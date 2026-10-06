/**
 * Photo / video uploader — modelled on Facebook & Booking.com host uploads.
 *
 * - Instant local previews; files upload in the background, 3 at a time
 * - Every photo is resized to ≤2048px JPEG before upload: 5–10× less data on
 *   mobile networks, consistent quality, correct orientation, and the EXIF
 *   location (the owner's home GPS) is stripped
 * - iPhone HEIC converted automatically; GIFs and videos uploaded as-is
 * - Signed uploads (server issues a signature) with unsigned-preset fallback for dev
 * - Auto-retry with backoff, a Retry button, waits for the connection to return
 * - Photos are tracked by id, so removing/reordering mid-upload is safe;
 *   removing a photo cancels its upload
 * - Reorder by drag (desktop) or move buttons (phones, keyboard); first photo = cover
 * - Warns before leaving the page while uploads are running
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { prepareImage, UploadError } from "../utils/prepareImage";
import {
  AlertTriangle, Camera, ChevronLeft, ChevronRight, Film, ImagePlus, Loader2, RotateCw, Star, UploadCloud, WifiOff, X,
} from "lucide-react";

import { api } from "../utils/api";
export interface UploadedPhoto {
  id: string;
  url: string;          // Cloudinary secure_url once uploaded
  localUrl: string;     // blob: preview shown immediately
  progress: number;     // 0 to 100
  done: boolean;        // finished. Successfully or not
  error: boolean;
  errorMsg?: string;
  isVideo: boolean;
  stage?: "queued" | "processing" | "uploading" | "offline";
  lowRes?: boolean;     // under 1024px on the long edge
}

interface Props {
  value: UploadedPhoto[];
  onChange: (photos: UploadedPhoto[]) => void;
  maxPhotos?: number;
  /** Decides the storage folder and who may upload. */
  purpose?: "listing" | "dispute" | "site";
}

const CLOUD  = import.meta.env.VITE_CLOUDINARY_CLOUD  ?? "";
const PRESET = import.meta.env.VITE_CLOUDINARY_PRESET ?? "";

const MAX_CONCURRENT = 3;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;   // Cloudinary video upload limit on our plan
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;    // before resizing. Anything bigger is not a photo
const RETRY_DELAYS_MS = [2000, 6000];
const SIGNATURE_TTL_MS = 45 * 60 * 1000;     // Cloudinary accepts signatures for 1 hour

const VIDEO_RE = /\.(mp4|mov|avi|mkv|webm|m4v|3gp)$/i;
const IMAGE_RE = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i;

const isVideoFile = (f: File) => f.type.startsWith("video/") || VIDEO_RE.test(f.name);
const isImageFile = (f: File) => f.type.startsWith("image/") || IMAGE_RE.test(f.name);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// ── Upload credentials ──────────────────────────────────────────────────────

type Credentials =
  | { kind: "signed"; cloud: string; fields: Record<string, string>; at: number }
  | { kind: "unsigned"; cloud: string; fields: Record<string, string>; at: number };

const credCache = new Map<string, Credentials>();

async function getCredentials(purpose: string): Promise<Credentials> {
  const cached = credCache.get(purpose);
  if (cached && Date.now() - cached.at < SIGNATURE_TTL_MS) return cached;
  try {
    const r = await api("/uploads/signature", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose }),
    });
    if (r.ok) {
      const s = await r.json();
      const creds: Credentials = {
        kind: "signed", cloud: s.cloud_name, at: Date.now(),
        fields: { api_key: s.api_key, timestamp: String(s.timestamp), signature: s.signature, folder: s.folder },
      };
      credCache.set(purpose, creds);
      return creds;
    }
    if (r.status === 401) throw new UploadError("Please sign in again to upload photos", false);
    if (r.status !== 503) throw new UploadError("Uploads are not available right now", true);
  } catch (e) {
    if (e instanceof UploadError) throw e;
    throw new UploadError("No connection", true);
  }
  // Server not configured for signed uploads (local dev): use the unsigned preset.
  if (CLOUD && PRESET) return { kind: "unsigned", cloud: CLOUD, fields: { upload_preset: PRESET }, at: Date.now() };
  throw new UploadError("Photo uploads are not set up yet", false);
}


function uploadOnce(
  blob: Blob, isVideo: boolean, creds: Credentials,
  onProgress: (pct: number) => void, register: (xhr: XMLHttpRequest) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    Object.entries(creds.fields).forEach(([k, v]) => fd.append(k, v));
    fd.append("file", blob);

    const xhr = new XMLHttpRequest();
    register(xhr);
    xhr.open("POST", `https://api.cloudinary.com/v1_1/${creds.cloud}/${isVideo ? "video" : "image"}/upload`);
    xhr.timeout = isVideo ? 15 * 60_000 : 2 * 60_000;
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100))); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText).secure_url); }
        catch { reject(new UploadError("Unexpected reply from the photo server", true)); }
      } else if (xhr.status === 401 || xhr.status === 403) {
        credCache.clear();   // signature expired. Next attempt fetches a new one
        reject(new UploadError("Upload permission expired", true));
      } else if (xhr.status >= 500 || xhr.status === 420 || xhr.status === 429) {
        reject(new UploadError("The photo server is busy", true));
      } else {
        reject(new UploadError(xhr.status === 413 ? "This file is too large" : "This file was rejected", false));
      }
    };
    xhr.onerror = () => reject(new UploadError("Connection lost", true));
    xhr.ontimeout = () => reject(new UploadError("Upload timed out on a slow connection", true));
    xhr.onabort = () => reject(new UploadError("Cancelled", false));
    xhr.send(fd);
  });
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const waitForOnline = () => new Promise<void>(r => {
  if (navigator.onLine) return r();
  window.addEventListener("online", () => r(), { once: true });
});

// ── Progress ring ───────────────────────────────────────────────────────────

function ProgressRing({ pct }: { pct: number }) {
  const r = 18; const circ = 2 * Math.PI * r;
  return (
    <svg className="absolute inset-0 m-auto" width={44} height={44} role="img" aria-label={`${pct}% uploaded`}>
      <circle cx={22} cy={22} r={r} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={3} />
      <circle cx={22} cy={22} r={r} fill="none" stroke="white" strokeWidth={3}
        strokeDasharray={circ} strokeDashoffset={circ - (pct / 100) * circ} strokeLinecap="round"
        transform="rotate(-90 22 22)" style={{ transition: "stroke-dashoffset 0.2s" }} />
      <text x={22} y={26} textAnchor="middle" fill="white" fontSize={9} fontWeight="bold">{pct}%</text>
    </svg>
  );
}

// ── Component ───────────────────────────────────────────────────────────────

export default function PhotoUploader({ value, onChange, maxPhotos = 20, purpose = "listing" }: Props) {
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The parent owns the list; uploads finish asynchronously, so always patch
  // the latest list by id — never by index.
  const latest = useRef(value);
  // Lists we emitted ourselves. A re-render can hand back an older one of
  // these after newer updates — adopting it would drop finished uploads. Only
  // adopt `value` when the parent changed the list itself (e.g. cleared it).
  const emitted = useRef(new WeakSet<UploadedPhoto[]>());
  if (value !== latest.current && !emitted.current.has(value)) latest.current = value;
  const files = useRef(new Map<string, File>());
  const xhrs = useRef(new Map<string, XMLHttpRequest>());
  const queue = useRef<string[]>([]);
  const active = useRef(0);
  const mounted = useRef(true);

  const commit = useCallback((next: UploadedPhoto[]) => {
    emitted.current.add(next);
    latest.current = next;
    onChange(next);
  }, [onChange]);
  const patch = useCallback((id: string, p: Partial<UploadedPhoto>) => {
    if (!latest.current.some(x => x.id === id)) return;   // removed meanwhile
    commit(latest.current.map(x => (x.id === id ? { ...x, ...p } : x)));
  }, [commit]);

  const runOne = useCallback(async (id: string) => {
    const file = files.current.get(id);
    if (!file) return;
    const isVideo = isVideoFile(file);
    try {
      patch(id, { stage: "processing", progress: 0, error: false, errorMsg: undefined, done: false });
      const prepared = isVideo ? { blob: file as Blob, lowRes: false } : await prepareImage(file, purpose !== "dispute");
      if (prepared.lowRes) patch(id, { lowRes: true });

      for (let attempt = 0; ; attempt++) {
        if (!navigator.onLine) { patch(id, { stage: "offline" }); await waitForOnline(); }
        if (!latest.current.some(x => x.id === id)) return;
        try {
          const creds = await getCredentials(purpose);
          patch(id, { stage: "uploading" });
          const url = await uploadOnce(prepared.blob, isVideo, creds,
            pct => patch(id, { progress: pct }), xhr => xhrs.current.set(id, xhr));
          patch(id, { url, progress: 100, done: true, stage: undefined });
          files.current.delete(id);
          return;
        } catch (e) {
          const err = e instanceof UploadError ? e : new UploadError("Upload failed", true);
          if (!err.retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
          await sleep(RETRY_DELAYS_MS[attempt]);
        } finally {
          xhrs.current.delete(id);
        }
      }
    } catch (e) {
      if (e instanceof UploadError && e.message === "Cancelled") return;
      patch(id, { error: true, done: true, stage: undefined, errorMsg: e instanceof Error ? e.message : "Upload failed" });
    }
  }, [patch, purpose]);

  const pump = useCallback(() => {
    while (active.current < MAX_CONCURRENT && queue.current.length) {
      const id = queue.current.shift()!;
      active.current++;
      runOne(id).finally(() => { active.current--; if (mounted.current) pump(); });
    }
  }, [runOne]);

  function addFiles(list: File[]) {
    if (!list.length) return;
    const skipped: string[] = [];
    const accepted = list.filter(f => {
      if (isVideoFile(f)) {
        if (f.size > MAX_VIDEO_BYTES) { skipped.push(`${f.name} is over 100 MB`); return false; }
        return true;
      }
      if (!isImageFile(f)) { skipped.push(`${f.name} isn't a photo or video`); return false; }
      if (f.size > MAX_IMAGE_BYTES) { skipped.push(`${f.name} is too large`); return false; }
      return true;
    });
    const room = Math.max(0, maxPhotos - latest.current.length);
    if (accepted.length > room) skipped.push(`only ${maxPhotos} files allowed. ${accepted.length - room} not added`);
    const take = accepted.slice(0, room);
    setNotice(skipped.length ? `Skipped: ${skipped.slice(0, 3).join(" · ")}${skipped.length > 3 ? ` · +${skipped.length - 3} more` : ""}` : null);
    if (!take.length) return;

    const added: UploadedPhoto[] = take.map(f => {
      const id = newId();
      files.current.set(id, f);
      queue.current.push(id);
      return { id, url: "", localUrl: URL.createObjectURL(f), progress: 0, done: false, error: false,
               isVideo: isVideoFile(f), stage: "queued" };
    });
    commit([...latest.current, ...added]);
    pump();
  }

  function retry(id: string) {
    if (!files.current.has(id)) return;
    patch(id, { error: false, done: false, errorMsg: undefined, stage: "queued", progress: 0 });
    queue.current.push(id);
    pump();
  }

  function retryAll() { latest.current.filter(p => p.error).forEach(p => retry(p.id)); }

  function remove(id: string) {
    xhrs.current.get(id)?.abort();
    queue.current = queue.current.filter(q => q !== id);
    files.current.delete(id);
    const p = latest.current.find(x => x.id === id);
    if (p) URL.revokeObjectURL(p.localUrl);
    commit(latest.current.filter(x => x.id !== id));
  }

  function move(id: string, to: number) {
    const list = [...latest.current];
    const from = list.findIndex(x => x.id === id);
    if (from < 0 || to < 0 || to >= list.length || from === to) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    commit(list);
  }

  // Leaving mid-upload loses work — warn like Facebook does.
  const uploading = value.some(p => !p.done);
  useEffect(() => {
    if (!uploading) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  // Unmounting (e.g. sheet closed) cancels uploads so the parent isn't left "uploading" forever.
  useEffect(() => {
    mounted.current = true;
    const xhrMap = xhrs.current;
    return () => {
      mounted.current = false;
      xhrMap.forEach(x => x.abort());
      queue.current = [];
      const stuck = latest.current.some(p => !p.done);
      if (stuck) onChange(latest.current.map(p => (p.done ? p : { ...p, done: true, error: true, errorMsg: "Upload interrupted", stage: undefined })));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = (e: ChangeEvent<HTMLInputElement>) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; };
  const onDrop = (e: DragEvent) => { e.preventDefault(); setDraggingOver(false); addFiles(Array.from(e.dataTransfer.files)); };

  const canAdd = value.length < maxPhotos;
  const failed = value.filter(p => p.error).length;
  const inFlight = value.filter(p => !p.done).length;
  const doneOk = value.filter(p => p.done && !p.error).length;
  const isListing = purpose === "listing";
  const accept = "image/*,video/*,.heic,.heif";

  return (
    <div className="space-y-3">
      <input ref={pickerRef} type="file" multiple accept={accept} className="hidden" onChange={onPick} disabled={!canAdd} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onPick} disabled={!canAdd} />

      {/* Drop zone — full size until the first photo, then compact */}
      <div
        onDragOver={e => { e.preventDefault(); setDraggingOver(true); }}
        onDragLeave={() => setDraggingOver(false)}
        onDrop={onDrop}
        className={`rounded-2xl border-2 border-dashed transition-colors ${value.length ? "p-3" : "py-7 px-4"} ${
          draggingOver ? "border-teal bg-teal/5"
            : canAdd ? "border-(--border)" : "border-(--border) opacity-50"}`}>
        {!value.length && (
          <div className="flex flex-col items-center text-center gap-1 mb-4">
            <UploadCloud className="w-8 h-8 text-(--text-muted)" aria-hidden="true" />
            <p className="text-sm font-semibold text-(--text-primary)">
              {draggingOver ? "Drop to upload" : isListing ? "Add photos of your place" : "Add photos"}
            </p>
            <p className="text-xs text-(--text-muted)">
              iPhone, Android, WhatsApp photos and videos all work{isListing ? " · bright, landscape shots look best" : ""}
            </p>
          </div>
        )}
        <div className="flex gap-2 justify-center">
          <button type="button" onClick={() => pickerRef.current?.click()} disabled={!canAdd}
            className="flex items-center gap-1.5 bg-forest disabled:bg-gray-300 text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
            <ImagePlus size={16} aria-hidden="true" /> {value.length ? "Add more" : "Choose photos"}
          </button>
          <button type="button" onClick={() => cameraRef.current?.click()} disabled={!canAdd}
            className="flex items-center gap-1.5 border border-(--border) text-(--text-primary) text-sm font-semibold px-4 py-2.5 rounded-xl disabled:opacity-50">
            <Camera size={16} aria-hidden="true" /> Take photo
          </button>
        </div>
        <p className="text-[11px] text-(--text-muted) text-center mt-2">{value.length}/{maxPhotos} added</p>
      </div>

      {notice && (
        <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400" role="alert">
          <AlertTriangle size={14} className="shrink-0 mt-px" aria-hidden="true" />{notice}
        </p>
      )}

      {/* Status bar */}
      {(inFlight > 0 || failed > 0) && (
        <div className="flex items-center gap-2 text-xs bg-(--bg-primary) rounded-xl px-3 py-2" aria-live="polite">
          {inFlight > 0 && <><Loader2 size={14} className="animate-spin text-teal" aria-hidden="true" />
            <span className="text-(--text-muted)">Uploading {inFlight} · {doneOk} done. You can keep filling in the form</span></>}
          {failed > 0 && (
            <button type="button" onClick={retryAll} className="ml-auto flex items-center gap-1 text-red-600 font-semibold">
              <RotateCw size={13} aria-hidden="true" /> Retry {failed} failed
            </button>
          )}
        </div>
      )}

      {value.length > 0 && (
        <ul className="grid grid-cols-3 gap-2" aria-label="Photos">
          {value.map((p, i) => (
            <li key={p.id}
              draggable={p.done && !p.error}
              onDragStart={e => { setDragId(p.id); e.dataTransfer.effectAllowed = "move"; }}
              onDragOver={e => { e.preventDefault(); if (dragId && dragId !== p.id) move(dragId, i); }}
              onDragEnd={() => setDragId(null)}
              className={`relative aspect-square rounded-xl overflow-hidden bg-(--bg-primary) ${
                i === 0 && isListing ? "ring-2 ring-forest" : ""} ${dragId === p.id ? "opacity-50" : ""}`}>
              {p.isVideo
                ? <video src={p.localUrl} className="w-full h-full object-cover" muted playsInline preload="metadata" />
                : <img src={p.localUrl} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />}

              {!p.done && (
                <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center">
                  {p.stage === "uploading" ? <ProgressRing pct={p.progress} />
                    : p.stage === "offline" ? <><WifiOff size={20} className="text-white" aria-hidden="true" /><span className="text-[10px] text-white mt-1">Waiting for signal</span></>
                    : <><Loader2 size={20} className="text-white animate-spin" aria-hidden="true" /><span className="text-[10px] text-white mt-1">{p.stage === "processing" ? "Preparing" : "Queued"}</span></>}
                </div>
              )}

              {p.error && (
                <div className="absolute inset-0 bg-red-900/70 flex flex-col items-center justify-center gap-1 px-1 text-center">
                  <p className="text-white text-[10px] leading-tight">{p.errorMsg ?? "Failed"}</p>
                  {files.current.has(p.id) && (
                    <button type="button" onClick={() => retry(p.id)}
                      className="flex items-center gap-1 bg-white text-red-700 text-[11px] font-bold px-2 py-1 rounded-lg">
                      <RotateCw size={11} aria-hidden="true" /> Retry
                    </button>
                  )}
                </div>
              )}

              {p.lowRes && p.done && !p.error && (
                <span className="absolute top-1 left-1 bg-amber-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md" title="This photo is small and may look blurry">
                  Low quality
                </span>
              )}
              {p.isVideo && !p.lowRes && (
                <span className="absolute top-1 left-1 bg-black/60 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                  <Film size={9} aria-hidden="true" /> Video
                </span>
              )}

              {isListing && i === 0 && p.done && !p.error && (
                <span className="absolute bottom-0 inset-x-0 text-center text-[11px] bg-forest text-white py-1 font-semibold">Cover photo</span>
              )}

              {/* Controls — buttons work on phones and keyboards, where drag doesn't */}
              <button type="button" onClick={() => remove(p.id)} aria-label={`Remove photo ${i + 1}`}
                className="absolute top-1 right-1 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center active:scale-90">
                <X size={14} className="text-white" />
              </button>
              {p.done && !p.error && value.length > 1 && !(isListing && i === 0) && (
                <div className="absolute bottom-1 inset-x-1 flex justify-between">
                  <button type="button" onClick={() => move(p.id, i - 1)} disabled={i === 0} aria-label={`Move photo ${i + 1} earlier`}
                    className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center disabled:opacity-0">
                    <ChevronLeft size={14} className="text-white" />
                  </button>
                  {isListing && (
                    <button type="button" onClick={() => move(p.id, 0)} aria-label={`Make photo ${i + 1} the cover`}
                      className="h-7 px-2 bg-black/60 rounded-full flex items-center gap-1 text-white text-[10px] font-semibold">
                      <Star size={11} aria-hidden="true" /> Cover
                    </button>
                  )}
                  <button type="button" onClick={() => move(p.id, i + 1)} disabled={i === value.length - 1} aria-label={`Move photo ${i + 1} later`}
                    className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center disabled:opacity-0">
                    <ChevronRight size={14} className="text-white" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {isListing && value.length > 0 && value.length < 8 && (
        <p className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2">
          <Camera size={14} className="shrink-0" aria-hidden="true" />
          Add {8 - value.length} more. Listings with 8+ photos get far more bookings. Show every room, the view and the outside.
        </p>
      )}
    </div>
  );
}

/** For forms: can the photos be saved yet? */
export function photoStatus(photos: UploadedPhoto[]) {
  const uploading = photos.filter(p => !p.done).length;
  const failed = photos.filter(p => p.error).length;
  const ready = photos.filter(p => p.done && !p.error && p.url);
  return { uploading, failed, ready, canSave: uploading === 0 && failed === 0 };
}

/**
 * Admin → Home page. Everything the team changes over time on the landing
 * page: offers, trending destinations and handpicked "unique stays".
 * Changes go live immediately (the home page caches for up to 5 minutes).
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown, ArrowUp, CalendarDays, Eye, EyeOff, ImageIcon, Loader2, Pencil, Plus, Sparkles, Star, Tag, Trash2,
} from "lucide-react";
import { apiJson } from "../../utils/api";
import { NAIVASHA_AREAS, areaLabel } from "../../utils/areas";
import { kes } from "../../utils/format";
import { imgSrc } from "../../utils/image";
import Modal from "../../components/ui/Modal";
import Notice from "../../components/ui/Notice";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "../../components/PhotoUploader";

const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";
const label = "block text-xs font-semibold text-(--text-primary) mb-1";

function Panel({ title, hint, action, children }: { title: string; hint: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-(--text-primary)">{title}</h2>
          <p className="text-xs text-(--text-muted) mt-0.5">{hint}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** One image: keep the current one, or upload a replacement. */
function ImageField({ value, onChange }: { value: string | null; onChange: (url: string | null, uploading: boolean) => void }) {
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  if (value && !photos.length) {
    return (
      <div className="flex items-center gap-3">
        <img src={imgSrc(value, 200)} alt="" className="w-24 h-16 object-cover rounded-lg" />
        <button type="button" onClick={() => onChange(null, false)} className="text-xs text-red-600 underline">Remove image</button>
      </div>
    );
  }
  return (
    <PhotoUploader purpose="site" maxPhotos={1} value={photos} onChange={next => {
      setPhotos(next);
      const s = photoStatus(next);
      onChange(s.ready[0]?.url ?? null, s.uploading > 0);
    }} />
  );
}

// ── Offers ────────────────────────────────────────────────────────────────────

interface OfferRow {
  id: string; title: string; subtitle: string | null; body: string | null; image_url: string | null;
  cta_label: string; link: string; promo_code: string | null; starts_at: string | null; ends_at: string | null;
  active: boolean; sort_order: number;
}
const EMPTY_OFFER: Omit<OfferRow, "id"> = {
  title: "", subtitle: "", body: "", image_url: null, cta_label: "See stays", link: "/search",
  promo_code: "", starts_at: null, ends_at: null, active: true, sort_order: 0,
};

const QUICK_LINKS = [
  { label: "All stays", link: "/search" },
  ...["cottage", "villa", "house", "apartment", "conference", "campsite"].map(t => ({ label: `Type: ${t}`, link: `/search?type=${t}` })),
  ...NAIVASHA_AREAS.map(a => ({ label: `Area: ${a.label}`, link: `/search?area=${a.slug}` })),
];

function offerStatus(o: OfferRow): { text: string; cls: string } {
  const now = Date.now();
  if (!o.active) return { text: "Off", cls: "bg-gray-100 text-gray-600" };
  if (o.starts_at && Date.parse(o.starts_at) > now) return { text: "Scheduled", cls: "bg-blue-100 text-blue-700" };
  if (o.ends_at && Date.parse(o.ends_at) <= now) return { text: "Ended", cls: "bg-gray-100 text-gray-600" };
  return { text: "Live", cls: "bg-green-100 text-green-800" };
}

// Date inputs are Naivasha calendar days; store as midnight EAT.
const toIso = (d: string) => (d ? new Date(`${d}T00:00:00+03:00`).toISOString() : null);
const toDay = (iso: string | null) =>
  iso ? new Date(Date.parse(iso) + 3 * 3600_000).toISOString().slice(0, 10) : "";

function OfferForm({ initial, onClose }: { initial: OfferRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState(() => ({ ...EMPTY_OFFER, ...(initial ?? {}) }));
  const [uploading, setUploading] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF(x => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => apiJson(initial ? `/admin/offers/${initial.id}` : "/admin/offers", {
      method: initial ? "PUT" : "POST",
      json: { ...f, subtitle: f.subtitle || null, body: f.body || null, promo_code: f.promo_code || null },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-offers"] }); qc.invalidateQueries({ queryKey: ["home-content"] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={initial ? "Edit offer" : "New offer"} icon={<Tag size={20} />}>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <div><label className={label}>Title *</label><input required maxLength={80} value={f.title} onChange={e => set("title", e.target.value)} placeholder="Weekend escape: 15% off" className={inputCls} /></div>
        <div><label className={label}>Highlight</label><input maxLength={120} value={f.subtitle ?? ""} onChange={e => set("subtitle", e.target.value)} placeholder="Save KES 2,000 on 2+ nights" className={inputCls} /></div>
        <div><label className={label}>Details</label><textarea maxLength={300} rows={2} value={f.body ?? ""} onChange={e => set("body", e.target.value)} placeholder="Book by 30 Nov for stays until 15 Dec." className={`${inputCls} resize-none`} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Starts</label><input type="date" value={toDay(f.starts_at)} onChange={e => set("starts_at", toIso(e.target.value))} className={inputCls} /></div>
          <div><label className={label}>Ends (not included)</label><input type="date" value={toDay(f.ends_at)} onChange={e => set("ends_at", toIso(e.target.value))} className={inputCls} /></div>
        </div>
        <div>
          <label className={label}>Opens</label>
          <select value={QUICK_LINKS.some(q => q.link === f.link) ? f.link : ""} onChange={e => e.target.value && set("link", e.target.value)} className={inputCls}>
            <option value="">Custom link…</option>
            {QUICK_LINKS.map(q => <option key={q.link} value={q.link}>{q.label}</option>)}
          </select>
          <input value={f.link} onChange={e => set("link", e.target.value)} className={`${inputCls} mt-1.5 font-mono text-xs`} aria-label="Link" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={label}>Button text</label><input maxLength={30} value={f.cta_label} onChange={e => set("cta_label", e.target.value)} className={inputCls} /></div>
          <div><label className={label}>Promo code</label><input maxLength={30} value={f.promo_code ?? ""} onChange={e => set("promo_code", e.target.value.toUpperCase())} placeholder="Optional" className={`${inputCls} font-mono`} /></div>
        </div>
        <div><label className={label}>Image (optional)</label><ImageField value={f.image_url} onChange={(url, up) => { set("image_url", url); setUploading(up); }} /></div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-(--text-primary)"><input type="checkbox" checked={f.active} onChange={e => set("active", e.target.checked)} className="w-4 h-4 accent-forest" /> Switched on</label>
          <label className="flex items-center gap-2 text-xs text-(--text-muted)">Order <input type="number" min={0} max={999} value={f.sort_order} onChange={e => set("sort_order", Number(e.target.value) || 0)} className="w-16 bg-(--bg-primary) border border-(--border) rounded-lg px-2 py-1" /></label>
        </div>
        {save.isError && <Notice tone="error">{(save.error as Error).message}</Notice>}
        <button disabled={save.isPending || uploading} className="w-full flex items-center justify-center gap-2 bg-forest disabled:bg-gray-300 text-white font-bold py-3 rounded-2xl text-sm">
          {save.isPending && <Loader2 size={16} className="animate-spin" />} {uploading ? "Uploading image…" : "Save offer"}
        </button>
      </form>
    </Modal>
  );
}

function OffersManager() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<OfferRow | null | "new">(null);
  const { data, isLoading } = useQuery({ queryKey: ["admin-offers"], queryFn: () => apiJson<OfferRow[]>("/admin/offers") });
  const del = useMutation({
    mutationFn: (id: string) => apiJson(`/admin/offers/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-offers"] }); qc.invalidateQueries({ queryKey: ["home-content"] }); },
  });
  return (
    <Panel title="Offers" hint="Shown under the search box while they run. Only add real promotions."
      action={<button onClick={() => setEditing("new")} className="flex items-center gap-1 bg-forest text-white text-xs font-semibold px-3 py-2 rounded-xl"><Plus size={14} /> New offer</button>}>
      {isLoading && <Loader2 className="animate-spin text-(--text-muted)" />}
      {data?.length === 0 && <p className="text-sm text-(--text-muted)">No offers. The section stays hidden until you add one.</p>}
      <ul className="space-y-2">
        {data?.map(o => {
          const st = offerStatus(o);
          return (
            <li key={o.id} className="flex items-center gap-3 bg-(--bg-primary) rounded-xl p-3">
              {o.image_url ? <img src={imgSrc(o.image_url, 120)} alt="" className="w-12 h-12 rounded-lg object-cover" />
                : <span className="w-12 h-12 rounded-lg bg-(--bg-surface) flex items-center justify-center"><Tag size={18} className="text-(--text-muted)" /></span>}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-(--text-primary) truncate">{o.title}</p>
                <p className="flex items-center gap-1 text-xs text-(--text-muted)">
                  <CalendarDays size={12} /> {toDay(o.starts_at) || "now"} → {toDay(o.ends_at) || "no end"}
                  {o.promo_code && <> · <span className="font-mono">{o.promo_code}</span></>}
                </p>
              </div>
              <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${st.cls}`}>{st.text}</span>
              <button onClick={() => setEditing(o)} aria-label={`Edit ${o.title}`} className="p-1.5 text-(--text-muted)"><Pencil size={15} /></button>
              <button onClick={() => { if (confirm(`Delete "${o.title}"?`)) del.mutate(o.id); }} aria-label={`Delete ${o.title}`} className="p-1.5 text-red-500"><Trash2 size={15} /></button>
            </li>
          );
        })}
      </ul>
      {editing && <OfferForm initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// ── Destinations ──────────────────────────────────────────────────────────────

interface DestRow { id: string; name: string; tagline: string | null; image_url: string | null; area: string | null; active: boolean; sort_order: number }

function DestinationForm({ initial, nextOrder, onClose }: { initial: DestRow | null; nextOrder: number; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<Omit<DestRow, "id">>(() => initial ?? { name: "", tagline: "", image_url: null, area: "", active: true, sort_order: nextOrder });
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    mutationFn: () => apiJson(initial ? `/admin/destinations/${initial.id}` : "/admin/destinations", {
      method: initial ? "PUT" : "POST", json: { ...f, tagline: f.tagline || null, area: f.area || null },
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-destinations"] }); qc.invalidateQueries({ queryKey: ["home-content"] }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title={initial ? "Edit destination" : "New destination"} icon={<Star size={20} />}>
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <div><label className={label}>Name *</label><input required maxLength={60} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} placeholder="Crescent Island" className={inputCls} /></div>
        <div><label className={label}>One line about it</label><input maxLength={120} value={f.tagline ?? ""} onChange={e => setF({ ...f, tagline: e.target.value })} placeholder="Walk with giraffe on the lake" className={inputCls} /></div>
        <div>
          <label className={label}>Stays shown for this destination</label>
          <select value={f.area ?? ""} onChange={e => setF({ ...f, area: e.target.value })} className={inputCls}>
            <option value="">All of Naivasha</option>
            {NAIVASHA_AREAS.map(a => <option key={a.slug} value={a.slug}>{a.label}</option>)}
          </select>
        </div>
        <div><label className={label}>Image</label><ImageField value={f.image_url} onChange={(url, up) => { setF(x => ({ ...x, image_url: url })); setUploading(up); }} /></div>
        <label className="flex items-center gap-2 text-sm text-(--text-primary)"><input type="checkbox" checked={f.active} onChange={e => setF({ ...f, active: e.target.checked })} className="w-4 h-4 accent-forest" /> Show on the home page</label>
        {save.isError && <Notice tone="error">{(save.error as Error).message}</Notice>}
        <button disabled={save.isPending || uploading} className="w-full flex items-center justify-center gap-2 bg-forest disabled:bg-gray-300 text-white font-bold py-3 rounded-2xl text-sm">
          {save.isPending && <Loader2 size={16} className="animate-spin" />} {uploading ? "Uploading image…" : "Save destination"}
        </button>
      </form>
    </Modal>
  );
}

function DestinationsManager() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<DestRow | null | "new">(null);
  const { data } = useQuery({ queryKey: ["admin-destinations"], queryFn: () => apiJson<DestRow[]>("/admin/destinations") });
  const refresh = () => { qc.invalidateQueries({ queryKey: ["admin-destinations"] }); qc.invalidateQueries({ queryKey: ["home-content"] }); };
  const put = (d: DestRow, patch: Partial<DestRow>) => apiJson(`/admin/destinations/${d.id}`, { method: "PUT", json: { ...d, ...patch } });
  const update = useMutation({ mutationFn: ({ d, patch }: { d: DestRow; patch: Partial<DestRow> }) => put(d, patch), onSuccess: refresh });
  const swap = useMutation({
    mutationFn: async ([a, b]: [DestRow, DestRow]) => { await put(a, { sort_order: b.sort_order }); await put(b, { sort_order: a.sort_order }); },
    onSuccess: refresh,
  });
  const del = useMutation({ mutationFn: (id: string) => apiJson(`/admin/destinations/${id}`, { method: "DELETE" }), onSuccess: refresh });
  const rows = data ?? [];

  return (
    <Panel title="Trending destinations" hint="Places guests come for. They're ranked by real bookings this month; your order breaks ties."
      action={<button onClick={() => setEditing("new")} className="flex items-center gap-1 bg-forest text-white text-xs font-semibold px-3 py-2 rounded-xl"><Plus size={14} /> Add</button>}>
      <ul className="space-y-2">
        {rows.map((d, i) => (
          <li key={d.id} className={`flex items-center gap-3 bg-(--bg-primary) rounded-xl p-3 ${d.active ? "" : "opacity-60"}`}>
            {d.image_url ? <img src={imgSrc(d.image_url, 120)} alt="" className="w-12 h-12 rounded-lg object-cover" />
              : <span className="w-12 h-12 rounded-lg bg-(--bg-surface) flex items-center justify-center" title="No image yet. A listing photo from the area is used"><ImageIcon size={18} className="text-(--text-muted)" /></span>}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-(--text-primary) truncate">{d.name}</p>
              <p className="text-xs text-(--text-muted) truncate">{areaLabel(d.area) ?? "All of Naivasha"}</p>
            </div>
            <button disabled={i === 0 || swap.isPending} onClick={() => swap.mutate([d, rows[i - 1]])} aria-label={`Move ${d.name} up`} className="p-1 text-(--text-muted) disabled:opacity-30"><ArrowUp size={15} /></button>
            <button disabled={i === rows.length - 1 || swap.isPending} onClick={() => swap.mutate([d, rows[i + 1]])} aria-label={`Move ${d.name} down`} className="p-1 text-(--text-muted) disabled:opacity-30"><ArrowDown size={15} /></button>
            <button onClick={() => update.mutate({ d, patch: { active: !d.active } })} aria-label={d.active ? `Hide ${d.name}` : `Show ${d.name}`} className="p-1 text-(--text-muted)">{d.active ? <Eye size={15} /> : <EyeOff size={15} />}</button>
            <button onClick={() => setEditing(d)} aria-label={`Edit ${d.name}`} className="p-1 text-(--text-muted)"><Pencil size={15} /></button>
            <button onClick={() => { if (confirm(`Delete "${d.name}"?`)) del.mutate(d.id); }} aria-label={`Delete ${d.name}`} className="p-1 text-red-500"><Trash2 size={15} /></button>
          </li>
        ))}
      </ul>
      {editing && <DestinationForm initial={editing === "new" ? null : editing} nextOrder={rows.length} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

// ── Featured ("Our most unique stays") ───────────────────────────────────────

interface Candidate { id: string; title: string; type: string; price_per_night: number; primary_image?: string; avg_rating?: number; featured_rank: number | null; featured_tagline: string | null }

function FeaturedManager() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["admin-featured"], queryFn: () => apiJson<Candidate[]>("/admin/featured") });
  const setFeature = useMutation({
    mutationFn: ({ id, rank, tagline }: { id: string; rank: number | null; tagline: string | null }) =>
      apiJson(`/admin/featured/${id}`, { method: "PUT", json: { featured_rank: rank, featured_tagline: tagline } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["admin-featured"] }); qc.invalidateQueries({ queryKey: ["home-content"] }); },
  });
  const featured = (data ?? []).filter(c => c.featured_rank != null);
  const others = (data ?? []).filter(c => c.featured_rank == null);
  // Re-number 1..n after any move so ranks stay tidy.
  const reorder = (list: Candidate[]) => list.forEach((c, i) => setFeature.mutate({ id: c.id, rank: i + 1, tagline: c.featured_tagline }));
  const move = (i: number, dir: -1 | 1) => { const l = [...featured]; [l[i], l[i + dir]] = [l[i + dir], l[i]]; reorder(l); };

  return (
    <Panel title="Our most unique stays" hint="Pick at least 4 homes worth the trip. Until then the section shows the top-rated homes.">
      {featured.length > 0 && featured.length < 4 && <Notice tone="info">{4 - featured.length} more to show your picks instead of top-rated homes.</Notice>}
      <ul className="space-y-2">
        {featured.map((c, i) => (
          <li key={c.id} className="bg-(--bg-primary) rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="w-6 text-center text-sm font-bold text-forest">{i + 1}</span>
              {c.primary_image && <img src={imgSrc(c.primary_image, 120)} alt="" className="w-12 h-12 rounded-lg object-cover" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-(--text-primary) truncate">{c.title}</p>
                <p className="text-xs text-(--text-muted)">{c.type} · {kes(c.price_per_night)}</p>
              </div>
              <button disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${c.title} up`} className="p-1 text-(--text-muted) disabled:opacity-30"><ArrowUp size={15} /></button>
              <button disabled={i === featured.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${c.title} down`} className="p-1 text-(--text-muted) disabled:opacity-30"><ArrowDown size={15} /></button>
              <button onClick={() => setFeature.mutate({ id: c.id, rank: null, tagline: null })} className="text-xs text-red-600 underline">Remove</button>
            </div>
            <label className="flex items-center gap-2">
              <Sparkles size={14} className="text-forest shrink-0" />
              <input defaultValue={c.featured_tagline ?? ""} maxLength={80} placeholder="What makes it special? e.g. Private jetty on the lake"
                onBlur={e => e.target.value !== (c.featured_tagline ?? "") && setFeature.mutate({ id: c.id, rank: c.featured_rank, tagline: e.target.value })}
                className="flex-1 bg-(--bg-surface) border border-(--border) rounded-lg px-2 py-1.5 text-xs text-(--text-primary) outline-hidden" />
            </label>
          </li>
        ))}
      </ul>
      {others.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-teal font-medium">Add a home ({others.length} live listings)</summary>
          <ul className="mt-2 space-y-1.5 max-h-80 overflow-y-auto">
            {others.map(c => (
              <li key={c.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-(--bg-primary)">
                {c.primary_image && <img src={imgSrc(c.primary_image, 80)} alt="" className="w-9 h-9 rounded-md object-cover" />}
                <span className="flex-1 min-w-0 truncate text-(--text-primary)">{c.title}</span>
                {c.avg_rating && <span className="text-xs text-(--text-muted)">★ {c.avg_rating}</span>}
                <button onClick={() => setFeature.mutate({ id: c.id, rank: featured.length + 1, tagline: null })}
                  className="flex items-center gap-1 text-xs font-semibold text-forest"><Plus size={13} /> Feature</button>
              </li>
            ))}
          </ul>
        </details>
      )}
      {setFeature.isError && <Notice tone="error">{(setFeature.error as Error).message}</Notice>}
    </Panel>
  );
}

export default function HomeContentAdmin() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-semibold text-(--text-primary)">Home page</h1>
        <p className="text-xs text-(--text-muted)">Changes appear on the site within 5 minutes. Property types and areas update automatically from listings.</p>
      </div>
      <OffersManager />
      <DestinationsManager />
      <FeaturedManager />
    </div>
  );
}

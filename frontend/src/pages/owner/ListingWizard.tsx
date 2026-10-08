/**
 * /owner/listing/new: list a home in about 10 minutes, one step at a time.
 * Works well on a phone (handy when signing a host up in person). The draft
 * is kept on this device until it's submitted, so nothing is lost.
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Camera, Check, FileText, Home, Landmark, Loader2, MapPin, ScrollText, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "../../components/PhotoUploader";
import LocationPicker from "../../components/LocationPicker";
import HouseRulesFields, { DEFAULT_HOUSE_RULES, rulesToPayload, type HouseRules } from "./HouseRulesFields";
import { KraPinForm, useCompliance } from "./Compliance";
import { NAIVASHA_AREAS, areaLabel } from "../../utils/areas";
import { api } from "../../utils/api";
import { kes } from "../../utils/format";

const DRAFT_KEY = "naivastay.listingDraft";
const TYPES = ["cottage", "villa", "house", "apartment", "conference", "campsite"];
const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";

interface Form {
  title: string; type: string; price_per_night: string; area: string; response_time_hours: string;
  lat: string; lng: string; what3words: string; landmark_instructions: string;
  description: string; tra_licence_no: string;
}
const EMPTY: Form = {
  title: "", type: "cottage", price_per_night: "", area: "", response_time_hours: "",
  lat: "", lng: "", what3words: "", landmark_instructions: "", description: "", tra_licence_no: "",
};
const STEPS: { title: string; Icon: LucideIcon }[] = [
  { title: "The basics", Icon: Home },
  { title: "Where is it?", Icon: MapPin },
  { title: "Photos", Icon: Camera },
  { title: "Description", Icon: FileText },
  { title: "House rules", Icon: ScrollText },
  { title: "Licence & tax", Icon: Landmark },
  { title: "Review", Icon: Check },
];
const MIN_PHOTOS = 5;

function L({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs text-(--text-muted) font-medium">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-(--text-muted)">{hint}</span>}
    </label>
  );
}

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null"); } catch { return null; }
}

export default function ListingWizard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const draft = loadDraft();
  const [step, setStep] = useState<number>(draft?.step ?? 0);
  const [form, setForm] = useState<Form>({ ...EMPTY, ...(draft?.form ?? {}) });
  const [rules, setRules] = useState<HouseRules>(draft?.rules ?? DEFAULT_HOUSE_RULES);
  const [rawDetails, setRawDetails] = useState<string>(draft?.rawDetails ?? "");
  // Restored photos: only the ones that finished uploading (preview blobs don't survive a reload).
  const [photos, setPhotos] = useState<UploadedPhoto[]>(
    (draft?.photos ?? []).map((p: { id: string; url: string; isVideo: boolean }) => ({ ...p, localUrl: p.url, progress: 100, done: true, error: false })),
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const compliance = useCompliance();
  const set = (k: keyof Form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const ps = photoStatus(photos);

  // Keep the draft on this device as they go.
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        step, form, rules, rawDetails, photos: ps.ready.map(p => ({ id: p.id, url: p.url, isVideo: p.isVideo })),
      }));
    } catch { /* private mode: no draft */ }
  }, [step, form, rules, rawDetails, ps.ready]);

  useEffect(() => { window.scrollTo({ top: 0 }); }, [step]);

  // What stops each step from moving on.
  const problems: string[][] = [
    [
      form.title.trim().length < 5 && "Give the home a title (at least 5 characters)",
      !(Number(form.price_per_night) >= 500) && "Set a nightly price (KES 500 or more)",
      !form.area && "Choose the area",
    ].filter(Boolean) as string[],
    [!form.landmark_instructions.trim() && "Add directions from a landmark guests can find"].filter(Boolean) as string[],
    [
      ps.uploading > 0 && "Wait for photos to finish uploading",
      ps.failed > 0 && "Retry or remove the photos that didn't upload",
      ps.ready.length < MIN_PHOTOS && `Add at least ${MIN_PHOTOS} photos (rooms, bathroom, outside, the view)`,
    ].filter(Boolean) as string[],
    [form.description.trim().length < 80 && "Write a description of at least a few sentences (80+ characters)"].filter(Boolean) as string[],
    [!rules.max_guests && "Say how many guests it sleeps"].filter(Boolean) as string[],
    [],
    [],
  ];
  const blocked = problems[step];
  const goLiveMissing = [
    !compliance.data?.kra_pin && "your KRA PIN",
    !form.tra_licence_no.trim() && "the TRA licence number",
  ].filter(Boolean) as string[];

  async function generateDescription() {
    if (!rawDetails.trim()) return;
    setAiLoading(true);
    const res = await api("/owner/ai/description", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ raw_details: rawDetails, property_type: form.type, price_per_night: Number(form.price_per_night) || 5000 }),
    });
    if (res.ok) set("description", (await res.json()).description);
    setAiLoading(false);
  }

  async function submit() {
    setSaving(true); setError("");
    try {
      const res = await api("/properties/", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form, ...rulesToPayload(rules),
          price_per_night: Number(form.price_per_night),
          lat: form.lat ? Number(form.lat) : null, lng: form.lng ? Number(form.lng) : null,
          response_time_hours: form.response_time_hours ? Number(form.response_time_hours) : null,
          area: form.area || null, what3words: form.what3words || null,
          tra_licence_no: form.tra_licence_no.trim() || null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(typeof d.detail === "string" ? d.detail : "Please check the details and try again");
        return;
      }
      const saved = await res.json();
      const img = await api(`/owner/properties/${saved.id}/images`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls: ps.ready.map(p => p.url) }),
      });
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* ignore */ }
      qc.invalidateQueries({ queryKey: ["owner-dash"] });
      qc.invalidateQueries({ queryKey: ["owner-properties"] });
      qc.invalidateQueries({ queryKey: ["owner-compliance"] });
      if (!img.ok) {
        navigate(`/owner/listing/edit/${saved.id}`, { state: { photoError: "Your photos couldn't be saved" } });
        return;
      }
      navigate("/owner/listings", { state: { justListed: saved.title } });
    } finally {
      setSaving(false);
    }
  }

  const { Icon } = STEPS[step];
  return (
    <div className="space-y-5 pb-28">
      {/* Progress */}
      <div>
        <div className="flex items-center justify-between text-xs text-(--text-muted) mb-2">
          <button type="button" onClick={() => (step === 0 ? navigate("/owner") : setStep(step - 1))} className="flex items-center gap-1">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {step === 0 ? "Cancel" : "Back"}
          </button>
          <span>Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="h-1.5 rounded-full bg-(--border) overflow-hidden" role="progressbar" aria-valuemin={1} aria-valuemax={STEPS.length} aria-valuenow={step + 1}>
          <div className="h-full bg-forest transition-all" style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
        </div>
        <h1 className="flex items-center gap-2 font-semibold text-lg text-(--text-primary) mt-4">
          <Icon className="w-5 h-5 text-forest" aria-hidden="true" /> {STEPS[step].title}
        </h1>
      </div>

      {step === 0 && (
        <div className="space-y-4">
          <L label="Title guests will see" hint="Say what makes it special, e.g. 'Lakeside Cottage with Hippo Views'">
            <input value={form.title} onChange={e => set("title", e.target.value)} maxLength={200} className={inputCls} />
          </L>
          <L label="Type of place">
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(t => (
                <button key={t} type="button" onClick={() => set("type", t)} aria-pressed={form.type === t}
                  className={`py-2.5 rounded-xl border text-sm capitalize ${form.type === t ? "border-forest bg-forest/10 text-forest font-semibold" : "border-(--border) text-(--text-primary)"}`}>
                  {t}
                </button>
              ))}
            </div>
          </L>
          <L label="Price per night (KES)" hint="The whole place, before NaivaStay's fee and tax. You can change it any time.">
            <input type="number" inputMode="numeric" min={500} value={form.price_per_night} onChange={e => set("price_per_night", e.target.value)} placeholder="e.g. 8500" className={inputCls} />
          </L>
          <L label="Area">
            <select value={form.area} onChange={e => set("area", e.target.value)} className={inputCls}>
              <option value="" disabled>Where in Naivasha is it?</option>
              {NAIVASHA_AREAS.map(a => <option key={a.slug} value={a.slug}>{a.label}</option>)}
            </select>
          </L>
          <L label="How fast do you usually reply? (hours, optional)">
            <input type="number" inputMode="numeric" min={1} max={72} value={form.response_time_hours} onChange={e => set("response_time_hours", e.target.value)} placeholder="e.g. 2" className={inputCls} />
          </L>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <div className="bg-(--bg-surface) rounded-2xl p-4">
            <p className="text-sm font-medium text-(--text-primary) mb-2">Drop a pin on the map</p>
            <LocationPicker lat={form.lat} lng={form.lng} onChange={(lat, lng) => { set("lat", lat); set("lng", lng); }} />
            <p className="text-[11px] text-(--text-muted) mt-2">Guests see the exact pin only after booking.</p>
          </div>
          <L label="Directions from a landmark" hint="e.g. From the Total petrol station on Moi South Lake Road, green gate 200m on the left">
            <textarea value={form.landmark_instructions} onChange={e => set("landmark_instructions", e.target.value)} rows={3} className={`${inputCls} resize-none`} />
          </L>
          <L label="what3words (optional)">
            <input value={form.what3words} onChange={e => set("what3words", e.target.value)} placeholder="e.g. lake.gate.path" className={inputCls} />
          </L>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <p className="text-sm text-(--text-muted)">
            At least {MIN_PHOTOS}: the best room first, then every bedroom, the bathroom, the kitchen, the outside and the view.
            Use daylight, and hold the phone level. Homes with 10+ good photos get far more bookings.
          </p>
          <div className="bg-(--bg-surface) rounded-2xl p-4">
            <PhotoUploader value={photos} onChange={setPhotos} maxPhotos={30} />
          </div>
          <p className="text-xs text-(--text-muted)">{ps.ready.length} photo{ps.ready.length === 1 ? "" : "s"} ready</p>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <p className="flex items-center gap-1.5 text-sm font-medium text-(--text-primary)">
              <Sparkles className="w-4 h-4 text-teal" aria-hidden="true" /> Let Avi write it
            </p>
            <textarea value={rawDetails} onChange={e => setRawDetails(e.target.value)} rows={3}
              placeholder="List what you have: 3 bedrooms, sleeps 6, lake view, Wi-Fi, BBQ, 2 km from Hell's Gate…" className={`${inputCls} resize-none`} />
            <button type="button" onClick={generateDescription} disabled={aiLoading || !rawDetails.trim()}
              className="text-sm font-semibold text-teal disabled:opacity-40">
              {aiLoading ? "Avi is writing…" : "Ask Avi to write it"}
            </button>
          </div>
          <L label="Description guests will read" hint="You can edit what Avi writes. Be honest: it's what guests hold you to.">
            <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={7} className={`${inputCls} resize-y`} />
          </L>
        </div>
      )}

      {step === 4 && <HouseRulesFields value={rules} onChange={setRules} pricePerNight={Number(form.price_per_night) || undefined} />}

      {step === 5 && (
        <div className="space-y-4">
          <p className="text-sm text-(--text-muted)">Kenyan law requires both before a home can take bookings. You can save the listing now and add them later, but it won't go live until they're in.</p>
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold text-(--text-primary)">Tourism Regulatory Authority (TRA) licence number</p>
            <input value={form.tra_licence_no} onChange={e => set("tra_licence_no", e.target.value.toUpperCase())} maxLength={40}
              placeholder="As shown on the TRA certificate" className={inputCls} />
          </div>
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold text-(--text-primary)">Your KRA PIN</p>
            {compliance.data?.kra_pin
              ? <p className="flex items-center gap-1.5 text-sm text-forest"><Check className="w-4 h-4" aria-hidden="true" /> Saved ({compliance.data.kra_pin})</p>
              : <KraPinForm current={null} />}
            <p className="text-[11px] text-(--text-muted)">
              NaivaStay deducts {compliance.data?.withholding_tax_pct ?? 5}% withholding tax from payouts and pays it to KRA for you.
            </p>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="space-y-3">
          <div className="bg-(--bg-surface) rounded-2xl overflow-hidden">
            {ps.ready[0] && <img src={ps.ready[0].url} alt="" className="w-full h-44 object-cover" />}
            <div className="p-4 space-y-1">
              <p className="font-semibold text-(--text-primary)">{form.title}</p>
              <p className="text-sm text-(--text-muted) capitalize">
                {form.type} · {areaLabel(form.area) ?? "Naivasha"} · sleeps {rules.max_guests || "?"} · {kes(Number(form.price_per_night) || 0)}/night
              </p>
              <p className="text-xs text-(--text-muted)">{ps.ready.length} photos · {rules.cancellation_policy} cancellation · {Number(rules.deposit_amount) ? `${kes(Number(rules.deposit_amount))} deposit` : "no deposit"}</p>
            </div>
          </div>
          <ul className="bg-(--bg-surface) rounded-2xl p-4 space-y-2 text-sm">
            {[
              ["Basics, location and description", true],
              [`${ps.ready.length} photos`, ps.ready.length >= MIN_PHOTOS],
              ["TRA licence number", !!form.tra_licence_no.trim()],
              ["Your KRA PIN", !!compliance.data?.kra_pin],
            ].map(([label, ok]) => (
              <li key={label as string} className="flex items-center gap-2">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center ${ok ? "bg-forest text-white" : "bg-amber-100 text-amber-700"}`}>
                  {ok ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : "!"}
                </span>
                <span className="text-(--text-primary)">{label as string}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-(--text-muted)">
            {goLiveMissing.length
              ? `Your listing will be saved, but can't go live until you add ${goLiveMissing.join(" and ")} (under More → Tax & licence).`
              : "The NaivaStay team will review your listing, usually within a day, and let you know when it's live."}
          </p>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </div>
      )}

      {/* Next / submit, always within thumb reach */}
      <div className="fixed left-0 right-0 bottom-[calc(4rem+var(--sab))] z-40 bg-(--bg-surface) border-t border-(--border) px-4 py-3">
        <div className="max-w-lg mx-auto">
          {blocked.length > 0 && <p className="text-xs text-amber-700 mb-2">{blocked[0]}</p>}
          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => setStep(step + 1)} disabled={blocked.length > 0}
              className="w-full flex items-center justify-center gap-2 bg-forest disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-2xl text-sm">
              Continue <ArrowRight className="w-4 h-4" aria-hidden="true" />
            </button>
          ) : (
            <button type="button" onClick={submit} disabled={saving}
              className="w-full flex items-center justify-center gap-2 bg-clay disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-2xl text-sm">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : "Submit for review"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

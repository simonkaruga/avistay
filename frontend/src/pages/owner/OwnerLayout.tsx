import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Routes, Route, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, BadgeCheck, Building2, CalendarDays, ChevronRight, ExternalLink, Home as HomeIcon, KeyRound, LayoutGrid, Link2, MessageSquareWarning, Sparkles, TrendingUp } from "lucide-react";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "../../components/PhotoUploader";
import ListingGallery from "./ListingGallery";
import OwnerBookings from "./OwnerBookings";
import Earnings from "./Earnings";
import OwnerDisputes from "./OwnerDisputes";
import { useOwnerProperties } from "./hooks";
import { NAIVASHA_AREAS } from "../../utils/areas";
import HouseRulesFields, { DEFAULT_HOUSE_RULES, rulesFromListing, rulesToPayload, type HouseRules } from "./HouseRulesFields";
import StatusBadge from "../../components/ui/StatusBadge";
import { fmtDate, kes } from "../../utils/format";
import LocationPicker from "../../components/LocationPicker";

import { api } from "../../utils/api";
// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardData {
  properties: number;
  bookings: number;
  total_earned: number;
  pending_payout: number;
  upcoming: UpcomingBooking[];
}

interface UpcomingBooking {
  id: string;
  property_id: string;
  check_in: string;
  check_out: string;
  status: string;
  total_amount: number;
  your_payout: number;
  property_title: string | null;
}

// ── API helpers ───────────────────────────────────────────────────────────────


async function fetchDashboard(): Promise<DashboardData> {
  const res = await api("/owner/dashboard");
  if (res.status === 401) throw new Error("unauth");
  if (!res.ok) throw new Error("failed");
  return res.json();
}

// ── Sub-pages ─────────────────────────────────────────────────────────────────

function Dashboard() {
  const { data, isLoading, error } = useQuery({ queryKey: ["owner-dash"], queryFn: fetchDashboard });
  const navigate = useNavigate();

  useEffect(() => {
    if (error?.message === "unauth") navigate("/profile?redirect=/owner");
  }, [error, navigate]);

  if (isLoading) return <LoadingSpinner />;
  if (error?.message === "unauth") return null;

  return (
    <div className="space-y-4">
      <h1 className="font-display italic text-2xl text-(--text-primary)">Your dashboard</h1>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Active listings", value: data?.properties ?? 0 },
          { label: "Total bookings", value: data?.bookings ?? 0 },
          { label: "Total earned (KES)", value: (data?.total_earned ?? 0).toLocaleString() },
          { label: "Pending payout", value: (data?.pending_payout ?? 0).toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-(--bg-surface) rounded-2xl p-4">
            <p className="text-xs text-(--text-muted) mb-1">{label}</p>
            <p className="text-xl font-bold text-(--text-primary)">{value}</p>
          </div>
        ))}
      </div>

      {/* Empty state for new owners */}
      {data?.bookings === 0 && (
        <div className="bg-(--bg-surface) rounded-2xl p-6 text-center space-y-3">
          <HomeIcon className="w-8 h-8 text-forest mx-auto" />
          <p className="font-medium text-(--text-primary)">Set up your listing to start earning</p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-mint h-2 rounded-full" style={{ width: `${data?.properties ? 60 : 20}%` }} />
          </div>
          <p className="text-xs text-(--text-muted)">
            {data?.properties ? "60%: Add more photos & get verified" : "20%: Create your first listing"}
          </p>
          <NavLink to="/owner/listing/new"
            className="inline-block bg-forest text-white text-sm font-medium px-6 py-2.5 rounded-xl">
            {data?.properties ? "Manage listing" : "Add your first home"}
          </NavLink>
        </div>
      )}

      {/* Quick block — prominent card for owners who also list on Airbnb/Booking.com */}
      <QuickBlockCard />

      {/* Upcoming bookings */}
      {(data?.upcoming?.length ?? 0) > 0 && (
        <div>
          <h2 className="font-semibold text-(--text-primary) mb-3">Upcoming stays</h2>
          <div className="space-y-3">
            {data!.upcoming.map(b => (
              <div key={b.id} className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    {b.property_title && <p className="text-sm font-semibold text-(--text-primary) truncate">{b.property_title}</p>}
                    <p className="flex items-center gap-1.5 text-xs text-(--text-muted) mt-0.5">
                      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> {fmtDate(b.check_in)} → {fmtDate(b.check_out)}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={b.status} />
                    <p className="text-sm font-bold text-(--text-primary) mt-1">{kes(b.your_payout)}</p>
                  </div>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-(--text-muted)">
                  <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  Ask the guest for their 4-digit code on arrival, then enter it under Bookings.
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Quick block card (shown on dashboard for multi-platform owners) ────────────

function QuickBlockCard() {
  const { data: myProps } = useOwnerProperties();
  const [open,       setOpen]       = useState(false);
  const [propertyId, setPropertyId] = useState("");
  const [checkIn,    setCheckIn]    = useState("");
  const [checkOut,   setCheckOut]   = useState("");
  const [saving,     setSaving]     = useState(false);
  const [result,     setResult]     = useState<"ok" | "error" | null>(null);

  async function block() {
    if (!propertyId || !checkIn || !checkOut) return;
    setSaving(true); setResult(null);
    const res = await api("/owner/block-dates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId, check_in: checkIn, check_out: checkOut }),
    });
    setResult(res.ok ? "ok" : "error");
    setSaving(false);
    if (res.ok) { setCheckIn(""); setCheckOut(""); }
  }

  return (
    <div className="rounded-2xl overflow-hidden border border-clay/25"
      style={{ background: "rgba(212,137,42,0.06)" }}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3.5 text-left">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(212,137,42,0.15)" }}>
            <AlertCircle size={16} className="text-clay" />
          </div>
          <div>
            <p className="text-sm font-semibold text-(--text-primary)">Got a booking on Airbnb?</p>
            <p className="text-xs text-(--text-muted)">Block those dates here instantly</p>
          </div>
        </div>
        <ChevronRight size={16} className={`text-(--text-muted) transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t border-clay/15 pt-3">
          <p className="text-xs text-(--text-muted)">
            Or text <span className="font-mono font-semibold text-(--text-primary)">BLOCK [code] [from] [to]</span> to our WhatsApp number. It's even faster.
          </p>
          <Field label="Property">
            <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className={inputCls}>
              <option value="">Select…</option>
              {(myProps ?? []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Check-in">
              <input type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)}
                min={new Date().toISOString().split("T")[0]} className={inputCls} />
            </Field>
            <Field label="Check-out">
              <input type="date" value={checkOut} onChange={e => setCheckOut(e.target.value)}
                min={checkIn} className={inputCls} />
            </Field>
          </div>
          <button onClick={block} disabled={saving || !propertyId || !checkIn || !checkOut}
            className="w-full py-3 rounded-xl text-white font-semibold text-sm disabled:opacity-50"
            style={{ background: "#b4511f" }}>
            {saving ? "Blocking…" : "Block these dates now"}
          </button>
          {result === "ok"    && <p className="text-sm text-teal text-center">Done. Dates are blocked. No new bookings can come in.</p>}
          {result === "error" && <p className="text-sm text-red-500 text-center">Something went wrong. Try again.</p>}
        </div>
      )}
    </div>
  );
}

function NewListing() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    title: "", type: "cottage", price_per_night: "", description: "",
    lat: "", lng: "", what3words: "", landmark_instructions: "", response_time_hours: "", area: "",
  });
  const [rules, setRules] = useState<HouseRules>(DEFAULT_HOUSE_RULES);
  const [rawDetails, setRawDetails] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function generateDescription() {
    if (!rawDetails) return;
    setAiLoading(true);
    const res = await api("/owner/ai/description", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        raw_details: rawDetails,
        property_type: form.type,
        price_per_night: Number(form.price_per_night) || 5000,
      }),
    });
    if (res.ok) {
      const data = await res.json();
      set("description", data.description);
    }
    setAiLoading(false);
  }

  /** Record uploaded photos on the listing in one request, in the order shown. */
  async function saveImages(propertyId: string, readyPhotos: UploadedPhoto[]): Promise<string | null> {
    const res = await api(`/owner/properties/${propertyId}/images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls: readyPhotos.map(p => p.url) }),
    });
    if (res.ok) return null;
    const d = await res.json().catch(() => ({}));
    return typeof d.detail === "string" ? d.detail : "Your photos couldn't be saved";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");
    const res = await api("/properties/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        ...rulesToPayload(rules),
        price_per_night: Number(form.price_per_night),
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
        response_time_hours: form.response_time_hours ? Number(form.response_time_hours) : null,
        area: form.area || null,
      }),
    });
    setSaving(false);
    if (res.ok) {
      const saved = await res.json();
      const { ready } = photoStatus(photos);
      const photoError = ready.length ? await saveImages(saved.id, ready) : null;
      queryClient.invalidateQueries({ queryKey: ["owner-dash"] });
      queryClient.invalidateQueries({ queryKey: ["owner-properties"] });
      if (photoError) {
        // Listing exists — send them to edit it, where they can add the photos again.
        navigate(`/owner/listing/edit/${saved.id}`, { state: { photoError } });
        return;
      }
      navigate("/owner");
    } else {
      const err = await res.json();
      setError(err.detail ?? "Failed to save listing");
    }
  }

  const types = ["cottage", "villa", "apartment", "conference", "campsite", "house"];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button type="button" onClick={() => navigate("/owner")} className="text-(--text-muted) text-xl">‹</button>
        <h1 className="font-semibold text-(--text-primary)">New listing</h1>
      </div>

      <Field label="Property title *">
        <input required value={form.title} onChange={e => set("title", e.target.value)}
          placeholder="e.g. Lakeside Cottage with Hippo Views"
          className={inputCls} />
      </Field>

      <Field label="Property type">
        <select value={form.type} onChange={e => set("type", e.target.value)} className={inputCls}>
          {types.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </Field>

      <Field label="Price per night (KES) *">
        <input required type="number" min={500} value={form.price_per_night}
          onChange={e => set("price_per_night", e.target.value)}
          placeholder="e.g. 8500" className={inputCls} />
      </Field>


      <Field label="Typical response time (hours)">
        <input type="number" min={1} max={72} value={form.response_time_hours}
          onChange={e => set("response_time_hours", e.target.value)}
          placeholder="e.g. 2" className={inputCls} />
      </Field>

      <Field label="Area *">
        <select required value={form.area} onChange={e => set("area", e.target.value)} className={inputCls}>
          <option value="" disabled>Where in Naivasha is it?</option>
          {NAIVASHA_AREAS.map(a => <option key={a.slug} value={a.slug}>{a.label}</option>)}
        </select>
      </Field>

      <HouseRulesFields value={rules} onChange={setRules} pricePerNight={Number(form.price_per_night) || undefined} />



      {/* AI description writer */}
      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
        <p className="text-sm font-medium text-(--text-primary)">
          Description
          <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-teal font-normal"><Sparkles className="w-3 h-3" /> Avi can write it</span>
        </p>
        <textarea value={rawDetails} onChange={e => setRawDetails(e.target.value)}
          placeholder="Tell AI what you have: 3 bed, lake view, sleeps 6, wifi, bbq, 2km from Hell's Gate…"
          rows={2} className={`${inputCls} resize-none`} />
        <button type="button" onClick={generateDescription} disabled={aiLoading || !rawDetails}
          className="text-xs text-teal font-medium disabled:opacity-40">
          {aiLoading ? "Avi is writing…" : <><Sparkles className="w-3.5 h-3.5 inline mr-1" />Ask Avi to write it</>}
        </button>
        <textarea value={form.description} onChange={e => set("description", e.target.value)}
          placeholder="Or write your own description…"
          rows={4} className={`${inputCls} resize-none`} />
      </div>

      {/* Location */}
      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-(--text-primary)">Location pin</p>
        <LocationPicker
          lat={form.lat}
          lng={form.lng}
          onChange={(lat, lng) => { set("lat", lat); set("lng", lng); }}
        />
        <Field label="What3words (optional)">
          <input value={form.what3words} onChange={e => set("what3words", e.target.value)}
            placeholder="e.g. lake.gate.path" className={inputCls} />
        </Field>
        <Field label="Landmark directions">
          <textarea value={form.landmark_instructions}
            onChange={e => set("landmark_instructions", e.target.value)}
            placeholder="e.g. From Total petrol station, green gate 200m on left"
            rows={2} className={`${inputCls} resize-none`} />
        </Field>
      </div>

      {/* Photos */}
      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-(--text-primary)">Photos &amp; videos</p>
        <PhotoUploader value={photos} onChange={setPhotos} maxPhotos={30} />
      </div>

      {error && <p className="text-red-500 text-sm text-center" role="alert">{error}</p>}
      {photoStatus(photos).failed > 0 && (
        <p className="text-amber-700 text-sm text-center" role="alert">Some photos didn't upload. Tap Retry on them or remove them.</p>
      )}

      <p className="text-xs text-(--text-muted) text-center">
        Your listing goes live after admin review
      </p>

      <button type="submit" disabled={saving || !photoStatus(photos).canSave}
        className="w-full bg-forest disabled:bg-gray-300 text-white font-semibold py-3.5 rounded-2xl text-sm">
        {saving ? "Saving…" : photoStatus(photos).uploading ? `Uploading ${photoStatus(photos).uploading} photo(s)…` : "Save listing"}
      </button>
    </form>
  );
}

// ── Edit listing ─────────────────────────────────────────────────────────────

function EditListing() {
  const { propId }    = useParams<{ propId: string }>();
  const navigate      = useNavigate();
  const queryClient   = useQueryClient();
  const [form, setForm] = useState({
    title: "", type: "cottage", price_per_night: "", description: "",
    lat: "", lng: "", what3words: "", landmark_instructions: "", response_time_hours: "", area: "",
  });
  const [rules, setRules] = useState<HouseRules>(DEFAULT_HOUSE_RULES);
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState("");
  const [loaded,  setLoaded]  = useState(false);
  const [newPhotos, setNewPhotos] = useState<UploadedPhoto[]>([]);
  const location = useLocation();
  const [photoNotice] = useState<string | null>((location.state as { photoError?: string } | null)?.photoError ?? null);

  // Load existing data
  useEffect(() => {
    if (!propId) return;
    api(`/properties/${propId}`).then(r => r.ok ? r.json() : null).then((p: any) => {
      if (!p) return;
      setForm({
        title: p.title ?? "",
        type: p.type ?? "cottage",
        price_per_night: String(p.price_per_night ?? ""),
        description: p.description ?? "",
        lat: p.lat != null ? String(p.lat) : "",
        lng: p.lng != null ? String(p.lng) : "",
        what3words: p.what3words ?? "",
        landmark_instructions: p.landmark_instructions ?? "",
        response_time_hours: p.response_time_hours != null ? String(p.response_time_hours) : "",
        area: p.area ?? "",
      });
      setRules(rulesFromListing(p));
      setLoaded(true);
    });
  }, [propId]);

  function set(key: string, val: string) { setForm(f => ({ ...f, [key]: val })); }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setError("");
    const r = await api(`/properties/${propId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        ...rulesToPayload(rules),
        price_per_night: Number(form.price_per_night),
        lat: form.lat ? Number(form.lat) : null,
        lng: form.lng ? Number(form.lng) : null,
        response_time_hours: form.response_time_hours ? Number(form.response_time_hours) : null,
        area: form.area || null,
      }),
    });
    if (r.ok && propId) {
      const { ready } = photoStatus(newPhotos);
      if (ready.length) {
        const pr = await api(`/owner/properties/${propId}/images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urls: ready.map(p => p.url) }),
        });
        if (!pr.ok) {
          const d = await pr.json().catch(() => ({}));
          setError(typeof d.detail === "string" ? d.detail : "Details saved, but the new photos couldn't be saved");
          setSaving(false);
          return;
        }
      }
      queryClient.invalidateQueries({ queryKey: ["owner-properties"] });
      queryClient.invalidateQueries({ queryKey: ["listing-images", propId] });
      navigate("/owner/listings");
    } else if (!r.ok) {
      const d = await r.json(); setError(d.detail ?? "Failed to save");
    }
    setSaving(false);
  }

  if (!loaded) return <LoadingSpinner />;

  const types = ["cottage","villa","apartment","conference","campsite","house"];

  return (
    <form onSubmit={handleSave} className="space-y-4">
      <div className="flex items-center gap-3 mb-2">
        <button type="button" onClick={() => navigate("/owner/listings")} className="text-(--text-muted) text-xl">‹</button>
        <h1 className="font-semibold text-(--text-primary)">Edit listing</h1>
      </div>

      <Field label="Property title *">
        <input required value={form.title} onChange={e => set("title", e.target.value)}
          className={inputCls} />
      </Field>

      <Field label="Property type">
        <select value={form.type} onChange={e => set("type", e.target.value)} className={inputCls}>
          {types.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select>
      </Field>

      <Field label="Price per night (KES) *">
        <input required type="number" min={500} value={form.price_per_night}
          onChange={e => set("price_per_night", e.target.value)} className={inputCls} />
      </Field>


      <Field label="Typical response time (hours)">
        <input type="number" min={1} max={72} value={form.response_time_hours}
          onChange={e => set("response_time_hours", e.target.value)}
          placeholder="e.g. 2" className={inputCls} />
      </Field>

      <Field label="Area *">
        <select required value={form.area} onChange={e => set("area", e.target.value)} className={inputCls}>
          <option value="" disabled>Where in Naivasha is it?</option>
          {NAIVASHA_AREAS.map(a => <option key={a.slug} value={a.slug}>{a.label}</option>)}
        </select>
      </Field>

      <HouseRulesFields value={rules} onChange={setRules} pricePerNight={Number(form.price_per_night) || undefined} />



      <Field label="Description">
        <textarea value={form.description} onChange={e => set("description", e.target.value)}
          rows={4} className={`${inputCls} resize-none`} />
      </Field>

      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-(--text-primary)">Location pin</p>
        <LocationPicker
          lat={form.lat}
          lng={form.lng}
          onChange={(lat, lng) => { set("lat", lat); set("lng", lng); }}
        />
        <Field label="What3words (optional)">
          <input value={form.what3words} onChange={e => set("what3words", e.target.value)}
            placeholder="e.g. lake.gate.path" className={inputCls} />
        </Field>
        <Field label="Landmark directions">
          <textarea value={form.landmark_instructions} onChange={e => set("landmark_instructions", e.target.value)}
            placeholder="e.g. From Total petrol station, green gate 200m on left"
            rows={2} className={`${inputCls} resize-none`} />
        </Field>
      </div>

      {/* Photos */}
      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <p className="text-sm font-medium text-(--text-primary)">Your photos</p>
        {photoNotice && <p className="text-sm text-amber-700" role="alert">{photoNotice}. Please add them again below.</p>}
        <p className="text-[13px] text-(--text-muted)">Changes here save straight away. The first photo is your cover.</p>
        {propId && <ListingGallery propertyId={propId} />}
        <p className="text-sm font-medium text-(--text-primary) pt-2">Add more photos &amp; videos</p>
        <PhotoUploader value={newPhotos} onChange={setNewPhotos} maxPhotos={30} />
      </div>

      {error && <p className="text-red-500 text-sm text-center" role="alert">{error}</p>}
      {photoStatus(newPhotos).failed > 0 && (
        <p className="text-amber-700 text-sm text-center" role="alert">Some photos didn't upload. Tap Retry on them or remove them.</p>
      )}

      <button type="submit" disabled={saving || !photoStatus(newPhotos).canSave}
        className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-3.5 rounded-2xl text-sm">
        {saving ? "Saving…" : photoStatus(newPhotos).uploading ? `Uploading ${photoStatus(newPhotos).uploading} photo(s)…` : "Save changes"}
      </button>
    </form>
  );
}

// ── Availability calendar ─────────────────────────────────────────────────────

function OwnerCalendar() {
  const [propertyId, setPropertyId] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [month, setMonth] = useState(new Date().getMonth()); // 0-indexed
  const [toggling, setToggling] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data: myProps } = useOwnerProperties();

  const { data: avail } = useQuery({
    queryKey: ["avail", propertyId, year, month],
    queryFn: async () => {
      if (!propertyId) return [];
      const res = await api(`/properties/${propertyId}/availability?year=${year}&month=${month + 1}`);
      if (!res.ok) return [];
      return res.json() as Promise<{ date: string; is_blocked: boolean; source: string }[]>;
    },
    enabled: !!propertyId,
  });

  const blockedSet = new Set((avail ?? []).filter(a => a.is_blocked).map(a => a.date));

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = new Date(year, month, 1).getDay();

  async function toggleDate(dateStr: string) {
    if (!propertyId) return;
    setToggling(dateStr);
    const isBlocked = blockedSet.has(dateStr);
    await api("/owner/availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId, date: dateStr, is_blocked: !isBlocked }),
    });
    queryClient.invalidateQueries({ queryKey: ["avail", propertyId, year, month] });
    setToggling(null);
  }

  const monthName = new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-(--text-primary)">Availability</h1>

      <Field label="Property">
        <select value={propertyId} onChange={e => setPropertyId(e.target.value)} className={inputCls}>
          <option value="">Select a property</option>
          {(myProps ?? []).map(p => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
      </Field>

      <div className="flex items-center justify-between">
        <button onClick={() => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }}
          className="text-(--text-muted) px-3 py-1 text-lg">‹</button>
        <p className="text-sm font-medium text-(--text-primary)">{monthName}</p>
        <button onClick={() => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }}
          className="text-(--text-muted) px-3 py-1 text-lg">›</button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {["S","M","T","W","T","F","S"].map((d, i) => (
          <div key={i} className="text-xs text-(--text-muted) py-1">{d}</div>
        ))}
        {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const blocked = blockedSet.has(dateStr);
          const loading = toggling === dateStr;
          return (
            <button key={day} onClick={() => toggleDate(dateStr)} disabled={loading || !propertyId}
              className={`rounded-lg py-2 text-xs font-medium transition-colors disabled:opacity-50 ${
                blocked ? "bg-red-100 text-red-600" : "bg-mint/20 text-teal"
              }`}>
              {loading ? "…" : day}
            </button>
          );
        })}
      </div>

      <div className="flex gap-3 text-xs">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-mint/20 inline-block" /> Available</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-100 inline-block" /> Blocked</span>
      </div>

      {!propertyId && (
        <p className="text-xs text-(--text-muted) text-center">Enter a property ID above to manage dates.</p>
      )}
    </div>
  );
}


const PLATFORM_LABELS: Record<string, { label: string; color: string; hint: string }> = {
  airbnb:  { label: "Airbnb",       color: "#FF5A5F", hint: "Airbnb → Calendar → Export calendar" },
  booking: { label: "Booking.com",  color: "#003580", hint: "Booking.com → Calendar → iCal" },
  vrbo:    { label: "VRBO",         color: "#1C5E8C", hint: "VRBO → Calendars → Export" },
  other:   { label: "Other",        color: "#6B7280", hint: "Any iCal (.ics) URL" },
};

interface ExternalCal { id: string; platform: string; ical_url: string; last_synced_at: string | null; }

function ICalSync() {
  const [propertyId, setPropertyId] = useState("");
  const [platform,   setPlatform]   = useState("airbnb");
  const [url,        setUrl]        = useState("");
  const [addStatus,  setAddStatus]  = useState<"idle" | "loading" | "ok" | "error">("idle");
  const [calendars,  setCalendars]  = useState<ExternalCal[]>([]);
  const [copied,     setCopied]     = useState(false);
  const { data: myProps } = useOwnerProperties();

  useEffect(() => {
    if (!propertyId) return;
    api(`/ical/calendars/${propertyId}`).then(r => r.ok ? r.json() : []).then(setCalendars);
  }, [propertyId, addStatus]);

  async function handleAdd() {
    if (!propertyId || !url) return;
    setAddStatus("loading");
    const res = await api("/ical/calendars", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property_id: propertyId, platform, ical_url: url }),
    });
    setAddStatus(res.ok ? "ok" : "error");
    if (res.ok) setUrl("");
  }

  async function handleRemove(calId: string) {
    await api(`/ical/calendars/${calId}`, { method: "DELETE" });
    setCalendars(c => c.filter(x => x.id !== calId));
  }

  function copyExportUrl() {
    navigator.clipboard.writeText(`https://avistay.com/api/ical/export/${propertyId}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const exportUrl = `https://avistay.com/api/ical/export/${propertyId}`;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-semibold text-(--text-primary) text-lg">Calendar sync</h1>
        <p className="text-sm text-(--text-muted) mt-1">
          Connect every platform you list on. We sync every <strong>30 minutes</strong> and alert you
          immediately on WhatsApp if a double-booking is detected.
        </p>
      </div>

      {/* How it prevents double-bookings */}
      <div className="rounded-2xl p-4 space-y-2.5"
        style={{ background: "rgba(31,77,54,0.06)", border: "1px solid rgba(31,77,54,0.14)" }}>
        <p className="text-sm font-semibold text-forest">How double-booking protection works</p>
        {[
          "Paste each platform's iCal URL below. We import their blocked dates automatically",
          "Copy your Avistay export URL and paste it into Airbnb & Booking.com as an external calendar",
          "We sync every 30 minutes both ways. If a conflict is ever found, you get a WhatsApp alert instantly",
        ].map((s, i) => (
          <div key={i} className="flex gap-2.5">
            <span className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0 mt-0.5"
              style={{ background: "#1f4d36" }}>{i + 1}</span>
            <p className="text-sm text-(--text-muted)">{s}</p>
          </div>
        ))}
      </div>

      {/* Property selector */}
      <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <Field label="Select property">
          <select value={propertyId} onChange={e => { setPropertyId(e.target.value); setAddStatus("idle"); }} className={inputCls}>
            <option value="">Choose a property…</option>
            {(myProps ?? []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </Field>
      </div>

      {propertyId && (
        <>
          {/* Connected calendars list */}
          <div className="bg-(--bg-surface) rounded-2xl overflow-hidden">
            <p className="text-xs font-bold text-(--text-muted) uppercase tracking-wide px-4 pt-4 pb-2">
              Connected platforms
            </p>
            {calendars.length === 0 ? (
              <p className="text-sm text-(--text-muted) px-4 pb-4">None yet. Add your first one below.</p>
            ) : (
              <div className="divide-y divide-(--border)">
                {calendars.map(c => {
                  const pl = PLATFORM_LABELS[c.platform] ?? PLATFORM_LABELS.other;
                  return (
                    <div key={c.id} className="flex items-center gap-3 px-4 py-3">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: pl.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-(--text-primary)">{pl.label}</p>
                        <p className="text-[12px] text-(--text-muted) truncate">{c.ical_url}</p>
                        {c.last_synced_at && (
                          <p className="text-[12px] text-teal">
                            Last synced {new Date(c.last_synced_at).toLocaleString("en-KE", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}
                          </p>
                        )}
                      </div>
                      <button onClick={() => handleRemove(c.id)}
                        className="text-red-500 text-[12px] font-semibold shrink-0">Remove</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add new calendar */}
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-(--text-primary)">Add a calendar</p>
            <Field label="Platform">
              <select value={platform} onChange={e => setPlatform(e.target.value)} className={inputCls}>
                {Object.entries(PLATFORM_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </Field>
            <Field label={`iCal URL (${PLATFORM_LABELS[platform]?.hint})`}>
              <input value={url} onChange={e => setUrl(e.target.value)}
                placeholder="https://…" className={inputCls} />
            </Field>
            <button onClick={handleAdd} disabled={addStatus === "loading" || !url}
              className="w-full bg-forest disabled:bg-gray-300 text-white font-semibold py-3 rounded-xl text-sm">
              {addStatus === "loading" ? "Connecting…" : `Connect ${PLATFORM_LABELS[platform]?.label}`}
            </button>
            {addStatus === "ok"    && <p className="text-teal text-sm text-center">Connected! Syncing now. Dates will be blocked within a minute.</p>}
            {addStatus === "error" && <p className="text-red-500 text-sm text-center">Could not fetch that URL. Make sure the calendar is set to public.</p>}
          </div>

          {/* Export URL */}
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <p className="text-sm font-semibold text-(--text-primary)">Your Avistay export URL</p>
            <p className="text-sm text-(--text-muted)">
              Paste this into Airbnb and Booking.com as an "external calendar" so they block your Avistay dates automatically.
            </p>
            <div className="bg-(--bg-primary) rounded-xl px-3 py-2.5 flex items-center gap-2">
              <p className="text-[12px] text-(--text-muted) flex-1 truncate font-mono">{exportUrl}</p>
              <button onClick={copyExportUrl}
                className="text-sm font-semibold shrink-0"
                style={{ color: copied ? "#1f4d36" : "var(--color-teal)" }}>
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── My listings ───────────────────────────────────────────────────────────────

function MyListings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: myProps, isLoading } = useOwnerProperties();

  async function toggleActive(id: string, currentActive: boolean) {
    // Admin must approve listings — owners can only deactivate their own
    if (!currentActive) {
      alert("Listings can only be reactivated by admin after review. Contact support.");
      return;
    }
    await api(`/properties/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    queryClient.invalidateQueries({ queryKey: ["owner-properties"] });
  }

  if (isLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-(--text-primary)">My listings</h1>
        <NavLink to="/owner/listing/new"
          className="text-xs bg-forest text-white px-3 py-1.5 rounded-xl font-medium">
          + New
        </NavLink>
      </div>

      {(!myProps || myProps.length === 0) && (
        <div className="flex flex-col items-center py-12 text-center space-y-3">
          <HomeIcon className="w-10 h-10 text-forest mx-auto" />
          <p className="font-medium text-(--text-primary)">No listings yet</p>
          <NavLink to="/owner/listing/new"
            className="bg-forest text-white text-sm font-medium px-6 py-2.5 rounded-xl">
            Add your first home
          </NavLink>
        </div>
      )}

      <div className="space-y-3">
        {myProps?.map((p: any) => (
          <div key={p.id} className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-(--text-primary) text-sm truncate">{p.title}</p>
                <p className="text-xs text-(--text-muted) capitalize mt-0.5">
                  {p.type} · KES {p.price_per_night?.toLocaleString()}/night
                </p>
              </div>
              <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${
                p.active ? "bg-mint/20 text-teal" : "bg-yellow-100 text-yellow-700"
              }`}>
                {p.active ? "Live" : "Pending review"}
              </span>
            </div>
            {p.verified_tier > 0 && (
              <p className="flex items-center gap-1 text-xs text-forest"><BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Tier {p.verified_tier} verified</p>
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => navigate(`/owner/listing/edit/${p.id}`)}
                className="flex-1 border border-(--border) text-(--text-muted) text-xs py-2 rounded-xl"
              >
                Edit
              </button>
              {p.active && (
                <button
                  onClick={() => toggleActive(p.id, p.active)}
                  className="flex-1 border border-red-200 text-red-600 text-xs py-2 rounded-xl"
                >
                  Deactivate
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── More menu (Calendar · iCal · Claims · New listing) ───────────────────────

function MoreMenu() {
  const navigate = useNavigate();
  const items = [
    { to: "/owner/calendar",    Icon: CalendarDays, label: "Availability calendar", desc: "Block or open dates on your property" },
    { to: "/owner/ical",        Icon: Link2,        label: "iCal sync",             desc: "Connect Airbnb / Booking.com calendar" },
    { to: "/owner/claims",      Icon: MessageSquareWarning, label: "Problems & damage claims", desc: "Guest reports and your damage claims" },
    { to: "/owner/listing/new", Icon: Building2,    label: "Add new listing",       desc: "List another property on Avistay" },
    { to: "/",                  Icon: ExternalLink, label: "Browse as guest",       desc: "Switch to the guest-facing portal" },
  ];
  return (
    <div>
      <h1 className="font-semibold text-(--text-primary) mb-4">More</h1>
      <div className="space-y-2">
        {items.map(({ to, Icon, label, desc }) => (
          <button key={to} type="button" onClick={() => navigate(to)}
            className="w-full flex items-center gap-4 bg-(--bg-surface) border border-(--border) rounded-2xl px-4 py-4 text-left active:scale-[.98] transition-transform">
            <span className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "rgba(31,77,54,0.08)" }}>
              <Icon className="w-5 h-5 text-forest" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-(--text-primary)">{label}</p>
              <p className="text-xs text-(--text-muted) mt-0.5">{desc}</p>
            </div>
            <ChevronRight className="w-4 h-4 text-(--text-muted) shrink-0" />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Bottom nav tabs ───────────────────────────────────────────────────────────

const OWNER_TABS = [
  { to: "/owner",          label: "Home",     Icon: HomeIcon,     end: true  },
  { to: "/owner/listings", label: "Listings", Icon: Building2,    end: false },
  { to: "/owner/bookings", label: "Bookings", Icon: CalendarDays, end: false },
  { to: "/owner/earnings", label: "Earnings", Icon: TrendingUp,   end: false },
  { to: "/owner/more",     label: "More",     Icon: LayoutGrid,   end: false },
] as const;

// ── Layout ────────────────────────────────────────────────────────────────────

export default function OwnerLayout() {
  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-20">

      {/* ── Host top bar ── */}
      <header
        className="fixed top-0 left-0 right-0 z-50 flex h-14 items-center px-4 border-b border-(--border)"
        style={{ background: "rgba(255,255,255,0.95)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)" }}
      >
        <div className="flex items-center gap-2 mr-auto">
          <span
            className="w-8 h-8 rounded-xl flex items-center justify-center text-white text-xs font-black shrink-0"
            style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 60%, #b8722a 100%)", boxShadow: "0 2px 8px rgba(31,77,54,0.30)" }}
          >A</span>
          <span className="font-display italic text-forest leading-none" style={{ fontSize: "1.15rem" }}>
            Avistay
          </span>
          <span className="ml-1 text-[13px] font-bold text-teal bg-teal/10 px-2 py-0.5 rounded-full">
            Host
          </span>
        </div>
        <NavLink to="/" className="flex items-center gap-1.5 text-xs text-(--text-muted)">
          <ExternalLink className="w-3.5 h-3.5" /> Guest view
        </NavLink>
      </header>

      {/* ── Page content ── */}
      <div className="px-4 py-5 max-w-lg mx-auto">
        <Routes>
          <Route path="/"                     element={<Dashboard />} />
          <Route path="/listings"             element={<MyListings />} />
          <Route path="/listing/new"          element={<NewListing />} />
          <Route path="/listing/edit/:propId" element={<EditListing />} />
          <Route path="/bookings"             element={<OwnerBookings />} />
          <Route path="/earnings"             element={<Earnings />} />
          <Route path="/calendar"             element={<OwnerCalendar />} />
          <Route path="/ical"                 element={<ICalSync />} />
          <Route path="/claims"               element={<OwnerDisputes />} />
          <Route path="/more"                 element={<MoreMenu />} />
        </Routes>
      </div>

      {/* ── Host bottom nav ── */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 flex h-16 items-stretch border-t border-(--border)"
        style={{
          background: "rgba(255,255,255,0.95)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {OWNER_TABS.map(({ to, label, Icon, end }) => (
          <NavLink
            key={to} to={to} end={end}
            className={({ isActive }) =>
              `relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                isActive ? "text-forest" : "text-(--text-muted)"
              }`
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-8 rounded-full"
                    style={{ background: "rgba(31,77,54,0.08)" }} aria-hidden="true" />
                )}
                <Icon className="w-6 h-6 relative z-10" />
                <span className={`text-[13px] leading-none relative z-10 ${isActive ? "font-bold" : "font-medium"}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-(--text-muted) font-medium">{label}</label>
      {children}
    </div>
  );
}

function LoadingSpinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-mint border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

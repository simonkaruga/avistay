import { useState } from "react";
import { useProtectionWindow, useSite } from "../components/SiteNotice";
import { useNavigate } from "react-router-dom";
import { Banknote, CalendarSync, CheckCircle2, Clock, Percent, ShieldCheck, SlidersHorizontal, XCircle } from "lucide-react";
import { useSEO } from "../utils/seo";

import { api } from "../utils/api";
const PROPERTY_TYPES = ["Cottage", "Villa", "House", "Apartment", "Conference / Retreat", "Campsite"];

const inputCls = "w-full bg-(--bg-surface) border border-(--border) text-(--text-primary) rounded-xl px-4 py-3 text-sm outline-hidden focus:border-teal transition-colors";

export default function OwnerApply() {
  const site = useSite();
  const payWindow = useProtectionWindow();
  useSEO({ title: "List Your Property on Avistay", description: "Apply to list your Naivasha property on Avistay." });

  const navigate = useNavigate();
  const [step, setStep] = useState<"form" | "submitted" | "check">("form");
  const [checkPhone, setCheckPhone] = useState("");
  const [appStatus, setAppStatus] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [form, setForm] = useState({
    full_name: "", phone: "", email: "",
    national_id: "", property_type: "", property_location: "", property_description: "",
  });

  function set(k: string, v: string) { setForm(f => ({ ...f, [k]: v })); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.full_name || !form.phone || !form.national_id || !form.property_type || !form.property_location) {
      setError("Please fill in all required fields"); return;
    }
    setSaving(true); setError("");
    const res = await api("/applications/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      setStep("submitted");
    } else {
      const d = await res.json();
      setError(d.detail ?? "Failed to submit. Try again");
    }
  }

  async function checkStatus() {
    if (!checkPhone) return;
    const res = await api(`/applications/status/${encodeURIComponent(checkPhone)}`);
    if (res.ok) setAppStatus(await res.json());
  }

  if (step === "submitted") return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 text-center pt-header">
      <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mb-4">
        <CheckCircle2 size={32} className="text-forest" />
      </div>
      <h1 className="font-display italic text-2xl text-(--text-primary) mb-2">Application received!</h1>
      <p className="text-(--text-muted) text-sm max-w-xs mb-6">
        We'll review your application within <strong>24 to 48 hours</strong> and contact you on <strong>{form.phone}</strong> once approved.
      </p>
      <div className="bg-(--bg-surface) rounded-2xl p-4 w-full max-w-sm text-left space-y-1 mb-6 border border-(--border)">
        <p className="text-xs text-(--text-muted) uppercase tracking-wide font-semibold mb-2">What happens next</p>
        {["Our team verifies your ID and property details", "You receive an SMS once approved", "Log in and start listing your property"].map((s, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="w-5 h-5 rounded-full bg-forest text-white text-[13px] font-bold flex items-center justify-center shrink-0 mt-0.5">{i + 1}</span>
            <p className="text-sm text-(--text-primary)">{s}</p>
          </div>
        ))}
      </div>
      <button onClick={() => navigate("/")} className="text-teal text-sm font-medium underline">Back to home</button>
    </div>
  );

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-10">

      {/* Hero banner */}
      <div className="relative overflow-hidden px-5 pt-8 pb-10 text-center"
        style={{ background: "linear-gradient(155deg, #0d2e10 0%, #1a4a1e 40%, #5c3010 75%, #2e1506 100%)" }}>
        <div className="absolute -top-8 -right-8 w-44 h-44 rounded-full" style={{ background: "rgba(62,200,144,0.07)" }} />
        <p className="text-mint text-[13px] font-semibold tracking-[0.3em] uppercase mb-3">For property owners</p>
        <h1 className="font-display italic text-white text-3xl leading-tight mb-2">List your home.<br />Get paid on M-Pesa.</h1>
        <p className="text-white/70 text-sm">Free to list. You only pay a commission when a guest stays.</p>
      </div>

      <div className="px-4 pt-6 max-w-lg mx-auto space-y-5">

        {/* Why host with Avistay — the details owners decide on */}
        <section className="bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
          <h2 className="font-semibold text-(--text-primary) mb-3">Why host with Avistay</h2>
          <ul className="space-y-3">
            {[
              { Icon: Banknote, title: "Paid on M-Pesa, fast", text: `Your payout reaches your M-Pesa ${payWindow} after each guest checks in.` },
              { Icon: Percent, title: "Fair, simple commission", text: `${site.commissionPct}% of the room price. Our first 20 hosts pay just 7%. Guests pay the service fee.` },
              { Icon: SlidersHorizontal, title: "Your home, your rules", text: "You set the price, minimum stay, cancellation policy, damage deposit, check-in times and house rules." },
              { Icon: ShieldCheck, title: "Protected against damage", text: "If you set a deposit, we hold it and pay you from it when damage is reported and confirmed." },
              { Icon: CalendarSync, title: "No double bookings", text: "Sync your Airbnb and Booking.com calendars, or block dates from WhatsApp." },
            ].map(({ Icon, title, text }) => (
              <li key={title} className="flex gap-3">
                <span className="w-9 h-9 rounded-xl bg-forest/10 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-forest" aria-hidden="true" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-(--text-primary)">{title}</span>
                  <span className="block text-sm text-(--text-muted)">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        {/* Check existing application */}
        <div className="bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
          <p className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide mb-3">Already applied? Check your status</p>
          <div className="flex gap-2">
            <input value={checkPhone} onChange={e => setCheckPhone(e.target.value)}
              placeholder="+254712345678" className={`${inputCls} flex-1`} />
            <button onClick={checkStatus}
              className="bg-forest text-white text-sm font-semibold px-4 rounded-xl">
              Check
            </button>
          </div>
          {appStatus && (
            <div className={`mt-3 px-3 py-2 rounded-xl text-sm font-medium ${
              appStatus.status === "approved" ? "bg-green-50 text-green-700" :
              appStatus.status === "rejected" ? "bg-red-50 text-red-600" :
              appStatus.status === "none" ? "bg-gray-50 text-gray-500" :
              "bg-yellow-50 text-yellow-700"
            }`}>
              {appStatus.status === "none" && "No application found for this number."}
              {appStatus.status === "pending" && <span className="flex items-center gap-2"><Clock size={14} /> Your application is under review. We'll SMS you when it's done.</span>}
              {appStatus.status === "approved" && <span className="flex items-center gap-2"><CheckCircle2 size={14} /> Approved! Log in with your phone number to access the owner dashboard.</span>}
              {appStatus.status === "rejected" && <span className="flex items-center gap-2"><XCircle size={14} /> Not approved. {appStatus.rejection_reason ? `Reason: ${appStatus.rejection_reason}` : "Contact support for more info."}</span>}
            </div>
          )}
        </div>

        {/* Application form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <h2 className="font-semibold text-(--text-primary)">New application</h2>

          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-4 border border-(--border)">
            <p className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide">Your details</p>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Full name *</label>
              <input value={form.full_name} onChange={e => set("full_name", e.target.value)}
                placeholder="As on your National ID" className={inputCls} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Phone number *</label>
              <input type="tel" value={form.phone} onChange={e => set("phone", e.target.value)}
                placeholder="+254712345678" className={inputCls} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Email (optional)</label>
              <input type="email" value={form.email} onChange={e => set("email", e.target.value)}
                placeholder="your@email.com" className={inputCls} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">National ID / Passport number *</label>
              <input value={form.national_id} onChange={e => set("national_id", e.target.value)}
                placeholder="e.g. 12345678" className={inputCls} />
              <p className="text-[13px] text-(--text-muted)">Used for identity verification only. Not shared publicly.</p>
            </div>
          </div>

          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-4 border border-(--border)">
            <p className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide">Property details</p>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Property type *</label>
              <select value={form.property_type} onChange={e => set("property_type", e.target.value)} className={inputCls}>
                <option value="">Select type…</option>
                {PROPERTY_TYPES.map(t => <option key={t} value={t.toLowerCase()}>{t}</option>)}
              </select>
            </div>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Location / area *</label>
              <input value={form.property_location} onChange={e => set("property_location", e.target.value)}
                placeholder="e.g. Near Hell's Gate, South Lake Rd" className={inputCls} />
            </div>

            <div className="space-y-1">
              <label className="text-xs text-(--text-muted) font-medium">Brief description (optional)</label>
              <textarea value={form.property_description} onChange={e => set("property_description", e.target.value)}
                placeholder="e.g. 3-bed cottage, lake view, sleeps 6, borehole water, solar power…"
                rows={3} className={`${inputCls} resize-none`} />
            </div>
          </div>

          {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>}

          <p className="text-xs text-(--text-muted) text-center">
            By applying you agree to our <a href="/terms" className="underline">terms of service</a>. We verify all owners before granting access.
          </p>

          <button type="submit" disabled={saving}
            className="w-full py-4 rounded-2xl text-white font-bold text-sm active:scale-[.98] transition-all"
            style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 60%, #b8722a 100%)" }}>
            {saving ? "Submitting…" : "Submit application"}
          </button>
        </form>
      </div>
    </div>
  );
}

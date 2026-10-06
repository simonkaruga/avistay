import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Briefcase, Phone, User, Building2, CheckCircle2 } from "lucide-react";

import { api } from "../../utils/api";
export default function AgentApply() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      // Register/login first then apply
      const authRes = await api("/auth/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!authRes.ok) throw new Error("Could not send OTP");
      // For demo: apply directly (assumes user is already logged in)
      const res = await api("/agent/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ agency_name: agencyName }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail ?? "Application failed");
      }
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}>
          <CheckCircle2 size={32} className="text-white" />
        </div>
        <h2 className="text-xl font-bold text-nearblack mb-2">Application Submitted!</h2>
        <p className="text-sm text-nearblack/60 max-w-xs mb-6">
          Our team will review your application and reach out via WhatsApp or SMS within 24 hours.
        </p>
        <button
          onClick={() => navigate("/agent/dashboard")}
          className="text-white text-sm font-semibold px-6 py-3 rounded-full"
          style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}
        >
          Go to dashboard
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="mb-6">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
          style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}>
          <Briefcase size={24} className="text-white" />
        </div>
        <h1 className="text-2xl font-bold text-nearblack">Become an Agent</h1>
        <p className="text-sm text-nearblack/60 mt-1">
          Earn 5% commission on every booking you refer. Paid instantly to M-Pesa after check-in.
        </p>
      </div>

      {/* Benefits */}
      <div className="bg-white rounded-2xl p-4 mb-6 shadow-xs">
        <p className="text-xs font-semibold text-forest mb-3 uppercase tracking-wide">What you get</p>
        {[
          ["5% commission", "Earned on every booking from your referral link"],
          ["Commission to your M-Pesa", "Sent automatically after your client checks in"],
          ["Agent dashboard", "Track referrals, earnings, and pending payouts"],
          ["Shareable links", "One tap to copy a property link with your agent code"],
        ].map(([title, desc]) => (
          <div key={title} className="flex gap-3 mb-3 last:mb-0">
            <CheckCircle2 size={16} className="text-forest shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-nearblack">{title}</p>
              <p className="text-xs text-nearblack/55">{desc}</p>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="text-xs font-semibold text-nearblack/70 uppercase tracking-wide mb-1 block">
            Full name
          </label>
          <div className="relative">
            <User size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-nearblack/30" />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              required
              placeholder="Jane Doe"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-black/10 bg-white text-sm text-nearblack outline-hidden focus:ring-2 focus:ring-forest/20"
            />
          </div>
        </div>

        <div>
          <label className="text-xs font-semibold text-nearblack/70 uppercase tracking-wide mb-1 block">
            M-Pesa number
          </label>
          <div className="relative">
            <Phone size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-nearblack/30" />
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              required
              placeholder="0712 345 678"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-black/10 bg-white text-sm text-nearblack outline-hidden focus:ring-2 focus:ring-forest/20"
            />
          </div>
          <p className="text-xs text-nearblack/45 mt-1">Commissions are sent to this number</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-nearblack/70 uppercase tracking-wide mb-1 block">
            Agency / business name <span className="font-normal normal-case text-nearblack/40">(optional)</span>
          </label>
          <div className="relative">
            <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-nearblack/30" />
            <input
              type="text"
              value={agencyName}
              onChange={e => setAgencyName(e.target.value)}
              placeholder="Naivasha Travel Hub"
              className="w-full pl-9 pr-4 py-3 rounded-xl border border-black/10 bg-white text-sm text-nearblack outline-hidden focus:ring-2 focus:ring-forest/20"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3.5 rounded-full text-white font-semibold text-sm transition-opacity disabled:opacity-60"
          style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}
        >
          {submitting ? "Submitting..." : "Apply now"}
        </button>
      </form>
    </div>
  );
}

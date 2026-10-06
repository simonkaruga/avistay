import { useState } from "react";
import { useSite, useSiteInfo } from "../components/SiteNotice";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams, useNavigate, Link } from "react-router-dom";
import { ArrowRight, Bell, BellOff, CalendarDays, ChevronRight, Eye, EyeOff, Heart, Home as HomeIcon, Info, LogOut, Mail, MessageCircle, Pencil, Phone, Trash2, X } from "lucide-react";

import { api, apiUrl, logout } from "../utils/api";
import { isNativeApp } from "../native/platform";
import DeleteAccountSheet from "../components/DeleteAccountSheet";
interface Me {
  user_id:    string;
  role:       string;
  phone?:     string;
  name?:      string;
  email?:     string;
  sms_opt_in: boolean;
}

async function fetchMe(): Promise<Me> {
  const res = await api("/auth/me", { credentials: "include" });
  if (!res.ok) throw new Error("Not logged in");
  return res.json();
}

// ── Digit-by-digit OTP input ──────────────────────────────────────────────────
function OTPInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex gap-2 justify-center">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i}
          className={`w-11 h-14 rounded-xl border-2 flex items-center justify-center transition-colors ${
            i < value.length
              ? "border-forest bg-forest/8"
              : i === value.length
              ? "border-teal"
              : "border-(--border) bg-(--bg-surface)"
          }`}>
          <span className="font-mono font-bold text-xl text-(--text-primary)">
            {value[i] ?? ""}
          </span>
        </div>
      ))}
      <input
        type="text" inputMode="numeric" maxLength={6}
        value={value} onChange={e => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="absolute opacity-0 w-0 h-0 pointer-events-none"
        id="otp-input" autoFocus
      />
    </div>
  );
}

// ── Profile edit sheet ────────────────────────────────────────────────────────
function ProfileEditSheet({ me, onClose, onSaved }: {
  me: Me; onClose: () => void; onSaved: () => void;
}) {
  const [name,      setName]      = useState(me.name ?? "");
  const [phone,     setPhone]     = useState(me.phone ?? "");
  const [smsOptIn,  setSmsOptIn]  = useState(me.sms_opt_in ?? true);
  const [saving,    setSaving]    = useState(false);
  const [error,     setError]     = useState("");
  const [code,      setCode]      = useState("");
  const [codeSent,  setCodeSent]  = useState(false);   // a new number must be confirmed by SMS
  const digits = (v: string) => v.replace(/\D/g, "").replace(/^0/, "254").replace(/^(?=[71])/, "254");
  const phoneChanged = phone.trim() !== "" && digits(phone) !== digits(me.phone ?? "");

  async function save() {
    setSaving(true); setError("");
    try {
      if (phoneChanged && !codeSent) {
        const r = await api("/auth/otp/request", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone: phone.trim() }),
        });
        if (!r.ok) {
          const b = await r.json().catch(() => ({}));
          setError(typeof b.detail === "string" ? b.detail : "Enter a valid Kenyan mobile number, e.g. 0712 345 678");
          return;
        }
        setCodeSent(true);
        return;
      }
      const r = await api("/auth/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name:       name.trim() || null,
          phone:      phone.trim() || null,
          phone_code: phoneChanged ? code.trim() : undefined,
          sms_opt_in: smsOptIn,
        }),
      });
      if (r.ok) { onSaved(); onClose(); return; }
      const b = await r.json().catch(() => ({}));
      setError(typeof b.detail === "string" ? b.detail : "Could not save. Try again");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-(--bg-surface) rounded-t-3xl px-5 pt-4 pb-10 space-y-4"
        style={{ animation: "fade-up 0.2s ease-out both" }}>
        <div className="w-10 h-1 bg-(--border) rounded-full mx-auto" />
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-(--text-primary)">Edit profile</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-(--bg-primary) flex items-center justify-center text-(--text-muted)" aria-label="Close"><X className="w-4 h-4" /></button>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide block">Display name</label>
          <input
            value={name} onChange={e => setName(e.target.value)}
            placeholder="Your name" autoFocus
            className="w-full bg-(--bg-primary) border-2 border-(--border) focus:border-teal rounded-2xl px-4 py-3 text-(--text-primary) outline-hidden transition-colors"
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide block">Phone number</label>
          <div className="flex items-center bg-(--bg-primary) border-2 border-(--border) focus-within:border-teal rounded-2xl px-4 overflow-hidden transition-colors">
            <span className="text-lg mr-2 shrink-0" role="img" aria-label="Kenya">🇰🇪</span>
            <input
              type="tel" value={phone}
              onChange={e => { setPhone(e.target.value); setCodeSent(false); setCode(""); }}
              placeholder="+254 712 345 678"
              className="flex-1 bg-transparent text-(--text-primary) py-3 outline-hidden text-base"
            />
          </div>
          <p className="text-[11px] text-(--text-muted) px-1">Used for booking confirmations and check-in codes via SMS/WhatsApp</p>
          {codeSent && phoneChanged && (
            <label className="block pt-2">
              <span className="text-xs text-(--text-muted)">Enter the 6-digit code we sent to {phone}</span>
              <input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
                className="mt-1 w-full bg-(--bg-primary) border-2 border-(--border) focus:border-teal rounded-2xl px-4 py-3 text-(--text-primary) outline-hidden tracking-[0.3em] font-mono" />
            </label>
          )}
        </div>

        <div className="flex items-center justify-between bg-(--bg-primary) rounded-2xl px-4 py-3.5">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${smsOptIn ? "bg-forest/10" : "bg-(--border)"}`}>
              {smsOptIn
                ? <Bell className="w-4 h-4 text-forest" />
                : <BellOff className="w-4 h-4 text-(--text-muted)" />
              }
            </div>
            <div>
              <p className="text-sm font-semibold text-(--text-primary)">SMS notifications</p>
              <p className="text-[11px] text-(--text-muted)">Booking updates, check-in codes</p>
            </div>
          </div>
          <button type="button" role="switch" aria-checked={smsOptIn} onClick={() => setSmsOptIn(v => !v)}
            className={`relative w-12 h-6 rounded-full transition-colors shrink-0 ${smsOptIn ? "bg-forest" : "bg-(--border)"}`}>
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${smsOptIn ? "translate-x-6" : "translate-x-0"}`} />
          </button>
        </div>

        {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-3 py-2" role="alert">{error}</p>}
        <button onClick={save} disabled={saving || (codeSent && phoneChanged && code.length !== 6)}
          className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm">
          {saving
            ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Saving…</span>
            : phoneChanged && !codeSent ? "Send code to new number" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />;
}

const inputCls = "w-full bg-(--bg-surface) border-2 border-(--border) focus:border-teal rounded-2xl px-4 py-3.5 text-(--text-primary) outline-hidden transition-colors text-base";

// ── Divider ───────────────────────────────────────────────────────────────────
function Divider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center gap-3 my-1">
      <div className="flex-1 h-px bg-(--border)" />
      <span className="text-xs text-(--text-muted) font-medium shrink-0">{label}</span>
      <div className="flex-1 h-px bg-(--border)" />
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
/** Where people land after signing in. */
const homeFor = (role: string) => (role === "admin" ? "/admin" : role === "owner" ? "/owner" : "/");

const GOOGLE_ERRORS: Record<string, string> = {
  google_unavailable: "Google sign-in isn't available yet. Please use your phone number or email below.",
  google_cancelled: "Google sign-in was cancelled. You can try again or use your phone number.",
  google_expired: "That sign-in link expired. Please try again.",
};

export default function Profile() {
  const site = useSite();
  const qc       = useQueryClient();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const navigate = useNavigate();
  const [sp]     = useSearchParams();
  // Only our own pages: "/x" but not "//evil.com" or "https://…" (phishing via a crafted sign-in link).
  const rawRedirect = sp.get("redirect");
  const redirect = rawRedirect && /^\/(?![/\\])/.test(rawRedirect) ? rawRedirect : null;
  const googleError = sp.get("error");
  const googleOn = !!useSiteInfo().data?.google_login;   // hidden until Google keys are set up

  const { data: me, isLoading } = useQuery({ queryKey: ["me"], queryFn: fetchMe, retry: false });

  // Phone OTP state
  const [phone,   setPhone]   = useState("");
  const [otp,     setOtp]     = useState("");
  const [otpStep, setOtpStep] = useState<"phone" | "otp">("phone");

  // Email state
  const [email,      setEmail]      = useState("");
  const [password,   setPassword]   = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [emailMode,  setEmailMode]  = useState<"login" | "register">("login");
  const [regName,    setRegName]    = useState("");

  // Forgot password
  const [forgotMode, setForgotMode]   = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotDone, setForgotDone]   = useState(false);

  const [sending,  setSending]  = useState(false);
  const [error,    setError]    = useState("");
  const [editingProfile, setEditingProfile] = useState(false);

  function clearError() { setError(""); }

  // ── Phone OTP ──────────────────────────────────────────────────────────────
  async function requestOTP() {
    if (!phone) return;
    setSending(true); clearError();
    const res = await api("/auth/otp/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    setSending(false);
    if (res.ok) setOtpStep("otp");
    else setError("Could not send code. Check your number and try again");
  }

  async function verifyOTP() {
    if (otp.length < 6) return;
    setSending(true); clearError();
    const res = await api("/auth/otp/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ phone, code: otp }),
    });
    setSending(false);
    if (res.ok) {
      const data = await res.json();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(redirect ?? homeFor(data.role));
    } else {
      setOtp(""); setError("Incorrect code. Check your SMS and try again");
    }
  }

  // ── Email auth ─────────────────────────────────────────────────────────────
  async function handleEmailSubmit() {
    if (!email || !password) return;
    setSending(true); clearError();

    const path = emailMode === "login" ? "/auth/email/login" : "/auth/email/register";
    const body = emailMode === "login"
      ? { email, password }
      : { email, password, name: regName || undefined };

    const res = await api(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSending(false);

    if (res.ok) {
      const data = await res.json();
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(redirect ?? homeFor(data.role));
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.detail ?? (emailMode === "login" ? "Invalid email or password" : "Could not create account"));
    }
  }

  // ── Forgot password ────────────────────────────────────────────────────────
  async function handleForgot() {
    if (!forgotEmail) return;
    setSending(true); clearError();
    await api("/auth/password/forgot", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: forgotEmail }),
    });
    setSending(false);
    setForgotDone(true);
  }

  // ── Logout ─────────────────────────────────────────────────────────────────
  async function signOut() {
    await logout();
    qc.clear();
    navigate("/profile", { replace: true });
  }

  if (isLoading) return (
    <div className="min-h-screen bg-(--bg-primary) flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-mint border-t-transparent rounded-full animate-spin" />
    </div>
  );

  // ── Logged-in profile ──────────────────────────────────────────────────────
  const chevron = (
    <ChevronRight className="w-4 h-4 text-(--text-muted) shrink-0" aria-hidden="true" />
  );

  if (me) return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-6">

      <div className="relative overflow-hidden"
        style={{ background: "linear-gradient(155deg, #0d2e10 0%, #1a4a1e 35%, #5c3010 70%, #2e1506 100%)", minHeight: 220 }}>

        <div className="absolute -top-10 -right-10 w-52 h-52 rounded-full" style={{ background: "rgba(62,200,144,0.07)" }} />
        <div className="absolute bottom-0 left-0 w-36 h-36 rounded-full" style={{ background: "rgba(212,137,42,0.06)" }} />

        <button onClick={() => setEditingProfile(true)} aria-label="Edit profile"
          className="absolute top-12 right-5 w-9 h-9 rounded-full bg-white/10 backdrop-blur-xs flex items-center justify-center active:scale-95 transition-transform z-10">
          <Pencil className="w-4 h-4 text-white/80" aria-hidden="true" />
        </button>

        <div className="relative z-10 flex flex-col items-center pt-20 pb-8 px-5 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center text-3xl font-bold text-white shadow-xl mb-4"
            style={{ background: "linear-gradient(135deg, #7dbf8e 0%, #4f9a8a 100%)" }}>
            {(me.name ?? me.email ?? me.role)[0].toUpperCase()}
          </div>
          <h1 className="font-display italic text-white text-2xl leading-tight">
            {me.name ?? (me.role === "owner" ? "Property Owner" : "Guest")}
          </h1>
          <p className="text-white/50 text-sm mt-1">{me.phone ?? me.email}</p>
          <span className={`mt-2 text-[13px] font-bold px-3 py-1 rounded-full uppercase tracking-widest ${
            me.role === "owner" ? "bg-mint/20 text-mint"
            : me.role === "admin" ? "bg-amber-400/20 text-amber-300"
            : "bg-white/10 text-white/50"
          }`}>
            {me.role}
          </span>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">

        {me.role === "owner" && (
          <Link to="/owner"
            className="flex items-center justify-between text-white px-5 py-4 rounded-2xl active:scale-[.98] transition-transform"
            style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 60%, #2b6777 100%)", boxShadow: "0 4px 20px rgba(31,77,54,0.4)" }}>
            <div>
              <p className="font-bold text-sm">Owner Dashboard</p>
              <p className="text-xs text-white/55 mt-0.5">Manage listings, bookings & payouts</p>
            </div>
            <ArrowRight className="w-5 h-5 text-mint" strokeWidth={2.5} aria-hidden="true" />
          </Link>
        )}

        <div className="bg-(--bg-surface) rounded-3xl overflow-hidden border border-(--border)">
          <Link to="/bookings" className="flex items-center gap-4 px-4 py-4 active:bg-(--bg-primary) transition-colors">
            <div className="w-10 h-10 rounded-2xl bg-forest/10 flex items-center justify-center shrink-0">
              <CalendarDays className="w-5 h-5 text-forest" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-(--text-primary) text-sm">My bookings</p>
              <p className="text-xs text-(--text-muted) mt-0.5">View and manage your stays</p>
            </div>
            {chevron}
          </Link>

          <div className="h-px bg-(--border) mx-4" />

          <Link to="/saved" className="flex items-center gap-4 px-4 py-4 active:bg-(--bg-primary) transition-colors">
            <div className="w-10 h-10 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
              <Heart className="w-5 h-5 text-red-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-(--text-primary) text-sm">Saved homes</p>
              <p className="text-xs text-(--text-muted) mt-0.5">Properties you've wishlisted</p>
            </div>
            {chevron}
          </Link>
        </div>

        <div className="bg-(--bg-surface) rounded-3xl overflow-hidden border border-(--border)">
          <button onClick={() => setEditingProfile(true)}
            className="w-full flex items-center gap-4 px-4 py-4 active:bg-(--bg-primary) transition-colors text-left">
            <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${me.phone ? "bg-forest/10" : "bg-amber-50 dark:bg-amber-900/20"}`}>
              <Phone className={`w-5 h-5 ${me.phone ? "text-forest" : "text-amber-500"}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-(--text-primary) text-sm">
                {me.phone ? "Phone & notifications" : "Add phone number"}
              </p>
              <p className="text-xs text-(--text-muted) mt-0.5 truncate">
                {me.phone
                  ? `${me.phone} · SMS ${me.sms_opt_in ? "on" : "off"}`
                  : "Required for booking confirmations"}
              </p>
            </div>
            {!me.phone && (
              <span className="shrink-0 text-[11px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded-full">
                Missing
              </span>
            )}
            {me.phone && chevron}
          </button>
        </div>

        <div className="bg-(--bg-surface) rounded-3xl overflow-hidden border border-(--border)">
          <a href={site.whatsapp()} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-4 px-4 py-4 active:bg-(--bg-primary) transition-colors">
            <div className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "#e9fef0" }}>
              <MessageCircle className="w-5 h-5" style={{ color: "#25D366" }} />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-(--text-primary) text-sm">Help & support</p>
              <p className="text-xs text-(--text-muted) mt-0.5">WhatsApp us. We reply fast</p>
            </div>
            {chevron}
          </a>

          <div className="h-px bg-(--border) mx-4" />

          <Link to="/about" className="flex items-center gap-4 px-4 py-4 active:bg-(--bg-primary) transition-colors">
            <div className="w-10 h-10 rounded-2xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
              <Info className="w-5 h-5 text-blue-500" aria-hidden="true" />
            </div>
            <div className="flex-1">
              <p className="font-semibold text-(--text-primary) text-sm">About Avistay</p>
              <p className="text-xs text-(--text-muted) mt-0.5">How it works · Legal</p>
            </div>
            {chevron}
          </Link>
        </div>

        <button onClick={signOut}
          className="w-full flex items-center justify-center gap-2 border border-red-200 dark:border-red-900/40 text-red-500 text-sm font-semibold py-4 rounded-2xl active:scale-[.98] transition-all">
          <LogOut className="w-4 h-4" aria-hidden="true" />
          Log out
        </button>

        <button onClick={() => setDeleteOpen(true)}
          className="w-full flex items-center justify-center gap-2 text-(--text-muted) text-xs font-medium py-2 underline underline-offset-2">
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete my account
        </button>
        <DeleteAccountSheet open={deleteOpen} onClose={() => setDeleteOpen(false)} />

        <p className="text-center text-[13px] text-(--text-muted) pb-2">
          Avistay v1.0 · Built by{" "}
          <a href="https://avinayasolutions.com" target="_blank" rel="noopener noreferrer" className="underline">Avinaya Solutions</a>
        </p>
      </div>

      {editingProfile && (
        <ProfileEditSheet
          me={me}
          onClose={() => setEditingProfile(false)}
          onSaved={() => qc.invalidateQueries({ queryKey: ["me"] })}
        />
      )}
    </div>
  );

  // ── Login screen — everything visible at once ──────────────────────────────
  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-10">

      {/* Compact brand header */}
      <div className="relative overflow-hidden flex flex-col items-center justify-center py-10 px-6 text-center"
        style={{ background: "linear-gradient(160deg, #1f4d36 0%, #2a6446 40%, #2b6777 78%, #141b16 100%)" }}>
        <div className="absolute inset-0 opacity-25"
          style={{ backgroundImage: "radial-gradient(1px 1px at 20% 30%, white, transparent), radial-gradient(1px 1px at 75% 20%, white, transparent), radial-gradient(1.5px 1.5px at 50% 60%, white, transparent)" }} />
        <h1 className="font-display italic text-white relative z-10" style={{ fontSize: "clamp(1.8rem, 8vw, 2.6rem)" }}>
          Welcome back.
        </h1>
        <p className="text-white/50 text-sm mt-1.5 relative z-10">Sign in to Avistay</p>
      </div>

      <div className="px-5 pt-6 max-w-sm mx-auto space-y-5">

        {/* Google error */}
        {googleError && (
          <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3" role="alert">
            <p className="text-red-600 text-sm font-medium">{GOOGLE_ERRORS[googleError] ?? "Google sign-in didn't work. Please use your phone number or email below."}</p>
          </div>
        )}

        {/* ── Google button — web only: Google blocks sign-in inside app webviews,
             and Apple would also require Sign in with Apple. ── */}
        {!isNativeApp && googleOn && (<>
        <a href={apiUrl("/auth/google")}
          className="w-full flex items-center justify-center gap-3 bg-white border-2 border-(--border) text-gray-700 font-semibold py-4 rounded-2xl text-sm shadow-xs active:scale-[.98] transition-all">
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Continue with Google
        </a>

        <Divider label="or use your phone" />
        </>)}

        {/* ── Phone OTP ── */}
        {otpStep === "phone" ? (
          <div className="space-y-3">
            <div className="flex items-center bg-(--bg-surface) border-2 border-(--border) rounded-2xl px-4 overflow-hidden focus-within:border-teal transition-colors">
              <span className="text-lg leading-none mr-2 shrink-0" role="img" aria-label="Kenya">🇰🇪</span>
              <input
                type="tel" value={phone}
                onChange={e => setPhone(e.target.value)}
                onKeyDown={e => e.key === "Enter" && requestOTP()}
                placeholder="+254 712 345 678"
                className="flex-1 bg-transparent text-(--text-primary) py-3.5 outline-hidden text-base"
              />
              <button onClick={requestOTP} disabled={sending || !phone}
                className="shrink-0 bg-forest disabled:bg-gray-300 text-white text-sm font-bold px-4 py-2 rounded-xl active:scale-95 transition-all ml-2">
                {sending ? <Spinner /> : "Send code"}
              </button>
            </div>
            {error && otpStep === "phone" && (
              <p className="text-red-500 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>
            )}
            <p className="text-xs text-(--text-muted) text-center">
              We'll SMS you a 6-digit code. No password needed
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-center">
              <p className="text-sm text-(--text-muted)">Code sent to <strong className="text-(--text-primary)">{phone}</strong></p>
            </div>
            <div onClick={() => document.getElementById("otp-input")?.focus()} className="cursor-text">
              <OTPInput value={otp} onChange={setOtp} />
            </div>
            {error && <p className="text-red-500 text-sm text-center bg-red-50 rounded-xl px-3 py-2">{error}</p>}
            <button onClick={verifyOTP} disabled={sending || otp.length < 6}
              className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm active:scale-[.98] transition-all">
              {sending ? <span className="flex items-center justify-center gap-2"><Spinner /> Verifying…</span> : "Verify & sign in"}
            </button>
            <div className="flex items-center justify-between text-xs text-(--text-muted)">
              <button onClick={() => { setOtpStep("phone"); setOtp(""); clearError(); }} className="underline">Change number</button>
              <button onClick={requestOTP} className="underline">Resend code</button>
            </div>
          </div>
        )}

        <Divider label="or use email" />

        {/* ── Email / Password ── */}
        {!forgotMode ? (
          <div className="space-y-3">
            {emailMode === "register" && (
              <input value={regName} onChange={e => setRegName(e.target.value)}
                placeholder="Your name (optional)"
                className={inputCls} />
            )}

            <div className="flex items-center bg-(--bg-surface) border-2 border-(--border) rounded-2xl px-4 overflow-hidden focus-within:border-teal transition-colors">
              <Mail size={16} className="text-(--text-muted) mr-2 shrink-0" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 bg-transparent text-(--text-primary) py-3.5 outline-hidden text-base" />
            </div>

            <div className="relative">
              <input type={showPw ? "text" : "password"} value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleEmailSubmit()}
                placeholder={emailMode === "register" ? "Choose a password (8+ characters)" : "Password"}
                className={`${inputCls} pr-12`} />
              <button type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-(--text-muted)">
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>}

            <button onClick={handleEmailSubmit} disabled={sending || !email || !password}
              className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm active:scale-[.98] transition-all">
              {sending
                ? <span className="flex items-center justify-center gap-2"><Spinner /> {emailMode === "login" ? "Signing in…" : "Creating account…"}</span>
                : emailMode === "login" ? "Sign in with email" : "Create account"}
            </button>

            <div className="flex items-center justify-between text-sm">
              <button type="button"
                onClick={() => { setEmailMode(m => m === "login" ? "register" : "login"); clearError(); }}
                className="text-teal font-medium">
                {emailMode === "login" ? "Create an account" : "Sign in instead"}
              </button>
              {emailMode === "login" && (
                <button type="button"
                  onClick={() => { setForgotMode(true); setForgotEmail(email); clearError(); }}
                  className="text-(--text-muted) underline">
                  Forgot password?
                </button>
              )}
            </div>
          </div>
        ) : (
          /* ── Forgot password ── */
          <div className="space-y-3">
            <button type="button" onClick={() => { setForgotMode(false); setForgotDone(false); clearError(); }}
              className="text-sm text-(--text-muted) flex items-center gap-1">
              ‹ Back
            </button>

            {forgotDone ? (
              <div className="bg-forest/8 border border-forest/20 rounded-2xl px-5 py-5 text-center space-y-2">
                <Mail size={28} className="text-forest mx-auto" />
                <p className="font-semibold text-(--text-primary)">Check your email</p>
                <p className="text-sm text-(--text-muted)">
                  If <strong>{forgotEmail}</strong> is registered, a reset link has been sent. Check your spam folder too.
                </p>
                <p className="text-xs text-(--text-muted)">Link expires in 30 minutes.</p>
              </div>
            ) : (
              <>
                <p className="text-sm text-(--text-muted)">Enter your email and we'll send a reset link.</p>
                <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleForgot()}
                  placeholder="your@email.com" autoFocus className={inputCls} />
                {error && <p className="text-red-500 text-sm bg-red-50 rounded-xl px-3 py-2">{error}</p>}
                <button onClick={handleForgot} disabled={sending || !forgotEmail}
                  className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm active:scale-[.98] transition-all">
                  {sending ? <span className="flex items-center justify-center gap-2"><Spinner /> Sending…</span> : "Send reset link"}
                </button>
              </>
            )}
          </div>
        )}

        {/* Owner note */}
        {!forgotMode && (
          <div className="flex items-start gap-3 bg-(--bg-surface) rounded-2xl px-4 py-3 border border-(--border)">
            <HomeIcon className="w-5 h-5 text-forest shrink-0 mt-0.5" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-(--text-primary)">Property owner?</p>
              <p className="text-xs text-(--text-muted) mt-0.5">
                Use the same sign-in above. After signing in you'll land straight on your owner dashboard to manage listings, photos &amp; bookings.
              </p>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

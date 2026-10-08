import { useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";

import { api } from "../utils/api";
const inputCls = "w-full bg-(--bg-surface) border-2 border-(--border) focus:border-teal rounded-2xl px-4 py-3.5 text-(--text-primary) outline-hidden transition-colors text-base";

export default function ResetPassword() {
  const [sp]   = useSearchParams();
  const token  = sp.get("token") ?? "";

  const [password,   setPassword]   = useState("");
  const [confirm,    setConfirm]    = useState("");
  const [showPw,     setShowPw]     = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [done,       setDone]       = useState(false);
  const [error,      setError]      = useState("");

  async function handleSubmit() {
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm)  { setError("Passwords don't match"); return; }

    setSaving(true); setError("");
    const res = await api("/auth/password/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: password }),
    });
    setSaving(false);

    if (res.ok) {
      setDone(true);
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.detail ?? "Reset link expired or already used. Request a new one.");
    }
  }

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-(--bg-primary) px-5">
        <div className="text-center space-y-3 max-w-sm">
          <p className="text-lg font-semibold text-(--text-primary)">Invalid reset link</p>
          <p className="text-sm text-(--text-muted)">This link is missing a reset token. Request a new password reset from the sign-in page.</p>
          <Link to="/profile" className="inline-block mt-3 text-sm text-teal font-semibold underline">Back to sign in</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-(--bg-primary)">

      {/* Brand header */}
      <div className="relative overflow-hidden flex flex-col items-center justify-center pt-16 pb-12 px-6 text-center shrink-0"
        style={{ background: "linear-gradient(160deg, #1f4d36 0%, #2a6446 40%, #2b6777 78%, #141b16 100%)" }}>
        <div className="absolute inset-0 opacity-30"
          style={{ backgroundImage: "radial-gradient(1px 1px at 20% 20%, white, transparent), radial-gradient(1px 1px at 70% 15%, white, transparent), radial-gradient(1.5px 1.5px at 45% 35%, white, transparent)" }} />
        <p className="text-mint text-[13px] font-semibold tracking-[0.3em] uppercase mb-3 relative z-10">NaivaStay</p>
        <h1 className="font-display italic text-white relative z-10" style={{ fontSize: "clamp(1.8rem, 8vw, 2.5rem)" }}>
          Reset password
        </h1>
        <p className="text-white/50 text-sm mt-2 relative z-10">Choose a new password for your account</p>
      </div>

      <div className="flex-1 bg-(--bg-primary) rounded-t-3xl -mt-4 px-5 pt-8 pb-10">
        <div className="max-w-sm mx-auto">

          {done ? (
            <div className="space-y-5 text-center">
              <div className="w-16 h-16 rounded-full bg-forest/10 flex items-center justify-center mx-auto">
                <CheckCircle2 size={32} className="text-forest" />
              </div>
              <div>
                <p className="font-bold text-xl text-(--text-primary)">Password updated!</p>
                <p className="text-sm text-(--text-muted) mt-1">You can now sign in with your new password.</p>
              </div>
              <Link to="/profile"
                className="block w-full bg-forest text-white font-bold py-4 rounded-2xl text-sm text-center active:scale-[.98] transition-all">
                Sign in now
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide block mb-2">
                  New password <span className="normal-case font-normal">(min 8 characters)</span>
                </label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Choose a strong password"
                    autoFocus
                    className={`${inputCls} pr-12`}
                  />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-(--text-muted)">
                    {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-(--text-muted) uppercase tracking-wide block mb-2">Confirm new password</label>
                <input
                  type={showPw ? "text" : "password"}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleSubmit()}
                  placeholder="Repeat your password"
                  className={inputCls}
                />
              </div>

              {/* Strength hint */}
              {password.length > 0 && password.length < 8 && (
                <p className="text-xs text-amber-600">Password must be at least 8 characters</p>
              )}
              {password.length >= 8 && confirm.length > 0 && password !== confirm && (
                <p className="text-xs text-red-500">Passwords don't match</p>
              )}

              {error && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 rounded-2xl px-4 py-3">
                  <p className="text-red-600 text-sm">{error}</p>
                  {error.includes("expired") && (
                    <Link to="/profile" className="text-red-600 underline text-sm font-medium mt-1 block">
                      Request a new reset link
                    </Link>
                  )}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving || password.length < 8 || password !== confirm}
                className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm active:scale-[.98] transition-all"
              >
                {saving
                  ? <span className="flex items-center justify-center gap-2"><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</span>
                  : "Set new password"}
              </button>

              <p className="text-xs text-center text-(--text-muted)">
                Remembered it?{" "}
                <Link to="/profile" className="text-teal font-medium underline">Sign in instead</Link>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

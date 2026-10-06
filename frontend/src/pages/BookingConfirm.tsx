import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
const loadPdf = () => import("../utils/pdf");   // only when someone taps download
import { imgSrc } from "../utils/image";

import { AlertCircle, ArrowLeft, Check, Clock, CreditCard, Download, FileText, PenLine, Smartphone, XCircle } from "lucide-react";
import { api } from "../utils/api";
import { isNativeApp } from "../native/platform";
type Stage = "pending" | "confirmed" | "failed" | "cancelled" | "timeout";

/** Mirrors backend _payment_state(): what the server says happened to the payment. */
type PaymentState = "awaiting" | "paid" | "failed" | "expired" | "none";

interface BookingDetail {
  id: string; property_id: string;
  check_in: string; check_out: string;
  total_amount: number; platform_fee: number;
  checkin_code: string; mpesa_ref: string | null; status: string;
  is_corporate?: boolean; company_name?: string | null;
  kra_pin?: string | null; group_name?: string | null;
}

interface NavState {
  propertyTitle?: string;
  propertyImage?: string;
  propertyType?:  string;
  checkIn?:  string;
  checkOut?: string;
  nights?:   number;
  total?:    number;
  stkError?: string;   // STK push / card page failed before we got here
  method?: "mpesa" | "card";
}

/** Receipt email typed at checkout by guests whose account has none. */
function savedCardEmail(): string | undefined {
  try { return sessionStorage.getItem("avistay.cardEmail") || undefined; } catch { return undefined; }
}

export default function BookingConfirm() {
  const { bookingId } = useParams<{ bookingId: string }>();
  const navigate      = useNavigate();
  const location      = useLocation();
  const nav           = (location.state ?? {}) as NavState;
  const [sp]          = useSearchParams();
  const [method, setMethod] = useState<"mpesa" | "card">(sp.get("method") === "card" || nav.method === "card" ? "card" : "mpesa");

  const [stage,   setStage]   = useState<Stage>(nav.stkError ? "failed" : "pending");
  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [secs,    setSecs]    = useState(15 * 60);
  const [failMsg, setFailMsg] = useState<string | null>(nav.stkError ?? null);
  const [retrying, setRetrying] = useState(false);
  const expiresAt = useRef<number | null>(null);
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopAll() {
    if (pollRef.current)  clearInterval(pollRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
  }

  // Countdown is display-only. Only the server decides that a hold expired —
  // the guest may be typing their PIN at 0:00, and a late payment is refunded.
  useEffect(() => {
    timerRef.current = setInterval(() => {
      if (expiresAt.current) setSecs(Math.max(0, Math.round((expiresAt.current - Date.now()) / 1000)));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  useEffect(() => {
    if (!bookingId || stage !== "pending") return;
    pollRef.current = setInterval(async () => {
      try {
        const res  = await api(`/payments/status/${bookingId}`, { credentials: "include" });
        if (!res.ok) return;
        const data: { status: string; payment_state: PaymentState; hold_expires_at?: string } = await res.json();
        if (data.hold_expires_at) expiresAt.current = Date.parse(data.hold_expires_at);

        if (data.payment_state === "paid") {
          stopAll();
          const dr = await api(`/bookings/${bookingId}`, { credentials: "include" });
          if (dr.ok) setBooking(await dr.json());
          setStage("confirmed");
        } else if (data.payment_state === "failed") {
          setFailMsg(null);
          setStage("failed");
        } else if (data.payment_state === "expired") {
          stopAll();
          setStage(data.status === "cancelled" ? "cancelled" : "timeout");
        }
      } catch { /* network blip. Keep polling */ }
    }, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [bookingId, stage]);

  /** Open Paystack's card page again (closed tab, declined card, …). */
  async function retryCard() {
    if (!bookingId) return;
    setRetrying(true);
    try {
      const res = await api("/payments/card/initialize", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, email: savedCardEmail() }),
      });
      if (res.status === 410) { setStage("timeout"); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setFailMsg(body.detail ?? "Could not open the card page. Try again"); setStage("failed"); return; }
      setMethod("card");
      if (isNativeApp) { window.open(body.authorization_url, "_blank"); setFailMsg(null); setStage("pending"); }
      else window.location.assign(body.authorization_url);
    } catch {
      setFailMsg("Network error. Check your connection and try again");
    } finally {
      setRetrying(false);
    }
  }

  async function resendPrompt() {
    if (!bookingId) return;
    setMethod("mpesa");
    setRetrying(true);
    try {
      const res = await api("/payments/mpesa/stk-push", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ booking_id: bookingId }),
      });
      if (res.ok) { setFailMsg(null); setStage("pending"); return; }
      if (res.status === 410) { setStage("timeout"); return; }
      const err = await res.json().catch(() => ({}));
      setFailMsg(err.detail ?? "Could not reach M-Pesa. Please try again");
    } catch {
      setFailMsg("Network error. Check your connection and try again");
    } finally {
      setRetrying(false);
    }
  }

  const mins    = String(Math.floor(secs / 60)).padStart(2, "0");
  const ss      = String(secs % 60).padStart(2, "0");
  const fmtDate = (d: string) =>
    new Date(d).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });

  // ── Confirmed ──────────────────────────────────────────────────────────────
  if (stage === "confirmed" && booking) {
    const nights = Math.max(1,
      (new Date(booking.check_out).getTime() - new Date(booking.check_in).getTime()) / 86400000
    );

    return (
      <div className="min-h-screen flex flex-col bg-(--bg-primary) pb-8">

        {/* ── Property photo hero — replaces solid-colour header ── */}
        <div className="relative overflow-hidden" style={{ height: 300 }}>
          {nav.propertyImage
            ? <img src={imgSrc(nav.propertyImage, 800)} alt={nav.propertyTitle ?? "Property"}
                className="w-full h-full object-cover" />
            : <div className="w-full h-full"
                style={{ background: "linear-gradient(160deg, #1f4d36 0%, #2a6446 40%, #2b6777 80%, #141b16 100%)" }} />
          }

          {/* Gradient — top transparent, bottom dark for text */}
          <div className="absolute inset-0" style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.0) 35%, rgba(0,0,0,0.75) 100%)",
          }} />

          {/* Back button */}
          <button onClick={() => navigate("/")}
            className="absolute top-12 left-4 w-9 h-9 bg-black/30 backdrop-blur-xs rounded-full flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2.5} aria-hidden="true" />
          </button>

          {/* Check badge + headline over photo */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-5 flex items-end gap-4">
            <div className="w-14 h-14 rounded-2xl bg-mint flex items-center justify-center shadow-lg shrink-0">
              <Check className="w-7 h-7 text-nearblack" strokeWidth={3} aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-display italic text-3xl text-white leading-tight">You're booked!</p>
              {nav.propertyTitle && (
                <p className="text-white/70 text-sm mt-0.5 truncate">{nav.propertyTitle}</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Cards ── */}
        <div className="px-4 -mt-2 space-y-3 pt-4">

          {/* M-Pesa ref row */}
          {booking.mpesa_ref && (
            <div className="flex items-center justify-between bg-(--bg-surface) rounded-2xl px-4 py-3 border border-(--border)">
              <span className="text-xs text-(--text-muted) font-medium">{booking.mpesa_ref.startsWith("AVC-") ? "Card payment ref" : "M-Pesa ref"}</span>
              <span className="font-mono text-sm font-bold text-(--text-primary) truncate ml-3">{booking.mpesa_ref.startsWith("AVC-") ? booking.mpesa_ref.slice(4, 12).toUpperCase() : booking.mpesa_ref}</span>
            </div>
          )}

          {/* Check-in code */}
          <div className="bg-(--bg-surface) rounded-3xl p-5 text-center border border-(--border)">
            <p className="text-[13px] text-(--text-muted) uppercase tracking-[0.22em] font-semibold mb-3">
              Check-in code: show it to your host
            </p>
            <div className="flex items-center justify-center gap-2">
              {booking.checkin_code.split("").map((digit, i) => (
                <div key={i} className="w-14 h-16 rounded-2xl border-2 border-forest bg-(--bg-primary) flex items-center justify-center">
                  <span className="font-mono font-bold text-3xl text-forest">{digit}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Stay details */}
          <div className="bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
            <div className="flex items-center justify-between mb-3">
              <div className="text-center flex-1">
                <p className="text-[12px] text-(--text-muted) uppercase tracking-wide font-semibold mb-1">Check-in</p>
                <p className="font-bold text-(--text-primary) text-sm">{fmtDate(booking.check_in)}</p>
              </div>
              <div className="px-4 text-center">
                <p className="text-xs font-semibold text-(--color-amber)">{Math.round(nights)} nights</p>
              </div>
              <div className="text-center flex-1">
                <p className="text-[12px] text-(--text-muted) uppercase tracking-wide font-semibold mb-1">Check-out</p>
                <p className="font-bold text-(--text-primary) text-sm">{fmtDate(booking.check_out)}</p>
              </div>
            </div>
            <div className="h-px bg-(--border)" />
            <div className="flex justify-between items-center mt-3">
              <span className="text-sm text-(--text-muted)">Total paid</span>
              <span className="text-lg font-bold text-(--text-primary)">
                KES {booking.total_amount.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Actions */}
          <button onClick={() => loadPdf().then(m => m.generateBookingPDF(booking))}
            className="w-full flex items-center justify-center gap-2 text-white font-bold py-4 rounded-2xl active:scale-[.98]"
            style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 100%)", boxShadow: "0 4px 14px rgba(31,77,54,0.4)" }}>
            <Download className="w-5 h-5" aria-hidden="true" />
            Download PDF confirmation
          </button>

          {booking.is_corporate && (
            <button
              onClick={() => loadPdf().then(m => m.generateCorporateInvoicePDF(booking, nav.propertyTitle ?? "Accommodation"))}
              className="w-full flex items-center justify-center gap-2 font-bold py-4 rounded-2xl active:scale-[.98] border-2 border-teal text-teal">
              <FileText className="w-5 h-5" aria-hidden="true" />
              Download company invoice
            </button>
          )}

          <button
            onClick={() =>
              navigator.share
                ? navigator.share({ title: "I just booked in Naivasha!", url: `https://avistay.com/property/${booking.property_id}` }).catch(() => {})
                : navigator.clipboard.writeText(`https://avistay.com/property/${booking.property_id}`)
            }
            className="w-full flex items-center justify-center gap-2 bg-[#25D366] text-white font-bold py-4 rounded-2xl active:scale-[.98]">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
              <path d="M12 0C5.373 0 0 5.373 0 12c0 2.127.558 4.121 1.532 5.849L.073 23.927l6.244-1.635A11.94 11.94 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.885 0-3.645-.52-5.146-1.424l-.369-.219-3.826 1.003 1.02-3.722-.24-.382A9.944 9.944 0 012 12C2 6.478 6.477 2 12 2s10 4.478 10 10-4.477 10-10 10z"/>
            </svg>
            Share on WhatsApp
          </button>

          {/* ── Review nudge ── */}
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-4 py-4 flex items-start gap-3">
            <PenLine className="w-6 h-6 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-(--text-primary) leading-snug">Enjoyed your stay?</p>
              <p className="text-xs text-(--text-muted) mt-0.5">After check-out, leaving a review helps other guests and supports the host.</p>
              <button
                onClick={() => navigate("/bookings")}
                className="mt-2 text-xs font-bold text-amber-700 underline underline-offset-2">
                Go to My Trips to leave a review →
              </button>
            </div>
          </div>

          <button onClick={() => navigate("/")}
            className="w-full border border-(--border) text-(--text-muted) py-4 rounded-2xl text-sm font-medium">
            Back to home
          </button>
        </div>
      </div>
    );
  }

  // ── Timeout ──────────────────────────────────────────────────────────────────
  if (stage === "timeout") return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 pb-20 text-center space-y-5">
      <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
        <Clock className="w-9 h-9 text-amber-500" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div>
        <h2 className="font-semibold text-(--text-primary) text-xl mb-2">Booking hold expired</h2>
        <p className="text-(--text-muted) text-sm max-w-xs leading-relaxed">
          We didn't receive your payment in time, so the dates have been released.
          If any money was taken, it is refunded to you automatically.
        </p>
      </div>
      <button onClick={() => navigate(-1)}
        className="w-full max-w-xs py-4 rounded-2xl font-bold text-white"
        style={{ background: "linear-gradient(135deg, #b8722a, #b4511f)" }}>
        Try again
      </button>
    </div>
  );

  // ── Payment failed (PIN cancelled, wrong PIN, low balance) — dates still held ─
  if (stage === "failed") return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 pb-20 text-center space-y-5">
      <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertCircle className="w-9 h-9 text-amber-500" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div role="alert">
        <h2 className="font-semibold text-(--text-primary) text-xl mb-2">Payment not completed</h2>
        <p className="text-(--text-muted) text-sm max-w-xs leading-relaxed">
          {failMsg ?? (method === "card"
            ? "Your card payment didn't go through. You have not been charged."
            : "The M-Pesa request was cancelled or timed out. You have not been charged.")}
          {" "}Your dates are held for another {Math.ceil(secs / 60)} min.
        </p>
      </div>
      <div className="w-full max-w-xs space-y-2">
        <button onClick={method === "card" ? retryCard : resendPrompt} disabled={retrying}
          className="w-full py-4 rounded-2xl font-bold text-white disabled:opacity-60 bg-forest">
          {retrying ? "Please wait…" : method === "card" ? "Try the card again" : "Resend M-Pesa prompt"}
        </button>
        <button onClick={method === "card" ? resendPrompt : retryCard} disabled={retrying}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl font-semibold border border-(--border) text-(--text-primary) disabled:opacity-60">
          {method === "card"
            ? <><Smartphone size={16} aria-hidden="true" /> Pay with M-Pesa instead</>
            : <><CreditCard size={16} aria-hidden="true" /> Pay by card instead</>}
        </button>
      </div>
    </div>
  );

  // ── Cancelled ─────────────────────────────────────────────────────────────────
  if (stage === "cancelled") return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 pb-20 text-center space-y-5">
      <div className="w-20 h-20 rounded-full bg-red-50 flex items-center justify-center">
        <XCircle className="w-9 h-9 text-red-400" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <div>
        <h2 className="font-semibold text-(--text-primary) text-xl mb-2">Payment cancelled</h2>
        <p className="text-(--text-muted) text-sm">You have not been charged.</p>
      </div>
      <button onClick={() => navigate(-1)}
        className="w-full max-w-xs py-4 rounded-2xl font-bold text-white"
        style={{ background: "linear-gradient(135deg, #1f4d36, #2a6446)" }}>
        Try again
      </button>
    </div>
  );

  // ── Waiting for PIN ──────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col pb-20">

      {/* Property photo reminder — tells user what they're paying for */}
      {nav.propertyImage && (
        <div className="relative overflow-hidden shrink-0" style={{ height: 200 }}>
          <img
            src={imgSrc(nav.propertyImage, 800)}
            alt={nav.propertyTitle ?? "Property"}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0" style={{
            background: "linear-gradient(to bottom, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.0) 40%, rgba(0,0,0,0.70) 100%)",
          }} />
          {/* Back button */}
          <button onClick={() => { stopAll(); navigate(-1); }}
            className="absolute top-12 left-4 w-9 h-9 bg-black/30 backdrop-blur-xs rounded-full flex items-center justify-center">
            <ArrowLeft className="w-5 h-5 text-white" strokeWidth={2.5} aria-hidden="true" />
          </button>
          {/* Property info overlay */}
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-3">
            <p className="text-white font-semibold text-sm leading-snug">{nav.propertyTitle}</p>
            {nav.nights && nav.total && (
              <p className="text-white/65 text-xs mt-0.5">
                {nav.nights} night{nav.nights !== 1 ? "s" : ""} · KES {nav.total.toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}

      {/* M-Pesa wait content */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">

        {method === "card" ? (
          <div className="relative mb-8 flex items-center justify-center" style={{ width: 160, height: 160 }}>
            {[0, 1, 2].map(i => (
              <div key={i} className="absolute rounded-full border-2 border-clay"
                style={{ inset: 0, opacity: 0, animation: `mpesa-ring 2.1s ease-out ${i * 0.7}s infinite` }} />
            ))}
            <div className="w-20 h-20 rounded-full bg-clay flex items-center justify-center relative z-10 shadow-lg">
              <CreditCard className="w-9 h-9 text-white" aria-hidden="true" />
            </div>
          </div>
        ) : (
          <>
            {/* Sonar rings */}
        <div className="relative mb-8 flex items-center justify-center" style={{ width: 160, height: 160 }}>
          {[0, 1, 2].map(i => (
            <div key={i} className="absolute rounded-full border-2 border-[#00A651]"
              style={{ inset: 0, opacity: 0, animation: `mpesa-ring 2.1s ease-out ${i * 0.7}s infinite` }} />
          ))}
          <div className="w-20 h-20 rounded-full bg-[#00A651] flex flex-col items-center justify-center relative z-10"
            style={{ boxShadow: "0 0 0 8px rgba(0,166,81,0.12), 0 4px 24px rgba(0,166,81,0.40)" }}>
            <span className="text-white font-bold text-xs leading-none">M</span>
            <span className="text-white font-bold text-lg leading-none">-</span>
            <span className="text-white font-bold text-xs leading-none">Pesa</span>
          </div>
        </div>

          </>
        )}

        <h1 className="font-semibold text-(--text-primary) text-2xl mb-2">{method === "card" ? "Confirming your card payment" : "Check your phone"}</h1>
        <p className="text-(--text-muted) text-sm leading-relaxed max-w-[280px] mb-8">
          {method === "card"
            ? "This usually takes a few seconds. If you closed the card page before paying, open it again below."
            : "Enter your M-Pesa PIN on the prompt to complete the booking."}
        </p>

        {/* Countdown */}
        <div className="bg-(--bg-surface) rounded-2xl px-8 py-4 mb-8 border border-(--border)">
          <p className="text-[12px] text-(--text-muted) uppercase tracking-[0.18em] font-semibold mb-1">
            Session expires in
          </p>
          <p className="font-mono font-bold text-3xl text-(--text-primary)">{mins}:{ss}</p>
        </div>

        {method === "card" && (
          <button onClick={retryCard} disabled={retrying}
            className="mb-4 px-6 py-3 rounded-2xl font-semibold border border-(--border) text-(--text-primary) disabled:opacity-60">
            {retrying ? "Opening…" : "Open the card page again"}
          </button>
        )}

        <button onClick={() => { stopAll(); navigate(-1); }}
          className="text-(--text-muted) text-sm underline">
          Cancel and go back
        </button>
      </div>
    </div>
  );
}

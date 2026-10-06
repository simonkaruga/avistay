import { useState } from "react";
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Briefcase, CalendarCheck, CalendarX, Check, Clock, CreditCard, Loader2, Lock, Minus, Plus,
  ShieldCheck, Smartphone, Tag, Users,
} from "lucide-react";
import { isNativeApp } from "../native/platform";
import { useProtectionWindow, useSite, useSiteInfo } from "../components/SiteNotice";
import { imgSrc } from "../utils/image";
import { api, apiJson, ApiError } from "../utils/api";
import { fmtDate, kes } from "../utils/format";
import { isWorkTrip } from "../utils/workTrip";
import { currentReferral } from "../utils/referral";
import PriceBreakdown, { type Quote } from "../components/ui/PriceBreakdown";
import StepIndicator from "../components/ui/StepIndicator";
import Notice from "../components/ui/Notice";

interface PropertySummary {
  id: string; title: string; type: string;
  price_per_night: number; primary_image?: string; min_nights: number;
}

async function fetchProperty(id: string): Promise<PropertySummary> {
  const res = await api(`/properties/${id}`);
  if (!res.ok) throw new Error("Not found");
  const data = await res.json();
  const primary = data.images?.find((i: { is_primary: boolean }) => i.is_primary)?.cloudinary_url
    ?? data.images?.[0]?.cloudinary_url;
  return { ...data, primary_image: primary };
}

const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";

export default function Booking() {
  const site = useSite();
  const { id }    = useParams<{ id: string }>();
  const [sp]      = useSearchParams();
  const navigate  = useNavigate();
  const checkIn   = sp.get("check_in") ?? "";
  const checkOut  = sp.get("check_out") ?? "";

  const [guests,        setGuests]        = useState(() => Math.max(1, Number(sp.get("guests") ?? "1")));
  const [promoInput,    setPromoInput]    = useState("");
  const [promo,         setPromo]         = useState("");   // the code sent to the server for quoting
  const [isCorporate,   setIsCorporate]   = useState(isWorkTrip);
  const [groupName,     setGroupName]     = useState("");
  const [companyName,   setCompanyName]   = useState("");
  const [kraPin,        setKraPin]        = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [method,        setMethod]        = useState<"mpesa" | "card">("mpesa");
  const [cardEmail,     setCardEmail]     = useState("");
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState("");

  const { data: prop } = useQuery({
    queryKey: ["property", id],
    queryFn: () => fetchProperty(id!),
    enabled: !!id,
  });

  const quoteQuery = useQuery({
    queryKey: ["quote", id, checkIn, checkOut, promo],
    queryFn: () => apiJson<Quote>(`/bookings/quote?${new URLSearchParams({
      property_id: id!, check_in: checkIn, check_out: checkOut, ...(promo ? { promo_code: promo } : {}),
    })}`),
    enabled: !!id && !!checkIn && !!checkOut,
    placeholderData: prev => prev,
    retry: 1,
  });
  const quote = quoteQuery.data;
  const cardsOn = !!useSiteInfo().data?.card_payments;
  const protectWindow = useProtectionWindow();
  const me = useQuery({
    queryKey: ["me"], queryFn: () => apiJson<{ email?: string | null }>("/auth/me"), retry: false,
  }).data;
  const needsEmail = method === "card" && !me?.email;
  const cardFee = quote?.card_fee ?? 0;
  const payTotal = quote ? quote.total_amount + (method === "card" ? cardFee : 0) : 0;
  const promoApplied = !!promo && !!quote && !quote.promo_error && quote.discount > 0;

  function applyPromo() {
    const code = promoInput.trim().toUpperCase();
    if (code) setPromo(code);
  }

  async function handleConfirm() {
    if (!termsAccepted) { setError("Please accept the terms to continue"); return; }
    if (!quote) { setError("Prices are still loading. Try again in a moment"); return; }
    if (needsEmail && !/^\S+@\S+\.\S+$/.test(cardEmail.trim())) { setError("Enter an email address for your card receipt"); return; }
    setLoading(true); setError("");
    try {
      const booking = await apiJson<{ id: string }>("/bookings/", {
        method: "POST",
        json: {
          property_id: id, check_in: checkIn, check_out: checkOut,
          guests, promo_code: promoApplied ? promo : undefined, terms_accepted: true,
          group_name:   groupName   || undefined,
          is_corporate: isCorporate,
          company_name: isCorporate ? companyName : undefined,
          kra_pin:      isCorporate ? kraPin      : undefined,
          ref_code:     currentReferral(),
        },
      });
      const navState = {
        propertyTitle: prop?.title, propertyImage: prop?.primary_image, propertyType: prop?.type,
        checkIn, checkOut, nights: quote.nights, total: payTotal, method,
      };
      if (method === "card") {
        // Paystack's secure page takes the card; we never see the number.
        try {
          if (needsEmail) { try { sessionStorage.setItem("avistay.cardEmail", cardEmail.trim()); } catch { /* private mode */ } }
          const card = await apiJson<{ authorization_url: string }>("/payments/card/initialize", {
            method: "POST", json: { booking_id: booking.id, email: needsEmail ? cardEmail.trim() : undefined },
          });
          if (isNativeApp) {
            window.open(card.authorization_url, "_blank");   // system browser; this screen keeps checking
            navigate(`/booking-confirm/${booking.id}?method=card`, { state: navState });
          } else {
            window.location.assign(card.authorization_url);  // comes back to /booking-confirm/:id
          }
        } catch (e) {
          navigate(`/booking-confirm/${booking.id}?method=card`, {
            state: { ...navState, stkError: e instanceof ApiError ? e.message : "Could not open the card payment page" },
          });
        }
        return;
      }
      // The booking holds the dates even if the prompt fails — the next
      // screen offers "Resend M-Pesa prompt".
      let stkError: string | undefined;
      try {
        await apiJson("/payments/mpesa/stk-push", { method: "POST", json: { booking_id: booking.id } });
      } catch (e) {
        stkError = e instanceof ApiError ? e.message : "Could not send the M-Pesa prompt";
      }
      navigate(`/booking-confirm/${booking.id}`, { state: { ...navState, stkError } });
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        navigate(`/profile?redirect=${encodeURIComponent(`/booking/${id}?check_in=${checkIn}&check_out=${checkOut}`)}`);
        return;
      }
      setError(e instanceof Error ? e.message : "Booking failed. Please try again");
    } finally {
      setLoading(false);
    }
  }

  const nights = quote?.nights ?? 0;

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-8">

      {/* Header — sits below the fixed TopBar */}
      <div className="sticky top-header z-40 px-4 py-3 bg-(--bg-surface) border-b border-(--border) space-y-3">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(-1)} aria-label="Back"
            className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center text-(--text-primary)">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-semibold text-(--text-primary) leading-none">Confirm and pay</h1>
            {nights > 0 && <p className="text-xs text-(--text-muted) mt-0.5">{nights} night{nights !== 1 ? "s" : ""}</p>}
          </div>
        </div>
        <div className="max-w-md mx-auto"><StepIndicator steps={["Your details", "Pay", "Confirmed"]} current={0} /></div>
      </div>

      <div className="max-w-md mx-auto">

        {/* Property banner */}
        {prop && (
          <div className="relative overflow-hidden" style={{ height: 200 }}>
            {prop.primary_image
              ? <img src={imgSrc(prop.primary_image, 800)} alt={prop.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-linear-to-r from-forest to-teal" />
            }
            <div className="absolute inset-0" style={{
              background: "linear-gradient(to bottom, rgba(0,0,0,0.10) 0%, rgba(0,0,0,0.0) 30%, rgba(0,0,0,0.72) 100%)",
            }} />
            <div className="absolute bottom-0 left-0 right-0 px-4 pb-4">
              <p className="text-white font-semibold text-sm leading-snug">{prop.title}</p>
              <p className="text-white/70 text-xs mt-0.5 capitalize">{prop.type} · Naivasha, Kenya</p>
            </div>
          </div>
        )}

        {/* Dates */}
        <div className="mx-4 -mt-4 relative z-10 bg-(--bg-surface) rounded-2xl shadow-lg px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-(--text-muted) uppercase tracking-wide font-medium">Check-in</p>
            <p className="text-sm font-bold text-(--text-primary) mt-0.5">{fmtDate(checkIn, { weekday: "short", day: "numeric", month: "short" })}</p>
          </div>
          <div className="flex items-center gap-1 text-teal" aria-hidden="true">
            <ArrowRight size={16} />
          </div>
          <div className="text-right">
            <p className="text-xs text-(--text-muted) uppercase tracking-wide font-medium">Check-out</p>
            <p className="text-sm font-bold text-(--text-primary) mt-0.5">{fmtDate(checkOut, { weekday: "short", day: "numeric", month: "short" })}</p>
          </div>
        </div>

        <div className="px-4 pt-4 space-y-3">

          {/* Price breakdown — always the server's numbers */}
          {quoteQuery.isLoading && <div className="bg-(--bg-surface) rounded-2xl h-48 animate-pulse" aria-label="Loading prices" />}
          {quoteQuery.isError && !quote && (
            <Notice tone="error">{(quoteQuery.error as Error).message}</Notice>
          )}
          {quote && <PriceBreakdown quote={quote} promoLabel={promoApplied ? promo : undefined} />}

          {/* Cancellation policy + protection — the property's real terms */}
          {quote && (
            <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
              <p className="font-semibold text-(--text-primary)">Cancellation & protection</p>
              {quote.free_cancellation_until ? (
                <div className="flex gap-2.5 text-sm">
                  <CalendarCheck size={18} className="text-forest shrink-0" aria-hidden="true" />
                  <p className="text-forest font-medium">
                    Free cancellation until {fmtDate(quote.free_cancellation_until, { weekday: "short", day: "numeric", month: "long" })}
                  </p>
                </div>
              ) : (
                <div className="flex gap-2.5 text-sm">
                  <CalendarX size={18} className="text-amber-600 shrink-0" aria-hidden="true" />
                  <p className="text-amber-700 dark:text-amber-400 font-medium">No free cancellation for these dates</p>
                </div>
              )}
              <p className="text-xs text-(--text-muted) leading-relaxed pl-7">{quote.policy_summary}</p>
              <div className="flex gap-2.5 text-sm">
                <ShieldCheck size={18} className="text-forest shrink-0" aria-hidden="true" />
                <p className="text-xs text-(--text-muted) leading-relaxed">
                  <span className="font-semibold text-(--text-primary)">Your payment is protected. </span>
                  Avistay keeps it and only pays the host {protectWindow} after you check in. If something is wrong (you can't get in, or the home isn't as described), report it in the app before then and we step in.
                </p>
              </div>
              <div className="flex gap-2.5 text-sm">
                <Clock size={18} className="text-(--text-muted) shrink-0" aria-hidden="true" />
                <p className="text-xs text-(--text-muted) leading-relaxed">
                  Dates are held for {site.holdMinutes} while you pay.
                </p>
              </div>
            </div>
          )}

          {/* Guests */}
          <div className="bg-(--bg-surface) rounded-2xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Users size={18} className="text-(--text-muted)" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-(--text-primary)">Guests</p>
                <p className="text-xs text-(--text-muted)">How many people are staying?</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => setGuests(g => Math.max(1, g - 1))} aria-label="Fewer guests" disabled={guests <= 1}
                className="w-9 h-9 rounded-full border-2 border-(--border) text-(--text-primary) flex items-center justify-center disabled:opacity-40">
                <Minus size={16} />
              </button>
              <span className="text-base font-bold text-(--text-primary) w-5 text-center" aria-live="polite">{guests}</span>
              <button onClick={() => setGuests(g => Math.min(20, g + 1))} aria-label="More guests" disabled={guests >= 20}
                className="w-9 h-9 rounded-full border-2 border-(--border) text-(--text-primary) flex items-center justify-center disabled:opacity-40">
                <Plus size={16} />
              </button>
            </div>
          </div>

          {/* Group / corporate booking */}
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <Briefcase size={18} className="text-(--text-muted) mt-0.5" aria-hidden="true" />
                <div>
                  <p className="text-sm font-semibold text-(--text-primary)">Group or corporate booking?</p>
                  <p className="text-xs text-(--text-muted) mt-0.5">Retreats, offsites, family reunions, church trips</p>
                </div>
              </div>
              <button type="button" role="switch" aria-checked={isCorporate} aria-label="Group or corporate booking"
                onClick={() => setIsCorporate(v => !v)}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${isCorporate ? "bg-forest" : "bg-(--border)"}`}>
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${isCorporate ? "translate-x-5" : ""}`} />
              </button>
            </div>

            {isCorporate && (
              <div className="space-y-3 pt-1">
                <label className="block">
                  <span className="text-xs text-(--text-muted) font-medium">Trip / group name</span>
                  <input value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Safaricom Q3 Offsite" className={`${inputCls} mt-1`} />
                </label>
                <label className="block">
                  <span className="text-xs text-(--text-muted) font-medium">Company name <span className="text-teal">(for invoice)</span></span>
                  <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="e.g. Safaricom PLC" className={`${inputCls} mt-1`} />
                </label>
                <label className="block">
                  <span className="text-xs text-(--text-muted) font-medium">KRA PIN <span className="text-teal">(for tax invoice)</span></span>
                  <input value={kraPin} onChange={e => setKraPin(e.target.value.toUpperCase())} placeholder="e.g. P051234567A" className={`${inputCls} mt-1 font-mono`} />
                </label>
                <p className="text-xs text-(--text-muted)">
                  Once you've paid, you can download a company invoice with your KRA PIN from the confirmation page.
                </p>
              </div>
            )}
          </div>

          {/* Promo code — validated by the server, never assumed */}
          <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
            <label htmlFor="promo" className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
              <Tag size={16} className="text-(--text-muted)" aria-hidden="true" /> Promo code
            </label>
            <div className="flex gap-2">
              <input id="promo" value={promoInput} onChange={e => setPromoInput(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === "Enter") applyPromo(); }}
                placeholder="e.g. NAIVASHA500" disabled={promoApplied}
                className={`${inputCls} flex-1 disabled:opacity-60`} />
              {promoApplied ? (
                <button onClick={() => { setPromo(""); setPromoInput(""); }}
                  className="px-4 border border-(--border) text-(--text-muted) text-xs font-bold rounded-xl">
                  Remove
                </button>
              ) : (
                <button onClick={applyPromo} disabled={!promoInput.trim() || quoteQuery.isFetching}
                  className="px-4 bg-forest disabled:bg-gray-300 text-white text-xs font-bold rounded-xl">
                  {quoteQuery.isFetching && promo ? <Loader2 size={14} className="animate-spin" /> : "Apply"}
                </button>
              )}
            </div>
            {promoApplied && (
              <p className="flex items-center gap-1 text-xs text-teal" role="status">
                <Check size={14} aria-hidden="true" /> {kes(quote!.discount)} off applied
              </p>
            )}
            {promo && quote?.promo_error && <p className="text-xs text-red-600" role="alert">{quote.promo_error}</p>}
          </div>

          {/* How to pay */}
          {quote && (
            <fieldset className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
              <legend className="sr-only">How would you like to pay?</legend>
              <p className="text-sm font-semibold text-(--text-primary)">How would you like to pay?</p>
              {([
                { id: "mpesa", Icon: Smartphone, title: "M-Pesa", sub: "Prompt on your phone · no extra fee", amount: quote.total_amount },
                ...(cardsOn ? [{ id: "card", Icon: CreditCard, title: "Card or Apple Pay",
                  sub: `Visa, Mastercard · card fee ${kes(cardFee)} (${quote.card_surcharge_pct ?? 0}%)`, amount: quote.total_amount + cardFee }] : []),
              ] as const).map(o => (
                <label key={o.id} className={`flex items-center gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                  method === o.id ? "border-forest bg-forest/5" : "border-(--border)"}`}>
                  <input type="radio" name="pay-method" value={o.id} checked={method === o.id}
                    onChange={() => setMethod(o.id as "mpesa" | "card")} className="accent-forest w-4 h-4" />
                  <o.Icon size={20} className="text-forest shrink-0" aria-hidden="true" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-(--text-primary)">{o.title}</span>
                    <span className="block text-xs text-(--text-muted)">{o.sub}</span>
                  </span>
                  <span className="text-sm font-bold text-(--text-primary) whitespace-nowrap">{kes(o.amount)}</span>
                </label>
              ))}
              {method === "card" && (
                <div className="space-y-2 pt-1">
                  {needsEmail && (
                    <label className="block">
                      <span className="text-xs text-(--text-muted) font-medium">Email for your card receipt</span>
                      <input type="email" autoComplete="email" value={cardEmail} onChange={e => setCardEmail(e.target.value)}
                        placeholder="you@example.com" className={`${inputCls} mt-1`} />
                    </label>
                  )}
                  <p className="flex items-start gap-2 text-xs text-(--text-muted) leading-relaxed">
                    <Lock size={14} className="shrink-0 mt-0.5 text-forest" aria-hidden="true" />
                    You'll pay on Paystack's secure page. Avistay never sees your card number. Your bank may ask you to confirm.
                    The card fee covers the card company's charge and isn't refunded if you cancel; if the host or Avistay cancels, you get it back too.
                  </p>
                </div>
              )}
            </fieldset>
          )}

          {/* Terms */}
          <label className={`flex gap-3 rounded-2xl p-4 cursor-pointer border transition-colors ${
            termsAccepted ? "bg-forest/8 border-forest/30" : "bg-(--bg-surface) border-transparent"
          }`}>
            <input type="checkbox" checked={termsAccepted} onChange={e => setTermsAccepted(e.target.checked)}
              className="mt-0.5 w-5 h-5 shrink-0 accent-forest" />
            <span className="text-xs text-(--text-muted) leading-relaxed">
              I agree to the{" "}
              <a href="/terms" className="text-teal font-medium">Terms of Service</a>,{" "}
              <a href="/cancellation-policy" className="text-teal font-medium">Cancellation Policy</a>, and{" "}
              <a href="/privacy" className="text-teal font-medium">Privacy Policy</a>.
            </span>
          </label>

          {error && <Notice tone="error">{error}</Notice>}

          {/* Pay */}
          {method === "card" ? (
            <button onClick={handleConfirm} disabled={loading || !termsAccepted || !quote}
              className="w-full flex items-center justify-center gap-3 text-white font-bold py-4 rounded-2xl transition-all active:scale-[.98] disabled:opacity-50 bg-clay hover:bg-(--color-clay-dark) disabled:bg-gray-400">
              {loading
                ? <><Loader2 size={20} className="animate-spin" /> Opening secure payment…</>
                : <><CreditCard size={18} aria-hidden="true" /> Pay {quote ? kes(payTotal) : ""} by card</>}
            </button>
          ) : (
            <button onClick={handleConfirm} disabled={loading || !termsAccepted || !quote}
              className="w-full flex items-center justify-center gap-3 text-white font-bold py-4 rounded-2xl transition-all active:scale-[.98] disabled:opacity-50"
              style={loading || !termsAccepted || !quote ? { background: "#9ca3af" } : {
                background: "linear-gradient(135deg, #00A651 0%, #007a3d 100%)",
                boxShadow: "0 4px 16px rgba(0,166,81,0.4)",
              }}>
              {loading
                ? <><Loader2 size={20} className="animate-spin" /> Sending prompt…</>
                : <><Smartphone size={18} aria-hidden="true" /> Pay {quote ? kes(quote.total_amount) : ""} via M-Pesa</>}
            </button>
          )}

          <p className="text-xs text-center text-(--text-muted) pb-4">
            {method === "card"
              ? <>You'll go to a secure card page, then come straight back here.</>
              : <>You'll get an M-Pesa prompt on your phone.<br />Enter your PIN to complete the booking.</>}
          </p>
        </div>
      </div>
    </div>
  );
}

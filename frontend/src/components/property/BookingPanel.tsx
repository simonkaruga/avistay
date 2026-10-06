/**
 * Price + dates + guests + Book. One component, two presentations:
 * a sticky card beside the details on wide screens, a compact bar on phones.
 * Prices come from the server's quote — the same numbers checkout uses.
 */
import { useProtectionWindow, useSiteInfo } from "../SiteNotice";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, Loader2, Minus, Plus, ShieldCheck, Star, Users } from "lucide-react";
import { apiJson } from "../../utils/api";
import { fmtDate, kes } from "../../utils/format";
import type { Quote } from "../ui/PriceBreakdown";

interface Props {
  propertyId: string;
  pricePerNight: number;
  minNights: number;
  rating: number | null;
  reviewCount: number;
  checkIn: string;
  checkOut: string;
  guests: number;
  maxGuests?: number;
  onGuests: (n: number) => void;
  onPickDates: () => void;
  onReserve: () => void;
}

export function useStayQuote(propertyId: string, checkIn: string, checkOut: string) {
  return useQuery({
    queryKey: ["quote", propertyId, checkIn, checkOut],
    queryFn: () => apiJson<Quote>(`/bookings/quote?property_id=${propertyId}&check_in=${checkIn}&check_out=${checkOut}`),
    enabled: !!checkIn && !!checkOut && checkOut > checkIn,
    staleTime: 60_000,
  });
}

export default function BookingPanel(p: Props) {
  const { data: q, isFetching } = useStayQuote(p.propertyId, p.checkIn, p.checkOut);
  const nights = q?.nights ?? 0;
  const cardsOn = !!useSiteInfo().data?.card_payments;
  const protectWindow = useProtectionWindow();
  const ready = !!p.checkIn && !!p.checkOut && nights >= p.minNights;
  const cta = !p.checkIn || !p.checkOut ? "Select dates"
    : nights < p.minNights ? `Minimum ${p.minNights} nights` : "Book now";

  const dates = (
    <button type="button" onClick={p.onPickDates}
      className="w-full flex items-center gap-2.5 border border-(--border) rounded-xl px-3 py-2.5 text-left hover:border-forest transition-colors">
      <CalendarDays className="w-5 h-5 text-(--text-muted) shrink-0" aria-hidden="true" />
      <span className={`text-sm ${p.checkIn ? "font-semibold text-(--text-primary)" : "text-(--text-muted)"}`}>
        {p.checkIn ? fmtDate(p.checkIn, { weekday: "short", day: "numeric", month: "short" }) : "Check-in"}
        {" to "}
        {p.checkOut ? fmtDate(p.checkOut, { weekday: "short", day: "numeric", month: "short" }) : "Check-out"}
      </span>
    </button>
  );

  return (
    <>
      {/* Wide screens: sticky card */}
      <aside className="hidden lg:block sticky top-24 self-start bg-(--bg-surface) border border-(--border) rounded-2xl p-5 shadow-xs space-y-4" aria-label="Book this stay">
        <div className="flex items-baseline justify-between">
          <p><span className="text-2xl font-bold text-(--text-primary)">{kes(p.pricePerNight)}</span>
            <span className="text-sm text-(--text-muted)"> / night</span></p>
          {p.rating && (
            <span className="flex items-center gap-1 text-sm text-(--text-primary)">
              <Star className="w-4 h-4 fill-gold text-gold" aria-hidden="true" /> {p.rating.toFixed(1)}
              <span className="text-(--text-muted)">({p.reviewCount})</span>
            </span>
          )}
        </div>
        {dates}
        <div className="flex items-center justify-between border border-(--border) rounded-xl px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-(--text-primary)"><Users className="w-5 h-5 text-(--text-muted)" aria-hidden="true" /> Guests</span>
          <span className="flex items-center gap-3">
            <button type="button" aria-label="Fewer guests" onClick={() => p.onGuests(Math.max(1, p.guests - 1))} disabled={p.guests <= 1}
              className="w-7 h-7 rounded-full border border-(--border) flex items-center justify-center disabled:opacity-30"><Minus className="w-3.5 h-3.5" /></button>
            <span className="w-4 text-center text-sm font-semibold" aria-live="polite">{p.guests}</span>
            <button type="button" aria-label="More guests" onClick={() => p.onGuests(Math.min(p.maxGuests ?? 20, p.guests + 1))}
              className="w-7 h-7 rounded-full border border-(--border) flex items-center justify-center"><Plus className="w-3.5 h-3.5" /></button>
          </span>
        </div>

        {q && nights > 0 && (
          <dl className="text-sm space-y-1.5 border-t border-(--border) pt-3">
            <div className="flex justify-between"><dt className="text-(--text-muted)">{kes(q.price_per_night)} × {nights} night{nights !== 1 ? "s" : ""}</dt><dd>{kes(q.room_amount)}</dd></div>
            <div className="flex justify-between"><dt className="text-(--text-muted)">Tourism levy &amp; service fee</dt><dd>{kes(q.levy_amount + q.platform_fee)}</dd></div>
            {q.deposit_amount > 0 && <div className="flex justify-between"><dt className="text-(--text-muted)">Refundable deposit</dt><dd>{kes(q.deposit_amount)}</dd></div>}
            <div className="flex justify-between font-semibold text-(--text-primary) pt-1.5 border-t border-(--border)"><dt>Total</dt><dd>{kes(q.total_amount)}</dd></div>
          </dl>
        )}

        <button type="button" onClick={ready ? p.onReserve : p.onPickDates}
          className="w-full flex items-center justify-center gap-2 bg-clay hover:bg-(--color-clay-dark) text-white font-bold py-3.5 rounded-full active:scale-[.98] transition-transform">
          {isFetching && <Loader2 className="w-4 h-4 animate-spin" />} {cta}
        </button>
        {q?.free_cancellation_until && (
          <p className="text-xs text-forest text-center">Free cancellation until {fmtDate(q.free_cancellation_until, { day: "numeric", month: "long" })}</p>
        )}
        <p className="flex items-start gap-2 text-xs text-(--text-muted)">
          <ShieldCheck className="w-4 h-4 text-forest shrink-0" aria-hidden="true" />
          {cardsOn ? "Pay by M-Pesa or card." : "Pay with M-Pesa."} The host is only paid {protectWindow} after you check in.
        </p>
      </aside>

      {/* Phones/tablets: compact bar above the bottom tabs */}
      <div className="lg:hidden fixed left-0 right-0 bottom-tabs z-500 bg-(--bg-surface) border-t border-(--border) shadow-[0_-4px_16px_rgba(0,0,0,0.08)] px-4 py-3 flex items-center gap-3">
        <div className="flex-1 min-w-0">
          {q && nights > 0 ? (
            <>
              <p className="font-bold text-(--text-primary)">{kes(q.total_amount)} <span className="text-xs font-normal text-(--text-muted)">total</span></p>
              <button type="button" onClick={p.onPickDates} className="text-xs text-(--text-muted) underline underline-offset-2 truncate">
                {fmtDate(p.checkIn)} to {fmtDate(p.checkOut)} · {nights} night{nights !== 1 ? "s" : ""}
              </button>
            </>
          ) : (
            <>
              <p className="font-bold text-(--text-primary)">{kes(p.pricePerNight)} <span className="text-xs font-normal text-(--text-muted)">/ night</span></p>
              {p.rating && <p className="text-xs text-(--text-muted) flex items-center gap-1"><Star className="w-3 h-3 fill-gold text-gold" aria-hidden="true" />{p.rating.toFixed(1)} · {p.reviewCount} reviews</p>}
            </>
          )}
        </div>
        <button type="button" onClick={ready ? p.onReserve : p.onPickDates}
          className="shrink-0 bg-clay text-white font-bold text-sm px-5 py-3 rounded-full active:scale-[.98] transition-transform">
          {cta}
        </button>
      </div>
    </>
  );
}

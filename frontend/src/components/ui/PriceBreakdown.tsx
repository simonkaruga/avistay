import type { LucideIcon } from "lucide-react";
import { useSite } from "../SiteNotice";
import { BedDouble, Landmark, Receipt, ShieldCheck, Tag } from "lucide-react";
import { kes } from "../../utils/format";

export interface Quote {
  nights: number;
  price_per_night: number;
  room_amount: number;
  levy_amount: number;
  platform_fee: number;
  deposit_amount: number;
  discount: number;
  total_amount: number;
  cancellation_policy: string;
  policy_summary: string;
  free_cancellation_until: string | null;
  promo_error?: string | null;
  card_fee?: number;
  card_surcharge_pct?: number;
}

function Line({ Icon, label, value, hint, accent }: {
  Icon: LucideIcon; label: string; value: string; hint?: string; accent?: boolean;
}) {
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon size={16} className={`mt-0.5 shrink-0 ${accent ? "text-teal" : "text-(--text-muted)"}`} aria-hidden="true" />
      <div className="flex-1 min-w-0">
        <p className="text-(--text-muted)">{label}</p>
        {hint && <p className="text-xs text-(--text-muted) mt-0.5">{hint}</p>}
      </div>
      <span className={accent ? "text-teal font-medium" : "text-(--text-primary)"}>{value}</span>
    </div>
  );
}

/** The server's quote, line by line. Never computes prices itself. */
export default function PriceBreakdown({ quote, promoLabel }: { quote: Quote; promoLabel?: string }) {
  const site = useSite();
  return (
    <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
      <p className="font-semibold text-(--text-primary)">Price details</p>
      <Line Icon={BedDouble} label={`${kes(quote.price_per_night)} × ${quote.nights} night${quote.nights !== 1 ? "s" : ""}`}
        value={kes(quote.room_amount)} />
      <Line Icon={Landmark} label="Tourism levy (2%)" value={kes(quote.levy_amount)} />
      <Line Icon={Receipt} label="Service fee" value={kes(quote.platform_fee)} />
      {quote.deposit_amount > 0 && (
        <Line Icon={ShieldCheck} label="Refundable damage deposit" value={kes(quote.deposit_amount)} accent
          hint={`Returned ${site.depositDays} after check-out`} />
      )}
      {quote.discount > 0 && (
        <Line Icon={Tag} label={promoLabel ? `Promo ${promoLabel}` : "Promo discount"} value={`− ${kes(quote.discount)}`} accent />
      )}
      <div className="h-px bg-(--border)" />
      <div className="flex justify-between items-baseline">
        <span className="font-semibold text-(--text-primary)">Total to pay</span>
        <span className="text-lg font-bold text-(--text-primary)">{kes(quote.total_amount)}</span>
      </div>
      {quote.deposit_amount > 0 && (
        <p className="text-xs text-(--text-muted)">
          Your stay costs {kes(quote.total_amount - quote.deposit_amount)}; {kes(quote.deposit_amount)} comes back to you.
        </p>
      )}
    </div>
  );
}

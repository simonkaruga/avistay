import { useQuery } from "@tanstack/react-query";
import { useProtectionWindow } from "../../components/SiteNotice";
import { Banknote, Clock, Hammer, Info, MinusCircle, Percent, TrendingUp } from "lucide-react";
import { apiJson } from "../../utils/api";
import { fmtDate, kes } from "../../utils/format";
import Notice from "../../components/ui/Notice";

interface Statement {
  commission_pct: number;
  payouts: { id: string; property_title: string; type: "payout" | "claim_payout"; check_in: string; check_out: string;
             room_amount: number; commission_kes: number; amount: number; status: string; mpesa_ref: string | null }[];
  adjustments: { id: string; amount: number; reason: string; applied: boolean; created_at: string }[];
  outstanding_deductions: number;
}

const ADJUSTMENT_LABELS: Record<string, string> = {
  owner_cancellation: "Cancellation penalty",
  dispute_refund: "Guest refund (problem report)",
  carried_forward: "Carried from a previous payout",
};

const STATUS_LABEL: Record<string, string> = {
  completed: "Paid", processing: "Sending", pending: "Queued", failed: "Failed. We'll retry",
};

export default function Earnings() {
  const payWindow = useProtectionWindow();
  const dash = useQuery({ queryKey: ["owner-dash"], queryFn: () => apiJson<{ total_earned: number; pending_payout: number }>("/owner/dashboard") });
  const stmt = useQuery({ queryKey: ["owner-earnings"], queryFn: () => apiJson<Statement>("/owner/earnings") });

  if (dash.isError || stmt.isError) return <Notice tone="error">We couldn't load your earnings. Please try again shortly.</Notice>;
  const s = stmt.data;

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-(--text-primary)">Earnings</h1>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Paid to you", value: dash.data?.total_earned, Icon: TrendingUp },
          { label: "Upcoming", value: dash.data?.pending_payout, Icon: Clock },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="bg-(--bg-surface) rounded-2xl p-4">
            <p className="flex items-center gap-1.5 text-xs text-(--text-muted)"><Icon size={14} aria-hidden="true" />{label}</p>
            {value === undefined
              ? <div className="h-7 mt-1 rounded-sm bg-(--bg-primary) animate-pulse" />
              : <p className="text-xl font-bold text-(--text-primary) mt-1">{kes(value)}</p>}
          </div>
        ))}
      </div>

      {s && s.outstanding_deductions < 0 && (
        <Notice tone="warning" title={`${kes(-s.outstanding_deductions)} will come off your next payout`}>
          From cancellation penalties or guest refunds. See the list below.
        </Notice>
      )}

      <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-(--text-primary)"><Info size={16} aria-hidden="true" />How you get paid</p>
        <ul className="text-xs text-(--text-muted) space-y-1.5">
          <li className="flex gap-2"><Clock size={14} className="shrink-0" aria-hidden="true" />Sent to your M-Pesa {payWindow} after the guest checks in.</li>
          <li className="flex gap-2"><Percent size={14} className="shrink-0" aria-hidden="true" />
            You receive the room price minus {s ? `${s.commission_pct}%` : "your"} commission. Guests pay the service fee and tourism levy.</li>
          <li className="flex gap-2"><Hammer size={14} className="shrink-0" aria-hidden="true" />Damage? Report it within 2 days of check-out. It's paid from the guest's deposit.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-(--text-primary)">Payouts</h2>
        {stmt.isLoading && <div className="h-24 bg-(--bg-surface) rounded-2xl animate-pulse" />}
        {s?.payouts.length === 0 && <p className="text-sm text-(--text-muted) py-4 text-center">No payouts yet.</p>}
        {s?.payouts.map(p => (
          <div key={p.id} className="bg-(--bg-surface) rounded-2xl p-4 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-forest/10 flex items-center justify-center shrink-0">
              {p.type === "claim_payout" ? <Hammer size={16} className="text-forest" aria-hidden="true" />
                : <Banknote size={16} className="text-forest" aria-hidden="true" />}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-(--text-primary) truncate">{p.type === "claim_payout" ? "Damage award" : p.property_title}</p>
              <p className="text-xs text-(--text-muted)">{fmtDate(p.check_in)} → {fmtDate(p.check_out)}</p>
              {p.type === "payout" && p.commission_kes > 0 && (
                <p className="text-xs text-(--text-muted)">{kes(p.room_amount)} room − {kes(p.commission_kes)} commission</p>
              )}
            </div>
            <div className="text-right">
              <p className="text-sm font-bold text-(--text-primary)">{kes(p.amount)}</p>
              <p className={`text-xs ${p.status === "failed" ? "text-red-600" : "text-(--text-muted)"}`}>{STATUS_LABEL[p.status] ?? p.status}</p>
              {p.mpesa_ref && <p className="text-[11px] font-mono text-(--text-muted)">{p.mpesa_ref}</p>}
            </div>
          </div>
        ))}
      </section>

      {s && s.adjustments.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-(--text-primary)">Deductions</h2>
          {s.adjustments.map(a => (
            <div key={a.id} className="bg-(--bg-surface) rounded-2xl px-4 py-3 flex items-center gap-3">
              <MinusCircle size={16} className="text-red-500 shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-(--text-primary)">{ADJUSTMENT_LABELS[a.reason] ?? a.reason}</p>
                <p className="text-xs text-(--text-muted)">{fmtDate(a.created_at)} · {a.applied ? "Taken from a payout" : "Comes off your next payout"}</p>
              </div>
              <span className="text-sm font-semibold text-red-600">{kes(a.amount)}</span>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

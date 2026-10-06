import { Link } from "react-router-dom";
import { ChevronRight, Hammer, MessageSquareWarning } from "lucide-react";
import { fmtDate, kes } from "../utils/format";
import StatusBadge from "./ui/StatusBadge";

export interface DisputeSummary {
  id: string; booking_id: string; property_title: string; check_in: string; check_out: string;
  opener_role: "guest" | "owner"; reason: string; reason_label: string; claimed_amount: number;
  status: string; guest_refund_kes: number; owner_award_kes: number; created_at: string;
}

export default function DisputeRow({ d, showParty = true }: { d: DisputeSummary; showParty?: boolean }) {
  return (
    <Link to={`/disputes/${d.id}`} className="flex items-center gap-3 bg-(--bg-surface) rounded-2xl px-4 py-3">
      <span className="w-9 h-9 rounded-xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center shrink-0">
        {d.opener_role === "owner"
          ? <Hammer size={16} className="text-purple-700 dark:text-purple-300" aria-hidden="true" />
          : <MessageSquareWarning size={16} className="text-purple-700 dark:text-purple-300" aria-hidden="true" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-(--text-primary) truncate">{d.reason_label}</p>
        <p className="text-xs text-(--text-muted) truncate">
          {showParty && (d.opener_role === "guest" ? "From guest · " : "From host · ")}
          {d.property_title} · {fmtDate(d.check_in)}
          {d.claimed_amount > 0 && ` · ${kes(d.claimed_amount)}`}
        </p>
      </div>
      <StatusBadge status={d.status} />
      <ChevronRight size={16} className="text-(--text-muted)" aria-hidden="true" />
    </Link>
  );
}

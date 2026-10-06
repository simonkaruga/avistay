import { useEffect, useState } from "react";
import { CheckCircle2, Clock, XCircle, Download } from "lucide-react";
const loadPdf = () => import("../../utils/pdf");   // only when someone taps download

import { api } from "../../utils/api";
interface Referral {
  id: string;
  booking_id: string;
  commission_kes: number;
  status: "pending" | "paid" | "cancelled";
  paid_at: string | null;
  check_in: string | null;
  check_out: string | null;
  property_title: string | null;
}

export default function AgentReferrals() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/agent/referrals")
      .then(r => (r.ok ? r.json() : []))
      .then(d => { setReferrals(Array.isArray(d) ? d : []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-nearblack/40 text-sm">Loading...</div>;

  if (!referrals.length) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mb-4"
          style={{ background: "rgba(31,77,54,0.08)" }}>
          <CheckCircle2 size={28} className="text-forest" />
        </div>
        <h2 className="text-xl font-bold text-nearblack mb-2">No referrals yet</h2>
        <p className="text-sm text-nearblack/55 max-w-xs">
          Share a property link with a client to make your first referral and earn commission.
        </p>
      </div>
    );
  }

  const totalEarned  = referrals.filter(r => r.status === "paid").reduce((s, r) => s + r.commission_kes, 0);
  const totalPending = referrals.filter(r => r.status === "pending").reduce((s, r) => s + r.commission_kes, 0);

  return (
    <div className="p-4 max-w-lg mx-auto">
      <h2 className="text-lg font-bold text-nearblack mb-1">Referrals</h2>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="bg-white rounded-2xl p-3 shadow-xs">
          <p className="text-xs text-nearblack/50 mb-0.5">Paid out</p>
          <p className="text-base font-bold text-forest">KES {totalEarned.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-2xl p-3 shadow-xs">
          <p className="text-xs text-nearblack/50 mb-0.5">Pending</p>
          <p className="text-base font-bold text-clay">KES {totalPending.toLocaleString()}</p>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {referrals.map(r => (
          <ReferralCard key={r.id} referral={r} />
        ))}
      </div>
    </div>
  );
}

function ReferralCard({ referral: r }: { referral: Referral }) {
  const StatusIcon = r.status === "paid" ? CheckCircle2 : r.status === "cancelled" ? XCircle : Clock;
  const statusColor = r.status === "paid" ? "#1f4d36" : r.status === "cancelled" ? "#dc2626" : "#b4511f";
  const statusLabel = r.status === "paid" ? "Paid" : r.status === "cancelled" ? "Cancelled" : "Pending";

  function downloadVoucher() {
    loadPdf().then(m => m.generateAgentVoucherPDF({
      booking_id: r.booking_id,
      property_title: r.property_title ?? "Property",
      check_in: r.check_in ?? "",
      check_out: r.check_out ?? "",
      commission_kes: r.commission_kes,
      status: r.status,
      paid_at: r.paid_at,
    }));
  }

  return (
    <div className="bg-white rounded-2xl shadow-xs overflow-hidden">
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="font-semibold text-nearblack text-sm leading-snug">{r.property_title ?? "Property"}</p>
          <span className="flex items-center gap-1 text-xs font-medium shrink-0"
            style={{ color: statusColor }}>
            <StatusIcon size={12} />
            {statusLabel}
          </span>
        </div>
        {(r.check_in || r.check_out) && (
          <p className="text-xs text-nearblack/50 mb-2">
            {r.check_in} → {r.check_out}
          </p>
        )}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-nearblack/50">Commission</p>
            <p className="text-sm font-bold" style={{ color: statusColor }}>
              KES {r.commission_kes.toLocaleString()}
            </p>
          </div>
          {r.status !== "cancelled" && (
            <button
              onClick={downloadVoucher}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-teal/30 text-teal transition-colors hover:bg-teal/5"
            >
              <Download size={12} />
              Voucher
            </button>
          )}
        </div>
      </div>
      {r.paid_at && (
        <div className="px-4 py-2 bg-forest/5 border-t border-forest/8">
          <p className="text-[13px] text-forest/70">
            Paid {new Date(r.paid_at).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      )}
    </div>
  );
}

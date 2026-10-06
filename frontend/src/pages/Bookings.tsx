import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import {
  CalendarCheck, CalendarDays, CalendarX, CalendarPlus, ChevronRight, Download, Home as HomeIcon, KeyRound,
  Loader2, LockKeyhole, MessageSquareWarning, PenLine, ShieldCheck, Star, X, XCircle,
} from "lucide-react";
const loadPdf = () => import("../utils/pdf");   // only when someone taps download
import { api, apiJson } from "../utils/api";
import { useProtectionWindow } from "../components/SiteNotice";
import { fmtDate, kes, nightsBetween } from "../utils/format";
import StatusBadge from "../components/ui/StatusBadge";
import Modal from "../components/ui/Modal";
import Notice from "../components/ui/Notice";
import ReportProblemSheet from "../components/ReportProblemSheet";

interface Booking {
  id: string; property_id: string; property_title?: string;
  check_in: string; check_out: string;
  total_amount: number; platform_fee: number; deposit_amount: number; status: string;
  checkin_code: string | null; mpesa_ref: string | null;
  policy_summary: string | null; free_cancellation_until: string | null;
  deposit_note: string | null; deposit_status: string;
  dispute_id: string | null; dispute_status: string | null;
  can_cancel: boolean; can_report: boolean;
  cancelled_by: string | null;
}

type Tab = "upcoming" | "past" | "cancelled";

// ── Review sheet ──────────────────────────────────────────────────────────────

function ReviewSheet({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [scores, setScores] = useState({ accuracy_score: 5, cleanliness_score: 5, location_score: 5, value_score: 5 });
  const [comment, setComment] = useState("");

  const mut = useMutation({
    mutationFn: () => apiJson("/reviews/", { method: "POST", json: { booking_id: bookingId, ...scores, comment: comment || null } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["my-bookings"] }); onClose(); },
  });

  const DIMS = [
    { key: "accuracy_score",    label: "Accuracy" },
    { key: "cleanliness_score", label: "Cleanliness" },
    { key: "location_score",    label: "Location" },
    { key: "value_score",       label: "Value" },
  ] as const;

  return (
    <Modal open onClose={onClose} title="Leave a review" icon={<Star size={20} />}>
      <div className="space-y-4">
        {DIMS.map(({ key, label }) => (
          <div key={key} className="flex items-center justify-between" role="radiogroup" aria-label={label}>
            <span className="text-sm text-(--text-muted) w-24">{label}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} role="radio" aria-checked={scores[key] === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
                  onClick={() => setScores(s => ({ ...s, [key]: n }))} className="p-0.5 active:scale-90 transition-transform">
                  <Star size={24} className={scores[key] >= n ? "fill-amber-400 text-amber-400" : "text-gray-300 dark:text-gray-600"} />
                </button>
              ))}
            </div>
          </div>
        ))}
        <textarea value={comment} onChange={e => setComment(e.target.value)} rows={3}
          placeholder="Share your experience… (optional)" aria-label="Your review"
          className="w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-2xl px-4 py-3 text-sm outline-hidden resize-none focus:border-teal" />
        {mut.isError && <Notice tone="error">{(mut.error as Error).message}</Notice>}
        <button onClick={() => mut.mutate()} disabled={mut.isPending}
          className="w-full bg-forest disabled:bg-gray-300 text-white font-bold py-4 rounded-2xl text-sm">
          {mut.isPending ? "Submitting…" : "Submit review"}
        </button>
      </div>
    </Modal>
  );
}

// ── Cancel sheet — shows the server's refund before confirming ───────────────

function CancelSheet({ booking, onClose, onDone }: { booking: Booking; onClose: () => void; onDone: (msg: string) => void }) {
  const qc = useQueryClient();
  const preview = useQuery({
    queryKey: ["cancel-preview", booking.id],
    queryFn: () => apiJson<{ paid: number; refund_pct: number; refund_amount: number; policy_summary: string }>(
      `/bookings/${booking.id}/cancel-preview`),
  });
  const cancel = useMutation({
    mutationFn: () => apiJson<{ refund_amount: number }>(`/bookings/${booking.id}/cancel`, {
      method: "POST", json: { reason: "Guest cancellation" },
    }),
    onSuccess: r => {
      qc.invalidateQueries({ queryKey: ["my-bookings"] });
      onDone(r.refund_amount > 0
        ? `Booking cancelled. ${kes(r.refund_amount)} is on its way to your M-Pesa.`
        : "Booking cancelled.");
    },
  });
  const p = preview.data;

  return (
    <Modal open onClose={onClose} title="Cancel this booking?" icon={<CalendarX size={20} />}>
      <div className="space-y-4">
        <p className="text-sm text-(--text-primary) font-medium">{booking.property_title}</p>
        <p className="text-xs text-(--text-muted)">{fmtDate(booking.check_in)} → {fmtDate(booking.check_out)}</p>
        {preview.isLoading && <div className="h-20 rounded-2xl bg-(--bg-primary) animate-pulse" aria-label="Calculating refund" />}
        {preview.isError && <Notice tone="error">{(preview.error as Error).message}</Notice>}
        {p && (
          <div className="bg-(--bg-primary) rounded-2xl p-4 space-y-2 text-sm">
            {p.paid === 0 ? (
              <p className="text-(--text-muted)">You haven't paid for this booking, so nothing is charged.</p>
            ) : (
              <>
                <div className="flex justify-between"><span className="text-(--text-muted)">You paid</span><span>{kes(p.paid)}</span></div>
                <div className="flex justify-between font-semibold text-(--text-primary)">
                  <span>You get back</span><span className="text-forest">{kes(p.refund_amount)}</span>
                </div>
                <p className="text-xs text-(--text-muted) pt-1">{p.policy_summary} Refunds go to your M-Pesa.</p>
              </>
            )}
          </div>
        )}
        {cancel.isError && <Notice tone="error">{(cancel.error as Error).message}</Notice>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-(--border) text-(--text-primary) text-sm font-medium py-3 rounded-2xl">
            Keep booking
          </button>
          <button onClick={() => cancel.mutate()} disabled={!p || cancel.isPending}
            className="flex-1 flex items-center justify-center gap-2 bg-red-600 disabled:bg-red-300 text-white text-sm font-bold py-3 rounded-2xl">
            {cancel.isPending && <Loader2 size={16} className="animate-spin" />} Yes, cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Booking card ──────────────────────────────────────────────────────────────

function Action({ onClick, to, Icon, label, tone = "neutral" }: {
  onClick?: () => void; to?: string; Icon: typeof Star; label: string; tone?: "neutral" | "danger" | "amber";
}) {
  const cls = {
    neutral: "border-(--border) text-(--text-primary)",
    danger: "border-red-200 text-red-600 dark:border-red-900",
    amber: "border-amber-200 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300",
  }[tone];
  const inner = <><Icon size={14} aria-hidden="true" /> {label}</>;
  const base = `flex items-center justify-center gap-1.5 border text-xs py-2.5 px-3 rounded-xl font-medium ${cls}`;
  return to ? <Link to={to} className={base}>{inner}</Link> : <button onClick={onClick} className={base}>{inner}</button>;
}

function BookingCard({ b, onReview, onCancel, onReport }: {
  b: Booking; onReview: () => void; onCancel: () => void; onReport: () => void;
}) {
  const nights = nightsBetween(b.check_in, b.check_out);
  const protectWindow = useProtectionWindow();

  return (
    <article className="bg-(--bg-surface) rounded-2xl overflow-hidden shadow-xs" style={{ animation: "fade-up 0.25s ease-out both" }}
      aria-label={b.property_title ?? "Booking"}>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <StatusBadge status={b.status} label={b.status === "cancelled" && b.cancelled_by === "owner" ? "Cancelled by host" : undefined} />
            {b.property_title && <p className="font-semibold text-(--text-primary) text-sm leading-snug mt-1.5 line-clamp-1">{b.property_title}</p>}
            <p className="flex items-center gap-1.5 text-xs text-(--text-muted) mt-0.5">
              <CalendarDays size={13} aria-hidden="true" />
              {fmtDate(b.check_in, { weekday: "short", day: "numeric", month: "short" })} → {fmtDate(b.check_out, { weekday: "short", day: "numeric", month: "short" })}
              <span>· {nights} night{nights !== 1 ? "s" : ""}</span>
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-(--text-primary)">{kes(b.total_amount)}</p>
            {b.mpesa_ref && <p className="text-xs text-(--text-muted) font-mono mt-0.5">{b.mpesa_ref}</p>}
          </div>
        </div>

        {b.checkin_code && b.status === "confirmed" && (
          <div className="bg-(--bg-primary) rounded-xl px-4 py-3 flex items-center justify-between border border-forest/20">
            <p className="flex items-center gap-1.5 text-xs text-(--text-muted)">
              <KeyRound size={14} aria-hidden="true" /> Check-in code
              <span className="sr-only">{b.checkin_code.split("").join(" ")}</span>
            </p>
            <div className="flex gap-1.5" aria-hidden="true">
              {b.checkin_code.split("").map((d, i) => (
                <div key={i} className="w-9 h-10 rounded-lg bg-forest/10 border border-forest/30 flex items-center justify-center">
                  <span className="font-mono font-bold text-lg text-forest">{d}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What happens next — the Booking.com "good to know" block */}
        <ul className="space-y-1.5 text-xs text-(--text-muted)">
          {b.status === "confirmed" && (b.free_cancellation_until ? (
            <li className="flex gap-2 text-forest"><CalendarCheck size={14} className="shrink-0 mt-px" aria-hidden="true" />
              Free cancellation until {fmtDate(b.free_cancellation_until, { day: "numeric", month: "long" })}</li>
          ) : b.policy_summary && (
            <li className="flex gap-2"><CalendarX size={14} className="shrink-0 mt-px" aria-hidden="true" />{b.policy_summary}</li>
          ))}
          {b.status === "confirmed" && (
            <li className="flex gap-2"><KeyRound size={14} className="shrink-0 mt-px" aria-hidden="true" />
              Show your code to the host when you arrive. Never share it before.</li>
          )}
          {b.status === "checked_in" && (
            <li className="flex gap-2"><ShieldCheck size={14} className="shrink-0 mt-px" aria-hidden="true" />
              The host is paid {protectWindow} after check-in. Something wrong? Report it before then.</li>
          )}
          {b.deposit_note && (
            <li className="flex gap-2"><ShieldCheck size={14} className="shrink-0 mt-px" aria-hidden="true" />{b.deposit_note}</li>
          )}
          {b.status === "cancelled" && b.cancelled_by === "owner" && (
            <li className="flex gap-2 text-red-600"><XCircle size={14} className="shrink-0 mt-px" aria-hidden="true" />
              The host cancelled. You get a full refund, fees included.</li>
          )}
        </ul>

        {b.dispute_id && (
          <Link to={`/disputes/${b.dispute_id}`}
            className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-900 rounded-xl px-3 py-2.5">
            <MessageSquareWarning size={16} className="text-purple-700 dark:text-purple-300" aria-hidden="true" />
            <span className="text-xs font-medium text-purple-800 dark:text-purple-200 flex-1">Your problem report</span>
            {b.dispute_status && <StatusBadge status={b.dispute_status} />}
            <ChevronRight size={16} className="text-purple-700" aria-hidden="true" />
          </Link>
        )}

        <div className="grid grid-cols-2 gap-2 pt-1">
          {["confirmed", "checked_in", "completed"].includes(b.status) && (
            <Action Icon={Download} label="Confirmation PDF"
              onClick={() => loadPdf().then(m => m.generateBookingPDF({ ...b, checkin_code: b.checkin_code ?? "", platform_fee: b.platform_fee ?? 0 }))} />
          )}
          {b.status === "completed" && <Action Icon={PenLine} label="Review stay" tone="amber" onClick={onReview} />}
          {b.can_report && <Action Icon={MessageSquareWarning} label="Report a problem" tone="amber" onClick={onReport} />}
          {b.can_cancel && <Action Icon={X} label="Cancel booking" tone="danger" onClick={onCancel} />}
          <Action Icon={HomeIcon} label="View home" to={`/property/${b.property_id}`} />
          {b.status === "cancelled" && <Action Icon={CalendarPlus} label="Book again" to={`/property/${b.property_id}`} />}
        </div>
      </div>
    </article>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Bookings() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("upcoming");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [cancelFor, setCancelFor] = useState<Booking | null>(null);
  const [reportFor, setReportFor] = useState<Booking | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery<Booking[], Error>({
    queryKey: ["my-bookings"],
    queryFn: async () => {
      const r = await api("/bookings/mine");
      if (r.status === 401) throw new Error("unauth");
      if (!r.ok) throw new Error("We couldn't load your bookings.");
      return r.json();
    },
    retry: false,
  });

  if (error?.message === "unauth") return (
    <div className="min-h-screen bg-(--bg-primary) flex flex-col items-center justify-center px-6 pb-20 text-center space-y-4">
      <div className="w-16 h-16 rounded-full bg-(--bg-surface) flex items-center justify-center">
        <LockKeyhole className="w-7 h-7 text-(--text-muted)" aria-hidden="true" />
      </div>
      <p className="font-semibold text-(--text-primary)">Sign in to see your bookings</p>
      <button onClick={() => navigate("/profile?redirect=/bookings")}
        className="bg-forest text-white text-sm font-bold px-8 py-3.5 rounded-2xl">
        Sign in
      </button>
    </div>
  );

  const TAB_FILTER: Record<Tab, (b: Booking) => boolean> = {
    upcoming:  b => ["pending", "confirmed", "checked_in"].includes(b.status),
    past:      b => b.status === "completed",
    cancelled: b => b.status === "cancelled",
  };
  const filtered = data?.filter(TAB_FILTER[tab]) ?? [];
  const TABS: { id: Tab; label: string }[] = [
    { id: "upcoming", label: "Upcoming" }, { id: "past", label: "Past" }, { id: "cancelled", label: "Cancelled" },
  ];

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-6">
      <div className="sticky top-0 z-40 bg-(--bg-surface) border-b border-(--border)">
        <div className="px-4 pt-4">
          <h1 className="font-semibold text-(--text-primary) text-lg">Your bookings</h1>
        </div>
        <div className="flex gap-1 px-4 py-2.5 overflow-x-auto scrollbar-none" role="tablist">
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
              className={`shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                tab === t.id ? "bg-forest text-white" : "text-(--text-muted) bg-(--bg-primary)"}`}>
              {t.label}
              {data && <span className="ml-1 opacity-70">{data.filter(TAB_FILTER[t.id]).length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3 max-w-md mx-auto">
        {notice && (
          <div className="relative">
            <Notice tone="success">{notice}</Notice>
            <button onClick={() => setNotice(null)} aria-label="Dismiss" className="absolute top-3 right-3 text-forest/60">
              <X size={14} />
            </button>
          </div>
        )}

        {isLoading && [1, 2, 3].map(i => <div key={i} className="bg-(--bg-surface) rounded-2xl h-40 animate-pulse" />)}

        {error && error.message !== "unauth" && (
          <div className="space-y-2">
            <Notice tone="error">{error.message}</Notice>
            <button onClick={() => refetch()} className="text-sm text-teal underline">Try again</button>
          </div>
        )}

        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center py-16 text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-(--bg-surface) flex items-center justify-center">
              <CalendarDays className="w-7 h-7 text-(--text-muted)" aria-hidden="true" />
            </div>
            <p className="font-semibold text-(--text-primary)">
              {tab === "upcoming" ? "No upcoming trips" : tab === "past" ? "No past stays yet" : "No cancelled bookings"}
            </p>
            {tab === "upcoming" && (
              <>
                <p className="text-sm text-(--text-muted) max-w-[220px]">Find a verified home by the lake and book in under a minute.</p>
                <button onClick={() => navigate("/search")}
                  className="bg-forest text-white text-sm font-bold px-8 py-3.5 rounded-2xl">
                  Browse homes
                </button>
              </>
            )}
          </div>
        )}

        {filtered.map(b => (
          <BookingCard key={b.id} b={b}
            onReview={() => setReviewId(b.id)}
            onCancel={() => setCancelFor(b)}
            onReport={() => setReportFor(b)} />
        ))}
      </div>

      {reviewId && <ReviewSheet bookingId={reviewId} onClose={() => setReviewId(null)} />}
      {cancelFor && <CancelSheet booking={cancelFor} onClose={() => setCancelFor(null)}
        onDone={msg => { setCancelFor(null); setNotice(msg); }} />}
      {reportFor && <ReportProblemSheet open party="guest" bookingId={reportFor.id} onClose={() => setReportFor(null)} />}
    </div>
  );
}

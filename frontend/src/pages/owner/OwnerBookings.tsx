import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, BadgeCheck, Banknote, CalendarDays, CalendarX, ChevronRight, Clock, DoorOpen, Hammer, KeyRound, Loader2,
  MessageCircle, MessageSquareWarning, PauseCircle, Users,
} from "lucide-react";
import { apiJson } from "../../utils/api";
import { fmtDate, fmtDateTime, kes, nightsBetween } from "../../utils/format";
import StatusBadge from "../../components/ui/StatusBadge";
import Modal from "../../components/ui/Modal";
import Notice from "../../components/ui/Notice";
import ReportProblemSheet from "../../components/ReportProblemSheet";
import { useOwnerProperties } from "./hooks";

interface OwnerBooking {
  id: string; property_id: string; property_title: string | null;
  check_in: string; check_out: string; guests: number; status: string;
  room_amount: number; commission_kes: number; deposit_amount: number; deposit_status: string;
  your_payout: number; payout_status: string | null; payout_due_at: string | null;
  dispute: { id: string; status: string; opener_role: "guest" | "owner" } | null;
  can_cancel: boolean; can_report_damage: boolean; cancelled_by: string | null;
  guest: { name: string; phone: string | null; email: string | null; id_verified: boolean; shared: boolean } | null;
  unread_messages: number;
  group_name?: string | null; company_name?: string | null;
}

/** Who is coming: full contact details once the booking is paid. */
function GuestCard({ b }: { b: OwnerBooking }) {
  const g = b.guest;
  if (!g || b.status === "cancelled") return null;
  return (
    <div className="flex items-center gap-3 rounded-xl border border-(--border) px-3 py-2.5">
      <span className="w-9 h-9 rounded-full bg-teal/10 text-teal font-semibold flex items-center justify-center shrink-0">{g.name.charAt(0)}</span>
      <div className="min-w-0 flex-1 text-xs">
        <p className="text-sm font-semibold text-(--text-primary) flex items-center gap-1.5">
          {g.name}
          {g.id_verified && <BadgeCheck size={14} className="text-teal" aria-label="ID checked by NaivaStay" />}
        </p>
        {g.shared ? (
          <p className="text-(--text-muted) truncate">
            {g.phone && <a href={`tel:${g.phone}`} className="text-teal underline underline-offset-2">{g.phone}</a>}
            {g.email && <> · {g.email}</>}
            {(b.company_name || b.group_name) && <> · {b.company_name ?? b.group_name}</>}
          </p>
        ) : (
          <p className="text-(--text-muted)">Contact details appear once the guest has paid</p>
        )}
        {g.shared && <p className="text-(--text-muted)">Check their ID on arrival before giving the keys.</p>}
      </div>
      <Link to={`/owner/messages/${b.id}`} className="relative flex items-center gap-1.5 text-xs font-semibold text-white bg-forest rounded-full px-3 py-2 shrink-0">
        <MessageCircle size={14} aria-hidden="true" /> Message
        {b.unread_messages > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-clay text-white text-[11px] font-bold flex items-center justify-center"
            aria-label={`${b.unread_messages} unread`}>{b.unread_messages}</span>
        )}
      </Link>
    </div>
  );
}

/** Plain-language payout state for a host — the question they ask most. */
function PayoutLine({ b }: { b: OwnerBooking }) {
  const guestCaseOpen = b.dispute?.status === "open" && b.dispute.opener_role === "guest";
  let Icon = Clock, text = "", tone = "text-(--text-muted)";
  if (b.status === "cancelled") return null;
  if (b.payout_status === "completed") { Icon = Banknote; text = "Paid to your M-Pesa"; tone = "text-forest"; }
  else if (b.payout_status === "processing" || b.payout_status === "pending") { Icon = Banknote; text = "Payout being sent to M-Pesa"; tone = "text-teal"; }
  else if (guestCaseOpen) { Icon = PauseCircle; text = "Payout on hold. The guest reported a problem"; tone = "text-amber-700 dark:text-amber-400"; }
  else if (b.payout_due_at) { text = `Payout due ${fmtDateTime(b.payout_due_at)}`; }
  else return null;
  return <p className={`flex items-center gap-1.5 text-xs ${tone}`}><Icon size={14} aria-hidden="true" />{text}</p>;
}

function CheckinForm({ booking }: { booking: OwnerBooking }) {
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const checkin = useMutation({
    mutationFn: () => apiJson(`/bookings/${booking.id}/checkin?code=${encodeURIComponent(code)}`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner-bookings"] });
      qc.invalidateQueries({ queryKey: ["owner-dash"] });
    },
  });
  return (
    <div className="space-y-2 pt-1">
      <label htmlFor={`code-${booking.id}`} className="flex items-center gap-1.5 text-xs text-(--text-muted)">
        <KeyRound size={14} aria-hidden="true" /> When the guest arrives, enter the 4-digit code they show you:
      </label>
      <div className="flex gap-2">
        <input id={`code-${booking.id}`} type="text" inputMode="numeric" maxLength={4} autoComplete="off"
          placeholder="• • • •" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))}
          className="flex-1 bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2 text-sm font-mono tracking-[0.5em] text-center outline-hidden focus:border-teal" />
        <button onClick={() => checkin.mutate()} disabled={code.length !== 4 || checkin.isPending}
          className="flex items-center gap-1.5 bg-forest disabled:bg-gray-300 text-white text-xs font-semibold px-4 py-2 rounded-xl">
          {checkin.isPending ? <Loader2 size={14} className="animate-spin" /> : <DoorOpen size={14} aria-hidden="true" />} Check in
        </button>
      </div>
      {checkin.isError && <p className="text-xs text-red-600" role="alert">{(checkin.error as Error).message}</p>}
    </div>
  );
}

interface CancelPreview { guest_refund: number; penalty: number; strikes_after: number; strike_limit: number; will_pause_listing: boolean }

function OwnerCancelSheet({ booking, onClose }: { booking: OwnerBooking; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const preview = useQuery({
    queryKey: ["owner-cancel-preview", booking.id],
    queryFn: () => apiJson<CancelPreview>(`/owner/bookings/${booking.id}/cancel-preview`),
  });
  const cancel = useMutation({
    mutationFn: () => apiJson(`/owner/bookings/${booking.id}/cancel`, { method: "POST", json: { reason: reason.trim() } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner-bookings"] }); onClose(); },
  });
  const p = preview.data;

  return (
    <Modal open onClose={onClose} title="Cancel this guest's booking?" icon={<CalendarX size={20} />}>
      <div className="space-y-4">
        <Notice tone="warning" title="Cancelling hurts guests who planned their trip around you">
          Only cancel if the home truly can't host them.
        </Notice>
        {preview.isLoading && <div className="h-28 rounded-2xl bg-(--bg-primary) animate-pulse" />}
        {p && (
          <ul className="bg-(--bg-primary) rounded-2xl p-4 space-y-2.5 text-sm">
            <li className="flex justify-between"><span className="text-(--text-muted)">Guest gets back (100%)</span><span>{kes(p.guest_refund)}</span></li>
            <li className="flex justify-between font-semibold text-red-600"><span>Penalty from your next payout</span><span>− {kes(p.penalty)}</span></li>
            <li className="flex justify-between"><span className="text-(--text-muted)">These dates</span><span>Stay blocked</span></li>
            <li className="flex justify-between"><span className="text-(--text-muted)">Cancellation strikes (12 months)</span>
              <span className={p.will_pause_listing ? "text-red-600 font-semibold" : ""}>{p.strikes_after} of {p.strike_limit}</span></li>
          </ul>
        )}
        {p?.will_pause_listing && (
          <Notice tone="error">This reaches the limit of {p.strike_limit} cancellations in 12 months. The listing will be paused until our team reviews it.</Notice>
        )}
        <label className="block">
          <span className="text-xs font-semibold text-(--text-primary)">Reason (the guest will see a summary)</span>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
            placeholder="e.g. Burst water pipe. The house has no water until repairs finish."
            className="mt-1 w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden resize-none focus:border-teal" />
        </label>
        {cancel.isError && <Notice tone="error">{(cancel.error as Error).message}</Notice>}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-(--border) text-(--text-primary) text-sm font-medium py-3 rounded-2xl">Keep booking</button>
          <button onClick={() => cancel.mutate()} disabled={!p || reason.trim().length < 10 || cancel.isPending}
            className="flex-1 flex items-center justify-center gap-2 bg-red-600 disabled:bg-red-300 text-white text-sm font-bold py-3 rounded-2xl">
            {cancel.isPending && <Loader2 size={16} className="animate-spin" />} Cancel booking
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function OwnerBookings() {
  const [selectedProp, setSelectedProp] = useState("");
  const [cancelFor, setCancelFor] = useState<OwnerBooking | null>(null);
  const [damageFor, setDamageFor] = useState<OwnerBooking | null>(null);
  const { data: myProps } = useOwnerProperties();

  const { data: bookings, isLoading, isError, refetch } = useQuery({
    queryKey: ["owner-bookings", selectedProp],
    queryFn: () => apiJson<OwnerBooking[]>(`/owner/bookings${selectedProp ? `?property_id=${selectedProp}` : ""}`),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-(--text-primary)">Bookings</h1>

      {(myProps?.length ?? 0) > 1 && (
        <select value={selectedProp} onChange={e => setSelectedProp(e.target.value)} aria-label="Filter by property"
          className="w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden">
          <option value="">All properties</option>
          {myProps!.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}
        </select>
      )}

      {isLoading && [1, 2].map(i => <div key={i} className="bg-(--bg-surface) rounded-2xl h-36 animate-pulse" />)}
      {isError && (
        <div className="space-y-2">
          <Notice tone="error">We couldn't load your bookings.</Notice>
          <button onClick={() => refetch()} className="text-sm text-teal underline">Try again</button>
        </div>
      )}
      {!isLoading && bookings?.length === 0 && (
        <div className="flex flex-col items-center py-12 text-center gap-2">
          <CalendarDays className="w-8 h-8 text-(--text-muted)" aria-hidden="true" />
          <p className="text-sm text-(--text-muted)">No bookings yet. Share your listing to get your first guest.</p>
        </div>
      )}

      <div className="space-y-3">
        {bookings?.map(b => (
          <article key={b.id} className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <StatusBadge status={b.status} label={b.status === "cancelled" && b.cancelled_by === "owner" ? "Cancelled by you" : undefined} />
                {b.property_title && <p className="text-sm font-semibold text-(--text-primary) mt-1.5 truncate">{b.property_title}</p>}
                <p className="flex items-center gap-1.5 text-xs text-(--text-muted) mt-0.5">
                  <CalendarDays size={13} aria-hidden="true" />
                  {fmtDate(b.check_in)} → {fmtDate(b.check_out)} · {nightsBetween(b.check_in, b.check_out)} nights
                  <Users size={13} className="ml-1" aria-hidden="true" /> {b.guests}
                </p>
              </div>
              {b.status !== "cancelled" && (
                <div className="text-right shrink-0">
                  <p className="text-xs text-(--text-muted)">Your payout</p>
                  <p className="text-sm font-bold text-(--text-primary)">{kes(b.your_payout)}</p>
                  {b.commission_kes > 0 && <p className="text-[11px] text-(--text-muted)">after commission and tax</p>}
                </div>
              )}
            </div>

            <GuestCard b={b} />

            <PayoutLine b={b} />

            {b.dispute && (
              <Link to={`/disputes/${b.dispute.id}`}
                className="flex items-center gap-2 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-900 rounded-xl px-3 py-2.5">
                <MessageSquareWarning size={16} className="text-purple-700 dark:text-purple-300" aria-hidden="true" />
                <span className="text-xs font-medium text-purple-800 dark:text-purple-200 flex-1">
                  {b.dispute.opener_role === "guest" ? "Guest reported a problem" : "Your damage report"}
                </span>
                <StatusBadge status={b.dispute.status} />
                <ChevronRight size={16} className="text-purple-700" aria-hidden="true" />
              </Link>
            )}

            {b.status === "confirmed" && <CheckinForm booking={b} />}

            {(b.can_report_damage || b.can_cancel) && (
              <div className="flex gap-2">
                {b.can_report_damage && (
                  <button onClick={() => setDamageFor(b)}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-amber-200 bg-amber-50 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300 text-xs font-medium py-2.5 rounded-xl">
                    <Hammer size={14} aria-hidden="true" /> Report damage
                  </button>
                )}
                {b.can_cancel && (
                  <button onClick={() => setCancelFor(b)}
                    className="flex-1 flex items-center justify-center gap-1.5 border border-red-200 text-red-600 dark:border-red-900 text-xs font-medium py-2.5 rounded-xl">
                    <AlertTriangle size={14} aria-hidden="true" /> Cancel booking
                  </button>
                )}
              </div>
            )}
          </article>
        ))}
      </div>

      {cancelFor && <OwnerCancelSheet booking={cancelFor} onClose={() => setCancelFor(null)} />}
      {damageFor && (
        <ReportProblemSheet open party="owner" bookingId={damageFor.id} onClose={() => setDamageFor(null)}
          depositAmount={damageFor.deposit_status === "held" ? damageFor.deposit_amount : 0} />
      )}
    </div>
  );
}

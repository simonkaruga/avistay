import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Banknote, CalendarDays, Gavel, Home as HomeIcon, Loader2, Paperclip, Send, ShieldCheck,
  Undo2, User as UserIcon, Wallet,
} from "lucide-react";
import { apiJson, ApiError } from "../utils/api";
import { fmtDate, fmtDateTime, kes } from "../utils/format";
import StatusBadge from "../components/ui/StatusBadge";
import Notice from "../components/ui/Notice";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "../components/PhotoUploader";

interface Message {
  id: string; author_role: "guest" | "owner" | "admin"; mine: boolean;
  body: string; attachments: string[]; created_at: string;
}
interface DisputeDetail {
  id: string; booking_id: string; property_title: string; check_in: string; check_out: string;
  opener_role: "guest" | "owner"; reason: string; reason_label: string; claimed_amount: number;
  status: "open" | "resolved" | "withdrawn"; guest_refund_kes: number; owner_award_kes: number;
  ruling: string | null; resolved_at: string | null; viewer_role: "guest" | "owner" | "admin";
  booking: { total_amount: number; deposit_amount: number; deposit_status: string; status: string;
             payout_due_at: string; deposit_due_at: string };
  messages: Message[]; can_reply: boolean; can_withdraw: boolean; can_resolve: boolean;
  max_guest_refund?: number; max_owner_award?: number;
}

const ROLE_LABEL = { guest: "Guest", owner: "Host", admin: "NaivaStay team" } as const;
const ROLE_ICON = { guest: UserIcon, owner: HomeIcon, admin: ShieldCheck } as const;
const POLL_MS = 10_000;

export default function Dispute() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: d, isLoading, error } = useQuery<DisputeDetail, ApiError>({
    queryKey: ["dispute", id],
    queryFn: () => apiJson(`/disputes/${id}`),
    enabled: !!id,
    refetchInterval: q => (q.state.data?.status === "open" ? POLL_MS : false),
    retry: (n, e) => e.status >= 500 && n < 2,
  });

  const msgCount = d?.messages.length ?? 0;
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgCount]);

  const withdraw = useMutation({
    mutationFn: () => apiJson(`/disputes/${id}/withdraw`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispute", id] }),
  });

  if (isLoading) return (
    <div className="min-h-screen bg-(--bg-primary) pt-24 px-4 space-y-3" aria-busy="true">
      {[1, 2, 3].map(i => <div key={i} className="bg-(--bg-surface) rounded-2xl h-24 animate-pulse" />)}
    </div>
  );
  if (error || !d) return (
    <div className="min-h-screen bg-(--bg-primary) pt-24 px-4 max-w-md mx-auto space-y-4">
      <Notice tone="error" title={error?.status === 401 ? "Please sign in" : "Case not found"}>
        {error?.status === 401 ? "Sign in to view this case." : "This case doesn't exist or you don't have access to it."}
      </Notice>
      <button onClick={() => navigate(error?.status === 401 ? `/profile?redirect=/disputes/${id}` : "/bookings")}
        className="w-full bg-forest text-white font-bold py-3.5 rounded-2xl text-sm">
        {error?.status === 401 ? "Sign in" : "Back to my bookings"}
      </button>
    </div>
  );

  const frozen = d.opener_role === "guest" ? "The host's payout is on hold" : "The guest's deposit is on hold";

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-40">
      <div className="sticky top-header z-40 flex items-center gap-3 px-4 py-3 bg-(--bg-surface) border-b border-(--border)">
        <button onClick={() => navigate(-1)} aria-label="Back"
          className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center text-(--text-primary)">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="font-semibold text-(--text-primary) leading-tight truncate">{d.reason_label}</h1>
          <p className="text-xs text-(--text-muted) truncate">{d.property_title}</p>
        </div>
        <StatusBadge status={d.status} />
      </div>

      <div className="max-w-md mx-auto px-4 pt-4 space-y-3">
        {/* Case summary */}
        <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-2.5 text-sm" aria-label="Case summary">
          <div className="flex items-center gap-2 text-(--text-muted)">
            <CalendarDays size={16} aria-hidden="true" />
            <span>{fmtDate(d.check_in)} → {fmtDate(d.check_out)}</span>
          </div>
          <div className="flex items-center gap-2 text-(--text-muted)">
            {(() => { const I = ROLE_ICON[d.opener_role]; return <I size={16} aria-hidden="true" />; })()}
            <span>Reported by the {d.opener_role === "guest" ? "guest" : "host"}</span>
          </div>
          {d.claimed_amount > 0 && (
            <div className="flex items-center gap-2 text-(--text-muted)">
              <Banknote size={16} aria-hidden="true" /><span>Claimed: {kes(d.claimed_amount)}</span>
            </div>
          )}
          {d.status === "open" && (
            <Notice tone="info">{frozen} while our team reviews this case. Add photos and details below.</Notice>
          )}
        </section>

        {/* Decision */}
        {d.status === "resolved" && (
          <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-2 border-l-4 border-forest">
            <p className="flex items-center gap-2 font-semibold text-(--text-primary)">
              <Gavel size={18} className="text-forest" aria-hidden="true" /> Decision
            </p>
            <p className="text-sm text-(--text-muted) whitespace-pre-line">{d.ruling}</p>
            {d.guest_refund_kes > 0 && <p className="text-sm text-forest font-medium">Guest refund: {kes(d.guest_refund_kes)} to M-Pesa</p>}
            {d.owner_award_kes > 0 && <p className="text-sm text-forest font-medium">Paid to host from deposit: {kes(d.owner_award_kes)}</p>}
            {d.resolved_at && <p className="text-xs text-(--text-muted)">{fmtDateTime(d.resolved_at)}</p>}
          </section>
        )}

        {/* Thread */}
        <ol className="space-y-3" aria-label="Messages">
          {d.messages.map(m => <MessageBubble key={m.id} m={m} />)}
        </ol>
        <div ref={bottomRef} />

        {d.can_resolve && <ResolveForm d={d} />}

        {d.can_withdraw && (
          <button onClick={() => { if (confirm("Withdraw this report? The payout or deposit will be released as normal.")) withdraw.mutate(); }}
            disabled={withdraw.isPending}
            className="w-full flex items-center justify-center gap-2 border border-(--border) text-(--text-muted) text-sm font-medium py-3 rounded-2xl">
            <Undo2 size={16} aria-hidden="true" /> Withdraw report
          </button>
        )}

        <Link to={d.viewer_role === "owner" ? "/owner/bookings" : d.viewer_role === "admin" ? "/admin" : "/bookings"}
          className="block text-center text-sm text-teal underline underline-offset-2 pt-2">
          Back to bookings
        </Link>
      </div>

      {d.can_reply && <ReplyBox disputeId={d.id} />}
    </div>
  );
}

function MessageBubble({ m }: { m: Message }) {
  const Icon = ROLE_ICON[m.author_role];
  const isAdmin = m.author_role === "admin";
  return (
    <li className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-3 space-y-2 ${
        isAdmin ? "bg-forest/10 border border-forest/25"
          : m.mine ? "bg-forest text-white" : "bg-(--bg-surface)"}`}>
        <p className={`flex items-center gap-1.5 text-xs font-semibold ${m.mine && !isAdmin ? "text-white/80" : "text-(--text-muted)"}`}>
          <Icon size={12} aria-hidden="true" /> {m.mine ? "You" : ROLE_LABEL[m.author_role]}
        </p>
        <p className={`text-sm whitespace-pre-line wrap-break-word ${m.mine && !isAdmin ? "" : "text-(--text-primary)"}`}>{m.body}</p>
        {m.attachments.length > 0 && (
          <div className="grid grid-cols-3 gap-1.5">
            {m.attachments.map(url => url.includes("/video/") ? (
              <video key={url} src={url} controls preload="metadata" className="w-full aspect-square object-cover rounded-lg col-span-3" />
            ) : (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer" aria-label="Open photo">
                <img src={url.replace("/upload/", "/upload/w_300,h_300,c_fill,q_auto,f_auto/")} alt="Evidence photo"
                  loading="lazy" className="w-full aspect-square object-cover rounded-lg" />
              </a>
            ))}
          </div>
        )}
        <p className={`text-[11px] ${m.mine && !isAdmin ? "text-white/70" : "text-(--text-muted)"}`}>{fmtDateTime(m.created_at)}</p>
      </div>
    </li>
  );
}

function ReplyBox({ disputeId }: { disputeId: string }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [showPhotos, setShowPhotos] = useState(false);
  const { uploading, failed, ready } = photoStatus(photos);

  const send = useMutation({
    mutationFn: () => apiJson(`/disputes/${disputeId}/messages`, {
      method: "POST",
      json: { body: body.trim(), attachments: ready.map(p => p.url) },
    }),
    onSuccess: () => {
      setBody(""); setPhotos([]); setShowPhotos(false);
      qc.invalidateQueries({ queryKey: ["dispute", disputeId] });
    },
  });

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 bg-(--bg-surface) border-t border-(--border) px-4 py-3"
      style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
      <div className="max-w-md mx-auto space-y-2">
        {showPhotos && <PhotoUploader value={photos} onChange={setPhotos} maxPhotos={6} purpose="dispute" />}
        {send.isError && <p className="text-xs text-red-600" role="alert">{(send.error as Error).message}</p>}
        <div className="flex items-end gap-2">
          <button onClick={() => setShowPhotos(v => !v)} aria-label="Attach photos" aria-pressed={showPhotos}
            className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${showPhotos ? "bg-forest text-white" : "bg-(--bg-primary) text-(--text-muted)"}`}>
            <Paperclip size={18} />
          </button>
          <label className="sr-only" htmlFor="reply">Write a message</label>
          <textarea id="reply" value={body} onChange={e => setBody(e.target.value)} rows={1} maxLength={4000}
            placeholder="Write a message…"
            className="flex-1 bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-2xl px-4 py-2.5 text-sm outline-hidden resize-none max-h-32 focus:border-teal" />
          <button onClick={() => send.mutate()} aria-label="Send"
            disabled={!body.trim() || send.isPending || uploading > 0 || failed > 0}
            className="w-10 h-10 rounded-full bg-forest disabled:bg-gray-300 text-white flex items-center justify-center shrink-0">
            {send.isPending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}

function ResolveForm({ d }: { d: DisputeDetail }) {
  const qc = useQueryClient();
  const [ruling, setRuling] = useState("");
  const [amount, setAmount] = useState("");
  const [deduct, setDeduct] = useState(true);
  const isGuestCase = d.opener_role === "guest";
  const max = (isGuestCase ? d.max_guest_refund : d.max_owner_award) ?? 0;
  const n = Number(amount || 0);

  const resolve = useMutation({
    mutationFn: () => apiJson(`/disputes/${d.id}/resolve`, {
      method: "POST",
      json: {
        ruling: ruling.trim(),
        guest_refund_kes: isGuestCase ? n : 0,
        owner_award_kes: isGuestCase ? 0 : n,
        deduct_from_owner: deduct,
      },
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["dispute", d.id] }),
  });

  return (
    <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-3 border border-purple-200 dark:border-purple-900">
      <p className="flex items-center gap-2 font-semibold text-(--text-primary)">
        <Gavel size={18} aria-hidden="true" /> Decide this case
      </p>
      <label className="block">
        <span className="text-xs font-semibold text-(--text-primary)">
          {isGuestCase ? "Refund to guest" : "Pay host from deposit"} (KES, max {kes(max)})
        </span>
        <div className="relative mt-1">
          <Wallet size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-(--text-muted)" aria-hidden="true" />
          <input type="number" inputMode="numeric" min={0} max={max} value={amount}
            onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
            className="w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl pl-9 pr-3 py-2.5 text-sm outline-hidden focus:border-teal" />
        </div>
        {!isGuestCase && d.max_owner_award ? (
          <span className="text-xs text-(--text-muted)">The rest of the deposit ({kes(Math.max(0, max - n))}) goes back to the guest.</span>
        ) : null}
      </label>
      {isGuestCase && (
        <label className="flex items-center gap-2 text-sm text-(--text-primary)">
          <input type="checkbox" checked={deduct} onChange={e => setDeduct(e.target.checked)} className="w-4 h-4 accent-forest" />
          Deduct this refund from the host's payout
        </label>
      )}
      <label className="block">
        <span className="text-xs font-semibold text-(--text-primary)">Decision (both parties see this)</span>
        <textarea value={ruling} onChange={e => setRuling(e.target.value)} rows={3}
          className="mt-1 w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden resize-none focus:border-teal" />
      </label>
      {resolve.isError && <Notice tone="error">{(resolve.error as Error).message}</Notice>}
      <button onClick={() => resolve.mutate()} disabled={resolve.isPending || ruling.trim().length < 10 || n > max}
        className="w-full flex items-center justify-center gap-2 bg-purple-700 disabled:bg-gray-300 text-white font-bold py-3 rounded-2xl text-sm">
        {resolve.isPending ? <Loader2 size={16} className="animate-spin" /> : <Gavel size={16} aria-hidden="true" />}
        Send decision{n > 0 ? ` and pay ${kes(n)}` : ""}
      </button>
    </section>
  );
}

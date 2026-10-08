/**
 * Guest ↔ host conversation for one booking. Used at /messages/:bookingId
 * (guests) and /owner/messages/:bookingId (hosts). Refreshes every 10 seconds
 * while open; new messages trigger an SMS to the other side (throttled).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarDays, Loader2, LockKeyhole, Send } from "lucide-react";
import { apiJson, ApiError } from "../utils/api";
import { fmtDate } from "../utils/format";
import Notice from "./ui/Notice";

interface Thread {
  booking: { id: string; property_title: string; check_in: string; check_out: string; status: string };
  role: "guest" | "host" | "admin";
  with: string;
  can_write: boolean;
  messages: { id: string; body: string; mine: boolean; sender: string; created_at: string; read: boolean }[];
}

const time = (iso: string) => new Date(iso).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function MessageThread({ bookingId, backTo }: { bookingId: string; backTo: string }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const q = useQuery({
    queryKey: ["messages", bookingId],
    queryFn: () => apiJson<Thread>(`/bookings/${bookingId}/messages`),
    refetchInterval: 10_000,
  });
  const send = useMutation({
    mutationFn: (body: string) => apiJson(`/bookings/${bookingId}/messages`, { method: "POST", json: { body } }),
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: ["messages", bookingId] });
      qc.invalidateQueries({ queryKey: ["unread-messages"] });
    },
  });
  const count = q.data?.messages.length ?? 0;
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [count]);
  useEffect(() => { qc.invalidateQueries({ queryKey: ["unread-messages"] }); }, [count, qc]);

  if (q.isLoading) return <p className="text-center text-sm text-(--text-muted) py-16">Loading conversation…</p>;
  if (q.isError) {
    const status = (q.error as ApiError).status;
    return <div className="p-4"><Notice tone="error">{status === 401 ? "Sign in to read your messages." : "This conversation isn't available."}</Notice></div>;
  }
  const t = q.data!;
  const submit = () => { const body = text.trim(); if (body && !send.isPending) send.mutate(body); };

  return (
    <div className="flex flex-col h-[calc(100dvh-var(--header-h)-4rem-var(--sab))] lg:h-[calc(100dvh-var(--header-h)-2rem)] max-w-2xl mx-auto">
      {/* Who and which stay */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-(--border) bg-(--bg-surface)">
        <Link to={backTo} aria-label="Back" className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0">
          <p className="font-semibold text-(--text-primary) truncate">{t.role === "admin" ? "Guest and host" : t.with}</p>
          <p className="flex items-center gap-1 text-xs text-(--text-muted) truncate">
            <CalendarDays className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {t.booking.property_title} · {fmtDate(t.booking.check_in, { day: "numeric", month: "short" })} to {fmtDate(t.booking.check_out, { day: "numeric", month: "short" })}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-(--bg-primary)" aria-live="polite">
        <p className="flex items-start gap-2 text-xs text-(--text-muted) bg-(--bg-surface) rounded-xl px-3 py-2">
          <LockKeyhole className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
          Keep payments and changes on NaivaStay so you stay protected. Never pay outside the app. The NaivaStay team can read
          this conversation if you ask for help.
        </p>
        {t.messages.length === 0 && (
          <p className="text-center text-sm text-(--text-muted) py-8">
            {t.role === "guest" ? "Ask your host anything: arrival time, directions, special requests." : "Say hello to your guest, or share arrival details."}
          </p>
        )}
        {t.messages.map(m => (
          <div key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 ${m.mine ? "bg-forest text-white rounded-br-sm" : "bg-(--bg-surface) text-(--text-primary) rounded-bl-sm"}`}>
              {!m.mine && t.role === "admin" && <p className="text-[11px] font-semibold opacity-70">{m.sender}</p>}
              <p className="text-sm whitespace-pre-line break-words">{m.body}</p>
              <p className={`text-[10px] mt-0.5 ${m.mine ? "text-white/70" : "text-(--text-muted)"}`}>
                {time(m.created_at)}{m.mine && m.read ? " · Seen" : ""}
              </p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Compose */}
      {t.can_write ? (
        <div className="border-t border-(--border) bg-(--bg-surface) px-3 py-3">
          {send.isError && <p className="text-xs text-red-600 mb-1" role="alert">{(send.error as Error).message}</p>}
          <div className="flex items-end gap-2">
            <textarea value={text} onChange={e => setText(e.target.value)} rows={1} maxLength={2000}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="Write a message…" aria-label="Your message"
              className="flex-1 resize-none max-h-32 bg-(--bg-primary) border border-(--border) rounded-2xl px-3.5 py-2.5 text-sm text-(--text-primary) outline-none focus:border-teal" />
            <button onClick={submit} disabled={!text.trim() || send.isPending} aria-label="Send"
              className="w-11 h-11 rounded-full bg-forest disabled:bg-gray-300 text-white flex items-center justify-center shrink-0">
              {send.isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      ) : (
        <p className="border-t border-(--border) bg-(--bg-surface) px-4 py-3 text-xs text-(--text-muted) text-center">
          This conversation is closed. Contact NaivaStay support if you need help.
        </p>
      )}
    </div>
  );
}

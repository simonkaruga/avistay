/**
 * Ask Avi: NaivaStay's AI assistant. A floating "Ask Avi" button and chat panel.
 * Property pages talk to /properties/:id/chat (answers about that home);
 * the home page talks to /avi/chat (helps choose a home, explains NaivaStay).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Send, Sparkles, X } from "lucide-react";
import { api } from "../utils/api";

export default function AskAvi({ endpoint, subtitle, greeting, starters, note, open, setOpen, raised = true, phoneButton = true }: {
  endpoint: string; subtitle: string; greeting: string; starters: string[]; note: string;
  open: boolean; setOpen: (v: boolean) => void;
  /** Phones: sit higher when a booking bar is at the bottom (property pages). */
  raised?: boolean;
  /** False where the page already offers Avi (home hero): keeps the button off small screens. */
  phoneButton?: boolean;
}) {
  const [input,   setInput]   = useState("");
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<{ role: "user"|"assistant"; content: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, loading]);
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;
    setInput("");
    const newHistory = [...history, { role: "user" as const, content: msg }];
    setHistory(newHistory);
    setLoading(true);
    try {
      const r = await api(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history: history.slice(-8) }),
      });
      const data = r.ok ? await r.json()
        : { reply: r.status === 429 ? "You've asked a lot of questions. Please try again a little later." : "Sorry, I couldn't connect. Please try again." };
      setHistory([...newHistory, { role: "assistant", content: data.reply }]);
    } catch {
      setHistory([...newHistory, { role: "assistant", content: "Connection error. Try again." }]);
    }
    setLoading(false);
  }, [input, loading, history, endpoint]);

  return (
    <>
      {/* Floating button: labelled so guests know what it is */}
      <button
        onClick={() => setOpen(!open)}
        aria-label={open ? "Close Avi" : "Ask Avi about this home"}
        aria-expanded={open}
        className={`${phoneButton ? "flex" : "hidden lg:flex"} fixed ${raised ? "bottom-[calc(9rem+var(--sab))]" : "bottom-[calc(5rem+var(--sab))]"} lg:bottom-6 right-4 lg:right-6 z-510 h-12 pl-4 pr-5 rounded-full bg-forest text-white shadow-xl flex items-center gap-2 font-semibold text-sm active:scale-95 transition-transform`}
      >
        {open
          ? <><X className="w-5 h-5" strokeWidth={2.5} aria-hidden="true" /> Close</>
          : <><Sparkles className="w-5 h-5" aria-hidden="true" /> Ask Avi</>}
      </button>

      {open && (
        <div role="dialog" aria-label="Ask Avi about this home"
          className={`fixed ${raised ? "bottom-[calc(13rem+var(--sab))]" : "bottom-[calc(5rem+var(--sab))]"} lg:bottom-24 right-4 left-4 lg:left-auto lg:w-96 z-510 bg-(--bg-surface) rounded-3xl shadow-2xl border border-(--border) overflow-hidden flex flex-col`}
          style={{ maxHeight: "60vh", animation: "fade-up 0.2s ease-out both" }}>
          <div className="flex items-center gap-3 px-4 py-3 bg-forest">
            <div className="w-9 h-9 rounded-full bg-white/15 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-mint" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-sm font-semibold">Avi <span className="font-normal text-white/65">· NaivaStay's AI assistant</span></p>
              <p className="text-white/65 text-xs truncate">{subtitle}</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" aria-live="polite">
            {history.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-(--text-primary)">{greeting}</p>
                {starters.map(q => (
                  <button key={q} onClick={() => send(q)}
                    className="w-full text-left text-sm bg-(--bg-overlay) hover:bg-forest/10 rounded-xl px-3 py-2 text-(--text-primary)">
                    {q}
                  </button>
                ))}
              </div>
            )}
            {history.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm whitespace-pre-line ${
                  m.role === "user"
                    ? "bg-forest text-white rounded-br-sm"
                    : "bg-(--bg-overlay) text-(--text-primary) rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start" aria-label="Avi is typing">
                <div className="bg-(--bg-overlay) rounded-2xl rounded-bl-sm px-4 py-2.5 flex gap-1">
                  {[0,1,2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-(--text-muted) animate-bounce" style={{ animationDelay: `${i*0.15}s` }} />
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-(--border) px-3 pt-3 pb-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                value={input}
                maxLength={500}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && send()}
                placeholder="Ask a question…"
                aria-label="Your question"
                className="flex-1 bg-(--bg-overlay) rounded-xl px-3 py-2 text-sm text-(--text-primary) outline-hidden"
              />
              <button onClick={() => send()} disabled={!input.trim() || loading} aria-label="Send"
                className="w-10 h-10 bg-forest disabled:bg-(--border) text-white rounded-xl flex items-center justify-center shrink-0">
                <Send className="w-4 h-4" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </div>
            <p className="text-[11px] text-(--text-muted) mt-1.5 text-center">{note}</p>
          </div>
        </div>
      )}
    </>
  );
}


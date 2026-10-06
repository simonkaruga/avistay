/**
 * Home search card.
 * Computers/tablets: one line — Where | When | Who | Search.
 * Phones: stacked rows, since one line can't fit.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarDays, MapPin, Minus, Plus, Search, Users } from "lucide-react";
import { WORK_TRIP_KEY } from "../../utils/workTrip";

const todayIso = () => new Date().toISOString().slice(0, 10);
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-KE", { weekday: "short", day: "numeric", month: "short" });

/** A date field that reads like text ("Fri 9 Oct") but opens the phone's date picker. */
function DateField({ value, min, placeholder, onChange, label }: {
  value: string; min: string; placeholder: string; onChange: (v: string) => void; label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <span className="relative">
      <button type="button" onClick={() => { try { ref.current?.showPicker(); } catch { ref.current?.focus(); } }}
        className={`text-sm whitespace-nowrap ${value ? "font-semibold text-(--text-primary)" : "text-(--text-muted)"}`}>
        {value ? fmt(value) : placeholder}
      </button>
      <input ref={ref} type="date" value={value} min={min} aria-label={label}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 pointer-events-none w-full" tabIndex={-1} />
    </span>
  );
}

function Counter({ label, sub, value, min, onChange }: {
  label: string; sub?: string; value: number; min: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-2">
      <div>
        <p className="text-sm font-semibold text-(--text-primary)">{label}</p>
        {sub && <p className="text-xs text-(--text-muted)">{sub}</p>}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min}
          aria-label={`Fewer ${label.toLowerCase()}`}
          className="w-8 h-8 rounded-full border border-(--border) flex items-center justify-center text-forest disabled:opacity-30">
          <Minus className="w-4 h-4" />
        </button>
        <span className="w-5 text-center text-sm font-semibold text-(--text-primary)" aria-live="polite">{value}</span>
        <button type="button" onClick={() => onChange(Math.min(20, value + 1))} disabled={value >= 20}
          aria-label={`More ${label.toLowerCase()}`}
          className="w-8 h-8 rounded-full border border-(--border) flex items-center justify-center text-forest disabled:opacity-30">
          <Plus className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

export default function SearchBar() {
  const navigate = useNavigate();
  const [location, setLocation] = useState("");
  const [checkIn, setCheckIn] = useState("");
  const [checkOut, setCheckOut] = useState("");
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [guestsOpen, setGuestsOpen] = useState(false);
  const [workTrip, setWorkTrip] = useState(() => {
    try { return sessionStorage.getItem(WORK_TRIP_KEY) === "1"; } catch { return false; }
  });
  const guestsRef = useRef<HTMLDivElement>(null);

  // Close the guests panel on outside click or Esc.
  useEffect(() => {
    if (!guestsOpen) return;
    const onDown = (e: MouseEvent) => { if (!guestsRef.current?.contains(e.target as Node)) setGuestsOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setGuestsOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [guestsOpen]);

  function pickCheckIn(v: string) {
    setCheckIn(v);
    if (v && (!checkOut || checkOut <= v)) setCheckOut(nextDay(v));   // keep the range valid
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = new URLSearchParams();
    if (location.trim()) p.set("location", location.trim());
    if (checkIn) p.set("check_in", checkIn);
    if (checkOut) p.set("check_out", checkOut);
    p.set("adults", String(adults));
    p.set("children", String(children));
    p.set("guests", String(adults + children));
    navigate(`/search?${p.toString()}`);
  }

  const guestSummary = `${adults} adult${adults !== 1 ? "s" : ""}${children ? ` · ${children} child${children !== 1 ? "ren" : ""}` : ""}`;
  // Each field: small label on top, value below — divided by thin lines on wide screens.
  const cell = "flex items-center gap-3 px-4 py-2.5 md:py-3 min-w-0 rounded-xl md:rounded-none hover:bg-(--bg-primary) transition-colors";
  const caption = "block text-[11px] font-semibold uppercase tracking-wider text-forest";

  return (
    <form onSubmit={submit} role="search" aria-label="Search stays"
      className="relative z-20 -mt-8 mx-4 lg:mx-auto max-w-5xl" style={{ animation: "fade-up 0.8s ease-out 0.24s both" }}>
      <div className="flex flex-col md:flex-row md:items-center gap-1 md:gap-0 p-2 rounded-2xl bg-(--bg-surface) border border-(--border) shadow-[0_12px_32px_-12px_rgba(20,27,22,0.35)]
                      md:divide-x md:divide-(--border)">
        <label className={`${cell} md:flex-[1.4] cursor-text`}>
          <MapPin className="w-5 h-5 text-forest shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className={caption}>Where</span>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Lakeside, Hell's Gate, a home…"
              aria-label="Where are you going?"
              className="w-full bg-transparent outline-hidden text-sm font-medium text-(--text-primary) placeholder:text-(--text-muted) placeholder:font-normal" />
          </span>
        </label>

        <div className={`${cell} md:flex-[1.3]`}>
          <CalendarDays className="w-5 h-5 text-forest shrink-0" aria-hidden="true" />
          <span className="flex-1 min-w-0">
            <span className={caption}>When</span>
            <span className="flex items-center gap-1.5">
              <DateField label="Check-in date" value={checkIn} min={todayIso()} placeholder="Arrive" onChange={pickCheckIn} />
              <span className="text-(--text-muted)" aria-hidden="true">→</span>
              <DateField label="Check-out date" value={checkOut} min={checkIn ? nextDay(checkIn) : nextDay(todayIso())}
                placeholder="Leave" onChange={setCheckOut} />
            </span>
          </span>
        </div>

        <div ref={guestsRef} className="relative md:flex-1">
          <button type="button" onClick={() => setGuestsOpen(o => !o)} aria-expanded={guestsOpen} aria-haspopup="dialog"
            className={`${cell} w-full text-left`}>
            <Users className="w-5 h-5 text-forest shrink-0" aria-hidden="true" />
            <span className="flex-1 min-w-0">
              <span className={caption}>Who</span>
              <span className="block text-sm font-medium text-(--text-primary) truncate">{guestSummary}</span>
            </span>
          </button>
          {guestsOpen && (
            <div role="dialog" aria-label="Guests"
              className="absolute left-0 right-0 md:left-auto md:w-80 top-full mt-2 z-30 bg-(--bg-surface) rounded-2xl border border-(--border) shadow-xl px-4 py-2">
              <Counter label="Adults" sub="Age 13+" value={adults} min={1} onChange={setAdults} />
              <Counter label="Children" sub="Ages 0 to 12" value={children} min={0} onChange={setChildren} />
              <button type="button" onClick={() => setGuestsOpen(false)}
                className="w-full mt-2 mb-1 py-2 rounded-full border border-forest text-forest text-sm font-semibold">
                Done
              </button>
            </div>
          )}
        </div>

        <div className="md:pl-2 border-l-0!">
          <button type="submit"
            className="w-full flex items-center justify-center gap-2 h-12 md:h-14 px-7 rounded-xl bg-clay hover:bg-(--color-clay-dark) text-white font-bold text-sm active:scale-[.98] transition">
            <Search className="w-4 h-4" aria-hidden="true" /> Search
          </button>
        </div>
      </div>

      {/* Business travellers: remembered for checkout (company invoice + KRA PIN) */}
      <label className="mt-2.5 ml-1 inline-flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={workTrip} className="w-4 h-4 accent-forest"
          onChange={e => {
            setWorkTrip(e.target.checked);
            try { sessionStorage.setItem(WORK_TRIP_KEY, e.target.checked ? "1" : "0"); } catch { /* private mode */ }
          }} />
        <span className="text-sm text-(--text-primary)">Business trip? I need a company invoice</span>
      </label>
    </form>
  );
}

/**
 * "House rules & policies" for a listing — every choice is the owner's.
 * Shared by New listing and Edit listing.
 */
import { useSite } from "../../components/SiteNotice";
import type { LucideIcon } from "lucide-react";
import { Baby, CalendarX, Cigarette, Clock, Dog, Moon, PartyPopper, Shield, Users } from "lucide-react";

export interface HouseRules {
  max_guests: string;
  min_nights: string;
  cancellation_policy: string;
  no_checkout_days: string;
  deposit_amount: string;
  check_in_from: string;
  check_in_until: string;
  check_out_until: string;
  children_allowed: boolean;
  pets_allowed: boolean;
  smoking_allowed: boolean;
  parties_allowed: boolean;
  quiet_from: string;
  quiet_until: string;
  house_rules: string;
}

export const DEFAULT_HOUSE_RULES: HouseRules = {
  max_guests: "", min_nights: "1", cancellation_policy: "moderate", no_checkout_days: "",
  deposit_amount: "0", check_in_from: "14:00", check_in_until: "", check_out_until: "10:00",
  children_allowed: true, pets_allowed: false, smoking_allowed: false, parties_allowed: false,
  quiet_from: "", quiet_until: "", house_rules: "",
};

/** API listing → form values. */
export function rulesFromListing(p: Record<string, unknown>): HouseRules {
  const [qf, qu] = String(p.quiet_hours ?? "").split("-");
  return {
    max_guests: p.max_guests != null ? String(p.max_guests) : "",
    min_nights: String(p.min_nights ?? 1),
    cancellation_policy: String(p.cancellation_policy ?? "moderate"),
    no_checkout_days: String(p.no_checkout_days ?? ""),
    deposit_amount: String(p.deposit_amount ?? 0),
    check_in_from: String(p.check_in_from ?? "14:00"),
    check_in_until: String(p.check_in_until ?? ""),
    check_out_until: String(p.check_out_until ?? "10:00"),
    children_allowed: p.children_allowed !== false,
    pets_allowed: p.pets_allowed === true,
    smoking_allowed: p.smoking_allowed === true,
    parties_allowed: p.parties_allowed === true,
    quiet_from: qf ?? "", quiet_until: qu ?? "",
    house_rules: String(p.house_rules ?? ""),
  };
}

/** Form values → API fields. */
export function rulesToPayload(r: HouseRules) {
  return {
    max_guests: r.max_guests ? Number(r.max_guests) : null,
    min_nights: Number(r.min_nights) || 1,
    cancellation_policy: r.cancellation_policy,
    no_checkout_days: r.no_checkout_days || null,
    deposit_amount: Number(r.deposit_amount) || 0,
    check_in_from: r.check_in_from || "14:00",
    check_in_until: r.check_in_until || null,
    check_out_until: r.check_out_until || "10:00",
    children_allowed: r.children_allowed,
    pets_allowed: r.pets_allowed,
    smoking_allowed: r.smoking_allowed,
    parties_allowed: r.parties_allowed,
    quiet_hours: r.quiet_from && r.quiet_until ? `${r.quiet_from}-${r.quiet_until}` : null,
    house_rules: r.house_rules.trim() || null,
  };
}

const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";
const labelCls = "block text-xs text-(--text-muted) font-medium mb-1";

function Toggle({ Icon, label, checked, onChange }: { Icon: LucideIcon; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 py-2 cursor-pointer">
      <span className="flex items-center gap-2 text-sm text-(--text-primary)"><Icon className="w-4 h-4 text-(--text-muted)" aria-hidden="true" />{label}</span>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="w-5 h-5 accent-forest" />
    </label>
  );
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function HouseRulesFields({ value, onChange, pricePerNight }: {
  value: HouseRules; onChange: (v: HouseRules) => void; pricePerNight?: number;
}) {
  const site = useSite();
  const set = <K extends keyof HouseRules>(k: K, v: HouseRules[K]) => onChange({ ...value, [k]: v });
  const suggestedDeposit = pricePerNight ? Math.min(50_000, Math.max(2_000, Math.round(pricePerNight * 0.5 / 500) * 500)) : 5_000;
  const days = value.no_checkout_days ? value.no_checkout_days.split(",").filter(Boolean) : [];

  return (
    <div className="bg-(--bg-surface) rounded-2xl p-4 space-y-5">
      <div>
        <p className="text-sm font-semibold text-(--text-primary)">House rules &amp; policies</p>
        <p className="text-xs text-(--text-muted) mt-0.5">Guests see these before they book. Clear rules mean fewer surprises.</p>
      </div>

      {/* Stay */}
      <div className="grid grid-cols-2 gap-3">
        <label>
          <span className={labelCls}><Users className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Max guests</span>
          <input type="number" min={1} max={100} value={value.max_guests} placeholder="e.g. 6"
            onChange={e => set("max_guests", e.target.value)} className={inputCls} />
        </label>
        <label>
          <span className={labelCls}><Moon className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Minimum nights</span>
          <input type="number" min={1} max={30} value={value.min_nights} onChange={e => set("min_nights", e.target.value)} className={inputCls} />
        </label>
      </div>

      {/* Times */}
      <div>
        <p className={labelCls}><Clock className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Check-in and check-out</p>
        <div className="grid grid-cols-3 gap-2">
          <label><span className="block text-[11px] text-(--text-muted) mb-0.5">Check-in from</span>
            <input type="time" value={value.check_in_from} onChange={e => set("check_in_from", e.target.value)} className={inputCls} /></label>
          <label><span className="block text-[11px] text-(--text-muted) mb-0.5">until (optional)</span>
            <input type="time" value={value.check_in_until} onChange={e => set("check_in_until", e.target.value)} className={inputCls} /></label>
          <label><span className="block text-[11px] text-(--text-muted) mb-0.5">Check-out by</span>
            <input type="time" value={value.check_out_until} onChange={e => set("check_out_until", e.target.value)} className={inputCls} /></label>
        </div>
      </div>

      {/* Cancellation */}
      <label className="block">
        <span className={labelCls}><CalendarX className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Cancellation policy</span>
        <select value={value.cancellation_policy} onChange={e => set("cancellation_policy", e.target.value)} className={inputCls}>
          <option value="flexible">Flexible: full refund up to 1 day before check-in</option>
          <option value="moderate">Moderate: full refund up to 5 days before</option>
          <option value="strict">Strict: 50% refund up to 7 days before</option>
        </select>
        <span className="block text-[11px] text-(--text-muted) mt-1">Flexible gets the most bookings; strict suits busy holiday dates.</span>
      </label>

      {/* Deposit */}
      <div>
        <p className={labelCls}><Shield className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Damage deposit</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => set("deposit_amount", "0")}
            className={`px-3 py-2 rounded-xl text-sm border ${value.deposit_amount === "0" ? "bg-forest/10 border-forest text-forest font-semibold" : "border-(--border) text-(--text-primary)"}`}>
            No deposit
          </button>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-(--text-muted)">KES</span>
            <input type="number" min={0} max={100000} step={500} value={value.deposit_amount === "0" ? "" : value.deposit_amount}
              placeholder={`e.g. ${suggestedDeposit.toLocaleString()}`}
              onChange={e => set("deposit_amount", e.target.value.replace(/\D/g, "") || "0")}
              className={`${inputCls} pl-12`} aria-label="Deposit amount in KES" />
          </div>
        </div>
        <span className="block text-[11px] text-(--text-muted) mt-1">
          Guests pay it with the booking. NaivaStay holds it and returns it {site.depositDays} after check-out, unless you report damage, in which case our team decides.
        </span>
      </div>

      {/* Rules */}
      <div className="divide-y divide-(--border)">
        <Toggle Icon={Baby} label="Children welcome" checked={value.children_allowed} onChange={v => set("children_allowed", v)} />
        <Toggle Icon={Dog} label="Pets allowed" checked={value.pets_allowed} onChange={v => set("pets_allowed", v)} />
        <Toggle Icon={Cigarette} label="Smoking allowed" checked={value.smoking_allowed} onChange={v => set("smoking_allowed", v)} />
        <Toggle Icon={PartyPopper} label="Parties & events allowed" checked={value.parties_allowed} onChange={v => set("parties_allowed", v)} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label><span className={labelCls}><Moon className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />Quiet hours from</span>
          <input type="time" value={value.quiet_from} onChange={e => set("quiet_from", e.target.value)} className={inputCls} /></label>
        <label><span className={labelCls}>until</span>
          <input type="time" value={value.quiet_until} onChange={e => set("quiet_until", e.target.value)} className={inputCls} /></label>
      </div>

      <div>
        <p className={labelCls}>No check-out on (optional)</p>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((day, i) => {
            const on = days.includes(String(i));
            return (
              <button key={day} type="button" aria-pressed={on}
                onClick={() => set("no_checkout_days", (on ? days.filter(d => d !== String(i)) : [...days, String(i)]).join(","))}
                className={`text-xs px-2.5 py-1 rounded-lg border ${on ? "bg-forest text-white border-forest" : "border-(--border) text-(--text-muted)"}`}>
                {day}
              </button>
            );
          })}
        </div>
      </div>

      <label className="block">
        <span className={labelCls}>Other rules (optional)</span>
        <textarea rows={3} maxLength={2000} value={value.house_rules} onChange={e => set("house_rules", e.target.value)}
          placeholder="e.g. No loud music after 10pm. Please don't feed the monkeys. Boats only with our guide."
          className={`${inputCls} resize-none`} />
      </label>
    </div>
  );
}

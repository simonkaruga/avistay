import { Check } from "lucide-react";

/** Booking.com-style progress: Your details → Pay → Confirmed. */
export default function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 text-xs" aria-label="Booking progress">
      {steps.map((label, i) => {
        const done = i < current, active = i === current;
        return (
          <li key={label} className="flex items-center gap-2 flex-1 min-w-0" aria-current={active ? "step" : undefined}>
            <span className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 font-bold ${
              done ? "bg-forest text-white"
                : active ? "border-2 border-forest text-forest"
                : "border-2 border-(--border) text-(--text-muted)"}`}>
              {done ? <Check size={14} aria-hidden="true" /> : i + 1}
            </span>
            <span className={`truncate ${active ? "font-semibold text-(--text-primary)" : "text-(--text-muted)"}`}>{label}</span>
            {i < steps.length - 1 && <span className="flex-1 h-px bg-(--border) min-w-[8px]" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}

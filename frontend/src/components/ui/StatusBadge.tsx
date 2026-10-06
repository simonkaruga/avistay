import type { LucideIcon } from "lucide-react";
import {
  CheckCircle, CheckCircle2, Clock, DoorOpen, Gavel, MessageSquareWarning, Undo2, XCircle,
} from "lucide-react";

type Tone = "amber" | "blue" | "green" | "gray" | "red" | "purple";

const TONE_CLS: Record<Tone, string> = {
  amber:  "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  blue:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  green:  "bg-mint/20 text-forest",
  gray:   "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  red:    "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  purple: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
};

const STATUSES: Record<string, { label: string; Icon: LucideIcon; tone: Tone }> = {
  // bookings
  pending:    { label: "Awaiting payment", Icon: Clock,        tone: "amber" },
  confirmed:  { label: "Confirmed",        Icon: CheckCircle,  tone: "blue" },
  checked_in: { label: "Checked in",       Icon: DoorOpen,     tone: "green" },
  completed:  { label: "Completed",        Icon: CheckCircle2, tone: "gray" },
  cancelled:  { label: "Cancelled",        Icon: XCircle,      tone: "red" },
  // disputes
  open:       { label: "Under review",     Icon: MessageSquareWarning, tone: "purple" },
  resolved:   { label: "Decided",          Icon: Gavel,        tone: "gray" },
  withdrawn:  { label: "Withdrawn",        Icon: Undo2,        tone: "gray" },
};

/** Status pill — icon + text, so status never relies on colour alone. */
export default function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = STATUSES[status] ?? { label: status, Icon: Clock, tone: "gray" as Tone };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${TONE_CLS[s.tone]}`}>
      <s.Icon size={12} aria-hidden="true" />
      {label ?? s.label}
    </span>
  );
}

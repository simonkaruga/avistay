import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

const TONES = {
  info:    { Icon: Info,          cls: "bg-teal/10 border-teal/30 text-teal" },
  success: { Icon: CheckCircle2,  cls: "bg-forest/10 border-forest/25 text-forest" },
  warning: { Icon: AlertTriangle, cls: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300" },
  error:   { Icon: XCircle,       cls: "bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-400" },
} as const;

/** Inline message box. `error` and `warning` are announced to screen readers. */
export default function Notice({ tone = "info", children, title }: {
  tone?: keyof typeof TONES; children: ReactNode; title?: string;
}) {
  const { Icon, cls } = TONES[tone];
  return (
    <div role={tone === "error" || tone === "warning" ? "alert" : "status"}
      className={`flex items-start gap-2.5 border rounded-2xl px-4 py-3 text-sm ${cls}`}>
      <Icon size={18} className="shrink-0 mt-0.5" aria-hidden="true" />
      <div className="leading-relaxed">
        {title && <p className="font-semibold">{title}</p>}
        <div className={title ? "text-xs mt-0.5 opacity-90" : ""}>{children}</div>
      </div>
    </div>
  );
}

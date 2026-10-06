import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Icon shown next to the title. */
  icon?: ReactNode;
}

/** Bottom sheet on phones, centred dialog on larger screens. Esc and backdrop close it. */
export default function Modal({ open, title, onClose, children, icon }: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} aria-hidden="true" />
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="relative w-full sm:max-w-md max-h-[90vh] overflow-y-auto bg-(--bg-surface) rounded-t-3xl sm:rounded-3xl px-5 pt-4 pb-8 outline-hidden"
        style={{ animation: "fade-up 0.2s ease-out both" }}>
        <div className="w-10 h-1 bg-(--border) rounded-full mx-auto mb-3 sm:hidden" aria-hidden="true" />
        <div className="flex items-center gap-2 mb-4">
          {icon && <span className="text-forest" aria-hidden="true">{icon}</span>}
          <h2 id={titleId} className="font-semibold text-(--text-primary) flex-1">{title}</h2>
          <button onClick={onClose} aria-label="Close"
            className="w-8 h-8 rounded-full bg-(--bg-primary) flex items-center justify-center text-(--text-muted)">
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

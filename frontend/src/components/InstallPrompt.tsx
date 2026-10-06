import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISSED_KEY = "sn_install_dismissed";

export default function InstallPrompt() {
  const [prompt, setPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setPrompt(e as BeforeInstallPromptEvent);
      // Small delay so it doesn't pop up the instant the page loads
      setTimeout(() => setVisible(true), 3000);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!visible || !prompt) return null;

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") {
      setVisible(false);
      setPrompt(null);
    }
  }

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  return (
    <div
      className="fixed bottom-20 left-4 right-4 z-50 bg-(--bg-surface) border border-(--border) rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3"
      style={{ animation: "fade-up 0.3s ease-out both" }}
    >
      <img src="/logo-mark.svg" alt="" className="w-10 h-10 object-contain shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-(--text-primary) text-sm leading-tight">Add to Home Screen</p>
        <p className="text-[13px] text-(--text-muted) mt-0.5">Book Naivasha homes in one tap</p>
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={dismiss}
          className="text-(--text-muted) text-xs px-2 py-1.5"
        >
          Not now
        </button>
        <button
          onClick={install}
          className="bg-forest text-white text-xs font-bold px-3 py-1.5 rounded-xl"
        >
          Install
        </button>
      </div>
    </div>
  );
}

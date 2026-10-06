import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import Modal from "./ui/Modal";
import Notice from "./ui/Notice";
import { apiJson, logout } from "../utils/api";

const CONFIRM_WORD = "DELETE";

/** Self-service account deletion — required by Google Play and the App Store. */
export default function DeleteAccountSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true); setError("");
    try {
      await apiJson("/auth/account", { method: "DELETE" });
      await logout();
      qc.clear();
      navigate("/", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete your account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Delete your account" icon={<Trash2 size={20} />}>
      <div className="space-y-4 text-sm">
        <p className="text-(--text-muted) leading-relaxed">This permanently removes:</p>
        <ul className="list-disc pl-5 space-y-1 text-(--text-primary)">
          <li>Your name, phone number, email and password</li>
          <li>Your ID documents and notification settings</li>
          <li>Your listings (hosts), which are taken offline</li>
        </ul>
        <p className="text-xs text-(--text-muted) leading-relaxed">
          Past booking and payment records are kept without your personal details for 7 years, as Kenyan tax law requires.
          You can't delete your account while you have an upcoming stay or a payment in progress.
        </p>
        <label className="block">
          <span className="text-xs font-semibold text-(--text-primary)">Type {CONFIRM_WORD} to confirm</span>
          <input value={typed} onChange={e => setTyped(e.target.value)} autoCapitalize="characters" autoComplete="off"
            className="mt-1 w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-red-400" />
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <button onClick={confirm} disabled={typed.trim().toUpperCase() !== CONFIRM_WORD || busy}
          className="w-full flex items-center justify-center gap-2 bg-red-600 disabled:bg-red-300 text-white font-bold py-3.5 rounded-2xl">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} aria-hidden="true" />} Delete my account
        </button>
      </div>
    </Modal>
  );
}

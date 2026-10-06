import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Ban, Camera, DoorClosed, FileWarning, HelpCircle, Loader2, ShieldAlert, Sparkles, Hammer, Send,
} from "lucide-react";
import Modal from "./ui/Modal";
import Notice from "./ui/Notice";
import PhotoUploader, { photoStatus, type UploadedPhoto } from "./PhotoUploader";
import { apiJson } from "../utils/api";
import { kes } from "../utils/format";

type Party = "guest" | "owner";

const REASONS: Record<Party, { id: string; label: string; Icon: LucideIcon }[]> = {
  guest: [
    { id: "no_access",        label: "Couldn't get in",       Icon: DoorClosed },
    { id: "not_as_described", label: "Not as described",      Icon: FileWarning },
    { id: "cleanliness",      label: "Cleanliness",           Icon: Sparkles },
    { id: "safety",           label: "Safety concern",        Icon: ShieldAlert },
    { id: "other",            label: "Something else",        Icon: HelpCircle },
  ],
  owner: [
    { id: "damage",      label: "Damage",            Icon: Hammer },
    { id: "house_rules", label: "House rules broken", Icon: Ban },
    { id: "other",       label: "Something else",    Icon: HelpCircle },
  ],
};

const INTRO: Record<Party, string> = {
  guest: "Tell us what's wrong. While we look into it, the host is not paid. Our team replies within a few hours.",
  owner: "Report damage or broken house rules. The guest's deposit stays held until our team decides.",
};

interface Props {
  open: boolean;
  onClose: () => void;
  bookingId: string;
  party: Party;
  /** Held deposit — the most an owner can be awarded. */
  depositAmount?: number;
}

export default function ReportProblemSheet({ open, onClose, bookingId, party, depositAmount = 0 }: Props) {
  const navigate = useNavigate();
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [amount, setAmount] = useState("");
  const [photos, setPhotos] = useState<UploadedPhoto[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const { uploading, failed, ready } = photoStatus(photos);
  const wantsAmount = party === "owner" && reason === "damage";
  const amountNum = Number(amount || 0);
  const amountInvalid = wantsAmount && (amountNum <= 0 || (depositAmount > 0 && amountNum > depositAmount));

  async function submit() {
    if (!reason) { setError("Choose what the problem is"); return; }
    if (message.trim().length < 10) { setError("Describe the problem in a sentence or two"); return; }
    if (failed) { setError("Some photos didn't upload. Retry or remove them"); return; }
    if (amountInvalid) { setError(depositAmount ? `Enter an amount up to ${kes(depositAmount)}` : "Enter the repair cost"); return; }
    setSubmitting(true); setError("");
    try {
      const res = await apiJson<{ id: string }>("/disputes/", {
        method: "POST",
        json: {
          booking_id: bookingId, reason, message: message.trim(),
          claimed_amount: wantsAmount ? amountNum : 0,
          attachments: ready.map(p => p.url),
        },
      });
      navigate(`/disputes/${res.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send your report");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={party === "guest" ? "Report a problem" : "Report damage or an issue"}
      icon={<ShieldAlert size={20} />}>
      <div className="space-y-4">
        <p className="text-sm text-(--text-muted) leading-relaxed">{INTRO[party]}</p>

        <fieldset>
          <legend className="text-xs font-semibold text-(--text-primary) mb-2">What happened?</legend>
          <div className="grid grid-cols-2 gap-2">
            {REASONS[party].map(({ id, label, Icon }) => (
              <button key={id} type="button" onClick={() => setReason(id)} aria-pressed={reason === id}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-sm transition-colors ${
                  reason === id
                    ? "border-forest bg-forest/10 text-forest font-semibold"
                    : "border-(--border) text-(--text-primary)"}`}>
                <Icon size={16} aria-hidden="true" className="shrink-0" /> {label}
              </button>
            ))}
          </div>
        </fieldset>

        {wantsAmount && (
          <label className="block">
            <span className="text-xs font-semibold text-(--text-primary)">Repair / replacement cost (KES)</span>
            <input type="number" inputMode="numeric" min={1} max={depositAmount || undefined} value={amount}
              onChange={e => setAmount(e.target.value.replace(/\D/g, ""))}
              className="mt-1 w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal" />
            {depositAmount > 0 && (
              <span className="text-xs text-(--text-muted)">Up to {kes(depositAmount)} can be paid from the guest's deposit.</span>
            )}
          </label>
        )}

        <label className="block">
          <span className="text-xs font-semibold text-(--text-primary)">Describe it</span>
          <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} maxLength={4000}
            placeholder={party === "guest" ? "e.g. We arrived at 2pm, the gate was locked and the host isn't answering." : "e.g. Glass coffee table in the lounge was shattered."}
            className="mt-1 w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden resize-none focus:border-teal" />
        </label>

        <div>
          <p className="flex items-center gap-1.5 text-xs font-semibold text-(--text-primary) mb-2">
            <Camera size={14} aria-hidden="true" /> Photos <span className="font-normal text-(--text-muted)">(strongly recommended)</span>
          </p>
          <PhotoUploader value={photos} onChange={setPhotos} maxPhotos={6} purpose="dispute" />
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <button onClick={submit} disabled={submitting || uploading > 0}
          className="w-full flex items-center justify-center gap-2 bg-forest disabled:bg-gray-300 text-white font-bold py-3.5 rounded-2xl text-sm">
          {submitting ? <Loader2 size={18} className="animate-spin" /> : <Send size={16} aria-hidden="true" />}
          {uploading ? `Uploading ${uploading} photo${uploading > 1 ? "s" : ""}…` : submitting ? "Sending…" : "Send report"}
        </button>
      </div>
    </Modal>
  );
}

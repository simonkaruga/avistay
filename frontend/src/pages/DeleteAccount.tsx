import { useState } from "react";
import { useSite } from "../components/SiteNotice";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api } from "../utils/api";
import DeleteAccountSheet from "../components/DeleteAccountSheet";

/** Public page Google Play links to: how to delete a Avistay account. */
export default function DeleteAccount() {
  const site = useSite();
  const [open, setOpen] = useState(false);
  const { data: me, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: async () => { const r = await api("/auth/me"); return r.ok ? r.json() : null; },
    retry: false,
  });

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-24 pb-10 px-5">
      <div className="max-w-md mx-auto space-y-4 text-sm text-(--text-muted) leading-relaxed">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-(--text-primary)">
          <Trash2 className="w-5 h-5" aria-hidden="true" /> Delete your Avistay account
        </h1>
        <p>You can delete your account yourself, in the app or on this website: open <strong>Profile</strong> and tap <strong>Delete my account</strong>.</p>
        <p>We erase your name, phone number, email, password, ID documents and notification settings, and take any listings offline.
          Booking and payment records are kept without your personal details for 7 years, as Kenyan tax law requires.</p>
        <p>If you can't sign in, email <a className="underline text-teal" href={`mailto:${site.supportEmail}?subject=Delete%20my%20account`}>{site.supportEmail}</a> from
          your registered email, or WhatsApp us from your registered number, and we'll delete it within 30 days.</p>
        {!isLoading && (me ? (
          <button onClick={() => setOpen(true)} className="w-full bg-red-600 text-white font-bold py-3.5 rounded-2xl">Delete my account</button>
        ) : (
          <Link to="/profile?redirect=/delete-account" className="block text-center w-full bg-forest text-white font-bold py-3.5 rounded-2xl">
            Sign in to delete your account
          </Link>
        ))}
      </div>
      <DeleteAccountSheet open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

import { useNavigate, Link } from "react-router-dom";
import { ArrowLeft, BadgeCheck, Banknote, Building2, Calendar, CheckCircle2, ClipboardCheck, Home as HomeIcon, Lock, Smartphone } from "lucide-react";
import { useSEO } from "../utils/seo";
import { useProtectionWindow, useSite } from "../components/SiteNotice";

export default function HowItWorks() {
  const navigate = useNavigate();
  const protectWindow = useProtectionWindow();
  const site = useSite();
  useSEO({
    title: "How Avistay Works",
    description: "Learn how Avistay's M-Pesa escrow, property verification and instant booking works.",
  });

  return (
    <div className="min-h-screen bg-(--bg-primary) pb-24">

      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-4 bg-(--bg-surface) border-b border-(--border)">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5 text-(--text-primary)" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <h1 className="font-semibold text-(--text-primary)">How it works</h1>
      </div>

      <div className="px-5 pt-6 max-w-lg mx-auto space-y-8 pb-8">

        {/* Hero blurb */}
        <div className="space-y-2">
          <p className="text-[13px] text-teal font-semibold tracking-[0.25em] uppercase">Kenya's local-first platform</p>
          <h2 className="font-display italic text-3xl text-(--text-primary) leading-tight">
            Book in 30 seconds.<br />Pay by M-Pesa or card.<br />Protected always.
          </h2>
          <p className="text-sm text-(--text-muted) leading-relaxed">
            Avistay is built for Kenyans, by Avinaya Solutions. No dollar cards, no international friction.
            Just your phone, your PIN, and a verified home waiting for you.
          </p>
        </div>

        {/* For guests */}
        <section className="space-y-4">
          <h3 className="font-semibold text-(--text-primary) text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-forest text-white text-xs font-bold flex items-center justify-center shrink-0">G</span>
            For guests
          </h3>

          {[
            { n: "1", title: "Browse verified homes",       body: "Every property is reviewed by the Avistay team before going live. Photos are approved, GPS coordinates confirmed, and the owner's identity checked.", Icon: HomeIcon,      color: "#1f4d36" },
            { n: "2", title: "Pick your dates & guests",    body: "Select check-in and check-out dates on the real-time availability calendar. Dates blocked by other bookings or the owner are greyed out automatically.",  Icon: Calendar,      color: "#2b6777" },
            { n: "3", title: "Pay by M-Pesa or card",       body: "Choose M-Pesa and you'll get a prompt on your phone. Enter your PIN and you're done in under 30 seconds. Or pay by Visa, Mastercard or Apple Pay on a secure card page (a small card fee applies). Prices are in Kenyan shillings.",    Icon: Smartphone,    color: "#7dbf8e" },
            { n: "4", title: "The host is paid after you arrive", body: `Avistay keeps your payment and only pays the host ${protectWindow} after you check in. Something wrong? Report it in the app before then. The host isn't paid until we've sorted it out, and we can refund you.`,              Icon: Lock,          color: "#b4511f" },
            { n: "5", title: "Check in with your code",     body: "After booking you receive a 4-digit check-in code. Show it to the owner on arrival. They enter it to confirm you're there. Never share the code before you arrive.", Icon: CheckCircle2,  color: "#1f4d36" },
          ].map(step => (
            <div key={step.n} className="flex gap-4 bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${step.color}15` }}>
                <step.Icon size={18} style={{ color: step.color }} />
              </span>
              <div>
                <p className="font-semibold text-(--text-primary) text-sm">{step.title}</p>
                <p className="text-xs text-(--text-muted) mt-1 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* For owners */}
        <section className="space-y-4">
          <h3 className="font-semibold text-(--text-primary) text-base flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-(--color-amber) text-white text-xs font-bold flex items-center justify-center shrink-0">O</span>
            For property owners
          </h3>

          {[
            { title: "List for free",                  body: `Creating a listing is free. You only pay a ${site.commissionPct}% commission on the room price when a booking is paid (7% for founding partners).`,             Icon: ClipboardCheck, color: "#1f4d36" },
            { title: "Avi writes your description",    body: "Tell Avi, our AI assistant, what you have (bedrooms, amenities, views) and it writes a compelling description in seconds. You can edit it before publishing.",           Icon: Building2,      color: "#2b6777" },
            { title: "Get verified for more bookings", body: "Verified tier 2 properties appear higher in search and get a Verified badge. The process takes 24 to 48 hours and involves a photo review.",                  Icon: BadgeCheck,     color: "#b4511f" },
            { title: `Paid ${protectWindow} after check-in`, body: `Enter the guest's 4-digit code on arrival. ${protectWindow} later your payout (room price minus commission) goes straight to your M-Pesa.`,                       Icon: Banknote,       color: "#7dbf8e" },
          ].map(step => (
            <div key={step.title} className="flex gap-4 bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
              <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: `${step.color}15` }}>
                <step.Icon size={18} style={{ color: step.color }} />
              </span>
              <div>
                <p className="font-semibold text-(--text-primary) text-sm">{step.title}</p>
                <p className="text-xs text-(--text-muted) mt-1 leading-relaxed">{step.body}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Cancellation quick ref */}
        <section className="bg-(--bg-surface) rounded-2xl p-4 border border-(--border) space-y-3">
          <h3 className="font-semibold text-(--text-primary) text-sm">Cancellation at a glance</h3>
          {[
            { when: "Flexible: 1+ day before check-in", refund: "100%", color: "text-teal" },
            { when: "Moderate: 5+ days before check-in", refund: "100%", color: "text-teal" },
            { when: "Strict: 7+ days before check-in", refund: "50%", color: "text-amber-600" },
            { when: "Owner cancels for any reason", refund: "100%", color: "text-teal" },
          ].map(r => (
            <div key={r.when} className="flex items-center justify-between">
              <span className="text-xs text-(--text-muted)">{r.when}</span>
              <span className={`text-xs font-bold ${r.color}`}>{r.refund} refund</span>
            </div>
          ))}
          <Link to="/cancellation-policy" className="text-xs text-teal font-medium underline underline-offset-2">
            Full cancellation policy →
          </Link>
        </section>

        {/* CTAs */}
        <div className="flex flex-col gap-3">
          <Link to="/search"
            className="w-full flex items-center justify-center gap-2 text-white font-bold py-4 rounded-2xl text-sm"
            style={{ background: "linear-gradient(135deg, #1f4d36 0%, #2a6446 100%)", boxShadow: "0 4px 14px rgba(31,77,54,.35)" }}>
            Browse homes
          </Link>
          <Link to="/owner"
            className="w-full flex items-center justify-center gap-2 border border-(--border) text-(--text-primary) font-semibold py-4 rounded-2xl text-sm">
            List your property
          </Link>
        </div>
      </div>
    </div>
  );
}

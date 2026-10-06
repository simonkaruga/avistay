import { useNavigate, Link } from "react-router-dom";
import { useProtectionWindow, useSite } from "../components/SiteNotice";
import { ArrowLeft, ChevronRight, Home as HomeIcon, Leaf, Mail, MessageCircle, ShieldCheck, Smartphone } from "lucide-react";
import { useSEO } from "../utils/seo";

export default function About() {
  const site = useSite();
  const protectWindow = useProtectionWindow();
  const navigate = useNavigate();
  useSEO({
    title: "About Avistay",
    description: "Avistay is Kenya's first local-first vacation rental platform for Kenyan guests and property owners. Book verified holiday homes in Naivasha with M-Pesa or card.",
  });

  return (
    <div className="min-h-screen bg-(--bg-primary) pb-24">

      {/* Header */}
      <div className="sticky top-0 z-40 flex items-center gap-3 px-4 py-4 bg-(--bg-surface) border-b border-(--border)">
        <button onClick={() => navigate(-1)}
          className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center shrink-0">
          <ArrowLeft className="w-5 h-5 text-(--text-primary)" strokeWidth={2.5} aria-hidden="true" />
        </button>
        <h1 className="font-semibold text-(--text-primary)">About</h1>
      </div>

      <div className="max-w-lg mx-auto">

        {/* Hero banner */}
        <div className="relative overflow-hidden px-5 pt-10 pb-10"
          style={{ background: "linear-gradient(160deg, #1f4d36 0%, #2a6446 45%, #2b6777 80%, #141b16 100%)" }}>
          <div className="absolute -top-6 -right-6 w-40 h-40 rounded-full" style={{ background: "rgba(62,200,144,0.07)" }} />
          <p className="text-mint text-[13px] font-semibold tracking-[0.28em] uppercase mb-3 relative z-10">
            Naivasha · Kenya
          </p>
          <h2 className="font-display italic text-white relative z-10"
            style={{ fontSize: "clamp(2.4rem, 9vw, 3.2rem)", lineHeight: 0.92 }}>
            Built by a resident.<br />For residents<br />and visitors.
          </h2>
          <p className="text-white/55 text-sm mt-4 max-w-xs leading-relaxed relative z-10">
            <strong className="text-(--text-primary)">Beautiful stays. Better experiences.</strong>{" "}
            Avistay is Kenya's first local-first vacation rental platform, designed from the ground up for the
            Kenyan market, with M-Pesa at its core and cards for visitors.
          </p>
        </div>

        <div className="px-5 pt-6 space-y-8">

          {/* Origin story */}
          <section className="space-y-3">
            <h3 className="font-semibold text-(--text-primary)">Our story</h3>
            <p className="text-sm text-(--text-muted) leading-relaxed">
              Naivasha has world-class views, hippos, Hell's Gate, and some of the most beautiful
              short-stay homes in East Africa. But booking them was broken: scattered WhatsApp groups,
              no photos, no price transparency, no protection if something went wrong.
            </p>
            <p className="text-sm text-(--text-muted) leading-relaxed">
              So we built what was missing. A platform where every home is verified, every booking is
              protected by M-Pesa escrow, and guests can book in 30 seconds without a credit card.
            </p>
          </section>

          {/* Values */}
          <section className="space-y-3">
            <h3 className="font-semibold text-(--text-primary)">What we stand for</h3>
            <div className="space-y-3">
              {[
                { Icon: Smartphone,   color: "#2b6777", title: "Kenya first",             body: "Prices in Kenyan shillings. Pay by M-Pesa in seconds, or by card if you're visiting from abroad. Built for Kenyans first." },
                { Icon: ShieldCheck,  color: "#1f4d36", title: "Guest protection always", body: "Your money never goes to a host until you physically check in. That's a promise, not a policy." },
                { Icon: HomeIcon,     color: "#b4511f", title: "Fair for owners too",     body: "Free to list, a simple commission only when you're booked, and M-Pesa payouts 24 hours after your guest checks in." },
                { Icon: Leaf,         color: "#7dbf8e", title: "Local community",         body: "Every property listed supports a local Naivasha family. We don't list chains or corporate-owned properties." },
              ].map(v => (
                <div key={v.title} className="flex gap-3 bg-(--bg-surface) rounded-2xl p-4 border border-(--border)">
                  <span className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${v.color}15` }}>
                    <v.Icon size={16} style={{ color: v.color }} />
                  </span>
                  <div>
                    <p className="font-semibold text-(--text-primary) text-sm">{v.title}</p>
                    <p className="text-xs text-(--text-muted) mt-0.5 leading-relaxed">{v.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* By the numbers */}
          <section className="bg-(--bg-surface) rounded-2xl border border-(--border) overflow-hidden">
            <div className="px-4 py-3 border-b border-(--border)">
              <h3 className="font-semibold text-(--text-primary) text-sm">By the numbers</h3>
            </div>
            <div className="grid grid-cols-2 divide-x divide-y divide-(--border)">
              {[
                { v: "~90 min", l: "From Nairobi via A104" },
                { v: `KES ${site.serviceFee.toLocaleString()}`, l: "Service fee per booking" },
                { v: protectWindow, l: "Host payout after check-in" },
                { v: `${site.commissionPct}%`, l: "Host commission (free to list)" },
              ].map(s => (
                <div key={s.l} className="px-4 py-3">
                  <p className="font-bold text-lg text-(--text-primary) leading-none">{s.v}</p>
                  <p className="text-[13px] text-(--text-muted) mt-1">{s.l}</p>
                </div>
              ))}
            </div>
          </section>

          <p className="text-xs text-(--text-muted)"><Link to="/photo-credits" className="underline">Photo credits</Link></p>

          {/* Contact */}
          <section className="space-y-3">
            <h3 className="font-semibold text-(--text-primary)">Get in touch</h3>
            <a href={site.whatsapp()} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-3 bg-(--bg-surface) rounded-2xl p-4 border border-(--border) active:opacity-80">
              <MessageCircle className="w-6 h-6 text-[#25D366]" aria-hidden="true" />
              <div>
                <p className="font-semibold text-(--text-primary) text-sm">WhatsApp support</p>
                <p className="text-xs text-(--text-muted)">We reply fast, usually within an hour</p>
              </div>
              <ChevronRight className="w-4 h-4 text-(--text-muted) ml-auto" aria-hidden="true" />
            </a>
            <a href={`mailto:${site.supportEmail}`}
              className="flex items-center gap-3 bg-(--bg-surface) rounded-2xl p-4 border border-(--border) active:opacity-80">
              <Mail className="w-6 h-6 text-forest" aria-hidden="true" />
              <div>
                <p className="font-semibold text-(--text-primary) text-sm">Email us</p>
                <p className="text-xs text-(--text-muted)">{site.supportEmail}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-(--text-muted) ml-auto" aria-hidden="true" />
            </a>
          </section>

          {/* Footer links */}
          <div className="grid grid-cols-2 gap-2 text-xs text-(--text-muted)">
            {[
              { to: "/how-it-works",        label: "How it works" },
              { to: "/terms",               label: "Terms of service" },
              { to: "/privacy",             label: "Privacy policy" },
              { to: "/cancellation-policy", label: "Cancellation policy" },
              { to: "/owner",               label: "List your property" },
              { to: "/search",              label: "Browse homes" },
            ].map(l => (
              <Link key={l.to} to={l.to} className="underline underline-offset-2">{l.label}</Link>
            ))}
          </div>

          <div className="text-center pb-2 space-y-1">
            <p className="text-[13px] text-(--text-muted)">
              © {new Date().getFullYear()} Avistay
            </p>
            <p className="text-xs text-(--text-muted)">
              Built by{" "}
              <span className="font-semibold text-forest">Avinaya Solutions Ltd</span>
              {" "}· Naivasha, Kenya
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Site footer on every guest page: brand, links, contact, and the legal owner.
 * NaivaStay is a product of Avinaya Solutions Ltd.
 */
import { Link, useLocation } from "react-router-dom";
import { Mail, MapPin, MessageCircle, ShieldCheck } from "lucide-react";
import { useSite } from "./SiteNotice";
import { AllPaymentLogos } from "./PaymentLogos";

const COLUMNS: { title: string; links: { to: string; label: string }[] }[] = [
  { title: "Explore", links: [
    { to: "/search", label: "Browse homes" },
    { to: "/places/hells-gate", label: "Hell's Gate" },
    { to: "/places/crescent-island", label: "Crescent Island" },
    { to: "/places/lake-naivasha", label: "Lake Naivasha" },
  ] },
  { title: "Hosts", links: [
    { to: "/list-your-property", label: "List your property" },
    { to: "/how-it-works", label: "How it works" },
    { to: "/owner", label: "Host dashboard" },
  ] },
  { title: "Company", links: [
    { to: "/about", label: "About NaivaStay" },
    { to: "/terms", label: "Terms of service" },
    { to: "/privacy", label: "Privacy policy" },
    { to: "/cancellation-policy", label: "Cancellation policy" },
  ] },
];

// Pages with their own full-screen layout or a fixed action bar at the bottom.
const HIDDEN_ON = [/^\/booking\//, /^\/booking-confirm\//, /^\/disputes\//, /^\/messages\//];

export default function SiteFooter() {
  const { pathname } = useLocation();
  const site = useSite();
  if (HIDDEN_ON.some(r => r.test(pathname))) return null;
  const year = new Date().getFullYear();

  return (
    <footer className="mt-12 border-t border-(--border) bg-(--bg-surface) pb-[calc(5rem+var(--sab))] lg:pb-0">
      <div className="max-w-6xl mx-auto px-4 py-10 grid grid-cols-2 gap-8 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3 col-span-2 md:col-span-1">
          <Link to="/" className="inline-flex items-center gap-2" aria-label="NaivaStay home">
            <img src="/logo-mark.png" alt="" className="h-9 w-auto" />
            <img src="/logo-wordmark.png" alt="NaivaStay" className="h-6 w-auto" />
          </Link>
          <p className="text-sm text-(--text-muted) max-w-xs">
            Verified holiday homes in Naivasha, booked and paid safely with M-Pesa or Paystack.
          </p>
          <ul className="space-y-1.5 text-sm text-(--text-muted)">
            <li><a href={site.whatsapp()} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:text-(--text-primary)">
              <MessageCircle className="w-4 h-4" aria-hidden="true" /> {site.supportPhone}</a></li>
            <li><a href={`mailto:${site.supportEmail}`} className="inline-flex items-center gap-2 hover:text-(--text-primary)">
              <Mail className="w-4 h-4" aria-hidden="true" /> {site.supportEmail}</a></li>
            <li className="inline-flex items-center gap-2"><MapPin className="w-4 h-4" aria-hidden="true" /> Naivasha, Kenya</li>
          </ul>
        </div>

        {COLUMNS.map(col => (
          <nav key={col.title} aria-label={col.title}>
            <p className="text-xs font-semibold uppercase tracking-wider text-(--text-primary) mb-3">{col.title}</p>
            <ul className="space-y-2">
              {col.links.map(l => (
                <li key={l.to}><Link to={l.to} className="text-sm text-(--text-muted) hover:text-(--text-primary)">{l.label}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="border-t border-(--border)">
        <div className="max-w-6xl mx-auto px-4 py-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-(--text-muted)">
          <p>
            © {year} <span className="font-semibold text-(--text-primary)">Avinaya Solutions Ltd</span>. All rights reserved.
            {" "}NaivaStay is a product of Avinaya Solutions Ltd, a company registered in Kenya.
          </p>
          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="w-4 h-4" aria-hidden="true" /> Secure payments</span>
            <AllPaymentLogos h={20} />
          </div>
        </div>
      </div>
    </footer>
  );
}

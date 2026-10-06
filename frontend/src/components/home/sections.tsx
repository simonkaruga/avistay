/**
 * Home page sections, in the order agreed (Booking.com-style, adapted to one
 * destination). Each section renders nothing until it has enough real homes
 * to look full — a half-empty row reads as "nobody uses this site".
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight, Building2, CalendarDays, ChevronLeft, ChevronRight, Flame, Gem, House, Landmark, Leaf, MapPin, Mountain,
  ShieldCheck, Smartphone, Sparkles, Tag, Tent,
} from "lucide-react";
import PropertyCard, { type PropertyCardData } from "../PropertyCard";
import { apiJson } from "../../utils/api";
import { placeForDestination } from "../../data/places";
import { STAY_PHOTOS, STAY_TYPE_PHOTO } from "../../data/stayPhotos";
import { useProtectionWindow, useSiteInfo } from "../SiteNotice";
import { imgSrc } from "../../utils/image";

export const ROW_MIN = 4;   // homes needed before a card row is shown
const TILE_MIN = 2;         // groups needed before a tile section is shown

// ── Shared pieces ─────────────────────────────────────────────────────────────

export function SectionHeader({ title, subtitle, to, linkLabel = "See all" }: {
  title: string; subtitle?: string; to?: string; linkLabel?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-3 mb-3">
      <div className="min-w-0">
        <h2 className="font-semibold text-(--text-primary) text-lg leading-tight">{title}</h2>
        {subtitle && <p className="text-sm text-(--text-muted) mt-0.5">{subtitle}</p>}
      </div>
      {to && (
        <Link to={to} className="shrink-0 flex items-center gap-0.5 text-sm font-semibold text-teal">
          {linkLabel} <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}

/** Sideways-scrolling row. Phones swipe; wide screens get ← → buttons when it overflows. */
function Carousel({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [update]);
  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.9, behavior: "smooth" });
  const arrow = "hidden md:flex absolute top-[38%] -translate-y-1/2 z-10 w-10 h-10 rounded-full bg-(--bg-surface) border border-(--border) shadow-md items-center justify-center text-(--text-primary)";
  return (
    <div className="relative">
      <div ref={ref} onScroll={update} role="region" aria-label={label}
        className="-mx-4 px-4 flex gap-4 overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-0 scrollbar-none pb-1 md:mx-0 md:px-0">
        {children}
      </div>
      {!edges.start && <button type="button" onClick={() => page(-1)} aria-label="Previous" className={`${arrow} -left-3`}><ChevronLeft className="w-5 h-5" /></button>}
      {!edges.end && <button type="button" onClick={() => page(1)} aria-label="Next" className={`${arrow} -right-3`}><ChevronRight className="w-5 h-5" /></button>}
    </div>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section className="mt-8">{children}</section>;
}

/** Horizontally scrolling cards on phones, a grid on wide screens. */
function CardRow({ homes, query }: { homes: PropertyCardData[]; query?: string }) {
  return (
    <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-0 scrollbar-none pb-1
                    md:mx-0 md:px-0 md:grid md:grid-cols-4 md:overflow-visible">
      {homes.map((p, i) => (
        // Phones swipe through up to 8; wide screens show a single row of 4.
        <div key={p.id} className={`snap-start shrink-0 w-[46vw] max-w-[230px] md:w-auto md:max-w-none ${i >= 4 ? "md:hidden" : ""}`}>
          <PropertyCard p={p} query={query} />
        </div>
      ))}
    </div>
  );
}

function PhotoTile({ to, image, Icon, title, subtitle }: {
  to: string; image?: string; Icon: LucideIcon; title: string; subtitle: string;
}) {
  return (
    <Link to={to} className="group relative block rounded-2xl overflow-hidden aspect-4/3 bg-forest active:scale-[.98] transition-transform">
      {image
        ? <img src={imgSrc(image, 480)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        : <div className="absolute inset-0 flex items-center justify-center"><Icon className="w-10 h-10 text-white/30" aria-hidden="true" /></div>}
      <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 p-3">
        <p className="text-white font-semibold text-sm leading-tight">{title}</p>
        <p className="text-white/75 text-xs mt-0.5">{subtitle}</p>
      </div>
    </Link>
  );
}

const homesLabel = (n: number) => `${n} home${n === 1 ? "" : "s"}`;

/** Best photo for a group: from its highest-rated home with a photo.
 *  Pass `used` to avoid repeating a photo another tile in the section already shows. */
function coverFor(homes: PropertyCardData[], used?: Set<string>) {
  const ranked = homes.filter(h => h.primary_image)
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0))
    .map(h => h.primary_image!);
  const pick = ranked.find(img => !used?.has(img)) ?? ranked[0];
  if (pick) used?.add(pick);
  return pick;
}

// ── 2. Stays unique to Naivasha ───────────────────────────────────────────────

const TYPES: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "cottage",    label: "Cottages",              Icon: Leaf },
  { id: "villa",      label: "Villas",                Icon: Gem },
  { id: "house",      label: "Houses",                Icon: House },
  { id: "apartment",  label: "Apartments",            Icon: Building2 },
  { id: "conference", label: "Retreats & conferences", Icon: Landmark },
  { id: "campsite",   label: "Campsites",             Icon: Tent },
];

export function StayTypes({ homes }: { homes: PropertyCardData[] }) {
  const groups = TYPES.map(t => ({ ...t, homes: homes.filter(h => h.type === t.id) })).filter(g => g.homes.length);
  if (groups.length < TILE_MIN) return null;
  const used = new Set<string>();
  return (
    <Section>
      <SectionHeader title="Stays unique to Naivasha" subtitle="Pick the kind of place that suits your trip" />
      {/* Big photo cards, name underneath (Booking-style). Swipe on phones; 4 visible + arrows on wide screens. */}
      <Carousel label="Stay types">
        {groups.map(g => {
          // A real Naivasha photo for each kind of stay; a listing photo only for types without one.
          const typePhoto = STAY_PHOTOS[STAY_TYPE_PHOTO[g.id]];
          const img = typePhoto?.sm ?? coverFor(g.homes, used);
          return (
            <Link key={g.id} to={`/search?type=${g.id}`}
              className="group snap-start shrink-0 w-[64vw] max-w-[300px] md:w-[calc((100%-3rem)/4)] md:max-w-none">
              <div className="relative aspect-4/3 rounded-2xl overflow-hidden bg-forest">
                {img
                  ? <img src={imgSrc(img, 600)} alt={typePhoto?.caption ?? ""} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  : <div className="absolute inset-0 flex items-center justify-center"><g.Icon className="w-12 h-12 text-white/30" aria-hidden="true" /></div>}
              </div>
              <p className="mt-2 font-semibold text-(--text-primary) leading-tight">{g.label}</p>
              <p className="text-sm text-(--text-muted)">{homesLabel(g.homes.length)}</p>
            </Link>
          );
        })}
      </Carousel>
    </Section>
  );
}

// ── 3. Available this weekend ─────────────────────────────────────────────────

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** The coming weekend: this Fri→Sun (Mon–Fri), today→Sun (Sat), next Fri→Sun (Sun). */
export function upcomingWeekend(today = new Date()): { checkIn: string; checkOut: string; label: string } {
  const day = today.getDay();                       // 0 Sun … 6 Sat
  const start = day === 6 ? today : addDays(today, day === 0 ? 5 : 5 - day);
  const end = addDays(start, day === 6 ? 1 : 2);
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => d.toLocaleDateString("en-KE", o);
  return {
    checkIn: iso(start), checkOut: iso(end),
    label: `${fmt(start, { weekday: "short", day: "numeric" })} to ${fmt(end, { weekday: "short", day: "numeric", month: "short" })}`,
  };
}

export function WeekendRow() {
  const w = upcomingWeekend();
  const { data } = useQuery({
    queryKey: ["properties", "weekend", w.checkIn],
    queryFn: () => apiJson<PropertyCardData[]>(`/properties/?check_in=${w.checkIn}&check_out=${w.checkOut}&limit=12`),
    staleTime: 5 * 60_000,
  });
  if (!data || data.length < ROW_MIN) return null;
  const q = `check_in=${w.checkIn}&check_out=${w.checkOut}`;
  return (
    <Section>
      <SectionHeader title="Available this weekend" subtitle={`${w.label} · free to book now`} to={`/search?${q}`} />
      <CardRow homes={data.slice(0, 8)} query={q} />
    </Section>
  );
}

// ── Home content managed by the Avistay team (admin → Home page) ─────────────

export interface Offer {
  id: string; title: string; subtitle: string | null; body: string | null; image_url: string | null;
  cta_label: string; link: string; promo_code: string | null; ends_at: string | null;
}
export interface Destination {
  id: string; name: string; tagline: string | null; image_url: string | null;
  area: string | null; area_label: string | null; stays: number; bookings_recent: number;
}
interface HomeContent {
  offers: Offer[];
  destinations: Destination[];
  featured: (PropertyCardData & { featured_tagline: string | null })[];
}

export function useHomeContent() {
  return useQuery({ queryKey: ["home-content"], queryFn: () => apiJson<HomeContent>("/home"), staleTime: 5 * 60_000 });
}

const endsLabel = (iso: string | null) => {
  if (!iso) return null;
  const days = Math.ceil((Date.parse(iso) - Date.now()) / 86_400_000);
  return days <= 1 ? "Ends today" : days <= 7 ? `Ends in ${days} days`
    : `Until ${new Date(iso).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`;
};

// ── Offers ────────────────────────────────────────────────────────────────────

export function Offers() {
  const { data } = useHomeContent();
  const offers = data?.offers ?? [];
  if (!offers.length) return null;   // only real, running promotions
  return (
    <Section>
      <SectionHeader title="Deals by the lake" subtitle="Limited-time offers on Naivasha stays" />
      <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-0 scrollbar-none md:mx-0 md:px-0 md:grid md:grid-cols-2 md:overflow-visible">
        {offers.map(o => (
          <Link key={o.id} to={o.link}
            className="snap-start shrink-0 w-[85vw] max-w-[440px] md:w-auto md:max-w-none flex rounded-2xl overflow-hidden bg-(--bg-surface) border border-(--border) active:scale-[.99] transition-transform">
            <div className="flex-1 p-4 flex flex-col">
              {endsLabel(o.ends_at) && (
                <span className="self-start flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 px-2 py-0.5 rounded-full mb-2">
                  <CalendarDays className="w-3 h-3" aria-hidden="true" /> {endsLabel(o.ends_at)}
                </span>
              )}
              <p className="font-semibold text-(--text-primary) leading-snug">{o.title}</p>
              {o.subtitle && <p className="text-sm text-forest font-medium mt-0.5">{o.subtitle}</p>}
              {o.body && <p className="text-sm text-(--text-muted) mt-1.5 line-clamp-3">{o.body}</p>}
              {o.promo_code && (
                <p className="flex items-center gap-1.5 text-xs text-(--text-muted) mt-2">
                  <Tag className="w-3.5 h-3.5" aria-hidden="true" /> Use code
                  <span className="font-mono font-bold text-(--text-primary) tracking-wider">{o.promo_code}</span>
                </p>
              )}
              <span className="mt-auto pt-3 inline-flex items-center gap-1 text-sm font-semibold text-teal">
                {o.cta_label} <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </span>
            </div>
            {o.image_url && (
              <img src={imgSrc(o.image_url, 360)} alt="" loading="lazy" className="w-32 md:w-40 object-cover shrink-0" />
            )}
          </Link>
        ))}
      </div>
    </Section>
  );
}

// ── Trending destinations ─────────────────────────────────────────────────────

export function TrendingDestinations({ homes }: { homes: PropertyCardData[] }) {
  const { data } = useHomeContent();
  const dests = data?.destinations ?? [];
  if (dests.length < TILE_MIN) return null;
  // Places with a guide open it (photos, things to do, stays nearby); others go to search.
  const link = (d: Destination) => {
    const guide = placeForDestination(d.name);
    return guide ? `/places/${guide.slug}` : d.area ? `/search?area=${d.area}` : "/search";
  };
  // Uploaded image first, then the guide's lead photo, then a home photo from that area.
  const used = new Set(dests.flatMap(d => (d.image_url ? [d.image_url] : [])));
  const covers = new Map(dests.map(d => [d.id,
    d.image_url ?? placeForDestination(d.name)?.photos[0]?.src ?? coverFor(homes.filter(h => h.area === d.area), used)]));
  const cover = (d: Destination) => covers.get(d.id);
  const sub = (d: Destination) => d.stays ? `${homesLabel(d.stays)} nearby` : d.area_label ?? "Naivasha";
  return (
    <Section>
      <SectionHeader title="Trending around the lake" subtitle="Where guests are heading this month" />
      {/* Phones: swipe big cards. Wide screens: two large, the rest smaller (like a magazine cover). */}
      <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-0 scrollbar-none
                      md:mx-0 md:px-0 md:grid md:grid-cols-6 md:overflow-visible">
        {dests.map((d, i) => (
          <Link key={d.id} to={link(d)}
            className={`group snap-start shrink-0 w-[78vw] max-w-[360px] md:w-auto md:max-w-none relative rounded-2xl overflow-hidden bg-forest active:scale-[.99] transition-transform
                        ${i < 2 ? "md:col-span-3 aspect-16/10" : "md:col-span-2 aspect-16/10 md:aspect-4/3"}`}>
            {cover(d)
              ? <img src={imgSrc(cover(d)!, i < 2 ? 900 : 600)} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              : <div className="absolute inset-0 flex items-center justify-center"><Mountain className="w-12 h-12 text-white/25" aria-hidden="true" /></div>}
            <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-black/20" />
            {i === 0 && d.bookings_recent > 0 && (
              <span className="absolute top-3 left-3 flex items-center gap-1 bg-white/95 text-nearblack text-xs font-bold px-2 py-1 rounded-full">
                <Flame className="w-3.5 h-3.5 text-orange-500" aria-hidden="true" /> Most booked
              </span>
            )}
            <div className="absolute bottom-0 inset-x-0 p-4">
              <p className="text-white font-semibold text-lg leading-tight">{d.name}</p>
              {d.tagline && <p className="text-white/85 text-sm mt-0.5 line-clamp-2">{d.tagline}</p>}
              <p className="text-white/70 text-xs mt-1">{sub(d)}</p>
            </div>
          </Link>
        ))}
      </div>
    </Section>
  );
}

// ── Our most unique stays (handpicked; falls back to top-rated) ──────────────

export function UniqueStays({ homes }: { homes: PropertyCardData[] }) {
  const { data } = useHomeContent();
  const picked = data?.featured ?? [];
  if (picked.length >= ROW_MIN) {
    return (
      <Section>
        <SectionHeader title="Our most unique stays" subtitle="Handpicked by the Avistay team" />
        <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-px-4 md:scroll-px-0 scrollbar-none pb-1 md:mx-0 md:px-0 md:grid md:grid-cols-4 md:overflow-visible">
          {picked.slice(0, 8).map((p, i) => (
            <div key={p.id} className={`snap-start shrink-0 w-[46vw] max-w-[230px] md:w-auto md:max-w-none ${i >= 4 ? "md:hidden" : ""}`}>
              <PropertyCard p={p} />
              {p.featured_tagline && (
                <p className="flex items-start gap-1 text-xs text-forest font-medium mt-1.5 px-1">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" /> {p.featured_tagline}
                </p>
              )}
            </div>
          ))}
        </div>
      </Section>
    );
  }
  // Until the team picks enough homes, show the best-reviewed ones (2+ reviews).
  const top = homes.filter(h => (h.review_count ?? 0) >= 2 && (h.avg_rating ?? 0) >= 4)
    .sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0) || (b.review_count ?? 0) - (a.review_count ?? 0));
  if (top.length < ROW_MIN) return null;
  return (
    <Section>
      <SectionHeader title="Our most unique stays" subtitle="Top-rated by guests who stayed" />
      <CardRow homes={top.slice(0, 8)} />
    </Section>
  );
}

// ── 5. Explore Naivasha by area ───────────────────────────────────────────────

interface Summary { total: number; types: Record<string, number>; areas: { slug: string; label: string; count: number }[] }

export function useHomeSummary() {
  return useQuery({ queryKey: ["properties", "summary"], queryFn: () => apiJson<Summary>("/properties/summary"), staleTime: 5 * 60_000 });
}

export function AreaTiles({ homes }: { homes: PropertyCardData[] }) {
  const { data } = useHomeSummary();
  const areas = data?.areas.filter(a => a.count > 0) ?? [];
  if (areas.length < TILE_MIN) return null;
  const used = new Set<string>();
  return (
    <Section>
      <SectionHeader title="Explore Naivasha by area" subtitle="From the lakeshore to the gorge" />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 [&>*:last-child:nth-child(odd)]:col-span-2 md:[&>*:last-child:nth-child(odd)]:col-span-1">
        {areas.map(a => (
          <PhotoTile key={a.slug} to={`/search?area=${a.slug}`} image={coverFor(homes.filter(h => h.area === a.slug), used)}
            Icon={MapPin} title={a.label} subtitle={homesLabel(a.count)} />
        ))}
      </div>
    </Section>
  );
}

// ── 6. Payment protection — what Avistay offers that WhatsApp bookings don't ──

export function ProtectionBanner() {
  const cards = !!useSiteInfo().data?.card_payments;
  const protectWindow = useProtectionWindow();
  const points: { Icon: LucideIcon; title: string; text: string }[] = [
    cards
      ? { Icon: Smartphone, title: "Pay with M-Pesa or card", text: "M-Pesa prompt, Visa, Mastercard or Apple Pay." }
      : { Icon: Smartphone, title: "Pay with M-Pesa", text: "A prompt on your phone. Book in under a minute." },
    { Icon: ShieldCheck, title: "Host paid after you arrive", text: `We keep your payment until ${protectWindow} after check-in.` },
    { Icon: CalendarDays, title: "Problem? We step in", text: "Report it in that time and the host isn't paid until it's sorted, refund included." },
  ];
  return (
    <Section>
      <div className="rounded-3xl bg-(--bg-surface) border border-(--border) p-5 md:p-6">
        <p className="text-xs font-semibold tracking-[0.2em] uppercase text-teal">Booked safely with Avistay</p>
        <h2 className="font-display italic text-2xl text-(--text-primary) mt-1">{cards ? "Pay your way. Stay protected." : "Pay with M-Pesa. Stay protected."}</h2>
        <ul className="mt-4 grid md:grid-cols-3 gap-4">
          {points.map(({ Icon, title, text }) => (
            <li key={title} className="flex gap-3">
              <span className="w-10 h-10 rounded-xl bg-forest/10 flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-forest" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-(--text-primary)">{title}</p>
                <p className="text-sm text-(--text-muted)">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <Link to="/how-it-works" className="inline-flex items-center gap-1 text-sm font-semibold text-teal mt-4">
          How it works <ChevronRight className="w-4 h-4" aria-hidden="true" />
        </Link>
      </div>
    </Section>
  );
}

// ── 7. Become a host — a short invitation; the details live on /list-your-property ──

export function HostCTA() {
  return (
    <Section>
      <Link to="/list-your-property"
        className="group flex flex-col sm:flex-row sm:items-center gap-4 rounded-3xl p-6 md:p-7 bg-(--bg-surface) border border-(--border) hover:shadow-md transition-shadow">
        <span className="w-14 h-14 rounded-2xl bg-forest/10 flex items-center justify-center shrink-0">
          <House className="w-7 h-7 text-forest" aria-hidden="true" />
        </span>
        <span className="flex-1">
          <span className="block font-display italic text-2xl text-(--text-primary) leading-tight">Own a place in Naivasha?</span>
          <span className="block text-sm text-(--text-muted) mt-1">
            Share it with guests who'll love it as much as you do. It's free to list.
          </span>
        </span>
        <span className="inline-flex items-center gap-2 self-start sm:self-auto bg-forest text-white font-semibold text-sm px-5 py-3 rounded-xl group-hover:gap-3 transition-all">
          List your property <ArrowRight className="w-4 h-4" aria-hidden="true" />
        </span>
      </Link>
    </Section>
  );
}

import { useState, useRef } from "react";
import RatingBadge, { ratingWord } from "../components/RatingBadge";
import AskAvi from "../components/AskAvi";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Baby, BadgeCheck, Bird, CalendarDays, CalendarX, Car, CheckCircle, ChevronLeft, ChevronRight, Cigarette, ConciergeBell, Dog, Droplets, Flame, Heart, Home as HomeIcon, LogIn, LogOut, MapPin, MessageCircle, Monitor, Moon, Mountain, PartyPopper, Sailboat, SearchX, Share2, Shield, Smartphone, Sparkles, Star, UserCheck, Users, UtensilsCrossed, Volume1, Waves, Wifi, Wind, X, Zap } from "lucide-react";
import { imgSrc } from "../utils/image";
import { useSEO } from "../utils/seo";
import { toggleSaved, isSaved } from "./Saved";
import { PropertyCardData } from "../components/PropertyCard";
import LeafletMap from "../components/LeafletMap";
import PhotoMosaic from "../components/property/PhotoMosaic";
import BookingPanel from "../components/property/BookingPanel";
import { kes } from "../utils/format";

import { api } from "../utils/api";
import { useProtectionWindow, useSiteInfo } from "../components/SiteNotice";
// ── Types ─────────────────────────────────────────────────────────────────────

interface Review {
  id: string;
  accuracy_score: number;
  cleanliness_score: number;
  location_score: number;
  value_score: number;
  avg_score: number;
  comment?: string;
  owner_response?: string;
  created_at: string;
  guest_name: string;
}

interface PropertyDetail {
  id: string;
  title: string;
  type: string;
  price_per_night: number;
  description?: string;
  lat?: number;
  lng?: number;
  what3words?: string;
  landmark_instructions?: string;
  verified_tier: number;
  min_nights: number;
  max_guests?: number;
  host_name?: string;
  host_since?: string;
  host_id_verified?: boolean;
  response_time_hours?: number;
  images: { cloudinary_url: string; is_primary: boolean; display_order: number }[];
  area_label?: string | null;
  deposit_amount: number;
  policy_summary?: string | null;
  cancellation_policy?: string;
  no_checkout_days?: string | null;
  check_in_from: string;
  check_in_until?: string | null;
  check_out_until: string;
  children_allowed: boolean;
  pets_allowed: boolean;
  smoking_allowed: boolean;
  parties_allowed: boolean;
  quiet_hours?: string | null;
  house_rules?: string | null;
}

// ── Amenity inference ─────────────────────────────────────────────────────────

type Amenity = { keys: string[]; icon: React.ReactNode; label: string };

const AMENITY_MAP: Amenity[] = [
  { keys: ["wifi","wi-fi","internet","fibre"],            icon: <Wifi className="w-6 h-6 text-sky-500" />,          label: "WiFi" },
  { keys: ["pool","swim","swimming","infinity"],           icon: <Waves className="w-6 h-6 text-blue-500" />,        label: "Pool" },
  { keys: ["bbq","braai","grill","barbecue","bonfire","fire pit"], icon: <Flame className="w-6 h-6 text-orange-500" />, label: "BBQ" },
  { keys: ["kitchen","cooking","chef"],                   icon: <UtensilsCrossed className="w-6 h-6 text-amber-600" />, label: "Kitchen" },
  { keys: ["parking","garage"],                           icon: <Car className="w-6 h-6 text-slate-500" />,          label: "Parking" },
  { keys: ["lake","waterfront","water view","shore"],     icon: <Sailboat className="w-6 h-6 text-cyan-500" />,     label: "Lake view" },
  { keys: ["hippo","zebra","wildlife","bird","animal","fish eagle"],icon: <Bird className="w-6 h-6 text-pink-500" />,  label: "Wildlife" },
  { keys: ["projector","conference","whiteboard"],        icon: <Monitor className="w-6 h-6 text-slate-500" />,     label: "AV equipment" },
  { keys: ["zip","archery","cycling","team build"],       icon: <Zap className="w-6 h-6 text-yellow-500" />,        label: "Activities" },
  { keys: ["mountain","longonot","rift valley","volcano"],icon: <Mountain className="w-6 h-6 text-slate-600" />,   label: "Scenic view" },
  { keys: ["hot water","shower","bath","ensuite"],        icon: <Droplets className="w-6 h-6 text-sky-400" />,      label: "Hot water" },
  { keys: ["housekeeper","housekeeping"],                 icon: <ConciergeBell className="w-6 h-6 text-amber-500" />, label: "Housekeeping" },
];

const TYPE_DEFAULTS: Record<string, { icon: React.ReactNode; label: string }[]> = {
  conference: [
    { icon: <Wifi className="w-6 h-6 text-sky-500" />,     label: "Fibre WiFi" },
    { icon: <Monitor className="w-6 h-6 text-slate-500" />, label: "Projector" },
    { icon: <Wind className="w-6 h-6 text-blue-400" />,    label: "AC" },
  ],
  campsite: [
    { icon: <Flame className="w-6 h-6 text-orange-500" />,   label: "Fire pit" },
    { icon: <Sparkles className="w-6 h-6 text-indigo-400" />, label: "Stargazing" },
    { icon: <Droplets className="w-6 h-6 text-sky-400" />,   label: "Ablutions" },
  ],
  villa: [
    { icon: <Waves className="w-6 h-6 text-blue-500" />,         label: "Pool" },
    { icon: <UserCheck className="w-6 h-6 text-amber-600" />,    label: "Staff on site" },
    { icon: <UtensilsCrossed className="w-6 h-6 text-amber-600" />, label: "Kitchen" },
  ],
};

function getAmenities(type: string, description = "") {
  const desc = description.toLowerCase();
  const found = AMENITY_MAP.filter(a => a.keys.some(k => desc.includes(k)));
  const defaults = TYPE_DEFAULTS[type] ?? [];
  const merged = [...found, ...defaults.filter(d => !found.some(f => f.label === d.label))];
  return merged.slice(0, 12);
}

// ── Review bar component ──────────────────────────────────────────────────────

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-xs text-(--text-muted) w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1 bg-(--border) rounded-full overflow-hidden">
        <div className="h-full bg-(--text-primary) rounded-full transition-all duration-500"
          style={{ width: `${(value / 5) * 100}%` }} />
      </div>
      <span className="text-xs font-semibold text-(--text-primary) w-6 text-right">{value.toFixed(1)}</span>
    </div>
  );
}

// ── Availability calendar ─────────────────────────────────────────────────────

function AvailabilityCalendar({ propertyId, checkIn, checkOut, onCheckIn, onCheckOut, minNights }: {
  propertyId: string;
  checkIn: string; checkOut: string;
  onCheckIn: (d: string) => void; onCheckOut: (d: string) => void;
  minNights: number;
}) {
  const today = new Date(); today.setHours(0,0,0,0);
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const { data: blocked = [] } = useQuery<{ date: string; is_blocked: boolean }[]>({
    queryKey: ["avail", propertyId, year, month],
    queryFn: async () => {
      const r = await api(`/properties/${propertyId}/availability?year=${year}&month=${month + 1}`);
      return r.ok ? r.json() : [];
    },
  });

  const blockedSet = new Set(blocked.filter(b => b.is_blocked).map(b => b.date));
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay    = new Date(year, month, 1).getDay();
  const monthName   = new Date(year, month).toLocaleString("default", { month: "long", year: "numeric" });

  function toISO(d: number) {
    return `${year}-${String(month + 1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
  }

  function handleDayTap(dateStr: string) {
    const dt = new Date(dateStr); dt.setHours(0,0,0,0);
    if (dt < today || blockedSet.has(dateStr)) return;
    if (!checkIn || (checkIn && checkOut)) {
      onCheckIn(dateStr); onCheckOut("");
    } else {
      const ci = new Date(checkIn);
      if (dt <= ci) { onCheckIn(dateStr); onCheckOut(""); return; }
      // Check no blocked dates in range
      const cur = new Date(ci); cur.setDate(cur.getDate() + 1);
      while (cur < dt) {
        const s = cur.toISOString().split("T")[0];
        if (blockedSet.has(s)) { onCheckIn(dateStr); onCheckOut(""); return; }
        cur.setDate(cur.getDate() + 1);
      }
      if ((dt.getTime() - ci.getTime()) / 86400000 < minNights) return;
      onCheckOut(dateStr);
    }
  }

  function dayClass(d: number): string {
    const s = toISO(d);
    const dt = new Date(s); dt.setHours(0,0,0,0);
    const isPast     = dt < today;
    const isBlocked  = blockedSet.has(s);
    const isCheckIn  = s === checkIn;
    const isCheckOut = s === checkOut;
    const ci = checkIn ? new Date(checkIn) : null;
    const co = checkOut ? new Date(checkOut) : null;
    const inRange = ci && co && dt > ci && dt < co;

    if (isCheckIn || isCheckOut) return "bg-forest text-white font-bold rounded-full";
    if (inRange)   return "bg-forest/15 text-forest font-medium";
    if (isPast || isBlocked) return "text-(--border) line-through cursor-default";
    return "text-(--text-primary) hover:bg-(--bg-overlay) rounded-full cursor-pointer";
  }

  function prevMonth() { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); }
  function nextMonth() { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); }

  return (
    <>
      <Divider />
      <div className="py-4 space-y-3 max-w-md">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg text-(--text-primary)">Availability</h2>
          {minNights > 1 && <span className="text-xs text-(--text-muted) bg-(--bg-overlay) px-2 py-0.5 rounded-full">{minNights}+ nights min</span>}
        </div>
        <div className="flex items-center justify-between mb-1">
          <button onClick={prevMonth} className="w-8 h-8 rounded-full bg-(--bg-overlay) flex items-center justify-center text-(--text-muted)">‹</button>
          <p className="text-sm font-semibold text-(--text-primary)">{monthName}</p>
          <button onClick={nextMonth} className="w-8 h-8 rounded-full bg-(--bg-overlay) flex items-center justify-center text-(--text-muted)">›</button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {["Su","Mo","Tu","We","Th","Fr","Sa"].map(d => (
            <div key={d} className="text-[13px] font-semibold text-(--text-muted) py-1">{d}</div>
          ))}
          {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const s   = toISO(day);
            const dt  = new Date(s); dt.setHours(0,0,0,0);
            const canTap = dt >= today && !blockedSet.has(s);
            return (
              <button key={day} onClick={() => handleDayTap(s)} disabled={!canTap}
                className={`w-full aspect-square flex items-center justify-center text-xs transition-colors ${dayClass(day)}`}>
                {day}
              </button>
            );
          })}
        </div>
        <div className="flex gap-4 text-[13px] text-(--text-muted)">
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-forest inline-block" />Selected</span>
          <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-(--border) inline-block" />Unavailable</span>
        </div>
      </div>
    </>
  );
}

// ── AI Chatbot ─────────────────────────────────────────────────────────────────

// ── Main component ────────────────────────────────────────────────────────────

export default function Property() {
  const { id }       = useParams<{ id: string }>();
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();

  const [photoIndex,   setPhotoIndex]   = useState(0);
  const [galleryOpen,  setGalleryOpen]  = useState(false);
  // Dates can arrive in the link (e.g. from "Available this weekend").
  const [sp] = useSearchParams();
  const validDate = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
  const [checkIn,      setCheckIn]      = useState(() => validDate(sp.get("check_in")));
  const [checkOut,     setCheckOut]     = useState(() => validDate(sp.get("check_out")));
  const [guests,       setGuests]       = useState(() => Math.max(1, Number(sp.get("guests")) || 1));
  const [saved,        setSaved]        = useState(() => isSaved(id ?? ""));
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [showAllRev,   setShowAllRev]   = useState(false);
  const [showAllAmen,  setShowAllAmen]  = useState(false);
  const [copyToast,    setCopyToast]    = useState(false);
  const [chatOpen,     setChatOpen]     = useState(false);
  const cardsOn = !!useSiteInfo().data?.card_payments;
  const protectWindow = useProtectionWindow();
  const touchStartX    = useRef(0);
  const calendarRef    = useRef<HTMLDivElement>(null);

  const { data: prop, isLoading, isError } = useQuery<PropertyDetail>({
    queryKey: ["property", id],
    queryFn: async () => {
      const r = await api(`/properties/${id}`);
      if (!r.ok) throw new Error("Not found");
      return r.json();
    },
    enabled: !!id,
  });

  const { data: reviews = [] } = useQuery<Review[]>({
    queryKey: ["reviews", id],
    queryFn: async () => {
      const r = await api(`/reviews/property/${id}`);
      return r.ok ? r.json() : [];
    },
    enabled: !!id,
  });

  // Similar stays from cache
  const allCached = queryClient.getQueryData<PropertyCardData[]>(["properties", "home"]) ?? [];
  const similar   = allCached.filter(p => p.id !== id).slice(0, 6);

  // SEO — must be called unconditionally before any early returns
  const primaryImg = prop?.images?.find(i => i.is_primary)?.cloudinary_url ?? prop?.images?.[0]?.cloudinary_url;
  useSEO({
    title: prop ? `${prop.title}, Naivasha` : "Property",
    description: prop?.description
      ? `${prop.description.slice(0, 140)}… Book from KES ${prop.price_per_night.toLocaleString()}/night.`
      : prop
        ? `${prop.type.charAt(0).toUpperCase() + prop.type.slice(1)} in Naivasha from KES ${prop.price_per_night.toLocaleString()}/night.`
        : undefined,
    image: primaryImg,
    url: prop ? `/property/${prop.id}` : undefined,
    type: "article",
    jsonLd: prop ? {
      "@context": "https://schema.org",
      "@type": "LodgingBusiness",
      "name": prop.title,
      "description": prop.description ?? `${prop.type} in Naivasha, Kenya`,
      "image": prop.images.map(i => i.cloudinary_url),
      "url": `https://avistay.com/property/${prop.id}`,
      "priceRange": `KES ${prop.price_per_night.toLocaleString()}/night`,
      "currenciesAccepted": "KES",
      "paymentAccepted": "M-Pesa",
      "address": {
        "@type": "PostalAddress",
        "addressLocality": "Naivasha",
        "addressRegion": "Nakuru County",
        "addressCountry": "KE",
      },
      ...(prop.lat && prop.lng ? {
        "geo": { "@type": "GeoCoordinates", "latitude": prop.lat, "longitude": prop.lng },
        "hasMap": `https://www.google.com/maps?q=${prop.lat},${prop.lng}`,
      } : {}),
      "amenityFeature": [],
      "starRating": prop.verified_tier >= 2 ? { "@type": "Rating", "ratingValue": "4" } : undefined,
    } : undefined,
  });

  // ── Derived ────────────────────────────────────────────────────────────────

  if (isLoading) return (
    <div className="min-h-screen bg-(--bg-primary)">
      <div className="h-72 bg-(--bg-surface) animate-pulse" />
      <div className="p-4 space-y-3">
        {[80,60,40,100,60].map((w, i) => (
          <div key={i} className="h-4 bg-(--bg-surface) rounded-full animate-pulse" style={{ width: `${w}%` }} />
        ))}
      </div>
    </div>
  );

  if (isError || !prop) return (
    <div className="flex flex-col items-center justify-center min-h-screen text-center px-6 space-y-4">
      <SearchX className="w-12 h-12 text-(--text-muted)" aria-hidden="true" />
      <p className="font-semibold text-(--text-primary)">This home isn't available</p>
      <button onClick={() => navigate(-1)} className="text-teal text-sm underline">Go back</button>
    </div>
  );

  const imgs         = [...prop.images].sort((a, b) => a.display_order - b.display_order);
  const mapsUrl      = prop.lat && prop.lng ? `https://www.google.com/maps/dir/?api=1&destination=${prop.lat},${prop.lng}&travelmode=driving` : null;
  const waUrl        = `https://wa.me/?text=${encodeURIComponent(`Check out this place in Naivasha:\nhttps://avistay.com/property/${prop.id}`)}`;
  const avgRating    = reviews.length ? reviews.reduce((s, r) => s + r.avg_score, 0) / reviews.length : null;
  const amenities    = getAmenities(prop.type, prop.description);
  const displayedRev = showAllRev ? reviews : reviews.slice(0, 4);

  const avgAccuracy    = reviews.length ? reviews.reduce((s, r) => s + r.accuracy_score,    0) / reviews.length : 0;
  const avgClean       = reviews.length ? reviews.reduce((s, r) => s + r.cleanliness_score, 0) / reviews.length : 0;
  const avgLocation    = reviews.length ? reviews.reduce((s, r) => s + r.location_score,    0) / reviews.length : 0;
  const avgValue       = reviews.length ? reviews.reduce((s, r) => s + r.value_score,       0) / reviews.length : 0;

  function share() {
    const url = `https://avistay.com/property/${prop!.id}`;
    if (navigator.share) {
      navigator.share({ title: prop!.title, text: `Check out this home in Naivasha`, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        setCopyToast(true);
        setTimeout(() => setCopyToast(false), 2500);
      }).catch(() => {});
    }
  }

  const imgUrls = imgs.map(i => i.cloudinary_url);
  const openGallery = (i: number) => { setPhotoIndex(i); setGalleryOpen(true); };
  const pickDates = () => calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  const reserve = () => navigate(`/booking/${prop.id}?check_in=${checkIn}&check_out=${checkOut}&guests=${guests}`);
  const noCheckout = (prop.no_checkout_days ?? "").split(",").filter(Boolean)
    .map(d => ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(d)]).filter(Boolean);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-40 lg:pb-16">
      <div className="max-w-6xl mx-auto px-4">

        {/* ── Back / share / save — below the main bar, never on top of it ── */}
        <div className="flex items-center justify-between py-3">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 text-sm font-medium text-(--text-primary)">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
          </button>
          <div className="flex items-center gap-1">
            <button onClick={share} className="flex items-center gap-1.5 text-sm font-medium text-(--text-primary) px-3 py-2 rounded-lg hover:bg-(--bg-surface)">
              <Share2 className="w-4 h-4" aria-hidden="true" /> Share
            </button>
            <button onClick={() => setSaved(toggleSaved(prop.id))} aria-pressed={saved}
              className="flex items-center gap-1.5 text-sm font-medium text-(--text-primary) px-3 py-2 rounded-lg hover:bg-(--bg-surface)">
              <Heart className="w-4 h-4" fill={saved ? "#ef4444" : "none"} stroke={saved ? "#ef4444" : "currentColor"} aria-hidden="true" />
              {saved ? "Saved" : "Save"}
            </button>
          </div>
        </div>

        {/* ── Title ── */}
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-(--text-muted)">{prop.type}{prop.max_guests ? ` · sleeps ${prop.max_guests}` : ""}</span>
              {prop.verified_tier >= 2 && (
                <span className="inline-flex items-center gap-1 bg-forest/10 text-forest text-xs font-bold px-2 py-0.5 rounded-full">
                  <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Verified by Avistay
                </span>
              )}
            </div>
            <h1 className="font-display italic text-3xl md:text-4xl text-(--text-primary) leading-tight">{prop.title}</h1>
            <p className="flex items-center gap-1.5 text-sm text-(--text-muted) mt-1.5">
              <MapPin className="w-4 h-4 shrink-0" aria-hidden="true" />
              {prop.area_label ? `${prop.area_label}, ` : ""}Naivasha, Kenya
              {prop.lat && prop.lng && (
                <a href="#location" className="text-teal font-medium underline underline-offset-2 ml-1">Show on map</a>
              )}
            </p>
          </div>
          {avgRating ? (
            <a href="#reviews" className="flex items-center gap-2 self-start md:self-auto">
              <span className="text-right">
                <span className="block text-sm font-semibold text-(--text-primary)">{ratingWord(avgRating)}</span>
                <span className="block text-xs text-(--text-muted)">{reviews.length} review{reviews.length !== 1 ? "s" : ""}</span>
              </span>
              <RatingBadge value={avgRating} />
            </a>
          ) : (
            <span className="self-start text-xs bg-mint/15 text-teal font-semibold px-2.5 py-1 rounded-full">New on Avistay</span>
          )}
        </div>

        {/* ── Photos ── */}
        <PhotoMosaic images={imgUrls} title={prop.title} onOpen={openGallery} />

        {/* ── Details + booking card ── */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-10 mt-6">
          <div className="min-w-0">

            {/* Stay essentials — the quick scan */}
            <section aria-label="Stay essentials" className="pb-5">
              <h2 className="font-semibold text-(--text-primary) mb-3">Stay essentials</h2>
              <ul className="flex flex-wrap gap-x-5 gap-y-2.5">
                {amenities.slice(0, 6).map(a => (
                  <li key={a.label} className="flex items-center gap-2 text-sm text-(--text-primary)">
                    <span className="[&>svg]:w-5 [&>svg]:h-5">{a.icon}</span>{a.label}
                  </li>
                ))}
              </ul>
            </section>

            <Divider />

            {/* Highlights */}
            <ul className="py-5 grid sm:grid-cols-3 gap-4">
              {[
                { icon: <HomeIcon className="w-6 h-6 text-teal" />, title: `Entire ${prop.type}`, sub: "The whole place is yours" },
                cardsOn
                  ? { icon: <Smartphone className="w-6 h-6 text-green-600" />, title: "M-Pesa or card", sub: "Pay by M-Pesa prompt, Visa, Mastercard or Apple Pay" }
                  : { icon: <Smartphone className="w-6 h-6 text-green-600" />, title: "Pay with M-Pesa", sub: "A prompt on your phone, done in a minute" },
                { icon: <Shield className="w-6 h-6 text-forest" />, title: "Payment protected", sub: `The host is paid ${protectWindow} after you check in` },
              ].map(h => (
                <li key={h.title} className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0">{h.icon}</span>
                  <span>
                    <span className="block text-sm font-semibold text-(--text-primary)">{h.title}</span>
                    <span className="block text-xs text-(--text-muted) mt-0.5">{h.sub}</span>
                  </span>
                </li>
              ))}
            </ul>

            <Divider />

            {/* Ask Avi invite */}
            <button type="button" onClick={() => setChatOpen(true)}
              className="w-full my-5 flex items-center gap-3 text-left rounded-2xl border border-forest/20 bg-forest/5 hover:bg-forest/10 px-4 py-3 transition-colors">
              <span className="w-10 h-10 rounded-full bg-forest flex items-center justify-center shrink-0">
                <Sparkles className="w-5 h-5 text-mint" aria-hidden="true" />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-(--text-primary)">Questions about this home?</span>
                <span className="block text-sm text-(--text-muted)">Ask Avi, our AI assistant, about rules, check-in or things to do nearby. Avi answers instantly.</span>
              </span>
              <ChevronRight className="w-5 h-5 text-(--text-muted) shrink-0" aria-hidden="true" />
            </button>

            <Divider />

            {/* About */}
            {prop.description && (
              <section className="py-5 space-y-2">
                <h2 className="font-semibold text-lg text-(--text-primary)">About this place</h2>
                <p className={`text-(--text-muted) leading-relaxed whitespace-pre-line ${!showFullDesc && prop.description.length > 320 ? "line-clamp-5" : ""}`}>
                  {prop.description}
                </p>
                {prop.description.length > 320 && (
                  <button onClick={() => setShowFullDesc(!showFullDesc)} className="text-sm font-semibold text-(--text-primary) underline underline-offset-2">
                    {showFullDesc ? "Show less" : "Read more"}
                  </button>
                )}
              </section>
            )}

            <Divider />

            {/* Facilities */}
            <section className="py-5 space-y-3">
              <h2 className="font-semibold text-lg text-(--text-primary)">Facilities</h2>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(showAllAmen ? amenities : amenities.slice(0, 9)).map(a => (
                  <li key={a.label} className="flex items-center gap-2.5 bg-(--bg-surface) border border-(--border) rounded-xl px-3 py-2.5">
                    <span className="shrink-0">{a.icon}</span>
                    <span className="text-sm text-(--text-primary)">{a.label}</span>
                  </li>
                ))}
              </ul>
              {amenities.length > 9 && (
                <button onClick={() => setShowAllAmen(v => !v)} className="text-sm font-semibold text-(--text-primary) underline underline-offset-2">
                  {showAllAmen ? "Show fewer" : `Show all ${amenities.length} facilities`}
                </button>
              )}
            </section>

            {/* Availability */}
            <div ref={calendarRef} id="availability" className="scroll-mt-24">
              <AvailabilityCalendar propertyId={prop.id} checkIn={checkIn} checkOut={checkOut}
                onCheckIn={setCheckIn} onCheckOut={setCheckOut} minNights={prop.min_nights} />
            </div>

            <Divider />

            {/* House rules & policies */}
            <section className="py-5 space-y-3">
              <h2 className="font-semibold text-lg text-(--text-primary)">House rules &amp; policies</h2>
              <dl className="divide-y divide-(--border) border border-(--border) rounded-2xl bg-(--bg-surface)">
                {[
                  { Icon: LogIn, k: "Check-in", v: prop.check_in_until ? `${prop.check_in_from} to ${prop.check_in_until}` : `From ${prop.check_in_from}` },
                  { Icon: LogOut, k: "Check-out", v: `By ${prop.check_out_until}` },
                  { Icon: CalendarX, k: "Cancellation", v: prop.policy_summary ?? "See terms at checkout" },
                  { Icon: Shield, k: "Damage deposit", v: prop.deposit_amount ? `${kes(prop.deposit_amount)}, paid with your booking and returned 2 days after check-out` : "No damage deposit" },
                  { Icon: Moon, k: "Minimum stay", v: `${prop.min_nights} night${prop.min_nights !== 1 ? "s" : ""}` },
                  ...(prop.max_guests ? [{ Icon: Users, k: "Guests", v: `Up to ${prop.max_guests}` }] : []),
                  { Icon: Baby, k: "Children", v: prop.children_allowed ? "Children are welcome" : "Not suitable for children" },
                  { Icon: Dog, k: "Pets", v: prop.pets_allowed ? "Pets are allowed" : "No pets" },
                  { Icon: Cigarette, k: "Smoking", v: prop.smoking_allowed ? "Smoking allowed" : "No smoking" },
                  { Icon: PartyPopper, k: "Parties & events", v: prop.parties_allowed ? "Allowed. Tell the host in advance" : "Not allowed" },
                  ...(prop.quiet_hours ? [{ Icon: Volume1, k: "Quiet hours", v: prop.quiet_hours.replace("-", " to ") }] : []),
                  ...(noCheckout.length ? [{ Icon: CalendarDays, k: "No check-out on", v: noCheckout.join(", ") }] : []),
                  { Icon: Smartphone, k: "Payment", v: cardsOn ? "M-Pesa or card, in Kenyan shillings" : "M-Pesa, in Kenyan shillings" },
                ].map(({ Icon, k, v }) => (
                  <div key={k} className="flex gap-3 px-4 py-3">
                    <dt className="flex items-center gap-2 w-40 shrink-0 text-sm font-medium text-(--text-primary)">
                      <Icon className="w-4 h-4 text-(--text-muted)" aria-hidden="true" /> {k}
                    </dt>
                    <dd className="text-sm text-(--text-muted)">{v}</dd>
                  </div>
                ))}
              </dl>
              {prop.house_rules && (
                <div className="bg-(--bg-surface) border border-(--border) rounded-2xl px-4 py-3">
                  <p className="text-sm font-medium text-(--text-primary) mb-1">From your host</p>
                  <p className="text-sm text-(--text-muted) whitespace-pre-line">{prop.house_rules}</p>
                </div>
              )}
            </section>

            <Divider />

            {/* Reviews */}
            <section id="reviews" className="py-5 space-y-4 scroll-mt-24">
              <h2 className="font-semibold text-lg text-(--text-primary)">
                Guest reviews {reviews.length > 0 && <span className="text-(--text-muted) font-normal text-base">({reviews.length})</span>}
              </h2>
              {reviews.length === 0 ? (
                <p className="text-sm text-(--text-muted)">No reviews yet. Only guests who stayed through Avistay can review, so every review here is real.</p>
              ) : (
                <>
                  <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
                    <div className="flex items-center gap-3">
                      <RatingBadge value={avgRating!} size="lg" />
                      <span>
                        <span className="block font-semibold text-(--text-primary)">{ratingWord(avgRating!)}</span>
                        <span className="block text-xs text-(--text-muted)">{reviews.length} verified review{reviews.length !== 1 ? "s" : ""}</span>
                      </span>
                    </div>
                    <div className="flex-1 grid sm:grid-cols-2 gap-x-6 gap-y-2">
                      <ScoreBar label="Accuracy" value={avgAccuracy} />
                      <ScoreBar label="Cleanliness" value={avgClean} />
                      <ScoreBar label="Location" value={avgLocation} />
                      <ScoreBar label="Value" value={avgValue} />
                    </div>
                  </div>
                  <ul className="grid md:grid-cols-2 gap-3">
                    {displayedRev.map(r => (
                      <li key={r.id} className="bg-(--bg-surface) border border-(--border) rounded-2xl p-4 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="w-9 h-9 rounded-full bg-forest/15 text-forest flex items-center justify-center text-sm font-bold shrink-0">
                            {r.guest_name[0]}
                          </span>
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-semibold text-(--text-primary)">{r.guest_name}</span>
                            <span className="block text-xs text-(--text-muted)">
                              Stayed · reviewed {new Date(r.created_at).toLocaleDateString("en-KE", { month: "long", year: "numeric" })}
                            </span>
                          </span>
                          <span className="text-sm font-bold text-(--text-primary) flex items-center gap-0.5">
                            <Star className="w-3.5 h-3.5 fill-gold text-gold" aria-hidden="true" />{r.avg_score.toFixed(1)}
                          </span>
                        </div>
                        {r.comment && <p className="text-sm text-(--text-primary) leading-relaxed">“{r.comment}”</p>}
                        {r.owner_response && (
                          <div className="bg-(--bg-primary) rounded-xl px-3 py-2">
                            <p className="text-xs font-semibold text-teal">Host response</p>
                            <p className="text-xs text-(--text-muted) leading-relaxed">{r.owner_response}</p>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                  {reviews.length > 4 && (
                    <button onClick={() => setShowAllRev(v => !v)} className="w-full md:w-auto md:px-6 border border-(--border) text-(--text-primary) text-sm font-medium py-2.5 rounded-xl">
                      {showAllRev ? "Show fewer reviews" : `Read all ${reviews.length} reviews`}
                    </button>
                  )}
                </>
              )}
            </section>

            <Divider />

            {/* Location */}
            <section id="location" className="py-5 space-y-3 scroll-mt-24">
              <h2 className="font-semibold text-lg text-(--text-primary)">Location</h2>
              {/* Own stacking layer: keeps the map's controls under the booking bar */}
              <div className="relative z-0 isolate rounded-2xl overflow-hidden">
                <LeafletMap single height={260}
                  pins={prop.lat && prop.lng ? [{ id: prop.id, lat: prop.lat, lng: prop.lng, label: prop.title, title: prop.title, href: `/property/${prop.id}` }] : []} />
              </div>
              {prop.landmark_instructions && (
                <p className="text-sm text-(--text-muted) leading-relaxed"><span className="font-medium text-(--text-primary)">Directions: </span>{prop.landmark_instructions}</p>
              )}
              {prop.what3words && (
                <a href={`https://what3words.com/${prop.what3words}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-teal font-medium underline underline-offset-2">
                  <span className="font-bold">///</span>{prop.what3words}
                </a>
              )}
              <p className="flex items-center gap-2 text-sm text-(--text-muted)">
                <Car className="w-4 h-4 shrink-0" aria-hidden="true" /> About 90 minutes from Nairobi on the A104
              </p>
              <div className="flex gap-2">
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 bg-forest text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
                    <MapPin className="w-4 h-4" aria-hidden="true" /> Get directions
                  </a>
                )}
                <a href={waUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 bg-[#25D366] text-white text-sm font-semibold px-4 py-2.5 rounded-xl">
                  <MessageCircle className="w-4 h-4" aria-hidden="true" /> Share on WhatsApp
                </a>
              </div>
            </section>

            <Divider />

            {/* Host */}
            <section className="py-5 flex items-center gap-3">
              <span className="w-12 h-12 rounded-full bg-linear-to-br from-forest to-teal flex items-center justify-center text-white font-bold text-lg shrink-0">
                {(prop.host_name ?? "H")[0].toUpperCase()}
              </span>
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-(--text-primary)">Hosted by {prop.host_name ?? "a local host"}</span>
                <span className="flex items-center gap-2 flex-wrap text-xs text-(--text-muted) mt-0.5">
                  {prop.host_since && <>On Avistay since {new Date(prop.host_since).getFullYear()}</>}
                  {prop.host_id_verified && (
                    <span className="inline-flex items-center gap-0.5 font-semibold text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded-full">
                      <CheckCircle className="w-3 h-3" aria-hidden="true" /> ID verified
                    </span>
                  )}
                  {prop.response_time_hours && <span className="inline-flex items-center gap-0.5"><Zap className="w-3 h-3" aria-hidden="true" /> Usually replies within {prop.response_time_hours}h</span>}
                </span>
              </span>
            </section>

            {/* Similar stays */}
            {similar.length > 0 && (
              <>
                <Divider />
                <section className="py-5 space-y-3">
                  <h2 className="font-semibold text-lg text-(--text-primary)">More stays in Naivasha</h2>
                  <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-none snap-x scroll-px-4">
                    {similar.map(p => (
                      <Link key={p.id} to={`/property/${p.id}`} className="snap-start shrink-0 w-52 group">
                        <div className="aspect-4/3 rounded-xl overflow-hidden bg-(--bg-surface)">
                          {p.primary_image
                            ? <img src={imgSrc(p.primary_image, 400)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                            : <div className="w-full h-full bg-forest" />}
                        </div>
                        <p className="text-sm font-medium text-(--text-primary) line-clamp-1 mt-1.5">{p.title}</p>
                        <p className="text-sm text-(--text-muted)">{kes(p.price_per_night)} / night</p>
                      </Link>
                    ))}
                  </div>
                </section>
              </>
            )}
          </div>

          <BookingPanel propertyId={prop.id} pricePerNight={prop.price_per_night} minNights={prop.min_nights}
            rating={avgRating} reviewCount={reviews.length} checkIn={checkIn} checkOut={checkOut}
            guests={guests} maxGuests={prop.max_guests} onGuests={setGuests} onPickDates={pickDates} onReserve={reserve} />
        </div>
      </div>

      {/* ── Copy toast ── */}
      {copyToast && (
        <div role="status" className="fixed top-24 left-1/2 -translate-x-1/2 z-600 bg-(--text-primary) text-white text-sm font-medium px-4 py-2.5 rounded-2xl shadow-xl pointer-events-none"
          style={{ animation: "fade-up 0.2s ease-out both" }}>
          Link copied
        </div>
      )}

      {/* ── Ask Avi (AI assistant) ── */}
      <AskAvi endpoint={`/properties/${prop.id}/chat`} subtitle={prop.title} open={chatOpen} setOpen={setChatOpen}
        greeting="Hi, I'm Avi! Ask me anything about this home: rules, check-in, who it suits, or what to do nearby."
        starters={["Can I bring my dog?", "What time is check-in?", "How many people can stay?", "What is there to do nearby?"]}
        note="Avi answers from this listing. Confirm anything important with the host." />

      {/* ── Full-screen gallery ── */}
      {galleryOpen && (
        <div role="dialog" aria-modal="true" aria-label="Photos" tabIndex={-1}
          ref={el => el?.focus()}
          onKeyDown={e => {
            if (e.key === "Escape") setGalleryOpen(false);
            if (e.key === "ArrowRight") setPhotoIndex(i => Math.min(imgs.length - 1, i + 1));
            if (e.key === "ArrowLeft") setPhotoIndex(i => Math.max(0, i - 1));
          }}
          className="fixed inset-0 z-700 bg-black flex flex-col outline-hidden"
          onTouchStart={e => { touchStartX.current = e.touches[0].clientX; }}
          onTouchEnd={e => {
            const diff = e.changedTouches[0].clientX - touchStartX.current;
            if (diff < -50 && photoIndex < imgs.length - 1) setPhotoIndex(i => i + 1);
            if (diff > 50 && photoIndex > 0) setPhotoIndex(i => i - 1);
          }}>
          <div className="flex items-center justify-between px-4 py-3">
            <button onClick={() => setGalleryOpen(false)} aria-label="Close photos" className="w-10 h-10 bg-white/15 text-white rounded-full flex items-center justify-center">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
            <p className="text-white/80 text-sm">{photoIndex + 1} / {imgs.length}</p>
            <button onClick={share} aria-label="Share" className="w-10 h-10 bg-white/15 text-white rounded-full flex items-center justify-center">
              <Share2 className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          <div className="relative flex-1 flex items-center justify-center px-4 min-h-0">
            <img src={imgSrc(imgs[photoIndex]?.cloudinary_url, 1600)} alt={`${prop.title} , photo ${photoIndex + 1}`} className="max-h-full max-w-full object-contain rounded-lg" />
            {photoIndex > 0 && (
              <button onClick={() => setPhotoIndex(i => i - 1)} aria-label="Previous photo"
                className="hidden md:flex absolute left-4 w-12 h-12 rounded-full bg-white/15 text-white items-center justify-center"><ChevronLeft className="w-6 h-6" /></button>
            )}
            {photoIndex < imgs.length - 1 && (
              <button onClick={() => setPhotoIndex(i => i + 1)} aria-label="Next photo"
                className="hidden md:flex absolute right-4 w-12 h-12 rounded-full bg-white/15 text-white items-center justify-center"><ChevronRight className="w-6 h-6" /></button>
            )}
          </div>
          {imgs.length > 1 && (
            <div className="flex justify-center gap-2 px-4 py-4 overflow-x-auto scrollbar-none">
              {imgs.map((img, i) => (
                <button key={i} onClick={() => setPhotoIndex(i)} aria-label={`Photo ${i + 1}`}
                  className={`shrink-0 w-16 h-12 rounded-md overflow-hidden border-2 ${i === photoIndex ? "border-white" : "border-transparent opacity-50"}`}>
                  <img src={imgSrc(img.cloudinary_url, 160)} alt="" className="w-full h-full object-cover" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div className="h-px bg-(--border)" />;
}

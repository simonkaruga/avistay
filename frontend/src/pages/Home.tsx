import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Heart, House, Sparkles, Star } from "lucide-react";
import PropertyCard, { PropertyCardData } from "../components/PropertyCard";
import SkeletonCard from "../components/SkeletonCard";
import HeroSlides from "../components/HeroSlides";
import AskAvi from "../components/AskAvi";
import TypeIcon from "../components/TypeIcon";
import { useCountUp } from "../hooks/useCountUp";
import { toggleSaved, isSaved } from "./Saved";
import { imgSrc } from "../utils/image";
import { useSEO } from "../utils/seo";
import SearchBar from "../components/home/SearchBar";
import {
  AreaTiles, HostCTA, Offers, ProtectionBanner, SectionHeader, StayTypes, TrendingDestinations, UniqueStays, WeekendRow,
} from "../components/home/sections";

const HOME_GRID_MAX = 9;   // featured + 8; the rest are one tap away in Search

import { api } from "../utils/api";
// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchProperties(): Promise<PropertyCardData[]> {
  const res = await api("/properties/?limit=100");
  if (!res.ok) throw new Error("Failed");
  return res.json();
}

// ── Featured card (first property — full width) ───────────────────────────────

function FeaturedCard({ p }: { p: PropertyCardData }) {
  const [saved, setSaved] = useState(() => isSaved(p.id));
  return (
    <Link to={`/property/${p.id}`} className="block rounded-3xl overflow-hidden relative card active:scale-[.98] transition-transform" style={{ height: 240 }}>
      {p.primary_image
        ? <img src={imgSrc(p.primary_image, 800)} alt={p.title} className="w-full h-full object-cover" loading="eager" />
        : <div className="w-full h-full bg-forest" />
      }
      <div className="absolute inset-0 bg-linear-to-t from-black/90 via-black/20 to-transparent" />

      {/* top row */}
      <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
        <span className="bg-black/50 backdrop-blur-xs text-white text-[9px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1">
          <TypeIcon type={p.type} className="w-3 h-3" />
          <span className="capitalize">{p.type}</span>
        </span>
        <div className="flex items-center gap-2">
          {p.verified_tier >= 2 && (
            <span className="bg-forest text-white text-[9px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-0.5"><BadgeCheck className="w-2.5 h-2.5" aria-hidden="true" /> Verified</span>
          )}
          <button
            onClick={e => { e.preventDefault(); e.stopPropagation(); setSaved(toggleSaved(p.id)); }}
            aria-label={saved ? "Remove from saved" : "Save"}
            className="w-8 h-8 bg-black/40 backdrop-blur-xs rounded-full flex items-center justify-center">
            <Heart className="w-4 h-4" fill={saved ? "#ef4444" : "none"} stroke={saved ? "#ef4444" : "white"} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* bottom text */}
      <div className="absolute bottom-0 left-0 right-0 p-4">
        <h3 className="font-display italic text-2xl text-white leading-tight mb-1">{p.title}</h3>
        <div className="flex items-center justify-between">
          <p className="text-mint font-bold text-sm">
            KES {p.price_per_night.toLocaleString()}
            <span className="text-white/50 font-normal text-xs"> /night</span>
          </p>
          {p.avg_rating
            ? <span className="bg-black/50 backdrop-blur-xs text-white text-xs font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                <Star className="w-3.5 h-3.5 inline -mt-0.5 fill-amber-400 text-amber-400" aria-hidden="true" /> {p.avg_rating.toFixed(1)}
                {p.review_count ? <span className="text-white/60 font-normal">({p.review_count})</span> : null}
              </span>
            : <span className="text-[9px] bg-mint/20 text-mint font-semibold px-2 py-0.5 rounded-full">New listing</span>
          }
        </div>
      </div>
    </Link>
  );
}

// ── Animated stat counters ────────────────────────────────────────────────────

function Stat({ value, suffix, label, decimals = 0 }: { value: number; suffix: string; label: string; decimals?: number }) {
  const { count, ref } = useCountUp(value, 1800);
  const display = decimals > 0 ? (count / Math.pow(10, decimals)).toFixed(decimals) : count.toLocaleString();
  return (
    <div ref={ref} className="text-center py-4">
      <p className="text-2xl font-bold text-(--text-primary) leading-none">
        {display}<span className="text-teal text-lg">{suffix}</span>
      </p>
      <p className="text-[10px] text-(--text-muted) mt-1">{label}</p>
    </div>
  );
}

function StatBar() {
  const { data } = useQuery<{ property_count: number; avg_rating: number; booking_count: number }>({
    queryKey: ["stats"],
    queryFn: async () => {
      const r = await api("/properties/stats");
      return r.ok ? r.json() : { property_count: 0, avg_rating: 0, booking_count: 0 };
    },
    staleTime: 5 * 60 * 1000,
  });
  // "0+ stays" makes a new site look empty — show only once the numbers are real.
  if (!data || data.booking_count < 10 || data.property_count < 10) return null;
  return (
    <div className="mt-8 grid grid-cols-3 divide-x divide-(--border) bg-(--bg-surface) rounded-2xl border border-(--border) overflow-hidden">
      <Stat value={data?.booking_count ?? 0}         suffix="+" label="Verified stays" />
      <Stat value={Math.round((data?.avg_rating ?? 0) * 10)} suffix="★" label="Avg rating" decimals={1} />
      <Stat value={data?.property_count ?? 0}        suffix="+" label="Homes listed" />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Home() {
  const [aviOpen, setAviOpen] = useState(false);
  const { data: all, isLoading, isError, refetch } = useQuery({
    queryKey: ["properties", "home"],
    queryFn: fetchProperties,
    retry: 1,
  });


  useSEO({
    title: "Naivasha Vacation Rentals",
    description: "Verified cottages, villas & retreats in Naivasha, Kenya. Pay by M-Pesa or card. ~90 min from Nairobi via A104.",
  });



  return (
    <div className="min-h-screen bg-(--bg-primary) pt-14 pb-20">

      {/* ════════════════════════════════════════
          HERO
      ════════════════════════════════════════ */}
      <div className="relative flex flex-col overflow-hidden" style={{ height: "clamp(270px, 38svh, 340px)" }}>

        {/* ── Photo today; videos of places slide in and out once added (see HeroSlides) ── */}
        <HeroSlides />

        {/* ── Content — anchored bottom-left ── */}
        <div className="relative z-10 flex-1 flex flex-col justify-end px-5 pb-14"
          style={{ animation: "fade-up 0.8s ease-out both" }}>

          {/* Location — whisper-small */}
          <p className="text-white/70 text-[10px] font-medium tracking-[0.45em] uppercase mb-2"
            style={{ animation: "fade-up 0.8s ease-out 0.06s both" }}>
            Naivasha · Kenya
          </p>

          {/* Headline — let it breathe */}
          <h1
            className="font-display italic text-white"
            style={{
              fontSize: "clamp(2.2rem, 9vw, 3.6rem)",
              lineHeight: 0.95,
              animation: "fade-up 0.8s ease-out 0.14s both",
            }}>
            Wake up<br />to the lake.
          </h1>
          <div className="mt-2 flex flex-col md:flex-row md:items-center gap-2.5 md:gap-4">
            <p className="text-white/85 text-sm font-medium tracking-wide"
              style={{ animation: "fade-up 0.8s ease-out 0.18s both" }}>
              Beautiful stays. Better experiences.
            </p>

            {/* AI support, front and centre */}
            <button type="button" onClick={() => setAviOpen(true)}
              className="self-start inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md border border-white/30 pl-1 pr-3.5 py-1 text-white text-sm font-medium transition-colors"
              style={{ animation: "fade-up 0.8s ease-out 0.24s both" }}>
              <span className="w-6 h-6 rounded-full bg-mint flex items-center justify-center">
                <Sparkles className="w-3.5 h-3.5 text-forest" aria-hidden="true" />
              </span>
              <span className="hidden sm:inline">Not sure where to stay?</span>
              <span className="font-semibold">Ask Avi, our AI assistant</span>
            </button>
          </div>

        </div>

      </div>

      <AskAvi endpoint="/avi/chat" subtitle="Find your Naivasha stay" open={aviOpen} setOpen={setAviOpen} raised={false} phoneButton={false}
        greeting="Hi, I'm Avi! Tell me who's coming and what you'd like to do, and I'll suggest homes. I can also explain how booking and payment work."
        starters={["A quiet weekend for two by the lake", "A home for 8 that allows dogs", "How does paying with M-Pesa work?", "What if something is wrong when I arrive?"]}
        note="Avi suggests homes from our live listings. Check dates on the home's calendar." />

      {/* Search — one line on wide screens, slim rows on phones */}
      <SearchBar />

      <div className="px-4 max-w-6xl mx-auto">

        {/* Offers — only while a real promotion is running (admin → Home page) */}
        <Offers />

        {/* Property types we have */}
        {all && <StayTypes homes={all} />}

        {/* Trending destinations — ranked by real bookings this month */}
        {all && <TrendingDestinations homes={all} />}

        {/* Explore Naivasha by area */}
        {all && <AreaTiles homes={all} />}

        {/* Stay at our top unique properties — handpicked by the team */}
        {all && <UniqueStays homes={all} />}

        {/* Available this weekend */}
        <WeekendRow />

        {/* All homes — on a young marketplace this is the heart of the page */}
        <section className="mt-8">
          {isLoading && (
            <div className="space-y-3">
              <div className="h-52 rounded-3xl bg-(--bg-surface) animate-pulse" />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
              </div>
            </div>
          )}

          {!isLoading && isError && (
            <div className="flex flex-col items-center py-12 text-center gap-3">
              <p className="font-semibold text-(--text-primary)">We couldn't load homes right now</p>
              <button onClick={() => refetch()} className="text-teal text-sm font-medium underline">Try again</button>
            </div>
          )}

          {!isLoading && !isError && !all?.length && (
            <div className="flex flex-col items-center py-12 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-(--bg-surface) flex items-center justify-center"><House className="w-7 h-7 text-(--text-muted)" aria-hidden="true" /></div>
              <p className="font-semibold text-(--text-primary)">New homes are on their way</p>
              <p className="text-sm text-(--text-muted) max-w-[260px]">We're verifying Naivasha's first hosts. Own a place by the lake? Be one of them.</p>
              <Link to="/list-your-property" className="mt-1 bg-forest text-white text-sm font-semibold px-6 py-3 rounded-xl">List your property</Link>
            </div>
          )}

          {!isLoading && all && all.length > 0 && (
            <>
              <SectionHeader title="All homes in Naivasha" subtitle={`${all.length} verified home${all.length === 1 ? "" : "s"}`}
                to={all.length > HOME_GRID_MAX ? "/search" : undefined} linkLabel={`See all ${all.length}`} />
              <FeaturedCard p={all[0]} />
              {all.length > 1 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  {all.slice(1, HOME_GRID_MAX).map(p => <PropertyCard key={p.id} p={p} />)}
                </div>
              )}
            </>
          )}
        </section>

        {/* Payment protection */}
        <ProtectionBanner />

        {/* Real numbers only once they mean something */}
        <StatBar />

        {/* Become a host */}
        <HostCTA />

        {/* ── Footer links ── */}
        <div className="mt-6 mb-4 pt-4 border-t border-(--border)">
          <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 mb-4">
            {([
              { to: "/how-it-works",        label: "How it works" },
              { to: "/about",               label: "About Avistay" },
              { to: "/terms",               label: "Terms of service" },
              { to: "/privacy",             label: "Privacy policy" },
              { to: "/cancellation-policy", label: "Cancellation policy" },
              { to: "/list-your-property", label: "List your property" },
            ] as const).map(l => (
              <Link key={l.to} to={l.to} className="text-xs text-(--text-muted) underline underline-offset-2">{l.label}</Link>
            ))}
          </div>
          <p className="text-[10px] text-(--text-muted) text-center">
            © {new Date().getFullYear()} Avistay · Beautiful stays. Better experiences.
          </p>
        </div>
      </div>
    </div>
  );
}

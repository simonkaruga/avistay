import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { Award, BadgeCheck, ChevronLeft, ChevronRight, Heart, Star } from "lucide-react";
import { toggleSaved, isSaved } from "../pages/Saved";
import { imgSrc } from "../utils/image";
import TypeIcon from "./TypeIcon";

export interface PropertyCardData {
  id: string;
  title: string;
  type: string;
  price_per_night: number;
  verified_tier: number;
  primary_image?: string;
  images?: string[];
  avg_rating?: number;
  review_count?: number;
  max_guests?: number;
  host_name?: string;
  host_since?: string;
  lat?: number;
  lng?: number;
  area?: string | null;
  min_nights?: number;
}

// ── 3-D tilt (desktop only) ───────────────────────────────────────────────────
function useTilt() {
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(hover: none)").matches) return;
    const onMove  = (e: MouseEvent) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left)  / r.width  - 0.5;
      const y = (e.clientY - r.top)   / r.height - 0.5;
      el.style.transform  = `perspective(900px) rotateX(${(-y*8).toFixed(1)}deg) rotateY(${(x*8).toFixed(1)}deg) scale(1.02)`;
      el.style.transition = "transform 0.08s linear";
    };
    const onLeave = () => {
      el.style.transform  = "perspective(900px) rotateX(0) rotateY(0) scale(1)";
      el.style.transition = "transform 0.45s cubic-bezier(0.34,1.56,0.64,1)";
    };
    el.style.willChange = "transform";
    el.addEventListener("mousemove", onMove);
    el.addEventListener("mouseleave", onLeave);
    return () => { el.removeEventListener("mousemove", onMove); el.removeEventListener("mouseleave", onLeave); };
  }, []);
  return ref;
}

// ── Photo carousel ────────────────────────────────────────────────────────────
function PhotoCarousel({ photos, title }: { photos: string[]; title: string }) {
  const [idx, setIdx] = useState(0);
  const touchX = useRef<number | null>(null);
  const isDesktop = !window.matchMedia("(hover: none)").matches;

  const prev = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setIdx(i => (i - 1 + photos.length) % photos.length); };
  const next = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); setIdx(i => (i + 1) % photos.length); };

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchX.current === null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) setIdx(i => dx < 0 ? (i + 1) % photos.length : (i - 1 + photos.length) % photos.length);
        touchX.current = null;
      }}
    >
      <img
        src={imgSrc(photos[idx], 420)}
        alt={title}
        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
        loading="lazy"
        draggable={false}
      />

      {photos.length > 1 && (
        <>
          {/* Arrows — desktop only */}
          {isDesktop && (
            <>
              <button onClick={prev}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/85 backdrop-blur-xs rounded-full flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronLeft className="w-3.5 h-3.5" stroke="#333" strokeWidth={2.5} aria-hidden="true" />
              </button>
              <button onClick={next}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 bg-white/85 backdrop-blur-xs rounded-full flex items-center justify-center shadow-sm opacity-0 group-hover:opacity-100 transition-opacity">
                <ChevronRight className="w-3.5 h-3.5" stroke="#333" strokeWidth={2.5} aria-hidden="true" />
              </button>
            </>
          )}

          {/* Dots */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1 pointer-events-none">
            {photos.map((_, i) => (
              <span key={i} className={`block rounded-full transition-all ${i === idx ? "w-3.5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/55"}`} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────
/** `query` is appended to the link, e.g. "check_in=2026-10-09&check_out=2026-10-11". */
export default function PropertyCard({ p, query }: { p: PropertyCardData; query?: string }) {
  const [saved, setSaved] = useState(() => isSaved(p.id));
  const tiltRef = useTilt();

  const photos = p.images?.length ? p.images : p.primary_image ? [p.primary_image] : [];
  const isGuestFavourite = (p.avg_rating ?? 0) >= 4.8 && (p.review_count ?? 0) >= 5;

  return (
    <Link
      ref={tiltRef}
      to={`/property/${p.id}${query ? `?${query}` : ""}`}
      style={{ transformStyle: "preserve-3d" }}
      className="group block rounded-2xl overflow-hidden bg-white shadow-xs active:scale-[.98]"
    >
      {/* ── Photo carousel ── */}
      <div className="relative overflow-hidden" style={{ aspectRatio: "4/3" }}>
        {photos.length > 0
          ? <PhotoCarousel photos={photos} title={p.title} />
          : <div className="w-full h-full bg-linear-to-br from-forest to-mint flex items-center justify-center">
              <TypeIcon type={p.type} className="w-10 h-10 text-white/30" />
            </div>
        }

        {/* Top rated badge */}
        {isGuestFavourite && (
          <span className="absolute top-2.5 left-2.5 bg-white text-nearblack text-[12px] font-bold px-2 py-0.5 rounded-full shadow-xs flex items-center gap-0.5">
            <Award className="w-3 h-3 text-clay" aria-hidden="true" /> Top rated
          </span>
        )}

        {/* Save heart */}
        <button
          onClick={e => { e.preventDefault(); e.stopPropagation(); setSaved(toggleSaved(p.id)); }}
          aria-label={saved ? "Remove from saved" : "Save"}
          className="absolute top-2.5 right-2.5 w-8 h-8 bg-white/90 backdrop-blur-xs rounded-full flex items-center justify-center shadow-xs transition-transform active:scale-90">
          <Heart className="w-[18px] h-[18px]" fill={saved ? "#ef4444" : "none"} stroke={saved ? "#ef4444" : "#333333"} aria-hidden="true" />
        </button>
      </div>

      {/* ── Info below photo ── */}
      <div className="p-3 space-y-1.5">

        {/* Type · location · trust tags */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1 text-[13px] text-(--text-muted) capitalize">
            <TypeIcon type={p.type} className="w-3 h-3" />
            {p.type} · Naivasha
          </span>
          <span className="flex items-center gap-1.5">
            {p.verified_tier === 1 && (
              <span className="flex items-center gap-0.5 text-[13px] font-semibold text-teal">
                <Star className="w-3 h-3" strokeWidth={2.5} aria-hidden="true" />
                Trusted
              </span>
            )}
            {p.verified_tier >= 2 && (
              <span className="flex items-center gap-0.5 text-[13px] font-bold text-white px-1.5 py-0.5 rounded-full"
                style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}>
                <BadgeCheck size={10} /> Team Verified
              </span>
            )}
          </span>
        </div>

        {/* Title */}
        <h3 className="font-semibold text-(--text-primary) text-sm leading-snug line-clamp-2">
          {p.title}
        </h3>

        {/* Rating + price */}
        <div className="flex items-center justify-between pt-0.5">
          <span>
            {p.avg_rating
              ? <span className="flex items-center gap-0.5">
                  <Star className="w-3.5 h-3.5 fill-gold text-gold" aria-hidden="true" />
                  <span className="text-[13px] font-bold text-(--text-primary)">{p.avg_rating.toFixed(1)}</span>
                  {p.review_count
                    ? <span className="text-[13px] text-(--text-muted)">({p.review_count})</span>
                    : null}
                </span>
              : <span className="text-[13px] font-semibold text-mint">New</span>
            }
          </span>
          <p className="text-[13px] font-bold text-(--text-primary) whitespace-nowrap">
            KES {p.price_per_night.toLocaleString()}
            <span className="text-[13px] font-normal text-(--text-muted)">/night</span>
          </p>
        </div>

      </div>
    </Link>
  );
}

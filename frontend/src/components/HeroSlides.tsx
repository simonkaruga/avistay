/**
 * Home-page hero media: one photo today, a sliding reel of places tomorrow.
 *
 * To add videos of properties, add entries to HERO_SLIDES below, e.g.
 *   { type: "video", src: "/hero/lake-villa.mp4", poster: "/hero/lake-villa.jpg", alt: "Lake Villa deck at sunset" }
 * Keep each clip short (6–10 s), 1280×720, H.264, muted, under ~2 MB — and
 * always give a poster image so the slide shows instantly on slow networks.
 *
 * Behaviour with 2+ slides: slides move in from the right every SLIDE_MS,
 * only the visible video plays, nothing auto-advances for people who prefer
 * reduced motion, and the reel pauses while the tab is hidden.
 */
import { useEffect, useState } from "react";

export type HeroSlide =
  | { type: "image"; src: string; alt: string }
  | { type: "video"; src: string; poster: string; alt: string };

export const HERO_SLIDES: HeroSlide[] = [
  { type: "image", src: "/hero-bg.jpg", alt: "Lake Naivasha at golden hour" },
];

const SLIDE_MS = 7000;

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function HeroSlides({ slides = HERO_SLIDES }: { slides?: HeroSlide[] }) {
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  const many = slides.length > 1;

  useEffect(() => {
    if (!many || prefersReducedMotion()) return;
    const id = window.setInterval(() => {
      if (!document.hidden) setIndex(i => (i + 1) % slides.length);
    }, SLIDE_MS);
    return () => window.clearInterval(id);
  }, [many, slides.length]);

  return (
    <div className="absolute inset-0 overflow-hidden bg-forest" aria-hidden="true">
      {slides.map((s, i) => {
        // Current slide in place; the previous one slides out left, the rest wait on the right.
        const offset = i === index ? 0 : i === (index - 1 + slides.length) % slides.length ? -100 : 100;
        const style = {
          transform: `translateX(${many ? offset : 0}%)`,
          transition: many ? "transform 900ms cubic-bezier(.65,0,.35,1)" : undefined,
          objectPosition: "center 55%",
        };
        const show = { opacity: loaded[i] ? 1 : 0, transition: "opacity .6s ease" };
        return s.type === "image" ? (
          <img key={s.src} src={s.src} alt={s.alt} decoding="async"
            {...{ fetchpriority: i === 0 ? "high" : "low" }} loading={i === 0 ? "eager" : "lazy"}
            onLoad={() => setLoaded(l => ({ ...l, [i]: true }))}
            className="absolute inset-0 w-full h-full object-cover" style={{ ...style, ...show }} />
        ) : (
          <video key={s.src} src={i === index ? s.src : undefined} poster={s.poster}
            autoPlay={i === index} muted loop playsInline preload={i === index ? "auto" : "none"}
            onLoadedData={() => setLoaded(l => ({ ...l, [i]: true }))}
            className="absolute inset-0 w-full h-full object-cover" style={style} />
        );
      })}

      {/* Readability: darken top (nav) and bottom (text), keep the middle bright */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "linear-gradient(to bottom, rgba(0,0,0,.40) 0%, rgba(0,0,0,0) 35%, rgba(0,0,0,.15) 55%, rgba(0,0,0,.70) 100%)",
      }} />

      {many && (
        <div className="absolute bottom-3 right-4 flex gap-1.5">
          {slides.map((s, i) => (
            <span key={s.src} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/50"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

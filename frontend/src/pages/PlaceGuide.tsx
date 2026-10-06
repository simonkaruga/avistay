/**
 * /places/:slug — a guide to one Naivasha destination: photo gallery,
 * what it is, what to do, practical tips, and homes to stay in nearby.
 */
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft, ArrowRight, Camera, ChevronLeft, ChevronRight, Compass, Info, Lightbulb, MapPin, X,
} from "lucide-react";
import { apiJson } from "../utils/api";
import { useSEO } from "../utils/seo";
import { areaLabel } from "../utils/areas";
import PropertyCard, { type PropertyCardData } from "../components/PropertyCard";
import NotFound from "./NotFound";
import { PLACES, placeBySlug, type PlacePhoto } from "../data/places";

function Lightbox({ photos, index, onClose, onIndex }: {
  photos: PlacePhoto[]; index: number; onClose: () => void; onIndex: (i: number) => void;
}) {
  const p = photos[index];
  const go = (d: number) => onIndex((index + d + photos.length) % photos.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  });
  return (
    <div role="dialog" aria-modal="true" aria-label="Photos" className="fixed inset-0 z-1000 bg-black/95 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <span className="text-sm">{index + 1} / {photos.length}</span>
        <button onClick={onClose} aria-label="Close" className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center">
          <X className="w-5 h-5" aria-hidden="true" />
        </button>
      </div>
      <div className="relative flex-1 min-h-0 flex items-center justify-center px-2 md:px-16">
        <img src={p.src} alt={p.caption} className="max-h-full max-w-full object-contain" />
        <button onClick={() => go(-1)} aria-label="Previous photo"
          className="absolute left-2 md:left-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center">
          <ChevronLeft className="w-6 h-6" aria-hidden="true" />
        </button>
        <button onClick={() => go(1)} aria-label="Next photo"
          className="absolute right-2 md:right-4 w-11 h-11 rounded-full bg-white/15 hover:bg-white/25 text-white flex items-center justify-center">
          <ChevronRight className="w-6 h-6" aria-hidden="true" />
        </button>
      </div>
      <div className="px-4 py-3 text-center">
        <p className="text-white text-sm">{p.caption}</p>
      </div>
    </div>
  );
}

export default function PlaceGuide() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const place = placeBySlug(slug);
  const [open, setOpen] = useState<number | null>(null);

  useSEO({
    title: place ? `${place.name}, Naivasha: guide and where to stay` : "Place not found",
    description: place ? `${place.tagline}. Photos, things to do, tips and verified homes to stay near ${place.name}.` : undefined,
    image: place?.photos[0] ? `https://avistay.com${place.photos[0].src}` : undefined,
    url: place ? `/places/${place.slug}` : undefined,
  });

  const stays = useQuery({
    queryKey: ["properties", "area", place?.area],
    queryFn: () => apiJson<PropertyCardData[]>(`/properties/?area=${place!.area}&limit=8`),
    enabled: !!place,
    staleTime: 5 * 60_000,
  });

  if (!place) return <NotFound />;
  const photos = place.photos;
  const others = PLACES.filter(p => p.slug !== place.slug);
  const where = areaLabel(place.area) ?? "Naivasha";

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-24">
      <div className="max-w-6xl mx-auto px-4">
        <button onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          className="flex items-center gap-1.5 text-sm text-(--text-primary) py-3">
          <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
        </button>

        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-teal">
          <Compass className="w-4 h-4" aria-hidden="true" /> Things to do in Naivasha
        </p>
        <h1 className="font-display italic text-3xl md:text-4xl text-(--text-primary) mt-1">{place.name}</h1>
        <p className="text-(--text-muted) mt-1">{place.tagline}</p>

        {/* Gallery: big lead photo + grid; tap any to open full screen */}
        {photos.length > 0 && (
          <section aria-label="Photos" className="mt-5">
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2 md:gap-2.5">
              <button onClick={() => setOpen(0)} aria-label={`Open photo: ${photos[0].caption}`}
                className="relative col-span-3 md:col-span-4 md:row-span-2 aspect-16/10 md:aspect-auto md:h-full overflow-hidden rounded-3xl group">
                <img src={photos[0].src} alt={photos[0].caption} className="absolute inset-0 w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500" />
              </button>
              {photos.slice(1, 5).map((p, i) => (
                <button key={p.src} onClick={() => setOpen(i + 1)} aria-label={`Open photo: ${p.caption}`}
                  className={`relative aspect-square md:aspect-4/3 overflow-hidden rounded-2xl group ${i >= 2 ? "hidden md:block" : ""}`}>
                  <img src={p.sm} alt={p.caption} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                  {i === 3 && photos.length > 5 && (
                    <span className="absolute inset-0 bg-black/55 flex items-center justify-center text-white text-lg font-semibold">+{photos.length - 5} photos</span>
                  )}
                </button>
              ))}
              {/* Phones: last two tiles; the second shows how many more */}
              {photos.length > 3 && (
                <button onClick={() => setOpen(3)} aria-label="See all photos"
                  className="md:hidden relative aspect-square overflow-hidden rounded-2xl">
                  <img src={photos[3].sm} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover" />
                  <span className="absolute inset-0 bg-black/55 flex flex-col items-center justify-center gap-1 text-white text-sm font-semibold text-center">
                    <Camera className="w-5 h-5" aria-hidden="true" /> All {photos.length}
                  </span>
                </button>
              )}
            </div>
          </section>
        )}

        <div className="mt-8 grid md:grid-cols-[1fr_320px] gap-8">
          <div className="space-y-8 min-w-0">
            <section className="space-y-3">
              {place.intro.map((t, i) => <p key={i} className="text-(--text-primary) leading-relaxed">{t}</p>)}
            </section>

            <section>
              <h2 className="text-xl font-semibold text-(--text-primary) mb-3">What to do</h2>
              <ul className="grid sm:grid-cols-2 gap-3">
                {place.todo.map(t => (
                  <li key={t.title} className="bg-(--bg-surface) border border-(--border) rounded-2xl p-4">
                    <p className="font-semibold text-(--text-primary)">{t.title}</p>
                    <p className="text-sm text-(--text-muted) mt-1 leading-relaxed">{t.text}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h2 className="flex items-center gap-2 text-xl font-semibold text-(--text-primary) mb-3">
                <Lightbulb className="w-5 h-5 text-gold" aria-hidden="true" /> Good to know
              </h2>
              <ul className="space-y-2">
                {place.tips.map(t => (
                  <li key={t} className="flex gap-2.5 text-(--text-primary) leading-relaxed">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-forest shrink-0" aria-hidden="true" />{t}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          {/* At a glance + where to stay */}
          <aside className="space-y-4 md:sticky md:top-24 self-start">
            <dl className="bg-(--bg-surface) border border-(--border) rounded-2xl divide-y divide-(--border)">
              <div className="px-4 py-3 flex items-center gap-2 font-semibold text-(--text-primary)">
                <Info className="w-4 h-4 text-teal" aria-hidden="true" /> At a glance
              </div>
              {place.facts.map(f => (
                <div key={f.label} className="px-4 py-3">
                  <dt className="text-xs text-(--text-muted)">{f.label}</dt>
                  <dd className="text-sm text-(--text-primary) mt-0.5">{f.value}</dd>
                </div>
              ))}
            </dl>
            <Link to={`/search?area=${place.area}`}
              className="flex items-center justify-center gap-2 w-full bg-clay hover:bg-(--color-clay-dark) text-white font-semibold py-3 rounded-full">
              <MapPin className="w-4 h-4" aria-hidden="true" /> Find stays near {place.name.replace(" National Park", "").replace(" boat rides", "")}
            </Link>
          </aside>
        </div>

        {/* Homes nearby */}
        {(stays.data?.length ?? 0) > 0 && (
          <section className="mt-10">
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <h2 className="text-xl font-semibold text-(--text-primary)">Stay nearby</h2>
                <p className="text-sm text-(--text-muted)">Verified homes in {where}</p>
              </div>
              <Link to={`/search?area=${place.area}`} className="flex items-center gap-1 text-sm font-semibold text-teal whitespace-nowrap">
                See all <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </Link>
            </div>
            <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none pb-1 md:mx-0 md:px-0 md:grid md:grid-cols-4 md:overflow-visible">
              {stays.data!.slice(0, 8).map((p, i) => (
                <div key={p.id} className={`snap-start shrink-0 w-[46vw] max-w-[230px] md:w-auto md:max-w-none ${i >= 4 ? "md:hidden" : ""}`}>
                  <PropertyCard p={p} />
                </div>
              ))}
            </div>
          </section>
        )}

        {/* More places */}
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-(--text-primary) mb-3">More to explore</h2>
          <div className="-mx-4 px-4 flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-none pb-1 md:mx-0 md:px-0 md:grid md:grid-cols-5 md:overflow-visible">
            {others.map(o => (
              <Link key={o.slug} to={`/places/${o.slug}`}
                className="group snap-start shrink-0 w-[60vw] max-w-[260px] md:w-auto md:max-w-none relative aspect-4/3 rounded-2xl overflow-hidden bg-forest">
                {o.photos[0] && <img src={o.photos[0].sm} alt="" loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />}
                <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
                <p className="absolute bottom-0 inset-x-0 p-3 text-white font-semibold leading-tight">{o.name}</p>
              </Link>
            ))}
          </div>
        </section>

      </div>

      {open !== null && <Lightbox photos={photos} index={open} onClose={() => setOpen(null)} onIndex={setOpen} />}
    </div>
  );
}

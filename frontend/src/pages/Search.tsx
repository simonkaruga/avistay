import { useEffect, useState, useMemo } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { imgSrc } from "../utils/image";
import { useSEO } from "../utils/seo";
import { areaLabel } from "../utils/areas";
import { toggleSaved, isSaved } from "./Saved";
import { PropertyCardData } from "../components/PropertyCard";
import TypeIcon from "../components/TypeIcon";
import RatingBadge, { ratingWord } from "../components/RatingBadge";
import LeafletMap, { MapPin } from "../components/LeafletMap";

import { Award, ArrowLeft, ArrowUpDown, BadgeCheck, CalendarDays, ChevronRight, Heart, LayoutGrid, ListFilter, Map as MapIcon, MapPin as PinIcon, Search as SearchIcon, SearchX } from "lucide-react";
import { api } from "../utils/api";
// ── Types ─────────────────────────────────────────────────────────────────────

type SortKey = "recommended" | "price_asc" | "price_desc" | "rating";


/** Search result: photo left, details middle, rating + price right. */
function SearchCard({ p, query }: { p: PropertyCardData; query?: string }) {
  const [saved, setSaved] = useState(() => isSaved(p.id));
  const isGuestFavourite = (p.avg_rating ?? 0) >= 4.8 && (p.review_count ?? 0) >= 5;
  const img = p.primary_image || p.images?.[0];
  const href = `/property/${p.id}${query ? `?${query}` : ""}`;
  return (
    <Link to={href}
      className="group flex bg-(--bg-surface) border border-(--border) rounded-2xl overflow-hidden hover:shadow-md transition-shadow">
      {/* Photo */}
      <div className="relative w-[38%] max-w-[150px] md:w-60 md:max-w-none shrink-0 min-h-[150px] md:h-60 md:m-3 md:rounded-xl overflow-hidden bg-(--bg-primary)">
        {img
          ? <img src={imgSrc(img, 480)} alt={p.title} loading="lazy" className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
          : <div className="absolute inset-0 bg-linear-to-br from-forest to-teal flex items-center justify-center"><TypeIcon type={p.type} className="w-10 h-10 text-white/30" /></div>}
        <button onClick={e => { e.preventDefault(); e.stopPropagation(); setSaved(toggleSaved(p.id)); }}
          aria-label={saved ? "Remove from saved" : "Save"} aria-pressed={saved}
          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
          <Heart className="w-4 h-4" fill={saved ? "#ef4444" : "none"} stroke={saved ? "#ef4444" : "#333"} aria-hidden="true" />
        </button>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 p-3 md:p-4 md:pl-1 flex flex-col md:flex-row md:gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-(--text-primary) leading-snug line-clamp-2 md:text-lg group-hover:text-forest">{p.title}</h3>
          <p className="flex items-center gap-1 text-xs md:text-sm text-(--text-muted) mt-1">
            <PinIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {areaLabel(p.area) ? `${areaLabel(p.area)}, ` : ""}Naivasha
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-2">
            <span className="inline-flex items-center gap-1 text-xs text-(--text-primary) border border-(--border) rounded-md px-1.5 py-0.5 capitalize">
              <TypeIcon type={p.type} className="w-3.5 h-3.5" /> Entire {p.type}
            </span>
            {p.verified_tier >= 1 && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-forest bg-forest/10 rounded-md px-1.5 py-0.5">
                <BadgeCheck className="w-3.5 h-3.5" aria-hidden="true" /> Verified
              </span>
            )}
            {isGuestFavourite && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-clay bg-clay/10 rounded-md px-1.5 py-0.5">
                <Award className="w-3 h-3" aria-hidden="true" /> Top rated
              </span>
            )}
          </div>
          {(p.min_nights ?? 1) > 1 && <p className="hidden md:block text-xs text-(--text-muted) mt-2">{p.min_nights}-night minimum stay</p>}
        </div>

        {/* Rating + price */}
        <div className="flex md:flex-col items-end md:justify-between gap-2 mt-3 md:mt-0 md:w-44 shrink-0 md:text-right">
          {p.avg_rating ? (
            <div className="flex items-center gap-2 order-2 md:order-1">
              <span className="hidden md:block text-right">
                <span className="block text-sm font-semibold text-(--text-primary)">{ratingWord(p.avg_rating)}</span>
                <span className="block text-xs text-(--text-muted)">{p.review_count ?? 0} review{p.review_count === 1 ? "" : "s"}</span>
              </span>
              <RatingBadge value={p.avg_rating} />
            </div>
          ) : (
            <span className="order-2 md:order-1 text-xs font-semibold text-teal bg-mint/15 px-2 py-0.5 rounded-full">New</span>
          )}
          <div className="order-1 md:order-2 flex-1 md:flex-none">
            <p className="text-base md:text-xl font-bold text-(--text-primary) whitespace-nowrap">KES {p.price_per_night.toLocaleString()}</p>
            <p className="text-xs text-(--text-muted)">per night</p>
            <span className="hidden md:inline-flex items-center justify-center gap-1 mt-2 bg-clay group-hover:bg-(--color-clay-dark) text-white text-sm font-semibold px-4 py-2 rounded-full">
              View stay <ChevronRight className="w-4 h-4" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

// ── Filter bottom sheet ────────────────────────────────────────────────────────

function FilterSheet({
  minPrice, maxPrice, onMinPrice, onMaxPrice,
  types, onTypes, amenity, onAmenity, onClose,
}: {
  minPrice: string; maxPrice: string;
  onMinPrice: (v: string) => void; onMaxPrice: (v: string) => void;
  types: string[]; onTypes: (t: string[]) => void;
  amenity: string; onAmenity: (v: string) => void;
  onClose: () => void;
}) {
  const ALL_TYPES = ["cottage","villa","house","apartment","conference","campsite"];
  const AMENITY_CHIPS = ["Pool","WiFi","BBQ","Lake view","Kitchen","Parking","Wildlife","Conference"];

  function toggleType(t: string) {
    onTypes(types.includes(t) ? types.filter(x => x !== t) : [...types, t]);
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-xs" onClick={onClose} />
      <div className="relative bg-(--bg-surface) rounded-t-3xl px-5 pt-4 pb-8 space-y-5"
        style={{ animation: "fade-up 0.2s ease-out both" }}>
        {/* Handle */}
        <div className="w-10 h-1 bg-(--border) rounded-full mx-auto" />

        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-(--text-primary)">Filters</h2>
          <button onClick={onClose} className="text-sm text-teal font-medium">Done</button>
        </div>

        {/* Keyword / amenity search */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-(--text-primary)">Search amenities</p>
          <input
            value={amenity}
            onChange={e => onAmenity(e.target.value)}
            placeholder="e.g. pool, wifi, conference, lake view…"
            className="w-full bg-(--bg-primary) border border-(--border) rounded-xl px-3 py-2.5 text-sm text-(--text-primary) outline-hidden focus:border-teal"
          />
          <div className="flex flex-wrap gap-1.5">
            {AMENITY_CHIPS.map(chip => (
              <button key={chip}
                onClick={() => onAmenity(amenity === chip.toLowerCase() ? "" : chip.toLowerCase())}
                className={`px-2.5 py-1 rounded-full text-[13px] font-medium border transition-colors ${
                  amenity === chip.toLowerCase()
                    ? "bg-forest text-white border-forest"
                    : "border-(--border) text-(--text-muted)"
                }`}>
                {chip}
              </button>
            ))}
          </div>
        </div>

        {/* Price range slider */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-(--text-primary)">Price per night (KES)</p>
            <p className="text-xs font-semibold text-teal">
              {minPrice ? `${Number(minPrice).toLocaleString()}` : "0"} to {maxPrice ? `${Number(maxPrice).toLocaleString()}` : "100,000"}
            </p>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-[13px] text-(--text-muted) uppercase tracking-wide">Min</label>
              <input type="range" min={0} max={50000} step={500}
                value={minPrice || 0}
                onChange={e => onMinPrice(e.target.value === "0" ? "" : e.target.value)}
                className="w-full mt-2 accent-forest" />
              <p className="text-[13px] text-(--text-muted) mt-1">KES {Number(minPrice || 0).toLocaleString()}</p>
            </div>
            <div className="flex-1">
              <label className="text-[13px] text-(--text-muted) uppercase tracking-wide">Max</label>
              <input type="range" min={0} max={100000} step={500}
                value={maxPrice || 100000}
                onChange={e => onMaxPrice(e.target.value === "100000" ? "" : e.target.value)}
                className="w-full mt-2 accent-forest" />
              <p className="text-[13px] text-(--text-muted) mt-1">KES {Number(maxPrice || 100000).toLocaleString()}</p>
            </div>
          </div>
          {/* Quick price presets */}
          <div className="flex gap-2 flex-wrap">
            {[["Budget",0,5000],["Mid",5000,15000],["Luxury",15000,0]].map(([label, min, max]) => (
              <button key={label as string}
                onClick={() => { onMinPrice(min ? String(min) : ""); onMaxPrice(max ? String(max) : ""); }}
                className="px-3 py-1 rounded-full text-[13px] font-medium border border-(--border) text-(--text-muted)">
                {label as string}
              </button>
            ))}
          </div>
        </div>

        {/* Property types */}
        <div className="space-y-2">
          <p className="text-sm font-medium text-(--text-primary)">Property type</p>
          <div className="grid grid-cols-3 gap-2">
            {ALL_TYPES.map(t => (
              <button key={t} onClick={() => toggleType(t)}
                className={`py-2.5 rounded-xl text-xs font-medium border capitalize transition-colors ${
                  types.includes(t)
                    ? "bg-forest text-white border-forest"
                    : "border-(--border) text-(--text-muted)"
                }`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <button onClick={() => { onMinPrice(""); onMaxPrice(""); onTypes([]); onAmenity(""); }}
          className="w-full border border-(--border) text-(--text-muted) text-sm py-3 rounded-xl">
          Clear all filters
        </button>
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sort,         setSort]         = useState<SortKey>("recommended");
  const [minPrice,     setMinPrice]     = useState("");
  const [maxPrice,     setMaxPrice]     = useState("");
  const [typeFilters,  setTypeFilters]  = useState<string[]>(() => searchParams.get("type") ? [searchParams.get("type")!] : []);
  const [amenityFilter, setAmenityFilter] = useState("");
  const [showFilters,  setShowFilters]  = useState(false);
  const [showSort,     setShowSort]     = useState(false);
  const [viewMode,     setViewMode]     = useState<"list"|"map">("list");

  const location = searchParams.get("location") ?? "";
  const area     = searchParams.get("area") ?? "";
  const checkIn  = searchParams.get("check_in") ?? "";
  const checkOut = searchParams.get("check_out") ?? "";
  const adults   = Number(searchParams.get("adults")   ?? searchParams.get("guests") ?? "1");
  const children = Number(searchParams.get("children") ?? "0");
  const guests   = String(adults + children);
  const [guestsLocal, setGuestsLocal] = useState(guests);
  useEffect(() => { setGuestsLocal(guests); }, [guests]);   // a new search resets the guest filter

  useSEO({
    title: location ? `Homes in Naivasha · "${location}"` : "Search Naivasha Homes",
    description: "Find and book verified vacation homes, cottages & conference retreats in Naivasha, Kenya.",
  });

  const { data: raw = [], isLoading, isError } = useQuery<PropertyCardData[]>({
    queryKey: ["properties", "search", checkIn, checkOut, location, area],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: "100" });
      if (checkIn)  p.set("check_in",  checkIn);
      if (checkOut) p.set("check_out", checkOut);
      if (location) p.set("location", location);   // matched on the server: name, description, directions, area
      if (area)     p.set("area", area);
      const r = await api(`/properties/?${p.toString()}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    retry: 1,
  });

  const results = useMemo(() => {
    let list = [...raw];
    if (amenityFilter) {
      const kw = amenityFilter.toLowerCase();
      list = list.filter(p =>
        p.title.toLowerCase().includes(kw) ||
        (p as any).description?.toLowerCase().includes(kw) ||
        p.type.toLowerCase().includes(kw)
      );
    }
    if (minPrice) list = list.filter(p => p.price_per_night >= Number(minPrice));
    if (maxPrice) list = list.filter(p => p.price_per_night <= Number(maxPrice));
    if (typeFilters.length) list = list.filter(p => typeFilters.includes(p.type));
    const g = Number(guestsLocal) || (adults + children);
    if (g > 1) list = list.filter(p => !p.max_guests || p.max_guests >= g);
    switch (sort) {
      case "price_asc":  return list.sort((a, b) => a.price_per_night - b.price_per_night);
      case "price_desc": return list.sort((a, b) => b.price_per_night - a.price_per_night);
      case "rating":     return list.sort((a, b) => (b.avg_rating ?? 0) - (a.avg_rating ?? 0));
      default:           return list;
    }
  }, [raw, minPrice, maxPrice, typeFilters, sort, guestsLocal, amenityFilter, adults, children]);

  const activeFilterCount = (minPrice || maxPrice ? 1 : 0) + typeFilters.length + (amenityFilter ? 1 : 0);

  const SORT_LABELS: Record<SortKey, string> = {
    recommended: "Recommended",
    price_asc:   "Price: low to high",
    price_desc:  "Price: high to low",
    rating:      "Top rated",
  };

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-20">

      {/* ── Header ── */}
      <div className="sticky top-0 z-40 bg-(--bg-surface) border-b border-(--border)">
        {/* Search bar row */}
        <div className="flex items-center gap-3 px-4 py-3">
          <button onClick={() => window.history.back()}
            className="w-9 h-9 rounded-full bg-(--bg-primary) flex items-center justify-center shrink-0">
            <ArrowLeft className="w-5 h-5 text-(--text-primary)" strokeWidth={2.5} aria-hidden="true" />
          </button>
          <button className="flex-1 flex items-center gap-2 bg-(--bg-primary) rounded-xl px-3 py-2.5"
            onClick={() => setSearchParams(p => p)}>
            <SearchIcon className="w-4 h-4 text-(--text-muted) shrink-0" aria-hidden="true" />
            <span className="text-sm text-(--text-primary) font-medium truncate">
              {location || "Naivasha"}
            </span>
            {checkIn && checkOut && (
              <span className="text-xs text-(--text-muted) shrink-0">{checkIn} to {checkOut}</span>
            )}
            {(adults > 1 || children > 0) && (
              <span className="text-xs text-(--text-muted) shrink-0">
                {adults}A · {children}C
              </span>
            )}
          </button>

          {/* Guests stepper */}
          <div className="flex items-center gap-1.5 bg-(--bg-primary) rounded-xl px-2.5 py-1.5 shrink-0">
            <button type="button"
              onClick={() => { const v = String(Math.max(1, Number(guestsLocal) - 1)); setGuestsLocal(v); setSearchParams(p => { p.set("guests", v); return p; }); }}
              className="w-5 h-5 rounded-full border border-(--border) flex items-center justify-center text-(--text-muted) text-xs font-bold">−</button>
            <span className="text-xs font-semibold text-(--text-primary) w-4 text-center">{guestsLocal}</span>
            <button type="button"
              onClick={() => { const v = String(Math.min(20, Number(guestsLocal) + 1)); setGuestsLocal(v); setSearchParams(p => { p.set("guests", v); return p; }); }}
              className="w-5 h-5 rounded-full border border-(--border) flex items-center justify-center text-(--text-muted) text-xs font-bold">+</button>
          </div>
        </div>

        {/* Filter + Sort row */}
        <div className="flex flex-wrap items-center gap-2 px-4 pb-2.5">
          {/* Filters button */}
          <button onClick={() => setShowFilters(true)}
            className={`shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              activeFilterCount > 0
                ? "bg-forest text-white border-forest"
                : "border-(--border) text-(--text-muted) bg-(--bg-surface)"
            }`}>
            <ListFilter className="w-3.5 h-3.5" aria-hidden="true" />
            Filters
            {activeFilterCount > 0 && (
              <span className="bg-white text-forest w-4 h-4 rounded-full text-[12px] font-bold flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* Sort button */}
          <div className="relative">
            <button onClick={() => setShowSort(!showSort)}
              className="shrink-0 whitespace-nowrap flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-(--border) text-(--text-muted) bg-(--bg-surface)">
              <ArrowUpDown className="w-3.5 h-3.5" aria-hidden="true" />
              {SORT_LABELS[sort]}
            </button>
            {showSort && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowSort(false)} />
                <div className="absolute left-0 top-full mt-1 bg-(--bg-surface) border border-(--border) rounded-2xl shadow-xl z-50 w-52 py-1 overflow-hidden">
                  {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                    <button key={k} onClick={() => { setSort(k); setShowSort(false); }}
                      className={`w-full text-left px-4 py-2.5 text-xs font-medium transition-colors ${
                        sort === k ? "bg-forest text-white" : "text-(--text-primary) hover:bg-(--bg-primary)"
                      }`}>
                      {SORT_LABELS[k]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {/* View toggle list/map */}
          <button onClick={() => setViewMode(v => v === "list" ? "map" : "list")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border border-(--border) text-(--text-muted) bg-(--bg-surface) ml-auto shrink-0">
            {viewMode === "list"
              ? <><MapIcon className="w-3.5 h-3.5" aria-hidden="true" />Map</>
              : <><LayoutGrid className="w-3.5 h-3.5" aria-hidden="true" />List</>
            }
          </button>

          {/* Active filter tags */}
          {typeFilters.map(t => (
            <button key={t} onClick={() => setTypeFilters(f => f.filter(x => x !== t))}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[13px] font-semibold bg-forest/15 text-teal border border-teal/30">
              {t} ×
            </button>
          ))}

          {/* Weekend quick filter */}
          {(() => {
            const today = new Date();
            const day = today.getDay();
            const daysToFri = (5 - day + 7) % 7 || 7;
            const fri = new Date(today); fri.setDate(today.getDate() + daysToFri);
            const sun = new Date(fri); sun.setDate(fri.getDate() + 2);
            const friStr = fri.toISOString().split("T")[0];
            const sunStr = sun.toISOString().split("T")[0];
            const isActive = checkIn === friStr && checkOut === sunStr;
            return (
              <button
                onClick={() => setSearchParams(p => {
                  if (isActive) { p.delete("check_in"); p.delete("check_out"); }
                  else { p.set("check_in", friStr); p.set("check_out", sunStr); }
                  return p;
                })}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[13px] font-semibold border transition-colors ${
                  isActive ? "bg-forest text-white border-forest" : "border-(--border) text-(--text-muted) bg-(--bg-surface)"
                }`}>
                <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" /> Weekend
              </button>
            );
          })()}
        </div>
      </div>

      {/* ── Results ── */}
      <div className="px-4 pt-4">
        {/* Result count + date context */}
        {!isLoading && !isError && (
          <div className="mb-3">
            <p className="text-xs text-(--text-muted)">
              <span className="font-semibold text-(--text-primary)">{results.length}</span>{" "}
              {results.length === 1 ? "home" : "homes"} available
              {checkIn && checkOut ? (
                <span className="text-teal font-medium">
                  {" "}· {new Date(checkIn).toLocaleDateString("en-KE",{day:"numeric",month:"short"})} to {new Date(checkOut).toLocaleDateString("en-KE",{day:"numeric",month:"short"})}
                </span>
              ) : " in Naivasha"}
              {location ? ` · "${location}"` : ""}
            </p>
            {checkIn && checkOut && (
              <p className="text-[13px] text-(--text-muted) mt-0.5">
                Homes with existing bookings on those dates are hidden
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="space-y-3">
            {[1,2,3,4,5].map(i => (
              <div key={i} className="flex gap-3 bg-(--bg-surface) rounded-2xl overflow-hidden h-24 animate-pulse">
                <div className="w-28 bg-(--bg-primary)" />
                <div className="flex-1 py-3 pr-3 space-y-2">
                  <div className="h-3 bg-(--bg-primary) rounded-full w-3/4" />
                  <div className="h-3 bg-(--bg-primary) rounded-full w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error / empty */}
        {viewMode === "list" && !isLoading && (isError || results.length === 0) && (
          <div className="flex flex-col items-center py-20 text-center space-y-3">
            <div className="w-14 h-14 rounded-full bg-(--bg-surface) flex items-center justify-center"><SearchX className="w-6 h-6 text-(--text-muted)" aria-hidden="true" /></div>
            <p className="font-semibold text-(--text-primary)">No homes found</p>
            <p className="text-sm text-(--text-muted) max-w-[200px]">Try different dates or remove some filters.</p>
            <button onClick={() => { setMinPrice(""); setMaxPrice(""); setTypeFilters([]); }}
              className="text-teal text-sm font-medium underline">
              Clear filters
            </button>
          </div>
        )}

        {/* Map view */}
        {viewMode === "map" && !isLoading && (
          <>
            {(() => {
              const pins: MapPin[] = results
                .filter(p => p.lat && p.lng)
                .map(p => ({
                  id:    p.id,
                  lat:   p.lat!,
                  lng:   p.lng!,
                  label: `KES ${p.price_per_night.toLocaleString()}`,
                  title: p.title,
                  href:  `/property/${p.id}`,
                }));
              return <LeafletMap pins={pins} height={420} />;
            })()}
            <p className="text-[13px] text-(--text-muted) text-center mt-2">Tap a price pin to view the listing</p>
          </>
        )}

        {/* Results list */}
        {viewMode === "list" && !isLoading && results.length > 0 && (
          <div className="space-y-3">
            {results.map((p, i) => (
              <div key={p.id} style={{ animation: `fade-up 0.25s ease-out ${i * 0.04}s both` }}>
                <SearchCard p={p} query={[checkIn && `check_in=${checkIn}`, checkOut && `check_out=${checkOut}`, `guests=${guests}`].filter(Boolean).join("&")} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter sheet */}
      {showFilters && (
        <FilterSheet
          minPrice={minPrice} maxPrice={maxPrice}
          onMinPrice={setMinPrice} onMaxPrice={setMaxPrice}
          types={typeFilters} onTypes={setTypeFilters}
          amenity={amenityFilter} onAmenity={setAmenityFilter}
          onClose={() => setShowFilters(false)}
        />
      )}
    </div>
  );
}

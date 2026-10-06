import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import PropertyCard, { PropertyCardData } from "../components/PropertyCard";
import SkeletonCard from "../components/SkeletonCard";

import { Heart } from "lucide-react";
import { api } from "../utils/api";
export function getSavedIds(): string[] {
  try { return JSON.parse(localStorage.getItem("saved_properties") ?? "[]"); }
  catch { return []; }
}

export function toggleSaved(id: string): boolean {
  const ids  = getSavedIds();
  const next = ids.includes(id) ? ids.filter(i => i !== id) : [...ids, id];
  localStorage.setItem("saved_properties", JSON.stringify(next));
  window.dispatchEvent(new Event("storage"));
  return next.includes(id);
}

export function isSaved(id: string): boolean {
  return getSavedIds().includes(id);
}

type RawProperty = Omit<PropertyCardData, "images"> & {
  images?: { is_primary: boolean; cloudinary_url: string }[];
};

async function fetchSavedProperties(ids: string[]): Promise<PropertyCardData[]> {
  if (!ids.length) return [];
  const results = await Promise.allSettled(
    ids.map(id => api(`/properties/${id}`).then(r => r.ok ? r.json() : null))
  );
  return results
    .filter((r): r is PromiseFulfilledResult<RawProperty> =>
      r.status === "fulfilled" && r.value !== null)
    .map(r => {
      const { images, ...rest } = r.value;
      return {
        ...rest,
        primary_image: images?.find(i => i.is_primary)?.cloudinary_url
          ?? images?.[0]?.cloudinary_url,
      };
    });
}

export default function Saved() {
  const navigate  = useNavigate();
  const [ids, setIds] = useState<string[]>([]);

  useEffect(() => {
    setIds(getSavedIds());
    const sync = () => setIds(getSavedIds());
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ["saved", ids],
    queryFn: () => fetchSavedProperties(ids),
    enabled: ids.length > 0,
  });

  return (
    <div className="min-h-screen bg-(--bg-primary) pt-header pb-6">

      {/* Header */}
      <div className="sticky top-0 z-40 bg-(--bg-surface) border-b border-(--border) px-4 py-4">
        <h1 className="font-semibold text-(--text-primary) text-lg">Saved homes</h1>
        {ids.length > 0 && (
          <p className="text-xs text-(--text-muted) mt-0.5">{ids.length} saved</p>
        )}
      </div>

      <div className="px-4 pt-5">

        {/* Empty state */}
        {ids.length === 0 && (
          <div className="flex flex-col items-center py-20 text-center space-y-4">
            {/* Animated heart */}
            <div className="relative w-20 h-20">
              <div className="absolute inset-0 rounded-full bg-red-100 dark:bg-red-900/20 animate-ping opacity-40" />
              <div className="relative w-20 h-20 rounded-full bg-red-50 dark:bg-red-900/30 flex items-center justify-center">
                <Heart className="w-10 h-10 text-red-400" fill="currentColor" aria-hidden="true" />
              </div>
            </div>
            <div className="space-y-1">
              <p className="font-semibold text-(--text-primary) text-lg">No saved homes yet</p>
              <p className="text-sm text-(--text-muted) max-w-[220px]">
                Tap the heart on any property to save it here for later.
              </p>
            </div>
            <button onClick={() => navigate("/")}
              className="bg-forest text-white text-sm font-bold px-8 py-3.5 rounded-2xl active:scale-[.98]">
              Browse homes
            </button>
          </div>
        )}

        {/* Loading */}
        {isLoading && ids.length > 0 && (
          <div className="grid grid-cols-2 gap-3">
            {ids.map(id => <SkeletonCard key={id} />)}
          </div>
        )}

        {/* Grid */}
        {data && data.length > 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              {data.map(p => <PropertyCard key={p.id} p={p} />)}
            </div>

            {/* Clear all */}
            <button
              onClick={() => {
                localStorage.removeItem("saved_properties");
                window.dispatchEvent(new Event("storage"));
                setIds([]);
              }}
              className="w-full border border-(--border) text-(--text-muted) text-xs py-3 rounded-xl font-medium">
              Clear all saved
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

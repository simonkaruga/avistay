import { Star } from "lucide-react";

/** Avistay's own words for a 5-star average. */
export const ratingWord = (r: number) =>
  r >= 4.8 ? "Outstanding" : r >= 4.5 ? "Excellent" : r >= 4 ? "Great" : r >= 3.5 ? "Good" : "Rated";

/** Gold-star pill — Avistay's rating mark. */
export default function RatingBadge({ value, size = "md" }: { value: number; size?: "sm" | "md" | "lg" }) {
  const cls = size === "lg" ? "text-xl px-3.5 py-1.5 gap-1.5" : size === "sm" ? "text-xs px-2 py-0.5 gap-1" : "text-sm px-2.5 py-1 gap-1";
  const icon = size === "lg" ? "w-5 h-5" : "w-3.5 h-3.5";
  return (
    <span className={`inline-flex items-center rounded-full bg-gold/15 ring-1 ring-gold/50 font-bold text-(--text-primary) ${cls}`}
      aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <Star className={`${icon} fill-gold text-gold`} aria-hidden="true" />{value.toFixed(1)}
    </span>
  );
}

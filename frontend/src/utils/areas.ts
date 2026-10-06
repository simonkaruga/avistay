/** Areas of Naivasha — must match NAIVASHA_AREAS in backend/app/models/models.py. */
export const NAIVASHA_AREAS = [
  { slug: "south-lake", label: "South Lake Road" },
  { slug: "north-lake", label: "North Lake & Kongoni" },
  { slug: "hells-gate", label: "Hell's Gate & Olkaria" },
  { slug: "town", label: "Naivasha Town" },
  { slug: "longonot", label: "Longonot & Mai Mahiu" },
] as const;

export const areaLabel = (slug?: string | null) => NAIVASHA_AREAS.find(a => a.slug === slug)?.label;

export const kes = (n: number | null | undefined) => `KES ${(n ?? 0).toLocaleString("en-KE")}`;

export function fmtDate(d: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) {
  if (!d) return "Not set";
  // Date-only strings are Naivasha dates — parse as local, not UTC midnight.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return date.toLocaleDateString("en-KE", opts);
}

export function fmtDateTime(d: string) {
  return new Date(d).toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function nightsBetween(checkIn: string, checkOut: string) {
  return Math.max(0, Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000));
}

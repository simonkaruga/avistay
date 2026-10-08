import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { apiJson } from "../utils/api";

export interface SiteInfo { support_phone: string; support_email: string; site_notice: string | null; card_payments?: boolean; card_surcharge_pct?: number;
  guest_dispute_hours?: number; deposit_hold_days?: number; service_fee_kes?: number; tourism_levy_pct?: number;
  booking_hold_minutes?: number;
  google_login?: boolean }

/** Support contacts and the optional notice set in Admin → Settings. */
export function useSiteInfo() {
  return useQuery({ queryKey: ["site"], queryFn: () => apiJson<SiteInfo>("/site"), staleTime: 5 * 60_000, retry: false });
}

/**
 * Admin → Settings values for page text, with launch defaults while loading.
 * Use this instead of typing fees, windows or contact details into pages.
 */
export function useSite() {
  const d = useSiteInfo().data;
  const phone = d?.support_phone ?? "+254700000000";
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  return {
    supportPhone: phone,
    supportEmail: d?.support_email ?? "hello@naivastay.com",
    whatsapp: (text?: string) => `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`,
    serviceFee: d?.service_fee_kes ?? 300,
    levyPct: d?.tourism_levy_pct ?? 2,
    holdMinutes: plural(d?.booking_hold_minutes ?? 15, "minute"),
    depositDays: plural(d?.deposit_hold_days ?? 2, "day"),
  };
}

/** Host commission % for the Become-a-host page only. Guests never see it. */
export function useHostCommissionPct(): number {
  const { data } = useQuery({
    queryKey: ["site", "hosting"], queryFn: () => apiJson<{ commission_pct: number }>("/site/hosting"),
    staleTime: 5 * 60_000, retry: false,
  });
  return data?.commission_pct ?? 10;
}

/** "24 hours": how long after check-in the host is paid (Admin → Settings). */
export function useProtectionWindow(): string {
  const h = useSiteInfo().data?.guest_dispute_hours ?? 24;
  return h % 24 === 0 && h > 24 ? `${h / 24} days` : `${h} hour${h === 1 ? "" : "s"}`;
}

/** Thin banner across the top of the site, e.g. "M-Pesa is down for maintenance tonight". */
export default function SiteNotice() {
  const notice = useSiteInfo().data?.site_notice;
  if (!notice) return null;
  return (
    <div role="status" className="bg-forest text-white text-xs sm:text-sm px-4 py-2 flex items-center justify-center gap-2 text-center">
      <Info className="w-4 h-4 shrink-0" aria-hidden="true" />{notice}
    </div>
  );
}

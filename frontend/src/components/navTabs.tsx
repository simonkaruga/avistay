/**
 * The main sections, shared by the top bar (computers/tablets) and the
 * bottom tabs (phones), so both always show the same places.
 */
import { useQuery } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import { CalendarDays, CircleUserRound, Heart, House, LayoutDashboard, Search, ShieldCheck } from "lucide-react";
import { api } from "../utils/api";

export interface NavTab {
  to: string;
  label: string;
  Icon: (props: { active: boolean; size?: number }) => JSX.Element;
}

/** Lucide icon with an active state: heavier stroke + soft tint fill. */
function navIcon(Icon: LucideIcon, activeColor?: string) {
  return function NavIcon({ active, size = 24 }: { active: boolean; size?: number }) {
    return (
      <Icon width={size} height={size} aria-hidden="true"
        strokeWidth={active ? 2.5 : 2}
        stroke={active && activeColor ? activeColor : "currentColor"}
        fill={active ? (activeColor ?? "currentColor") : "none"}
        fillOpacity={active ? (activeColor ? 1 : 0.15) : 0} />
    );
  };
}

const EXPLORE: NavTab = { to: "/", label: "Explore", Icon: navIcon(House) };
const SEARCH: NavTab = { to: "/search", label: "Search", Icon: navIcon(Search) };
const SAVED: NavTab = { to: "/saved", label: "Saved", Icon: navIcon(Heart, "#ef4444") };
const TRIPS: NavTab = { to: "/bookings", label: "Trips", Icon: navIcon(CalendarDays) };
const DASHBOARD: NavTab = { to: "/owner", label: "Dashboard", Icon: navIcon(LayoutDashboard) };
const PROFILE: NavTab = { to: "/profile", label: "Profile", Icon: navIcon(CircleUserRound) };
const ADMIN: NavTab = { to: "/admin", label: "Admin", Icon: navIcon(ShieldCheck) };

const GUEST_TABS = [EXPLORE, SEARCH, SAVED, TRIPS, PROFILE];
const HOST_TABS = [EXPLORE, SEARCH, DASHBOARD, TRIPS, PROFILE];
const ADMIN_TABS = [EXPLORE, SEARCH, ADMIN, TRIPS, PROFILE];

function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const r = await api("/auth/me");
      if (!r.ok) throw new Error("unauth");
      return r.json() as Promise<{ role: string }>;
    },
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** Unread guest–host messages, for a badge on the Trips tab (signed-in people only). */
export function useUnreadBadge(): number {
  const { data: me } = useMe();
  const { data } = useQuery({
    queryKey: ["unread-messages"],
    queryFn: async () => {
      const r = await api("/messages/unread");
      return r.ok ? (r.json() as Promise<{ total: number }>) : { total: 0 };
    },
    enabled: !!me,
    refetchInterval: 60_000,
  });
  return data?.total ?? 0;
}

/** Tabs for the signed-in user: hosts get Dashboard, staff get Admin, instead of Saved. */
export function useNavTabs(): NavTab[] {
  const { data: me } = useMe();
  if (me?.role === "admin") return ADMIN_TABS;
  return me?.role === "owner" ? HOST_TABS : GUEST_TABS;
}

/** "/" and "/owner" only match exactly; other tabs also match their sub-pages. */
export const isExactTab = (to: string) => to === "/" || to === "/owner";

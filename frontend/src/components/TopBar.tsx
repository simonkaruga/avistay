import { NavLink, useLocation } from "react-router-dom";
import { User } from "lucide-react";
import { isExactTab, useNavTabs, useUnreadBadge } from "./navTabs";

export default function TopBar() {
  const { pathname } = useLocation();
  const onProfile = pathname === "/profile";
  const tabs = useNavTabs();
  const unread = useUnreadBadge();
  const isHost = tabs.some(t => t.to === "/owner");

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center px-4 border-b border-(--border)"
      style={{
        height: "var(--header-h)",
        background: "rgba(255,255,255,0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
    >
      <NavLink to="/" className="flex items-center gap-2 mr-auto" aria-label="NaivaStay home">
        <img src="/logo-mark.png" alt="" className="shrink-0 h-9 w-auto lg:h-11" />
        <img src="/logo-wordmark.png" alt="NaivaStay" className="shrink-0 h-6 w-auto lg:h-7" />
      </NavLink>

      {/* Computers: main sections on the right of the logo line (phones & tablets: bottom tabs) */}
      <nav aria-label="Main navigation" className="hidden lg:flex items-center gap-1">
        {!isHost && (
          <NavLink to="/list-your-property"
            className="mr-2 px-3.5 py-2 rounded-full text-sm font-semibold text-forest border border-forest/30 hover:bg-forest/5 whitespace-nowrap">
            List your property
          </NavLink>
        )}
        {tabs.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={isExactTab(to)}
            className={({ isActive }) =>
              `flex items-center gap-2 px-3.5 py-2 rounded-full text-sm transition-colors ${
                isActive
                  ? "text-forest font-semibold bg-forest/10"
                  : "text-(--text-muted) font-medium hover:text-(--text-primary) hover:bg-(--bg-primary)"
              }`}>
            {({ isActive }) => <><Icon active={isActive} size={18} />{label}
              {to === "/bookings" && unread > 0 && (
                <span className="min-w-4.5 h-4.5 px-1 rounded-full bg-clay text-white text-[10px] font-bold flex items-center justify-center"
                  aria-label={`${unread} unread messages`}>{unread}</span>
              )}</>}
          </NavLink>
        ))}
      </nav>

      {/* Phones: profile shortcut (the other tabs are at the bottom) */}
      <NavLink
        to="/profile"
        aria-label="Profile"
        className={`lg:hidden w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${
          onProfile
            ? "border-forest text-forest"
            : "border-(--border) text-(--text-muted)"
        }`}
        style={onProfile ? { background: "rgba(31,77,54,0.08)" } : undefined}
      >
        <User className="w-[18px] h-[18px]" />
      </NavLink>
    </header>
  );
}

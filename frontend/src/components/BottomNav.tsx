import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { isExactTab, useNavTabs, useUnreadBadge } from "./navTabs";

/** Phones and tablets; on computers the same tabs live in the top bar. */
export default function BottomNav() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

  const tabs = useNavTabs();
  const unread = useUnreadBadge();

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      if (y < 40)                      setVisible(true);
      else if (y > lastY.current + 8)  setVisible(false);
      else if (y < lastY.current - 8)  setVisible(true);
      lastY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      aria-label="Main navigation"
      style={{
        transform:  visible ? "none" : "translateY(110%)",
        transition: "transform 0.28s cubic-bezier(0.4,0,0.2,1)",
        height: "calc(4rem + var(--sab))",          // the iPhone home indicator gets its own space
        paddingBottom: "var(--sab)",
        background: "rgba(255,255,255,0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
      }}
      className="lg:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-(--border)"
    >
      {tabs.map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={isExactTab(to)}
          aria-label={label}
          className={({ isActive }) =>
            `relative flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
              isActive ? "text-forest" : "text-(--text-muted)"
            }`
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span
                  className="absolute top-1.5 left-1/2 -translate-x-1/2 w-10 h-8 rounded-full"
                  style={{ background: "rgba(31,77,54,0.08)" }}
                  aria-hidden="true"
                />
              )}
              <span className="relative z-10"><Icon active={isActive} /></span>
              {to === "/bookings" && unread > 0 && (
                <span className="absolute top-1 left-1/2 ml-2 min-w-4.5 h-4.5 px-1 rounded-full bg-clay text-white text-[10px] font-bold flex items-center justify-center z-20"
                  aria-label={`${unread} unread messages`}>{unread}</span>
              )}
              <span className={`text-[13px] leading-none relative z-10 ${isActive ? "font-bold" : "font-medium"}`}>
                {label}
              </span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

import { useState, useEffect } from "react";
import { isNativeApp } from "../../native/platform";
import { Routes, Route, NavLink } from "react-router-dom";
import { LayoutDashboard, ListChecks, Briefcase, UserCircle, ChevronRight } from "lucide-react";
import AgentApply from "./AgentApply";
import AgentDashboard from "./AgentDashboard";
import AgentReferrals from "./AgentReferrals";
import AgentProfile from "./AgentProfile";

import { api } from "../../utils/api";
const TABS = [
  { to: "/agent/dashboard",  label: "Dashboard",  Icon: LayoutDashboard },
  { to: "/agent/referrals",  label: "Referrals",  Icon: ListChecks },
  { to: "/agent/properties", label: "Properties", Icon: Briefcase },
  { to: "/agent/profile",    label: "Profile",    Icon: UserCircle },
];

export default function AgentLayout() {
  return (
    <div className="min-h-screen bg-[#fef6e8] flex flex-col">
      {/* Top bar */}
      <header
        className="fixed top-0 left-0 right-0 z-50 h-14 flex items-center justify-between px-4 border-b border-black/5"
        style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(16px)" }}
      >
        <div className="flex items-center gap-2">
          <span
            className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-sm font-bold"
            style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}
          >
            SN
          </span>
          <span className="font-semibold text-nearblack text-sm">Agent Portal</span>
          <span className="ml-1 px-1.5 py-0.5 rounded-sm text-[13px] font-bold text-white"
            style={{ background: "#b4511f" }}>
            AGENT
          </span>
        </div>
        <a
          href="/"
          className="text-xs text-teal flex items-center gap-0.5"
        >
          Guest view <ChevronRight size={12} />
        </a>
      </header>

      {/* Page content */}
      <main className="flex-1 pt-header pb-20">
        <Routes>
          <Route path="/"           element={<AgentDashboard />} />
          <Route path="/apply"      element={<AgentApply />} />
          <Route path="/dashboard"  element={<AgentDashboard />} />
          <Route path="/referrals"  element={<AgentReferrals />} />
          <Route path="/properties" element={<AgentProperties />} />
          <Route path="/profile"    element={<AgentProfile />} />
        </Routes>
      </main>

      {/* Bottom nav */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 border-t border-black/5 flex"
        style={{
          background: "rgba(255,255,255,0.92)",
          backdropFilter: "blur(16px)",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 transition-colors ${
                isActive ? "text-forest" : "text-nearblack/40"
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className="relative flex items-center justify-center w-10 h-7 rounded-full transition-colors"
                  style={isActive ? { background: "rgba(31,77,54,0.08)" } : {}}
                >
                  <Icon size={20} strokeWidth={isActive ? 2 : 1.5} />
                </span>
                <span className="text-[13px] font-medium">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

// Inline property browser (simple list from /api/properties)
function AgentProperties() {
  return (
    <div className="p-4">
      <h2 className="text-lg font-semibold text-nearblack mb-1">Browse Properties</h2>
      <p className="text-sm text-nearblack/60 mb-4">
        Share your referral link with clients. You earn commission on every booking.
      </p>
      <AgentPropertyList />
    </div>
  );
}

// In the app the page origin is capacitor://…, which a client can't open.
const SITE = isNativeApp ? "https://avistay.com" : window.location.origin;

function AgentPropertyList() {
  const [props, setProps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api("/agent/me").then(r => (r.ok ? r.json() : null)).then(a => setCode(a?.ref_code ?? null)).catch(() => {});
  }, []);

  const linkFor = (path: string) => `${SITE}${path}${code ? `?ref=${code}` : ""}`;
  function copy(id: string, link: string) {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(id);
    setTimeout(() => setCopied(c => (c === id ? null : c)), 2000);
  }

  useEffect(() => {
    api("/properties/?limit=50")
      .then(r => r.json())
      .then(d => { setProps(d.properties ?? d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-center py-12 text-nearblack/40 text-sm">Loading...</div>;
  if (!props.length) return <div className="text-center py-12 text-nearblack/40 text-sm">No properties yet.</div>;

  return (
    <div className="flex flex-col gap-3">
      {code ? (
        <div className="bg-white rounded-2xl shadow-xs p-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-nearblack/50">Your referral code</p>
            <p className="font-mono font-bold text-forest text-lg tracking-wider">{code}</p>
            <p className="text-[11px] text-nearblack/50">Clients who book within 30 days of opening your link are credited to you.</p>
          </div>
          <button onClick={() => copy("home", linkFor("/"))}
            className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border border-forest/30 text-forest">
            {copied === "home" ? "Copied!" : "Copy site link"}
          </button>
        </div>
      ) : (
        <div className="bg-amber-50 text-amber-800 rounded-2xl p-3 text-xs">Your links will carry your code once your agent account is approved.</div>
      )}
      {props.map((p: any) => (
        <div key={p.id} className="bg-white rounded-2xl shadow-xs overflow-hidden">
          {p.primary_image && (
            <img src={p.primary_image} alt={p.title} className="w-full h-36 object-cover" />
          )}
          <div className="p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-nearblack text-sm">{p.title}</p>
                <p className="text-xs text-nearblack/50 mt-0.5">KES {(p.price_per_night ?? 0).toLocaleString()} / night</p>
              </div>
              <div className="shrink-0 flex flex-col items-end gap-1.5">
                <button
                  onClick={() => copy(p.id, linkFor(`/property/${p.id}`))}
                  className="text-xs text-white px-3 py-1.5 rounded-full font-medium"
                  style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}
                >
                  {copied === p.id ? "Copied!" : "Copy link"}
                </button>
                <a href={`https://wa.me/?text=${encodeURIComponent(`${p.title}, Naivasha: ${linkFor(`/property/${p.id}`)}`)}`}
                  target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-[#128C7E]">
                  Share on WhatsApp
                </a>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}


import { useEffect, useState } from "react";
import { useSite } from "../../components/SiteNotice";
import { useNavigate } from "react-router-dom";
import { UserCircle, BadgeCheck, Clock, LogOut } from "lucide-react";

import { api, logout } from "../../utils/api";
interface AgentData {
  id: string;
  agency_name: string | null;
  commission_pct: number;
  status: string;
  total_earned: number;
}

export default function AgentProfile() {
  const site = useSite();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api("/agent/me")
      .then(r => r.ok ? r.json() : null)
      .then(d => setAgent(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function signOut() {
    await logout();
    navigate("/");
  }

  if (loading) return <div className="text-center py-12 text-nearblack/40 text-sm">Loading...</div>;

  return (
    <div className="p-4 max-w-lg mx-auto">
      {/* Avatar */}
      <div className="flex flex-col items-center mb-6 pt-4">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-3"
          style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}>
          <UserCircle size={40} className="text-white" />
        </div>
        {agent ? (
          <>
            <h2 className="text-lg font-bold text-nearblack">{agent.agency_name ?? "Agent"}</h2>
            <div className="flex items-center gap-1.5 mt-1">
              {agent.status === "active" ? (
                <BadgeCheck size={14} className="text-forest" />
              ) : (
                <Clock size={14} className="text-clay" />
              )}
              <span className="text-xs font-medium capitalize"
                style={{ color: agent.status === "active" ? "#1f4d36" : "#b4511f" }}>
                {agent.status}
              </span>
            </div>
          </>
        ) : (
          <h2 className="text-lg font-bold text-nearblack">Agent Account</h2>
        )}
      </div>

      {agent && (
        <div className="bg-white rounded-2xl shadow-xs overflow-hidden mb-4">
          <Row label="Commission rate" value={`${agent.commission_pct}%`} />
          <Row label="Total earned" value={`KES ${agent.total_earned.toLocaleString()}`} />
          <Row label="Account status" value={agent.status} last />
        </div>
      )}

      {!agent && (
        <div className="bg-white rounded-2xl shadow-xs p-4 mb-4 text-center">
          <p className="text-sm text-nearblack/60 mb-3">No agent account found.</p>
          <button
            onClick={() => navigate("/agent/apply")}
            className="text-white text-sm font-semibold px-5 py-2.5 rounded-full"
            style={{ background: "linear-gradient(135deg, #1f4d36, #2b6777)" }}
          >
            Apply to be an agent
          </button>
        </div>
      )}

      {/* Support + logout */}
      <div className="bg-white rounded-2xl shadow-xs overflow-hidden">
        <a
          href={site.whatsapp("Hi Avistay Agent Support")}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between px-4 py-3.5 border-b border-black/5"
        >
          <span className="text-sm text-nearblack">WhatsApp support</span>
          <span className="text-xs text-nearblack/40">→</span>
        </a>
        <button
          onClick={signOut}
          className="w-full flex items-center gap-2 px-4 py-3.5 text-red-600 text-sm"
        >
          <LogOut size={16} />
          Sign out
        </button>
      </div>
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between px-4 py-3 ${!last ? "border-b border-black/5" : ""}`}>
      <span className="text-sm text-nearblack/60">{label}</span>
      <span className="text-sm font-semibold text-nearblack capitalize">{value}</span>
    </div>
  );
}

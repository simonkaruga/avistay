import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Banknote, CalendarCheck, Check, CheckCircle2, ClipboardList, FileSpreadsheet, Gavel, History, Home,
  Handshake, LayoutDashboard, LayoutTemplate, Lock, Settings, Tag, Users, X,
} from "lucide-react";
import { api, apiJson } from "../../utils/api";
import {
  AgentsAdmin, AuditAdmin, BookingsAdmin, ListingsAdmin, Overview, PaymentsAdmin, PromosAdmin, ReportsAdmin, SettingsAdmin, UsersAdmin, useMe,
} from "./Console";
import Notice from "../../components/ui/Notice";
import HomeContentAdmin from "./HomeContentAdmin";
import DisputeRow, { type DisputeSummary } from "../../components/DisputeRow";


// ── Disputes — each case is decided on its own thread page ──────────────────

function Disputes() {
  const [filter, setFilter] = useState<"open" | "resolved" | "">("open");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-disputes", filter],
    queryFn: () => apiJson<DisputeSummary[]>(`/disputes/${filter ? `?status=${filter}` : ""}`),
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 font-semibold text-(--text-primary)">
          <Gavel className="w-5 h-5" aria-hidden="true" /> Disputes
        </h1>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)} aria-label="Filter disputes"
          className="bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-1.5 text-sm">
          <option value="open">Open</option>
          <option value="resolved">Decided</option>
          <option value="">All</option>
        </select>
      </div>
      <p className="text-xs text-(--text-muted)">
        Open guest reports freeze the host's payout; open damage claims freeze the guest's deposit. Oldest first is fairest.
      </p>
      {isLoading && <Spinner />}
      {isError && <Notice tone="error">Could not load disputes.</Notice>}
      {data?.length === 0 && (
        <div className="flex flex-col items-center py-12 gap-2 text-(--text-muted)">
          <CheckCircle2 className="w-8 h-8 text-forest" aria-hidden="true" />
          <p className="text-sm">Nothing waiting for a decision</p>
        </div>
      )}
      <ul className="space-y-2">
        {[...(data ?? [])].reverse().map(d => <li key={d.id}><DisputeRow d={d} /></li>)}
      </ul>
    </div>
  );
}

// ── Applications ─────────────────────────────────────────────────────────────

function Applications() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("pending");
  const [reviewing, setReviewing] = useState<string | null>(null);

  const { data: apps, isLoading } = useQuery({
    queryKey: ["admin-applications", filter],
    queryFn: async () => {
      const res = await api(`/applications/admin/list?status_filter=${filter}`);
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
  });

  async function review(id: string, status: "approved" | "rejected", reason?: string) {
    setReviewing(id);
    await api(`/applications/admin/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, rejection_reason: reason ?? null }),
    });
    queryClient.invalidateQueries({ queryKey: ["admin-applications"] });
    setReviewing(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-(--text-primary)">
          Owner applications
          {apps?.length > 0 && filter === "pending" && (
            <span className="ml-2 bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">{apps.length}</span>
          )}
        </h1>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="text-xs border border-(--border) rounded-lg px-2 py-1 bg-(--bg-surface) text-(--text-primary)">
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
      </div>

      {isLoading && <Spinner />}

      {!isLoading && apps?.length === 0 && (
        <div className="text-center py-12 text-(--text-muted)">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-forest" aria-hidden="true" />
          <p className="text-sm">No {filter} applications</p>
        </div>
      )}

      <div className="space-y-3">
        {apps?.map((a: any) => (
          <div key={a.id} className="bg-(--bg-surface) rounded-2xl p-4 space-y-3 border border-(--border)">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-(--text-primary) text-sm">{a.full_name}</p>
                <p className="text-xs text-(--text-muted)">{a.phone} {a.email ? `· ${a.email}` : ""}</p>
              </div>
              <span className={`text-[13px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                a.status === "pending" ? "bg-yellow-100 text-yellow-700" :
                a.status === "approved" ? "bg-green-100 text-green-700" :
                "bg-red-100 text-red-600"
              }`}>{a.status}</span>
            </div>

            <div className="bg-(--bg-primary) rounded-xl p-3 space-y-1 text-xs">
              <div className="flex gap-2"><span className="text-(--text-muted) w-20 shrink-0">National ID</span><span className="font-mono text-(--text-primary) font-semibold">{a.national_id}</span></div>
              <div className="flex gap-2"><span className="text-(--text-muted) w-20 shrink-0">Type</span><span className="text-(--text-primary) capitalize">{a.property_type}</span></div>
              <div className="flex gap-2"><span className="text-(--text-muted) w-20 shrink-0">Location</span><span className="text-(--text-primary)">{a.property_location}</span></div>
              {a.property_description && (
                <div className="flex gap-2"><span className="text-(--text-muted) w-20 shrink-0">Notes</span><span className="text-(--text-primary)">{a.property_description}</span></div>
              )}
              <div className="flex gap-2"><span className="text-(--text-muted) w-20 shrink-0">Applied</span><span className="text-(--text-primary)">{new Date(a.created_at).toLocaleDateString()}</span></div>
            </div>

            {a.status === "pending" && (
              <div className="flex gap-2">
                <button
                  onClick={() => review(a.id, "approved")}
                  disabled={reviewing === a.id}
                  className="flex-1 bg-forest text-white text-xs font-bold py-2.5 rounded-xl disabled:opacity-50">
                  <Check className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> Approve
                </button>
                <button
                  onClick={() => {
                    const reason = prompt("Rejection reason (will be shown to applicant):");
                    if (reason !== null) review(a.id, "rejected", reason);
                  }}
                  disabled={reviewing === a.id}
                  className="flex-1 bg-red-500 text-white text-xs font-bold py-2.5 rounded-xl disabled:opacity-50">
                  <X className="w-3.5 h-3.5 inline -mt-0.5" aria-hidden="true" /> Reject
                </button>
              </div>
            )}
            {a.status === "rejected" && a.rejection_reason && (
              <p className="text-xs text-red-500">Reason: {a.rejection_reason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Admin nav + layout ────────────────────────────────────────────────────────

const adminTabs: { to: string; label: string; Icon: LucideIcon; end?: boolean }[] = [
  { to: "/admin", label: "Overview", Icon: LayoutDashboard, end: true },
  { to: "/admin/bookings", label: "Bookings", Icon: CalendarCheck },
  { to: "/admin/payments", label: "Payments", Icon: Banknote },
  { to: "/admin/disputes", label: "Disputes", Icon: Gavel },
  { to: "/admin/listings", label: "Listings", Icon: Home },
  { to: "/admin/applications", label: "Host applications", Icon: ClipboardList },
  { to: "/admin/users", label: "People", Icon: Users },
  { to: "/admin/agents", label: "Agents", Icon: Handshake },
  { to: "/admin/promos", label: "Promo codes", Icon: Tag },
  { to: "/admin/home", label: "Home page", Icon: LayoutTemplate },
  { to: "/admin/reports", label: "Levy report", Icon: FileSpreadsheet },
  { to: "/admin/audit", label: "Audit log", Icon: History },
  { to: "/admin/settings", label: "Settings", Icon: Settings },
];

export default function AdminLayout() {
  const me = useMe();
  if (me.isLoading) return <Spinner />;
  if (me.data?.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 p-6 text-center bg-(--bg-primary)">
        <Lock className="w-8 h-8 text-(--text-muted)" aria-hidden="true" />
        <p className="text-(--text-primary) font-semibold">Staff only</p>
        <Link to="/login" className="text-sm underline text-teal">Sign in with a staff account</Link>
      </div>
    );
  }
  return (
    <div className="min-h-screen bg-(--bg-primary) md:flex">
      <aside className="sticky top-0 z-40 bg-nearblack md:h-screen md:w-56 md:shrink-0 md:overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3">
          <Link to="/" className="font-display italic text-lg text-mint">Avistay</Link>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{me.data.is_superadmin ? "Super admin" : "Admin"}</span>
        </div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {adminTabs.map(({ to, label, Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              className={({ isActive }) => `flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-medium ${
                isActive ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}>
              <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />{label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="flex-1 min-w-0 px-4 py-5 md:px-8 md:py-8 max-w-5xl">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/bookings" element={<BookingsAdmin />} />
          <Route path="/payments" element={<PaymentsAdmin />} />
          <Route path="/disputes" element={<Disputes />} />
          <Route path="/listings" element={<ListingsAdmin />} />
          <Route path="/applications" element={<Applications />} />
          <Route path="/users" element={<UsersAdmin />} />
          <Route path="/agents" element={<AgentsAdmin />} />
          <Route path="/promos" element={<PromosAdmin />} />
          <Route path="/home" element={<HomeContentAdmin />} />
          <Route path="/reports" element={<ReportsAdmin />} />
          <Route path="/audit" element={<AuditAdmin />} />
          <Route path="/settings" element={<SettingsAdmin />} />
        </Routes>
      </main>
    </div>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-mint border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

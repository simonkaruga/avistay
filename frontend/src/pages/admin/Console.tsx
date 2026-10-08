/**
 * Operator console — everything the team needs to run NaivaStay without a developer.
 * Backend: /api/admin/console/*. Super-admin-only actions are enforced server-side;
 * the UI just hides what the person can't do.
 */
import { useSite } from "../../components/SiteNotice";
import { useState, type ReactNode } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle, Banknote, BadgeCheck, CalendarCheck, Download, Gavel, Home, Lock, Pencil, RotateCcw,
  Search, ShieldCheck, Tag, Users, X,
} from "lucide-react";
import { api, apiJson } from "../../utils/api";
import { NAIVASHA_AREAS } from "../../utils/areas";
import Notice from "../../components/ui/Notice";
import HouseRulesFields, { rulesFromListing, rulesToPayload, type HouseRules } from "../owner/HouseRulesFields";

const C = "/admin/console";
export const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2 text-sm outline-hidden focus:border-teal";
const btn = "inline-flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl disabled:opacity-50";
const btnPrimary = `${btn} bg-forest text-white`;
const btnGhost = `${btn} border border-(--border) text-(--text-primary)`;
const btnDanger = `${btn} bg-red-600 text-white`;
const kes = (n?: number | null) => `KES ${(n ?? 0).toLocaleString()}`;
const when = (iso?: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not set");
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: "medium" }) : "Not set");

/** Who's signed in — drives which super-admin controls are shown. */
export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => apiJson<{ user_id: string; role: string; is_superadmin: boolean }>("/auth/me"), retry: false });
}

// ── Small building blocks ─────────────────────────────────────────────────────

function Page({ title, Icon, actions, children, intro }: { title: string; Icon: LucideIcon; actions?: ReactNode; intro?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-(--text-primary)">
          <Icon className="w-5 h-5 text-forest" aria-hidden="true" />{title}
        </h1>
        {actions}
      </div>
      {intro && <p className="text-xs text-(--text-muted) -mt-2">{intro}</p>}
      {children}
    </section>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="relative block flex-1 min-w-48">
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-(--text-muted)" aria-hidden="true" />
      <input type="search" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} className={`${inputCls} pl-9`} />
    </label>
  );
}

function Pager({ page, setPage, count }: { page: number; setPage: (p: number) => void; count: number }) {
  if (page === 1 && count < 50) return null;
  return (
    <div className="flex items-center justify-center gap-3 text-sm">
      <button className={btnGhost} disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button>
      <span className="text-(--text-muted)">Page {page}</span>
      <button className={btnGhost} disabled={count < 50} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}

function State({ q, empty }: { q: { isLoading: boolean; isError: boolean; error: unknown; data?: unknown[] }; empty: string }) {
  if (q.isLoading) return <p className="text-sm text-(--text-muted) py-8 text-center">Loading…</p>;
  if (q.isError) return <Notice tone="error">{(q.error as Error).message}</Notice>;
  if (q.data && q.data.length === 0) return <p className="text-sm text-(--text-muted) py-8 text-center">{empty}</p>;
  return null;
}

const PILL: Record<string, string> = {
  confirmed: "bg-green-100 text-green-700", completed: "bg-green-100 text-green-700", checked_in: "bg-teal/10 text-teal",
  pending: "bg-yellow-100 text-yellow-800", processing: "bg-yellow-100 text-yellow-800",
  cancelled: "bg-gray-200 text-gray-700", failed: "bg-red-100 text-red-700", banned: "bg-red-100 text-red-700",
  live: "bg-green-100 text-green-700", paused: "bg-gray-200 text-gray-700", admin: "bg-forest/10 text-forest",
};
function Pill({ s }: { s: string }) {
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize whitespace-nowrap ${PILL[s] ?? "bg-(--bg-primary) text-(--text-muted)"}`}>{s.replace("_", " ")}</span>;
}

/** Text prompt that returns null on cancel; keeps reasons mandatory where money moves. */
function ask(question: string, min = 5): string | null {
  const v = window.prompt(question)?.trim();
  if (v == null) return null;
  if (v.length < min) { window.alert(`Please write at least ${min} characters.`); return null; }
  return v;
}

// ── Overview ──────────────────────────────────────────────────────────────────

interface MoneyIn { count: number; amount: number; card_fees?: number }
interface OverviewData {
  guest_payments?: { paystack: "off" | "test" | "live"; last_30_days: { mpesa: MoneyIn; card: MoneyIn } };
  last_30_days:{ bookings: number; room_value: number; revenue: number; levy_collected: number };
  today: { check_ins: number; new_bookings: number };
  needs_attention: { listings_awaiting_approval: number; open_disputes: number; payments_processing: number; payments_failed: number; double_bookings?: number };
  totals: { users: number; hosts: number; live_listings: number };
}

export function Overview() {
  const q = useQuery({ queryKey: ["console-overview"], queryFn: () => apiJson<OverviewData>(`${C}/overview`), refetchInterval: 60_000 });
  const d = q.data;
  const Tile = ({ label, value, to, alert }: { label: string; value: ReactNode; to?: string; alert?: boolean }) => {
    const body = (
      <div className={`rounded-2xl p-4 h-full ${alert ? "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800" : "bg-(--bg-surface)"}`}>
        <p className="text-xs text-(--text-muted) mb-1">{label}</p>
        <p className="text-xl font-bold text-(--text-primary)">{value}</p>
      </div>
    );
    return to ? <Link to={to} className="block">{body}</Link> : body;
  };
  return (
    <Page title="Overview" Icon={Home}>
      {q.isError && <Notice tone="error">{(q.error as Error).message}</Notice>}
      {d && (
        <>
          <h2 className="text-sm font-semibold text-(--text-primary)">Needs attention</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Listings to approve" value={d.needs_attention.listings_awaiting_approval} to="/admin/listings?state=pending" alert={d.needs_attention.listings_awaiting_approval > 0} />
            <Tile label="Open disputes" value={d.needs_attention.open_disputes} to="/admin/disputes" alert={d.needs_attention.open_disputes > 0} />
            <Tile label="Payments failed" value={d.needs_attention.payments_failed} to="/admin/payments?status=failed" alert={d.needs_attention.payments_failed > 0} />
            <Tile label="Payments processing" value={d.needs_attention.payments_processing} to="/admin/payments?status=processing" />
          </div>
          {(d.needs_attention.double_bookings ?? 0) > 0 && (
            <Link to="/admin/audit?event=double_booking" className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span><b>{d.needs_attention.double_bookings} possible double booking{d.needs_attention.double_bookings === 1 ? "" : "s"}</b> in the last 7 days (Airbnb/Booking.com clash). Check with the host.</span>
            </Link>
          )}
          <h2 className="text-sm font-semibold text-(--text-primary)">Today</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Check-ins today" value={d.today.check_ins} />
            <Tile label="New bookings (24h)" value={d.today.new_bookings} />
            <Tile label="Live listings" value={d.totals.live_listings} />
            <Tile label="Hosts · Users" value={`${d.totals.hosts} · ${d.totals.users}`} />
          </div>
          <h2 className="text-sm font-semibold text-(--text-primary)">Last 30 days (paid bookings)</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tile label="Bookings" value={d.last_30_days.bookings} />
            <Tile label="Room value" value={kes(d.last_30_days.room_value)} />
            <Tile label="NaivaStay revenue" value={kes(d.last_30_days.revenue)} />
            <Tile label="Tourism levy to remit" value={kes(d.last_30_days.levy_collected)} to="/admin/reports" />
          </div>
          {d.guest_payments && (() => {
            const g = d.guest_payments, m = g.last_30_days;
            const count = (n: number) => `${n} payment${n === 1 ? "" : "s"}`;
            return (
              <>
                <h2 className="text-sm font-semibold text-(--text-primary)">Guest payments (last 30 days)</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Tile label="Paystack" value={g.paystack === "live" ? "On" : g.paystack === "test" ? "On · test mode" : "Off"} />
                  <Tile label={`Paid by M-Pesa · ${count(m.mpesa.count)}`} value={kes(m.mpesa.amount)} to="/admin/payments?type=charge&method=mpesa" />
                  <Tile label={`Paid with Paystack · ${count(m.card.count)}`} value={kes(m.card.amount)} to="/admin/payments?type=charge&method=card" />
                  <Tile label="Card fees collected" value={kes(m.card.card_fees)} />
                </div>
                {g.paystack === "off" && (
                  <Notice tone="info">Card payments are off, so guests only see M-Pesa. To switch Paystack on, add <code>PAYSTACK_SECRET_KEY</code> to the backend settings on Railway and set the webhook in the Paystack dashboard to <code>https://api.naivastay.com/api/payments/paystack/webhook</code>.</Notice>
                )}
                {g.paystack === "test" && (
                  <Notice tone="info">Paystack is in <b>test mode</b>: card payments use Paystack's test cards and no real money moves. Switch to the live key (<code>sk_live_…</code>) before launch.</Notice>
                )}
              </>
            );
          })()}
        </>
      )}
    </Page>
  );
}

// ── Users ─────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string; name: string | null; phone: string | null; email: string | null; role: string;
  is_superadmin: boolean; commission_pct: number; verified_at: string | null; created_at: string;
}

export function UsersAdmin() {
  const me = useMe().data;
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["console-users", search, role, page],
    queryFn: () => apiJson<UserRow[]>(`${C}/users?${new URLSearchParams({ q: search, role, page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) => apiJson<UserRow>(`${C}/users/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["console-users"] }),
    onError: e => window.alert((e as Error).message),
  });

  function changeRole(u: UserRow, newRole: string) {
    if (newRole === u.role) return;
    const reason = newRole === "banned" ? ask(`Why are you banning ${u.name ?? u.phone}?`) : "";
    if (reason === null) return;
    patch.mutate({ id: u.id, role: newRole, reason: reason || undefined });
  }

  return (
    <Page title="People" Icon={Users} intro="Guests, hosts and staff. Banned people can't sign in or book. Only super admins can grant staff access.">
      <div className="flex flex-wrap gap-2">
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Name, phone or email" />
        <select value={role} onChange={e => { setRole(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Filter by role">
          <option value="">Everyone</option><option value="guest">Guests</option><option value="owner">Hosts</option>
          <option value="admin">Staff</option><option value="banned">Banned</option>
        </select>
      </div>
      <State q={q} empty="No one matches." />
      <ul className="space-y-2">
        {q.data?.map(u => (
          <li key={u.id} className="bg-(--bg-surface) rounded-2xl p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <p className="text-sm font-medium text-(--text-primary) flex items-center gap-1.5">
                {u.name ?? "No name"}
                {u.verified_at && <BadgeCheck className="w-4 h-4 text-teal" aria-label="Verified" />}
                {u.is_superadmin && <span className="text-[10px] font-bold uppercase tracking-wide text-forest">Super admin</span>}
              </p>
              <p className="text-xs text-(--text-muted)">{[u.phone, u.email].filter(Boolean).join(" · ")} · joined {day(u.created_at)}</p>
            </div>
            <select value={u.role} disabled={patch.isPending || u.id === me?.user_id} onChange={e => changeRole(u, e.target.value)}
              className={`${inputCls} w-auto`} aria-label="Role">
              <option value="guest">Guest</option><option value="owner">Host</option>
              <option value="admin" disabled={!me?.is_superadmin && u.role !== "admin"}>Staff (admin)</option>
              <option value="banned">Banned</option>
            </select>
            {u.role === "owner" && (
              <label className="flex items-center gap-1 text-xs text-(--text-muted)">Commission
                <select value={u.commission_pct} onChange={e => patch.mutate({ id: u.id, commission_pct: Number(e.target.value) })} className={`${inputCls} w-auto py-1`}>
                  {Array.from(new Set([0, 5, 7, 10, 12, 15, u.commission_pct])).sort((a, b) => a - b).map(p => <option key={p} value={p}>{p}%</option>)}
                </select>
              </label>
            )}
            <button className={btnGhost} onClick={() => patch.mutate({ id: u.id, verified: !u.verified_at })}>
              {u.verified_at ? "Remove ID check" : "Mark ID checked"}
            </button>
            {me?.is_superadmin && u.role === "admin" && u.id !== me.user_id && (
              <button className={btnGhost} onClick={() => patch.mutate({ id: u.id, is_superadmin: !u.is_superadmin })}>
                <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />{u.is_superadmin ? "Remove super admin" : "Make super admin"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} count={q.data?.length ?? 0} />
    </Page>
  );
}

// ── Listings ──────────────────────────────────────────────────────────────────

interface ListingRow {
  id: string; title: string; type: string; area: string | null; price_per_night: number; active: boolean;
  verified_tier: number; photos: number; cover: string | null; owner_name: string | null; owner_phone: string | null;
  missing?: string[];
}

export function ListingsAdmin() {
  const qc = useQueryClient();
  const initial = new URLSearchParams(location.search).get("state") ?? "";
  const [state, setState] = useState(initial);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["console-listings", search, state, page],
    queryFn: () => apiJson<ListingRow[]>(`${C}/listings?${new URLSearchParams({ q: search, ...(state ? { state } : {}), page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  const setStatus = useMutation({
    mutationFn: ({ id, ...body }: { id: string; active: boolean; verified_tier?: number; reason?: string }) =>
      apiJson(`${C}/listings/${id}/status`, { method: "POST", json: body }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["console-listings"] }); qc.invalidateQueries({ queryKey: ["console-overview"] }); },
    onError: e => window.alert((e as Error).message),
  });

  if (editing) return <ListingEditor id={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ["console-listings"] }); }} />;

  return (
    <Page title="Listings" Icon={Home} intro="Approve new homes, pause problem ones, and fix anything on any listing. Every edit is logged.">
      <div className="flex flex-wrap gap-2">
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Title, host name or phone" />
        <select value={state} onChange={e => { setState(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Filter listings">
          <option value="">All</option><option value="pending">Awaiting approval</option><option value="live">Live</option><option value="paused">Paused</option>
        </select>
      </div>
      <State q={q} empty="No listings here." />
      <ul className="space-y-2">
        {q.data?.map(p => (
          <li key={p.id} className="bg-(--bg-surface) rounded-2xl p-3 flex flex-wrap items-center gap-3">
            <div className="w-16 h-12 rounded-lg bg-(--bg-primary) overflow-hidden shrink-0">
              {p.cover && <img src={p.cover} alt="" className="w-full h-full object-cover" loading="lazy" />}
            </div>
            <div className="flex-1 min-w-48">
              <p className="text-sm font-medium text-(--text-primary)">{p.title}</p>
              <p className="text-xs text-(--text-muted) capitalize">
                {p.type} · {kes(p.price_per_night)}/night · {p.photos} photos · {p.owner_name ?? "Host"} {p.owner_phone}
              </p>
            </div>
            <Pill s={p.active ? "live" : p.verified_tier === 0 ? "pending" : "paused"} />
            {!p.active && (p.missing?.length ?? 0) > 0 && (
              <span className="basis-full text-xs text-amber-700">Can't go live yet: needs {p.missing!.join(" and ")}. Ask the host to add it under More → Tax &amp; licence.</span>
            )}
            <button className={btnGhost} onClick={() => setEditing(p.id)}><Pencil className="w-3.5 h-3.5" aria-hidden="true" />Edit</button>
            <Link to={`/property/${p.id}`} className={btnGhost} target="_blank">View</Link>
            {p.active ? (
              <button className={btnDanger} onClick={() => { const r = ask("Why pause this listing? (the host sees this)"); if (r) setStatus.mutate({ id: p.id, active: false, reason: r }); }}>Pause</button>
            ) : (
              <button className={btnPrimary} disabled={p.photos === 0 || (p.missing?.length ?? 0) > 0}
                title={p.photos === 0 ? "Add photos first" : p.missing?.length ? `Needs ${p.missing.join(" and ")}` : undefined}
                onClick={() => setStatus.mutate({ id: p.id, active: true })}>
                {p.verified_tier === 0 ? "Approve & go live" : "Put live again"}
              </button>
            )}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} count={q.data?.length ?? 0} />
    </Page>
  );
}

const TYPES = ["cottage", "villa", "house", "apartment", "campsite", "conference"];

function ListingEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["console-listing", id], queryFn: () => apiJson<Record<string, unknown>>(`${C}/listings/${id}`) });
  if (q.isLoading) return <p className="text-sm text-(--text-muted) py-8 text-center">Loading…</p>;
  if (q.isError || !q.data) return <Notice tone="error">{(q.error as Error)?.message ?? "Not found"}</Notice>;
  return <ListingForm listing={q.data} onClose={onClose} />;
}

function ListingForm({ listing, onClose }: { listing: Record<string, unknown>; onClose: () => void }) {
  const str = (k: string) => (listing[k] == null ? "" : String(listing[k]));
  const [form, setForm] = useState({
    title: str("title"), type: str("type") || "cottage", price_per_night: str("price_per_night"), area: str("area"),
    description: str("description"), landmark_instructions: str("landmark_instructions"), response_time_hours: str("response_time_hours"),
  });
  const [rules, setRules] = useState<HouseRules>(rulesFromListing(listing));
  const set = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));
  const save = useMutation({
    mutationFn: () => apiJson<{ changed: string[] }>(`${C}/listings/${listing.id}`, {
      method: "PUT",
      json: {
        ...form, price_per_night: Number(form.price_per_night), area: form.area || null,
        description: form.description || null, landmark_instructions: form.landmark_instructions || null,
        response_time_hours: form.response_time_hours ? Number(form.response_time_hours) : null,
        lat: listing.lat ?? null, lng: listing.lng ?? null, what3words: listing.what3words ?? null,
        ...rulesToPayload(rules),
      },
    }),
  });
  const L = ({ label, children }: { label: string; children: ReactNode }) => (
    <label className="block"><span className="block text-xs text-(--text-muted) font-medium mb-1">{label}</span>{children}</label>
  );
  return (
    <Page title={`Edit: ${str("title")}`} Icon={Pencil} actions={<button className={btnGhost} onClick={onClose}><X className="w-3.5 h-3.5" aria-hidden="true" />Close</button>}
      intro="Changes go live straight away and are recorded in the audit log with your name.">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
        <div className="bg-(--bg-surface) rounded-2xl p-4 grid md:grid-cols-2 gap-3">
          <L label="Title"><input required minLength={5} maxLength={200} value={form.title} onChange={e => set("title", e.target.value)} className={inputCls} /></L>
          <L label="Type"><select value={form.type} onChange={e => set("type", e.target.value)} className={`${inputCls} capitalize`}>
            {Array.from(new Set([...TYPES, form.type])).map(t => <option key={t} value={t}>{t}</option>)}</select></L>
          <L label="Price per night (KES)"><input required type="number" min={1} value={form.price_per_night} onChange={e => set("price_per_night", e.target.value)} className={inputCls} /></L>
          <L label="Area"><select value={form.area} onChange={e => set("area", e.target.value)} className={inputCls}>
            <option value="">Not set</option>{NAIVASHA_AREAS.map(a => <option key={a.slug} value={a.slug}>{a.label}</option>)}</select></L>
          <L label="Host response time (hours)"><input type="number" min={1} max={72} value={form.response_time_hours} onChange={e => set("response_time_hours", e.target.value)} className={inputCls} /></L>
          <L label="Directions / landmark"><input value={form.landmark_instructions} onChange={e => set("landmark_instructions", e.target.value)} className={inputCls} /></L>
          <div className="md:col-span-2"><L label="Description"><textarea rows={5} value={form.description} onChange={e => set("description", e.target.value)} className={`${inputCls} resize-y`} /></L></div>
        </div>
        <HouseRulesFields value={rules} onChange={setRules} pricePerNight={Number(form.price_per_night) || undefined} />
        {save.isError && <Notice tone="error">{(save.error as Error).message}</Notice>}
        {save.isSuccess && <Notice tone="success">{save.data.changed.length ? `Saved: ${save.data.changed.join(", ").replace(/_/g, " ")}` : "Nothing changed."}</Notice>}
        <div className="flex gap-2">
          <button type="submit" className={`${btnPrimary} px-5 py-2.5 text-sm`} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</button>
          <button type="button" className={`${btnGhost} px-5 py-2.5 text-sm`} onClick={onClose}>Back to listings</button>
        </div>
      </form>
    </Page>
  );
}

// ── Bookings ──────────────────────────────────────────────────────────────────

interface BookingRow {
  id: string; property_title: string; guest_name: string | null; guest_phone: string | null; check_in: string; check_out: string;
  status: string; total_amount: number; deposit_status: string; mpesa_ref: string | null; cancelled_by: string | null; created_at: string;
}

export function BookingsAdmin() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["console-bookings", search, status, page],
    queryFn: () => apiJson<BookingRow[]>(`${C}/bookings?${new URLSearchParams({ q: search, ...(status ? { status } : {}), page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason, refund }: { id: string; reason: string; refund: "full" | "none" }) =>
      apiJson<{ refund: number }>(`${C}/bookings/${id}/cancel`, { method: "POST", json: { reason, refund } }),
    onSuccess: r => { window.alert(r.refund ? `Cancelled. ${kes(r.refund)} is being refunded to the guest.` : "Cancelled without refund."); qc.invalidateQueries({ queryKey: ["console-bookings"] }); },
    onError: e => window.alert((e as Error).message),
  });

  function doCancel(b: BookingRow) {
    const reason = ask(`Cancel ${b.property_title} for ${b.guest_name ?? b.guest_phone}? Write the reason (kept in the audit log):`);
    if (!reason) return;
    const refund = window.confirm("Refund everything the guest paid?\n\nOK = full refund · Cancel = no refund") ? "full" : "none";
    cancel.mutate({ id: b.id, reason, refund });
  }

  return (
    <Page title="Bookings" Icon={CalendarCheck} intro="Search by guest, phone, home, M-Pesa code or booking ID. Problems after check-in go through Disputes instead.">
      <div className="flex flex-wrap gap-2">
        <SearchBox value={search} onChange={v => { setSearch(v); setPage(1); }} placeholder="Guest, phone, home, M-Pesa code" />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Filter bookings">
          <option value="">All</option>{["pending", "confirmed", "checked_in", "completed", "cancelled"].map(s => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
      </div>
      <State q={q} empty="No bookings match." />
      <ul className="space-y-2">
        {q.data?.map(b => (
          <li key={b.id} className="bg-(--bg-surface) rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-3">
              <button className="flex-1 min-w-48 text-left" onClick={() => setOpen(open === b.id ? null : b.id)} aria-expanded={open === b.id}>
                <p className="text-sm font-medium text-(--text-primary)">{b.property_title}</p>
                <p className="text-xs text-(--text-muted)">
                  {day(b.check_in)} → {day(b.check_out)} · {b.guest_name ?? "Guest"} {b.guest_phone} · <span className="font-mono">{b.id.slice(0, 8).toUpperCase()}</span>
                </p>
              </button>
              <span className="text-sm font-semibold text-(--text-primary)">{kes(b.total_amount)}</span>
              <Pill s={b.status} />
              {["pending", "confirmed"].includes(b.status) && <button className={btnDanger} disabled={cancel.isPending} onClick={() => doCancel(b)}>Cancel</button>}
            </div>
            {open === b.id && <BookingPayments id={b.id} b={b} />}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} count={q.data?.length ?? 0} />
    </Page>
  );
}

function BookingPayments({ id, b }: { id: string; b: BookingRow }) {
  const q = useQuery({ queryKey: ["console-booking-payments", id], queryFn: () => apiJson<PaymentRow[]>(`${C}/bookings/${id}/payments`) });
  return (
    <div className="mt-3 border-t border-(--border) pt-3 text-xs space-y-1">
      <p className="text-(--text-muted)">
        Booked {when(b.created_at)} · deposit {b.deposit_status} {b.mpesa_ref && <>· M-Pesa <span className="font-mono">{b.mpesa_ref}</span></>}
        {b.cancelled_by && <> · cancelled by {b.cancelled_by}</>} · <Link className="underline" to={`/admin/audit?entity=${id}`}>History</Link>
        {" "}· <Link className="underline" to={`/messages/${id}`}>Guest–host messages</Link>
      </p>
      {q.data?.map(p => (
        <p key={p.id} className="flex flex-wrap gap-2 items-center">
          <span className="capitalize w-28">{p.type.replace("_", " ")}</span><span className="w-24">{kes(p.amount)}</span><Pill s={p.status} />
          <span className="font-mono text-(--text-muted)">{p.mpesa_ref}</span><span className="text-(--text-muted)">{when(p.created_at)}</span>
        </p>
      ))}
      {q.data?.length === 0 && <p className="text-(--text-muted)">No payments yet.</p>}
    </div>
  );
}

// ── Payments ──────────────────────────────────────────────────────────────────

interface PaymentRow { id: string; booking_id: string; type: string; amount: number; status: string; mpesa_ref: string | null; created_at: string; method?: string; card_fee?: number }

export function PaymentsAdmin() {
  const me = useMe().data;
  const qc = useQueryClient();
  const initial = new URLSearchParams(location.search);
  const [status, setStatus] = useState(initial.get("status") ?? "");
  const [type, setType] = useState(initial.get("type") ?? "");
  const [method, setMethod] = useState(initial.get("method") ?? "");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["console-payments", status, type, method, page],
    queryFn: () => apiJson<PaymentRow[]>(`${C}/payments?${new URLSearchParams({ ...(status ? { status } : {}), ...(type ? { type } : {}), ...(method ? { method } : {}), page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ["console-payments"] }); qc.invalidateQueries({ queryKey: ["console-overview"] }); };
  const retry = useMutation({ mutationFn: (id: string) => apiJson(`${C}/payments/${id}/retry`, { method: "POST" }), onSuccess: done, onError: e => window.alert((e as Error).message) });
  const resolve = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status: "completed" | "failed"; mpesa_ref?: string; note: string }) => apiJson(`${C}/payments/${id}/resolve`, { method: "POST", json: body }),
    onSuccess: done, onError: e => window.alert((e as Error).message),
  });

  function doResolve(p: PaymentRow) {
    const sent = window.confirm(`Check the ${p.method === "card" ? "Paystack dashboard" : "M-Pesa org portal"} first.\n\nDid ${kes(p.amount)} actually reach the recipient?\nOK = yes, it was paid · Cancel = no, it failed`);
    const ref = sent ? window.prompt(p.method === "card" ? "Paystack refund reference:" : "M-Pesa transaction code (from the portal):")?.trim() : undefined;
    if (sent && !ref) return;
    const note = ask("Note for the audit log (what you checked):");
    if (note) resolve.mutate({ id: p.id, status: sent ? "completed" : "failed", mpesa_ref: ref, note });
  }

  return (
    <Page title="Payments" Icon={Banknote}
      intro={<>Guest payments (M-Pesa or Paystack), payouts to hosts and refunds to guests. Paystack bookings are refunded to the card through Paystack; everything else goes by M-Pesa. <b>Failed</b> ones can be sent again. <b>Processing</b> ones may already have been paid. Check the M-Pesa portal or Paystack dashboard, then record the outcome (super admin).</>}>
      <div className="flex flex-wrap gap-2">
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Status">
          <option value="">Any status</option>{["pending", "processing", "completed", "failed"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <select value={type} onChange={e => { setType(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Type">
          <option value="">Any type</option>
          {[["charge", "Guest payment"], ["payout", "Host payout"], ["refund", "Refund"], ["deposit_refund", "Deposit return"], ["claim_payout", "Damage award"], ["agent_commission", "Agent commission"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={method} onChange={e => { setMethod(e.target.value); setPage(1); }} className={`${inputCls} w-auto`} aria-label="Method">
          <option value="">M-Pesa and Paystack</option>
          <option value="mpesa">M-Pesa only</option>
          <option value="card">Paystack only</option>
        </select>
      </div>
      <State q={q} empty="No payments match." />
      <ul className="space-y-2">
        {q.data?.map(p => (
          <li key={p.id} className="bg-(--bg-surface) rounded-2xl p-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="capitalize w-32 text-(--text-primary) font-medium">{p.type.replace("_", " ")}
              <span className="block text-[11px] font-normal text-(--text-muted) normal-case">{p.method === "card" ? "Paystack (card)" : "M-Pesa"}</span></span>
            <span className="w-28 font-semibold text-(--text-primary)">{kes(p.amount)}
              {!!p.card_fee && <span className="block text-[11px] font-normal text-(--text-muted)">+ {kes(p.card_fee)} card fee</span>}</span>
            <Pill s={p.status} />
            <span className="flex-1 min-w-40 text-xs text-(--text-muted)">
              {when(p.created_at)} · booking <Link className="underline font-mono" to={`/admin/audit?entity=${p.booking_id}`}>{p.booking_id.slice(0, 8).toUpperCase()}</Link>
              {p.mpesa_ref && <> · <span className="font-mono">{p.mpesa_ref}</span></>}
            </span>
            {p.status === "failed" && p.type !== "charge" && (
              <button className={btnPrimary} disabled={retry.isPending} onClick={() => window.confirm(`Send ${kes(p.amount)} again?`) && retry.mutate(p.id)}>
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />Send again
              </button>
            )}
            {["processing", "pending"].includes(p.status) && p.type !== "charge" && (me?.is_superadmin
              ? <button className={btnGhost} disabled={resolve.isPending} onClick={() => doResolve(p)}>Record outcome</button>
              : <span className="text-[11px] text-(--text-muted) flex items-center gap-1"><Lock className="w-3 h-3" aria-hidden="true" />super admin</span>)}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} count={q.data?.length ?? 0} />
    </Page>
  );
}

// ── Promo codes ───────────────────────────────────────────────────────────────

interface Promo { id: string; code: string; discount_kes: number; max_uses: number; used_count: number; expires_at: string | null }

export function PromosAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console-promos"], queryFn: () => apiJson<Promo[]>(`${C}/promo-codes`) });
  const blank = { code: "", discount_kes: "", max_uses: "50", expires_at: "" };
  const [form, setForm] = useState(blank);
  const refresh = () => qc.invalidateQueries({ queryKey: ["console-promos"] });
  const create = useMutation({
    mutationFn: () => apiJson(`${C}/promo-codes`, { method: "POST", json: {
      code: form.code.trim(), discount_kes: Number(form.discount_kes), max_uses: Number(form.max_uses),
      expires_at: form.expires_at ? new Date(`${form.expires_at}T23:59:59`).toISOString() : null } }),
    onSuccess: () => { setForm(blank); refresh(); },
  });
  const end = useMutation({ mutationFn: (id: string) => apiJson(`${C}/promo-codes/${id}/end`, { method: "POST" }), onSuccess: refresh });
  const live = (p: Promo) => p.used_count < p.max_uses && (!p.expires_at || new Date(p.expires_at) > new Date());

  return (
    <Page title="Promo codes" Icon={Tag} intro="A fixed KES discount off the booking. NaivaStay pays for the discount. Hosts still get their full payout.">
      <form className="bg-(--bg-surface) rounded-2xl p-4 grid grid-cols-2 md:grid-cols-5 gap-2 items-end" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        <label className="col-span-2 md:col-span-1"><span className="text-xs text-(--text-muted)">Code</span>
          <input required pattern="[A-Za-z0-9_\-]{3,30}" value={form.code} onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="LAKE1000" className={`${inputCls} font-mono`} /></label>
        <label><span className="text-xs text-(--text-muted)">Discount (KES)</span>
          <input required type="number" min={1} max={100000} value={form.discount_kes} onChange={e => setForm({ ...form, discount_kes: e.target.value })} className={inputCls} /></label>
        <label><span className="text-xs text-(--text-muted)">Uses</span>
          <input required type="number" min={1} value={form.max_uses} onChange={e => setForm({ ...form, max_uses: e.target.value })} className={inputCls} /></label>
        <label><span className="text-xs text-(--text-muted)">Last day (optional)</span>
          <input type="date" value={form.expires_at} onChange={e => setForm({ ...form, expires_at: e.target.value })} className={inputCls} /></label>
        <button type="submit" className={`${btnPrimary} py-2.5`} disabled={create.isPending}>Create code</button>
        {create.isError && <div className="col-span-full"><Notice tone="error">{(create.error as Error).message}</Notice></div>}
      </form>
      <State q={q} empty="No promo codes yet." />
      <ul className="space-y-2">
        {q.data?.map(p => (
          <li key={p.id} className="bg-(--bg-surface) rounded-2xl p-3 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono font-semibold text-(--text-primary) w-32">{p.code}</span>
            <span className="w-28">{kes(p.discount_kes)} off</span>
            <span className="text-xs text-(--text-muted) flex-1">Used {p.used_count} of {p.max_uses}{p.expires_at && ` · until ${day(p.expires_at)}`}</span>
            <Pill s={live(p) ? "live" : "paused"} />
            {live(p) && <button className={btnGhost} onClick={() => window.confirm(`Stop ${p.code} now?`) && end.mutate(p.id)}>End now</button>}
          </li>
        ))}
      </ul>
    </Page>
  );
}

// ── Agents ────────────────────────────────────────────────────────────────────

interface AgentRow {
  id: string; name: string | null; phone: string | null; agency_name: string | null; status: string;
  commission_pct: number; ref_code: string; total_earned: number; referrals: number; created_at: string;
}

export function AgentsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console-agents"], queryFn: () => apiJson<AgentRow[]>(`${C}/agents`) });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: { id: string; status?: string; commission_pct?: number }) =>
      apiJson(`${C}/agents/${id}`, { method: "PATCH", json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["console-agents"] }),
    onError: e => window.alert((e as Error).message),
  });
  return (
    <Page title="Agents" Icon={Users}
      intro="Agents share links with their code. They earn a share of the room price on bookings they bring, paid to their M-Pesa with the host's payout. Approve an agent before their links earn.">
      <State q={q} empty="No agent applications yet." />
      <ul className="space-y-2">
        {q.data?.map(a => (
          <li key={a.id} className="bg-[var(--bg-surface)] rounded-2xl p-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[12rem]">
              <p className="text-sm font-medium text-[var(--text-primary)]">{a.name ?? "No name"}{a.agency_name && <span className="text-[var(--text-muted)]"> · {a.agency_name}</span>}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {a.phone} · code <span className="font-mono">{a.ref_code}</span> · {a.referrals} booking{a.referrals === 1 ? "" : "s"} · earned {kes(a.total_earned)}
              </p>
            </div>
            <Pill s={a.status === "active" ? "live" : a.status === "suspended" ? "paused" : "pending"} />
            <label className="flex items-center gap-1 text-xs text-[var(--text-muted)]">Commission
              <select value={a.commission_pct} onChange={e => patch.mutate({ id: a.id, commission_pct: Number(e.target.value) })} className={`${inputCls} w-auto py-1`}>
                {Array.from(new Set([3, 5, 7, 10, a.commission_pct])).sort((x, y) => x - y).map(p => <option key={p} value={p}>{p}%</option>)}
              </select>
            </label>
            {a.status !== "active"
              ? <button className={btnPrimary} onClick={() => patch.mutate({ id: a.id, status: "active" })}>Approve</button>
              : <button className={btnDanger} onClick={() => window.confirm(`Suspend ${a.name ?? "this agent"}? Their links stop earning.`) && patch.mutate({ id: a.id, status: "suspended" })}>Suspend</button>}
          </li>
        ))}
      </ul>
    </Page>
  );
}

// ── Settings ──────────────────────────────────────────────────────────────────

interface SettingRow { key: string; label: string; help: string; value: string | number; default: string | number; min: number | null; max: number | null }

export function SettingsAdmin() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["console-settings"], queryFn: () => apiJson<{ can_edit: boolean; settings: SettingRow[] }>(`${C}/settings`) });
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: (changes: Record<string, string | number>) => apiJson<{ settings: SettingRow[] }>(`${C}/settings`, { method: "PUT", json: changes }),
    onSuccess: data => { setDraft({}); qc.setQueryData(["console-settings"], { can_edit: true, settings: data.settings }); qc.invalidateQueries({ queryKey: ["site"] }); },
  });
  const canEdit = q.data?.can_edit;
  const changed = Object.keys(draft).length > 0;

  function submit() {
    const rows = q.data?.settings ?? [];
    const changes = Object.fromEntries(Object.entries(draft).map(([k, v]) => {
      const row = rows.find(r => r.key === k);
      return [k, typeof row?.default === "number" ? Number(v) : v];
    }));
    const money = ["service_fee_kes", "tourism_levy_pct", "default_commission_pct", "owner_cancel_penalty_pct"].filter(k => k in changes);
    if (money.length && !window.confirm("These change what guests pay or hosts receive on new bookings from now on. Continue?")) return;
    save.mutate(changes);
  }

  return (
    <Page title="Settings" Icon={ShieldCheck}
      intro={canEdit ? "Changes apply to new bookings within 30 seconds. No deploy needed. Bookings already made keep the prices they were made with." : undefined}>
      {q.data && !canEdit && <Notice tone="info">You can view these. Only a super admin can change them.</Notice>}
      <State q={{ ...q, data: undefined }} empty="" />
      {q.data && (
        <form className="bg-(--bg-surface) rounded-2xl divide-y divide-(--border)" onSubmit={e => { e.preventDefault(); submit(); }}>
          {q.data.settings.map(s => {
            const value = draft[s.key] ?? String(s.value);
            const numeric = typeof s.default === "number";
            return (
              <label key={s.key} className="flex flex-wrap items-center gap-3 p-4">
                <span className="flex-1 min-w-56">
                  <span className="block text-sm font-medium text-(--text-primary)">{s.label}</span>
                  <span className="block text-xs text-(--text-muted)">{s.help}{String(s.value) !== String(s.default) && ` · default ${s.default}`}</span>
                </span>
                {s.key === "site_notice"
                  ? <input value={value} disabled={!canEdit} maxLength={200} onChange={e => setDraft({ ...draft, [s.key]: e.target.value })} className={`${inputCls} md:w-96`} placeholder="No notice" />
                  : <input value={value} disabled={!canEdit} type={numeric ? "number" : "text"} step="any" min={s.min ?? undefined} max={s.max ?? undefined}
                      onChange={e => setDraft({ ...draft, [s.key]: e.target.value })} className={`${inputCls} ${numeric ? "w-32" : "md:w-72"}`} />}
              </label>
            );
          })}
          {canEdit && (
            <div className="p-4 flex flex-wrap items-center gap-3">
              <button type="submit" className={`${btnPrimary} px-5 py-2.5 text-sm`} disabled={!changed || save.isPending}>{save.isPending ? "Saving…" : "Save settings"}</button>
              {changed && <button type="button" className={`${btnGhost} px-5 py-2.5 text-sm`} onClick={() => setDraft({})}>Undo</button>}
              {save.isError && <span className="text-sm text-red-600">{(save.error as Error).message}</span>}
              {save.isSuccess && !changed && <span className="text-sm text-forest">Saved.</span>}
            </div>
          )}
        </form>
      )}
    </Page>
  );
}

// ── Audit log ─────────────────────────────────────────────────────────────────

interface AuditRow { id: string; event: string; entity_id: string; actor: string; details: Record<string, unknown> | null; at: string }

export function AuditAdmin() {
  const [event, setEvent] = useState(new URLSearchParams(location.search).get("event") ?? "");
  const [entity, setEntity] = useState(new URLSearchParams(location.search).get("entity") ?? "");
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["console-audit", event, entity, page],
    queryFn: () => apiJson<AuditRow[]>(`${C}/audit?${new URLSearchParams({ ...(event ? { event } : {}), ...(entity ? { entity } : {}), page: String(page) })}`),
    placeholderData: keepPreviousData,
  });
  return (
    <Page title="Audit log" Icon={Gavel} intro="Every money movement and every staff change, newest first. Records can't be edited or deleted.">
      <div className="flex flex-wrap gap-2">
        <SearchBox value={event} onChange={v => { setEvent(v); setPage(1); }} placeholder="Event (e.g. payout, cancelled, settings)" />
        <input value={entity} onChange={e => { setEntity(e.target.value.trim()); setPage(1); }} placeholder="Booking / user / listing ID" aria-label="Record ID" className={`${inputCls} md:w-80 font-mono`} />
      </div>
      <State q={q} empty="Nothing recorded." />
      <ul className="bg-(--bg-surface) rounded-2xl divide-y divide-(--border) text-xs">
        {q.data?.map(a => (
          <li key={a.id} className="p-3 space-y-0.5">
            <p className="flex flex-wrap gap-x-3">
              <span className="font-semibold text-(--text-primary)">{a.event.replace(/_/g, " ")}</span>
              <span className="text-(--text-muted)">{when(a.at)} · by {a.actor}</span>
              <button className="font-mono text-(--text-muted) underline" onClick={() => setEntity(a.entity_id)}>{a.entity_id.slice(0, 8)}</button>
            </p>
            {a.details && Object.keys(a.details).length > 0 && (
              <p className="text-(--text-muted) wrap-break-word font-mono">{JSON.stringify(a.details)}</p>
            )}
          </li>
        ))}
      </ul>
      <Pager page={page} setPage={setPage} count={q.data?.length ?? 0} />
    </Page>
  );
}

// ── Reports ───────────────────────────────────────────────────────────────────

interface LevyReport { month: string; totals: { bookings: number; room_amount: number; levy: number }; lines: { booking: string; property: string; check_in: string; room_amount: number; levy: number; mpesa_ref: string | null }[] }

export function ReportsAdmin() {
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [month, setMonth] = useState(lastMonth);
  const [downloading, setDownloading] = useState(false);
  const q = useQuery({ queryKey: ["console-levy", month], queryFn: () => apiJson<LevyReport>(`${C}/reports/levy?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });

  async function download() {
    setDownloading(true);
    try {
      const res = await api(`${C}/reports/levy?month=${month}&format=csv`);
      if (!res.ok) throw new Error("Download failed");
      const url = URL.createObjectURL(await res.blob());
      Object.assign(document.createElement("a"), { href: url, download: `naivastay-tourism-levy-${month}.csv` }).click();
      URL.revokeObjectURL(url);
    } catch (e) { window.alert((e as Error).message); } finally { setDownloading(false); }
  }

  return (
    <Page title="Tourism levy report" Icon={Download}
      intro={`${useSite().levyPct}% levy collected on stays that checked in during the month (cancelled stays excluded). Declare and pay it to the Tourism Fund by the 20th of the following month.`}>
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${inputCls} w-auto`} aria-label="Month" />
        <button className={`${btnPrimary} py-2.5`} onClick={download} disabled={downloading || !q.data?.lines.length}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" />{downloading ? "Preparing…" : "Download CSV"}
        </button>
      </div>
      {q.isError && <Notice tone="error">{(q.error as Error).message}</Notice>}
      {q.data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            {[["Stays", q.data.totals.bookings], ["Room value", kes(q.data.totals.room_amount)], ["Levy to remit", kes(q.data.totals.levy)]].map(([l, v]) => (
              <div key={l as string} className="bg-(--bg-surface) rounded-2xl p-4"><p className="text-xs text-(--text-muted)">{l}</p><p className="text-lg font-bold text-(--text-primary)">{v}</p></div>
            ))}
          </div>
          {q.data.lines.length === 0
            ? <p className="text-sm text-(--text-muted) text-center py-6">No stays that month.</p>
            : (
              <div className="overflow-x-auto bg-(--bg-surface) rounded-2xl">
                <table className="w-full text-xs">
                  <thead className="text-left text-(--text-muted)"><tr>{["Booking", "Home", "Check-in", "Room", "Levy", "M-Pesa"].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-(--border) text-(--text-primary)">
                    {q.data.lines.map(l => (
                      <tr key={l.booking}><td className="p-3 font-mono">{l.booking}</td><td className="p-3">{l.property}</td><td className="p-3">{day(l.check_in)}</td>
                        <td className="p-3">{kes(l.room_amount)}</td><td className="p-3 font-semibold">{kes(l.levy)}</td><td className="p-3 font-mono">{l.mpesa_ref}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
      <Notice tone="warning" title="Before launch">
        Confirm with your accountant how NaivaStay registers as the collecting agent for the levy, and that the 2% is charged on the right base.
      </Notice>
    </Page>
  );
}


// ── Withholding tax report ───────────────────────────────────────────────────

interface WhtReport {
  month: string;
  totals: { payouts: number; gross: number; tax_withheld: number; missing_pins: number };
  lines: { date: string; host: string; kra_pin: string; property: string; booking: string; gross: number; tax_withheld: number; paid_to_host: number; status: string }[];
}

export function WithholdingReport() {
  const lastMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); })();
  const [month, setMonth] = useState(lastMonth);
  const q = useQuery({ queryKey: ["console-wht", month], queryFn: () => apiJson<WhtReport>(`${C}/reports/withholding?month=${month}`), enabled: /^\d{4}-\d{2}$/.test(month) });
  async function download() {
    const res = await api(`${C}/reports/withholding?month=${month}&format=csv`);
    if (!res.ok) { window.alert("Download failed"); return; }
    const url = URL.createObjectURL(await res.blob());
    Object.assign(document.createElement("a"), { href: url, download: `naivastay-withholding-tax-${month}.csv` }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <Page title="Withholding tax report" Icon={Download}
      intro="Tax deducted from host payouts in the month, with each host's KRA PIN. File and remit it to KRA (iTax) by the 20th of the following month.">
      <div className="flex flex-wrap items-center gap-2">
        <input type="month" value={month} onChange={e => setMonth(e.target.value)} className={`${inputCls} w-auto`} aria-label="Month" />
        <button className={`${btnPrimary} py-2.5`} onClick={download} disabled={!q.data?.lines.length}>
          <Download className="w-3.5 h-3.5" aria-hidden="true" />Download CSV
        </button>
      </div>
      {q.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[["Payouts", q.data.totals.payouts], ["Gross to hosts", kes(q.data.totals.gross)], ["Tax to remit", kes(q.data.totals.tax_withheld)], ["Hosts without KRA PIN", q.data.totals.missing_pins]].map(([l, v]) => (
              <div key={l as string} className="bg-(--bg-surface) rounded-2xl p-4"><p className="text-xs text-(--text-muted)">{l}</p><p className="text-lg font-bold text-(--text-primary)">{v}</p></div>
            ))}
          </div>
          {q.data.lines.length === 0
            ? <p className="text-sm text-(--text-muted) text-center py-6">No payouts that month.</p>
            : (
              <div className="overflow-x-auto bg-(--bg-surface) rounded-2xl">
                <table className="w-full text-xs">
                  <thead className="text-left text-(--text-muted)"><tr>{["Date", "Host", "KRA PIN", "Home", "Gross", "Tax", "Paid"].map(h => <th key={h} className="p-3 font-medium">{h}</th>)}</tr></thead>
                  <tbody className="divide-y divide-(--border) text-(--text-primary)">
                    {q.data.lines.map(l => (
                      <tr key={l.booking + l.date}><td className="p-3">{day(l.date)}</td><td className="p-3">{l.host}</td>
                        <td className={`p-3 font-mono ${l.kra_pin ? "" : "text-red-600"}`}>{l.kra_pin || "missing"}</td><td className="p-3">{l.property}</td>
                        <td className="p-3">{kes(l.gross)}</td><td className="p-3 font-semibold">{kes(l.tax_withheld)}</td><td className="p-3">{kes(l.paid_to_host)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </Page>
  );
}

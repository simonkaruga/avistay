/**
 * /owner/compliance: the host's KRA PIN and each listing's TRA licence number.
 * Both are required before a listing can go live (Kenyan tax and tourism rules).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, CircleAlert, FileBadge, Landmark, Loader2 } from "lucide-react";
import { apiJson } from "../../utils/api";
import Notice from "../../components/ui/Notice";

export interface ComplianceData {
  kra_pin: string | null;
  payout_phone: string | null;
  withholding_tax_pct: number;
  listings: { id: string; title: string; active: boolean; tra_licence_no: string | null; missing: string[] }[];
}

export const KRA_PIN_PATTERN = /^[A-Z]\d{9}[A-Z]$/;
const inputCls = "w-full bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal";

export function useCompliance() {
  return useQuery({ queryKey: ["owner-compliance"], queryFn: () => apiJson<ComplianceData>("/owner/compliance") });
}

/** Dashboard reminder while anything is missing. */
export function ComplianceBanner() {
  const { data } = useCompliance();
  if (!data) return null;
  const todo = (data.kra_pin ? 0 : 1) + data.listings.filter(l => !l.tra_licence_no).length;
  if (!todo) return null;
  return (
    <Link to="/owner/compliance" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <CircleAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
      <span className="text-sm">
        <span className="block font-semibold text-amber-800">Add your tax and licence details</span>
        <span className="block text-amber-800/90">
          {!data.kra_pin && "Your KRA PIN"}{!data.kra_pin && todo > 1 && " and "}
          {todo - (data.kra_pin ? 0 : 1) > 0 && `${todo - (data.kra_pin ? 0 : 1)} TRA licence number${todo - (data.kra_pin ? 0 : 1) === 1 ? "" : "s"}`}
          {" "}needed before your listings can go live.
        </span>
      </span>
    </Link>
  );
}

function LicenceRow({ l }: { l: ComplianceData["listings"][number] }) {
  const qc = useQueryClient();
  const [value, setValue] = useState(l.tra_licence_no ?? "");
  const save = useMutation({
    mutationFn: () => apiJson(`/owner/properties/${l.id}/licence`, { method: "PUT", json: { tra_licence_no: value } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["owner-compliance"] }),
  });
  return (
    <li className="bg-(--bg-surface) rounded-2xl p-4 space-y-2">
      <p className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
        {l.tra_licence_no ? <BadgeCheck className="w-4 h-4 text-forest" aria-hidden="true" /> : <CircleAlert className="w-4 h-4 text-amber-600" aria-hidden="true" />}
        {l.title}
      </p>
      <div className="flex gap-2">
        <input value={value} onChange={e => setValue(e.target.value.toUpperCase())} maxLength={40}
          placeholder="TRA licence number" aria-label={`TRA licence number for ${l.title}`} className={inputCls} />
        <button onClick={() => save.mutate()} disabled={value.trim().length < 3 || value === (l.tra_licence_no ?? "") || save.isPending}
          className="shrink-0 bg-forest disabled:bg-gray-300 text-white text-sm font-semibold px-4 rounded-xl">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </button>
      </div>
      {save.isError && <p className="text-xs text-red-600" role="alert">{(save.error as Error).message}</p>}
    </li>
  );
}

export function KraPinForm({ current, onSaved }: { current: string | null; onSaved?: () => void }) {
  const qc = useQueryClient();
  const [pin, setPin] = useState(current ?? "");
  const clean = pin.toUpperCase().replace(/\s/g, "");
  const save = useMutation({
    mutationFn: () => apiJson("/owner/compliance", { method: "PUT", json: { kra_pin: clean } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["owner-compliance"] }); onSaved?.(); },
  });
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input value={pin} onChange={e => setPin(e.target.value.toUpperCase())} maxLength={13} autoCapitalize="characters"
          placeholder="e.g. A012345678Z" aria-label="KRA PIN" className={`${inputCls} font-mono tracking-wider`} />
        <button onClick={() => save.mutate()} disabled={!KRA_PIN_PATTERN.test(clean) || clean === current || save.isPending}
          className="shrink-0 bg-forest disabled:bg-gray-300 text-white text-sm font-semibold px-4 rounded-xl">
          {save.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Save"}
        </button>
      </div>
      {pin && !KRA_PIN_PATTERN.test(clean) && <p className="text-xs text-(--text-muted)">A KRA PIN is a letter, 9 digits and a letter, e.g. A012345678Z.</p>}
      {save.isError && <p className="text-xs text-red-600" role="alert">{(save.error as Error).message}</p>}
      {save.isSuccess && <p className="text-xs text-forest">Saved.</p>}
    </div>
  );
}

export default function Compliance() {
  const { data, isLoading, isError } = useCompliance();
  if (isLoading) return <p className="text-center text-sm text-(--text-muted) py-12">Loading…</p>;
  if (isError || !data) return <Notice tone="error">We couldn't load your details. Please try again.</Notice>;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-semibold text-(--text-primary)">Tax &amp; licence</h1>
        <p className="text-xs text-(--text-muted) mt-1">Kenyan law requires these before a home can be listed and paid out.</p>
      </div>

      <section className="bg-(--bg-surface) rounded-2xl p-4 space-y-3">
        <p className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
          <Landmark className="w-4 h-4 text-forest" aria-hidden="true" /> Your KRA PIN
          {data.kra_pin && <BadgeCheck className="w-4 h-4 text-forest" aria-label="Saved" />}
        </p>
        <KraPinForm current={data.kra_pin} />
        <p className="text-xs text-(--text-muted)">
          NaivaStay deducts {data.withholding_tax_pct}% withholding tax from each payout and pays it to KRA on your behalf.
          It shows on your KRA account, and you can claim it against your income tax.
        </p>
      </section>

      <section className="space-y-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-(--text-primary)">
          <FileBadge className="w-4 h-4 text-forest" aria-hidden="true" /> Tourism Regulatory Authority licence
        </p>
        <p className="text-xs text-(--text-muted)">One per home, as shown on your TRA certificate. Not registered yet? Apply on the TRA website, then add it here.</p>
        {data.listings.length === 0
          ? <p className="text-sm text-(--text-muted)">Add a listing first.</p>
          : <ul className="space-y-2">{data.listings.map(l => <LicenceRow key={l.id} l={l} />)}</ul>}
      </section>
    </div>
  );
}

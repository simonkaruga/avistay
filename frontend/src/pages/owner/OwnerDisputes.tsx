import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Hammer, ShieldCheck } from "lucide-react";
import { apiJson } from "../../utils/api";
import Notice from "../../components/ui/Notice";
import DisputeRow, { type DisputeSummary } from "../../components/DisputeRow";

/** Reports and claims on the host's bookings — both directions, one list. */
export default function OwnerDisputes() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["disputes"], queryFn: () => apiJson<DisputeSummary[]>("/disputes/"),
  });

  return (
    <div className="space-y-4">
      <h1 className="font-semibold text-(--text-primary)">Problems & damage claims</h1>
      <Notice tone="info">
        To claim for damage, open the booking under <Link to="/owner/bookings" className="underline font-medium">Bookings</Link> and
        tap <span className="inline-flex items-center gap-1 font-medium"><Hammer size={12} aria-hidden="true" />Report damage</span> within 2 days of check-out.
      </Notice>
      {isLoading && <div className="h-24 bg-(--bg-surface) rounded-2xl animate-pulse" />}
      {isError && <Notice tone="error">We couldn't load your cases.</Notice>}
      {data?.length === 0 && (
        <div className="flex flex-col items-center py-12 gap-2 text-center">
          <ShieldCheck className="w-8 h-8 text-forest" aria-hidden="true" />
          <p className="text-sm text-(--text-muted)">No problems reported. Great hosting!</p>
        </div>
      )}
      <ul className="space-y-2">
        {data?.map(d => <li key={d.id}><DisputeRow d={d} /></li>)}
      </ul>
    </div>
  );
}

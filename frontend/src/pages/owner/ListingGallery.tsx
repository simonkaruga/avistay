import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Star, Trash2 } from "lucide-react";
import { apiJson } from "../../utils/api";
import { imgSrc } from "../../utils/image";
import Notice from "../../components/ui/Notice";

interface GalleryImage { id: string; cloudinary_url: string; is_primary: boolean; display_order: number }

const isVideo = (url: string) => url.includes("/video/upload/");

/** Photos already on a listing: remove, reorder, choose the cover. Saves instantly. */
export default function ListingGallery({ propertyId }: { propertyId: string }) {
  const qc = useQueryClient();
  const key = ["listing-images", propertyId];
  const { data: images, isLoading, isError } = useQuery({
    queryKey: key,
    queryFn: () => apiJson<GalleryImage[]>(`/owner/properties/${propertyId}/images`),
  });

  // Optimistic: update the grid immediately, roll back if the server refuses.
  const reorder = useMutation({
    mutationFn: (ids: string[]) => apiJson<GalleryImage[]>(`/owner/properties/${propertyId}/images/order`, {
      method: "PUT", json: { image_ids: ids },
    }),
    onMutate: async ids => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<GalleryImage[]>(key);
      if (prev) qc.setQueryData(key, ids.map(id => prev.find(i => i.id === id)!));
      return { prev };
    },
    onError: (_e, _ids, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiJson(`/owner/images/${id}`, { method: "DELETE" }),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<GalleryImage[]>(key);
      if (prev) qc.setQueryData(key, prev.filter(i => i.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });

  function move(from: number, to: number) {
    if (!images || to < 0 || to >= images.length) return;
    const ids = images.map(i => i.id);
    const [id] = ids.splice(from, 1);
    ids.splice(to, 0, id);
    reorder.mutate(ids);
  }

  if (isLoading) return <div className="grid grid-cols-3 gap-2">{[1, 2, 3].map(i => <div key={i} className="aspect-square rounded-xl bg-(--bg-primary) animate-pulse" />)}</div>;
  if (isError) return <Notice tone="error">Couldn't load your photos.</Notice>;
  if (!images?.length) return <p className="text-sm text-(--text-muted)">No photos yet. Add some below.</p>;

  const busy = reorder.isPending || remove.isPending;
  const err = (reorder.error ?? remove.error) as Error | null;

  return (
    <div className="space-y-2">
      {err && <Notice tone="error">{err.message}</Notice>}
      <ul className="grid grid-cols-3 gap-2" aria-label="Current photos" aria-busy={busy}>
        {images.map((img, i) => (
          <li key={img.id} className={`relative aspect-square rounded-xl overflow-hidden bg-(--bg-primary) ${i === 0 ? "ring-2 ring-forest" : ""}`}>
            {isVideo(img.cloudinary_url)
              ? <video src={img.cloudinary_url} className="w-full h-full object-cover" muted playsInline preload="metadata" />
              : <img src={imgSrc(img.cloudinary_url, 300)} alt={`Listing photo ${i + 1}`} loading="lazy" className="w-full h-full object-cover" />}
            <button type="button" aria-label={`Delete photo ${i + 1}`} disabled={busy}
              onClick={() => { if (confirm("Delete this photo from your listing?")) remove.mutate(img.id); }}
              className="absolute top-1 right-1 w-7 h-7 bg-black/60 rounded-full flex items-center justify-center">
              <Trash2 size={13} className="text-white" />
            </button>
            {i === 0 ? (
              <span className="absolute bottom-0 inset-x-0 text-center text-[11px] bg-forest text-white py-1 font-semibold">Cover photo</span>
            ) : (
              <div className="absolute bottom-1 inset-x-1 flex justify-between">
                <button type="button" onClick={() => move(i, i - 1)} disabled={busy} aria-label={`Move photo ${i + 1} earlier`}
                  className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center"><ChevronLeft size={14} className="text-white" /></button>
                <button type="button" onClick={() => move(i, 0)} disabled={busy} aria-label={`Make photo ${i + 1} the cover`}
                  className="h-7 px-2 bg-black/60 rounded-full flex items-center gap-1 text-white text-[10px] font-semibold"><Star size={11} aria-hidden="true" /> Cover</button>
                <button type="button" onClick={() => move(i, i + 1)} disabled={busy || i === images.length - 1} aria-label={`Move photo ${i + 1} later`}
                  className="w-7 h-7 bg-black/60 rounded-full flex items-center justify-center disabled:opacity-0"><ChevronRight size={14} className="text-white" /></button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {busy && <p className="flex items-center gap-1.5 text-xs text-(--text-muted)"><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Saving…</p>}
    </div>
  );
}

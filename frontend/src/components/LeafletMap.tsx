import { useEffect, useRef } from "react";
import { loadLeaflet, OSM_ATTRIBUTION, OSM_TILES } from "../utils/leaflet";
import type { Map as LMap, Marker } from "leaflet";

export interface MapPin {
  id: string;
  lat: number;
  lng: number;
  label: string;
  title: string;
  href: string;
}

interface Props {
  pins: MapPin[];
  height?: number;
  single?: boolean;
}

export default function LeafletMap({ pins, height = 340, single = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<LMap | null>(null);
  const markersRef   = useRef<Marker[]>([]);

  useEffect(() => {
    if (!containerRef.current || pins.length === 0) return;

    loadLeaflet().then(L => {
      if (!mapRef.current) {
        mapRef.current = L.map(containerRef.current!, { zoomControl: true });
        L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(mapRef.current);
      }

      const map = mapRef.current;
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      pins.forEach(pin => {
        const marker = single
          ? L.marker([pin.lat, pin.lng]).addTo(map)
          : L.marker([pin.lat, pin.lng], {
              icon: L.divIcon({
                className: "",
                html: `<div style="background:#1f4d36;color:#fff;font-size:11px;font-weight:700;padding:4px 9px;border-radius:20px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.28);border:2px solid #fff;cursor:pointer;">${pin.label}</div>`,
                iconAnchor: [0, 0],
              }),
            }).addTo(map);

        marker.bindTooltip(pin.title, { direction: "top", offset: [0, -8] });
        marker.on("click", () => { window.location.href = pin.href; });
        markersRef.current.push(marker);
      });

      if (pins.length === 1) {
        map.setView([pins[0].lat, pins[0].lng], 15);
      } else {
        map.fitBounds(
          L.latLngBounds(pins.map(p => [p.lat, p.lng] as [number, number])),
          { padding: [40, 40] }
        );
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(pins), single]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  if (pins.length === 0) return (
    <div className="w-full rounded-2xl border border-(--border) bg-(--bg-surface) flex items-center justify-center text-sm text-(--text-muted)"
      style={{ height }}>
      No location set
    </div>
  );

  return <div ref={containerRef} className="w-full rounded-2xl overflow-hidden border border-(--border)" style={{ height }} />;
}

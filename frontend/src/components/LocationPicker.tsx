import { useEffect, useRef, useState } from "react";
import { loadLeaflet, OSM_ATTRIBUTION, OSM_TILES } from "../utils/leaflet";
import type { Map as LMap, Marker as LMarker } from "leaflet";

import { MapPin } from "lucide-react";
const NAIVASHA_LAT = -0.7127;
const NAIVASHA_LNG = 36.4310;

interface Props {
  lat: string;
  lng: string;
  onChange: (lat: string, lng: string) => void;
}

function parseGoogleMapsUrl(url: string): { lat: number; lng: number } | null {
  try {
    // @lat,lng,zoom — most share links
    const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (at) return { lat: parseFloat(at[1]), lng: parseFloat(at[2]) };

    // ?q=lat,lng
    const q = url.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (q) return { lat: parseFloat(q[1]), lng: parseFloat(q[2]) };

    // ll=lat,lng
    const ll = url.match(/[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (ll) return { lat: parseFloat(ll[1]), lng: parseFloat(ll[2]) };

    return null;
  } catch {
    return null;
  }
}


export default function LocationPicker({ lat, lng, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<LMap | null>(null);
  const markerRef    = useRef<LMarker | null>(null);
  const [open,      setOpen]      = useState(false);
  const [pasteUrl,  setPasteUrl]  = useState("");
  const [urlError,  setUrlError]  = useState("");

  // Initialise map when panel opens
  useEffect(() => {
    if (!open || !containerRef.current || mapRef.current) return;

    loadLeaflet().then(L => {

      const initLat = lat ? parseFloat(lat) : NAIVASHA_LAT;
      const initLng = lng ? parseFloat(lng) : NAIVASHA_LNG;
      const zoom    = lat ? 16 : 13;

      const map = L.map(containerRef.current!, { zoomControl: true });
      L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION }).addTo(map);
      map.setView([initLat, initLng], zoom);
      mapRef.current = map;

      function placeMarker(clickLat: number, clickLng: number) {
        if (markerRef.current) {
          markerRef.current.setLatLng([clickLat, clickLng]);
        } else {
          markerRef.current = L.marker([clickLat, clickLng], { draggable: true }).addTo(map);
          markerRef.current.on("dragend", () => {
            const pos = markerRef.current!.getLatLng();
            onChange(pos.lat.toFixed(6), pos.lng.toFixed(6));
          });
        }
        onChange(clickLat.toFixed(6), clickLng.toFixed(6));
      }

      // Restore existing pin
      if (lat && lng) placeMarker(parseFloat(lat), parseFloat(lng));

      map.on("click", (e: any) => placeMarker(e.latlng.lat, e.latlng.lng));
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep marker in sync when coords change from outside (e.g. URL paste)
  useEffect(() => {
    if (!mapRef.current || !lat || !lng) return;
    const parsedLat = parseFloat(lat);
    const parsedLng = parseFloat(lng);
    if (isNaN(parsedLat) || isNaN(parsedLng)) return;

    import("leaflet").then(L => {
      if (markerRef.current) {
        markerRef.current.setLatLng([parsedLat, parsedLng]);
      } else {
        markerRef.current = L.marker([parsedLat, parsedLng], { draggable: true }).addTo(mapRef.current!);
        markerRef.current.on("dragend", () => {
          const pos = markerRef.current!.getLatLng();
          onChange(pos.lat.toFixed(6), pos.lng.toFixed(6));
        });
      }
      mapRef.current!.setView([parsedLat, parsedLng], 16);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  useEffect(() => () => { mapRef.current?.remove(); mapRef.current = null; }, []);

  function handlePaste() {
    const coords = parseGoogleMapsUrl(pasteUrl.trim());
    if (coords) {
      onChange(String(coords.lat), String(coords.lng));
      setPasteUrl("");
      setUrlError("");
      if (!open) setOpen(true); // auto-open map to confirm
    } else {
      setUrlError("Couldn't read coordinates from this link. Open map and tap your property instead.");
    }
  }

  const hasCoords = lat && lng;

  return (
    <div className="space-y-3">

      {/* Step 1 — paste Google Maps link */}
      <div>
        <p className="text-[13px] text-(--text-muted) mb-1.5">
          Open Google Maps, long-press your property, tap <strong>Share</strong> and paste the link below:
        </p>
        <div className="flex gap-2">
          <input
            type="url"
            value={pasteUrl}
            onChange={e => { setPasteUrl(e.target.value); setUrlError(""); }}
            onKeyDown={e => e.key === "Enter" && (e.preventDefault(), handlePaste())}
            placeholder="https://maps.google.com/..."
            className="flex-1 bg-(--bg-primary) border border-(--border) text-(--text-primary) rounded-xl px-3 py-2.5 text-sm outline-hidden focus:border-teal transition-colors"
          />
          <button type="button" onClick={handlePaste}
            className="px-4 py-2.5 bg-teal text-white text-sm font-semibold rounded-xl shrink-0">
            Set
          </button>
        </div>
        {urlError && <p className="text-red-500 text-xs mt-1.5">{urlError}</p>}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-px bg-(--border)" />
        <span className="text-[12px] text-(--text-muted)">or pick on map</span>
        <div className="flex-1 h-px bg-(--border)" />
      </div>

      {/* Step 2 — interactive map picker */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-center gap-2 border border-(--border) text-(--text-primary) text-sm font-medium py-2.5 rounded-xl transition-colors active:bg-(--bg-surface)"
      >
        <MapPin className="w-4 h-4" aria-hidden="true" />
        {open ? "Close map" : hasCoords ? "Adjust pin on map" : "Tap to place pin"}
      </button>

      {open && (
        <div>
          <p className="text-[12px] text-(--text-muted) mb-2">Tap anywhere on the map to place or move your pin.</p>
          <div ref={containerRef}
            className="w-full rounded-2xl overflow-hidden border border-(--border)"
            style={{ height: 300 }}
          />
        </div>
      )}

      {/* Coordinates confirmed badge */}
      {hasCoords && (
        <div className="flex items-center gap-3 bg-forest/8 border border-forest/20 rounded-xl px-3 py-2.5">
          <MapPin className="w-4 h-4 text-forest shrink-0" fill="currentColor" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-forest">Pin saved</p>
            <p className="text-[11px] text-(--text-muted) font-mono truncate">
              {parseFloat(lat).toFixed(5)}, {parseFloat(lng).toFixed(5)}
            </p>
          </div>
          <a
            href={`https://www.google.com/maps?q=${lat},${lng}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] text-teal font-medium underline shrink-0"
          >
            Verify ↗
          </a>
        </div>
      )}
    </div>
  );
}

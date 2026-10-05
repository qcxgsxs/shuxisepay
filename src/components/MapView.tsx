import { useEffect, useRef } from "react";
import type * as L from "leaflet";

export type MapMarker = { lat: number; lng: number; radius?: number; label: string; color?: string };

/** OpenStreetMap via Leaflet — no API key. Loaded only in the browser. */
export function MapView({
  markers = [], polygon, circle, onClick, height = 360, center,
}: {
  markers?: MapMarker[];
  polygon?: [number, number][];
  circle?: { center: [number, number]; radius: number } | null;
  onClick?: (lat: number, lng: number) => void;
  height?: number;
  center?: [number, number] | null;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const lib = useRef<typeof L | null>(null);
  const clickRef = useRef(onClick);
  clickRef.current = onClick;

  useEffect(() => {
    let dead = false;
    import("leaflet").then((mod) => {
      if (dead || !el.current || map.current) return;
      const Lf = (mod as unknown as { default: typeof L }).default ?? (mod as unknown as typeof L);
      lib.current = Lf;
      const m = Lf.map(el.current).setView(center ?? [24.4798, 118.0894], 13);
      Lf.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap", maxZoom: 19 }).addTo(m);
      m.on("click", (e: L.LeafletMouseEvent) => clickRef.current?.(e.latlng.lat, e.latlng.lng));
      layer.current = Lf.layerGroup().addTo(m);
      map.current = m;
      draw();
    });
    return () => { dead = true; map.current?.remove(); map.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw() {
    const Lf = lib.current, g = layer.current;
    if (!Lf || !g) return;
    g.clearLayers();
    for (const mk of markers) {
      const c = mk.color ?? "#e2554a";
      Lf.circleMarker([mk.lat, mk.lng], { radius: 7, color: "#222", weight: 2, fillColor: c, fillOpacity: 1 }).bindTooltip(mk.label).addTo(g);
      if (mk.radius) Lf.circle([mk.lat, mk.lng], { radius: mk.radius, color: c, weight: 1, fillOpacity: 0.12 }).addTo(g);
    }
    if (polygon && polygon.length) Lf.polygon(polygon, { color: "#4a6ee2", fillOpacity: 0.2 }).addTo(g);
    if (circle) Lf.circle(circle.center, { radius: circle.radius, color: "#4a6ee2", fillOpacity: 0.2 }).addTo(g);
  }
  useEffect(draw);
  useEffect(() => { if (center && map.current) map.current.setView(center); }, [center?.[0], center?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={el} style={{ height }} className="w-full overflow-hidden rounded-lg border-2 border-ink" />;
}

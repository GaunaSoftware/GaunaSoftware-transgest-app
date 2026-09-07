import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

const key = process.env.REACT_APP_MAPTILER_KEY || "";
const style = key
  ? `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(key)}`
  : "https://tiles.openfreemap.org/styles/liberty";
const empty = { type: "FeatureCollection", features: [] };

export default function RouteMapCanvas({ points, geometry, vehicle }) {
  const container = useRef(null);
  const mapRef = useRef(null);
  const fitRef = useRef(() => {});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let map;
    let observer;
    setLoaded(false);
    setError("");
    try {
      map = new maplibregl.Map({ container: container.current, style, center: [-3.7, 40.2], zoom: 5, attributionControl: { compact: true }, cooperativeGestures: true });
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
      map.on("load", () => { setLoaded(true); setError(""); });
      map.on("idle", () => { if (container.current) container.current.dataset.mapIdle = "true"; });
      map.on("movestart", () => { if (container.current) container.current.dataset.mapIdle = "false"; });
      map.on("error", () => setError("No se ha podido cargar parte del mapa. Comprueba la conexion."));
      observer = new ResizeObserver(() => { map.resize(); fitRef.current(); });
      observer.observe(container.current);
    } catch (_) {
      setError("Mapa no disponible. Comprueba la aceleracion grafica del navegador.");
    }
    return () => { observer?.disconnect(); mapRef.current = null; map?.remove(); };
  }, [retry]);

  useEffect(() => {
    const map = mapRef.current;
    if (!loaded || !map) return;
    const line = geometry.map(point => [point.lng, point.lat]);
    const route = line.length >= 2 ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } } : empty;
    const markers = { type: "FeatureCollection", features: points.map((point, index) => ({
      type: "Feature", properties: {
        number: String(point.stopNumber || index + 1), label: point.label || "Parada",
        color: /descarga|destino/.test(point.role || point.tipo || "") ? "#c25616" : "#0f766e",
      }, geometry: { type: "Point", coordinates: [point.lng, point.lat] },
    })) };
    if (vehicle) markers.features.push({ type: "Feature", properties: { number: "V", label: "Vehiculo", color: "#2563eb" }, geometry: { type: "Point", coordinates: [vehicle.lng, vehicle.lat] } });
    if (!map.getSource("pedido-ruta")) {
      map.addSource("pedido-ruta", { type: "geojson", data: route });
      map.addLayer({ id: "pedido-ruta-borde", type: "line", source: "pedido-ruta", paint: { "line-color": "#ffffff", "line-width": 8 } });
      map.addLayer({ id: "pedido-ruta-linea", type: "line", source: "pedido-ruta", paint: { "line-color": "#0f766e", "line-width": 4 } });
    } else {
      map.getSource("pedido-ruta").setData(route);
    }
    const stopMarkers = markers.features.map(feature => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "tg-route-stop-marker";
      button.textContent = feature.properties.number;
      button.title = feature.properties.label;
      button.setAttribute("aria-label", `${feature.properties.number}: ${feature.properties.label}`);
      Object.assign(button.style, { width: "34px", height: "34px", padding: "0", borderRadius: "50%", border: "3px solid white", background: feature.properties.color, color: "white", fontSize: "14px", fontWeight: "700", cursor: "pointer", boxShadow: "0 1px 4px #0005" });
      return new maplibregl.Marker({ element: button })
        .setLngLat(feature.geometry.coordinates)
        .setPopup(new maplibregl.Popup({ offset: 20 }).setText(feature.properties.label))
        .addTo(map);
    });
    const positions = [...line, ...markers.features.map(feature => feature.geometry.coordinates)];
    fitRef.current = () => {
      if (!positions.length) return;
      const bounds = positions.reduce((result, point) => result.extend(point), new maplibregl.LngLatBounds(positions[0], positions[0]));
      map.fitBounds(bounds, { padding: Math.min(55, map.getContainer().clientWidth / 6), maxZoom: 14, duration: 0 });
    };
    fitRef.current();
    return () => stopMarkers.forEach(marker => marker.remove());
  }, [loaded, points, geometry, vehicle]);

  return (
    <div data-map-engine="maplibre">
      <div style={{ position: "relative", height: "clamp(280px, 38vh, 440px)" }}>
        <div ref={container} aria-label="Mapa de la ruta del pedido" style={{ position: "absolute", inset: 0 }} />
        <button type="button" title="Centrar ruta" aria-label="Centrar ruta" onClick={() => fitRef.current()} style={{ position: "absolute", top: 10, left: 10, width: 34, height: 34, background: "white", color: "#20252b", border: "1px solid #bbc5ca", borderRadius: 4, cursor: "pointer", fontSize: 22 }}>&#8982;</button>
      </div>
      {error && <div role="alert" style={{ padding: 10, fontSize: 12 }}>{error} <button type="button" onClick={() => setRetry(value => value + 1)}>Reintentar mapa</button></div>}
    </div>
  );
}

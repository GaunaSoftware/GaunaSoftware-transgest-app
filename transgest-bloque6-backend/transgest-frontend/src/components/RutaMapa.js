import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { calcularRutaGeo } from "../services/api";

const DEFAULT_CENTER = [40.2, -3.7];

function safeCoordinate(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizedPoint(point = {}, index = 0) {
  const lat = safeCoordinate(point.lat ?? point.latitude ?? point.latitud, -90, 90);
  const lng = safeCoordinate(point.lng ?? point.lon ?? point.longitude ?? point.longitud, -180, 180);
  return {
    label: String(point.label || point.nombre || point.direccion || `Parada ${index + 1}`).trim(),
    role: point.tipo || point.role || (index === 0 ? "origen" : "parada"),
    country: point.pais || point.country || "",
    region: point.provincia || point.region || "",
    google_maps_url: point.google_maps_url || "",
    title: point.title || "",
    tone: point.tone || null,
    lat,
    lng,
  };
}

function markerIcon(number, color, label) {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-label", label);
  wrapper.style.cssText = [
    "width:30px", "height:30px", "border-radius:50%", "display:grid", "place-items:center",
    `background:${color}`, "color:#fff", "border:3px solid #fff", "box-shadow:0 2px 8px rgba(15,23,42,.35)",
    "font:800 12px/1 system-ui,sans-serif",
  ].join(";");
  wrapper.textContent = String(number);
  return L.divIcon({ html: wrapper, className: "", iconSize: [30, 30], iconAnchor: [15, 15] });
}

function vehicleIcon() {
  const wrapper = document.createElement("div");
  wrapper.setAttribute("aria-label", "Posicion conocida del vehiculo");
  wrapper.style.cssText = [
    "width:34px", "height:34px", "border-radius:8px", "display:grid", "place-items:center",
    "background:#0f766e", "color:#fff", "border:3px solid #fff", "box-shadow:0 2px 9px rgba(15,23,42,.4)",
    "font:800 15px/1 system-ui,sans-serif",
  ].join(";");
  wrapper.textContent = "V";
  return L.divIcon({ html: wrapper, className: "", iconSize: [34, 34], iconAnchor: [17, 17] });
}

function popupNode(title, label, status) {
  const node = document.createElement("div");
  const heading = document.createElement("strong");
  const text = document.createElement("div");
  const state = document.createElement("small");
  heading.textContent = title;
  text.textContent = label;
  state.textContent = status;
  state.style.display = "block";
  state.style.marginTop = "4px";
  node.append(heading, text, state);
  return node;
}

function providerLabel(route) {
  if (route?.provider === "ors_hgv") return "Ruta para camion";
  if (route?.provider === "osrm") return "Ruta orientativa";
  if (route?.provider === "estimate") return "Distancia estimada";
  return "Ruta calculada";
}

export default function RutaMapa({ points = [], vehiclePosition = null }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const overlayRef = useRef(null);
  const [route, setRoute] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);

  const pointKey = JSON.stringify(points.map((point, index) => normalizedPoint(point, index)));
  const routePoints = useMemo(() => JSON.parse(pointKey), [pointKey]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const standard = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    });
    const relief = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
      maxZoom: 17,
      attribution: "Map data &copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap",
    });
    const map = L.map(containerRef.current, { center: DEFAULT_CENTER, zoom: 5, layers: [standard] });
    L.control.layers({ Estandar: standard, Relieve: relief }, null, { position: "topright" }).addTo(map);
    mapRef.current = map;
    overlayRef.current = L.layerGroup().addTo(map);
    const timer = setTimeout(() => map.invalidateSize(), 80);
    return () => {
      clearTimeout(timer);
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (routePoints.length < 2) {
      setRoute(null);
      setError("El pedido necesita al menos un origen y un destino.");
      return () => { active = false; };
    }
    setLoading(true);
    setError("");
    calcularRutaGeo(routePoints)
      .then(data => {
        if (!active) return;
        if (!data?.ok) throw new Error(data?.error || "No se pudo calcular la ruta");
        setRoute(data);
      })
      .catch(err => {
        if (!active) return;
        setRoute(null);
        setError(err?.message || "No se pudo calcular la ruta.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [pointKey, retry, routePoints]);

  useEffect(() => {
    const map = mapRef.current;
    const overlay = overlayRef.current;
    if (!map || !overlay) return;
    overlay.clearLayers();
    const resolved = Array.isArray(route?.points) ? route.points : routePoints;
    const bounds = [];

    resolved.forEach((point, index) => {
      const lat = safeCoordinate(point.lat, -90, 90);
      const lng = safeCoordinate(point.lng, -180, 180);
      if (lat === null || lng === null) return;
      const original = routePoints[index] || {};
      const color = original.tone?.color || (point.role === "destino" || point.role === "descarga" ? "#f97316" : "#0f766e");
      const title = original.title || (point.role === "destino" || point.role === "descarga" ? `Descarga ${index + 1}` : `Parada ${index + 1}`);
      const status = original.tone?.label || "Planificada";
      L.marker([lat, lng], { icon: markerIcon(index + 1, color, `${title}: ${point.label}`) })
        .bindPopup(popupNode(title, point.label || original.label || "Punto sin nombre", status))
        .addTo(overlay);
      bounds.push([lat, lng]);
    });

    const geometry = Array.isArray(route?.geometry) ? route.geometry.filter(item => (
      Array.isArray(item) && safeCoordinate(item[0], -90, 90) !== null && safeCoordinate(item[1], -180, 180) !== null
    )) : [];
    if (geometry.length >= 2) {
      L.polyline(geometry, { color: "#0f766e", weight: 5, opacity: 0.86 }).addTo(overlay);
      bounds.push(...geometry);
    }

    const vehicleLat = safeCoordinate(vehiclePosition?.lat, -90, 90);
    const vehicleLng = safeCoordinate(vehiclePosition?.lng, -180, 180);
    if (vehicleLat !== null && vehicleLng !== null) {
      L.marker([vehicleLat, vehicleLng], { icon: vehicleIcon(), zIndexOffset: 1000 })
        .bindPopup("Posicion conocida mas reciente del vehiculo")
        .addTo(overlay);
      bounds.push([vehicleLat, vehicleLng]);
    }

    if (bounds.length) map.fitBounds(bounds, { padding: [32, 32], maxZoom: 13 });
    else map.setView(DEFAULT_CENTER, 5);
    setTimeout(() => map.invalidateSize(), 60);
  }, [route, routePoints, vehiclePosition?.lat, vehiclePosition?.lng]);

  return (
    <div style={{ border: "1px solid var(--border2)", borderRadius: 8, overflow: "hidden", background: "var(--bg3)" }}>
      <div ref={containerRef} role="img" aria-label="Ruta y puntos operativos del pedido" style={{ width: "100%", height: "clamp(280px, 38vh, 440px)", background: "var(--bg3)" }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 11px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", fontSize: 11, color: "var(--text4)" }}>
          {loading && <strong style={{ color: "var(--accent)" }}>Calculando ruta...</strong>}
          {!loading && route && <strong style={{ color: "var(--text)" }}>{providerLabel(route)}</strong>}
          {Number(route?.km) > 0 && <span>{Number(route.km).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km</span>}
          {Number(route?.duration_min) > 0 && <span>{Math.floor(route.duration_min / 60)} h {route.duration_min % 60} min</span>}
          {route?.warning && <span style={{ color: "#b45309" }}>{route.warning}</span>}
          {error && <span role="alert" style={{ color: "#dc2626" }}>{error}</span>}
        </div>
        {error && (
          <button type="button" onClick={() => setRetry(value => value + 1)} style={{ border: "1px solid var(--border2)", background: "var(--button-bg)", color: "var(--text)", borderRadius: 7, padding: "6px 10px", fontWeight: 800, cursor: "pointer" }}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

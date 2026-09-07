import { useEffect, useMemo, useRef, useState } from "react";
import { calcularRutaGeo } from "../services/api";
import RouteMapCanvas from "./RouteMapCanvas";

function safeCoordinate(value, min, max) {
  if (value == null || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function normalizedPoint(point = {}, index = 0) {
  const lat = safeCoordinate(point.lat ?? point.latitude ?? point.latitud, -90, 90);
  const lng = safeCoordinate(point.lng ?? point.lon ?? point.longitude ?? point.longitud, -180, 180);
  const hasExplicitQuery = Object.prototype.hasOwnProperty.call(point, "query");
  const label = String(point.label || point.nombre || point.direccion || `Parada ${index + 1}`).trim();
  const address = String(point.address || point.direccion || "").trim();
  const city = String(point.city || point.ciudad || point.localidad || point.poblacion || point.municipio || "").trim();
  const region = String(point.provincia || point.region || "").trim();
  const country = String(point.pais || point.country || "").trim();
  const query = String(hasExplicitQuery
    ? (point.query || "")
    : [address, city, region, country].filter(Boolean).join(", ")
  ).trim();
  return {
    label,
    query,
    address,
    direccion: address,
    city,
    ciudad: city,
    role: point.tipo || point.role || (index === 0 ? "origen" : "parada"),
    country,
    region,
    google_maps_url: point.google_maps_url || "",
    title: point.title || "",
    tone: point.tone || null,
    lat,
    lng,
  };
}

function normalizeRouteText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const COUNTRY_ONLY_VALUES = new Set([
  "alemania", "austria", "belgica", "bulgaria", "chequia", "chipre", "croacia", "dinamarca",
  "eslovaquia", "eslovenia", "espana", "estonia", "finlandia", "francia", "grecia", "hungria",
  "irlanda", "islandia", "italia", "letonia", "lituania", "luxemburgo", "malta", "noruega",
  "paises bajos", "polonia", "portugal", "reino unido", "rumania", "suecia", "suiza",
  "spain", "france", "germany", "italy", "united kingdom",
]);

function isRoutePointReady(point = {}) {
  if (safeCoordinate(point.lat, -90, 90) !== null && safeCoordinate(point.lng, -180, 180) !== null) return true;
  const query = normalizeRouteText(point.query);
  const country = normalizeRouteText(point.country);
  return query.length >= 2 && query !== country && !COUNTRY_ONLY_VALUES.has(query);
}

function providerLabel(route) {
  if (route?.provider === "ors_hgv") return "Ruta para camion";
  if (route?.provider === "osrm") return "Ruta orientativa";
  if (route?.provider === "estimate") return "Distancia estimada";
  return "Ruta calculada";
}

function validLatLng(point = {}) {
  const lat = safeCoordinate(point.lat, -90, 90);
  const lng = safeCoordinate(point.lng, -180, 180);
  return lat === null || lng === null ? null : { lat, lng };
}

function geometryFromRoute(route) {
  const routeGeometry = Array.isArray(route?.geometry)
    ? route.geometry
        .map(item => Array.isArray(item) ? { lat: safeCoordinate(item[0], -90, 90), lng: safeCoordinate(item[1], -180, 180) } : null)
        .filter(point => point && point.lat !== null && point.lng !== null)
    : [];
  if (routeGeometry.length >= 2) return routeGeometry;
  return [];
}

function resolvedDisplayPoints(route, routePoints) {
  const resolved = Array.isArray(route?.points) && route.points.length ? route.points : routePoints;
  return resolved.map((point, index) => ({
    ...(routePoints[index] || {}),
    ...(point || {}),
    stopNumber: index + 1,
    lat: safeCoordinate(point?.lat ?? routePoints[index]?.lat, -90, 90),
    lng: safeCoordinate(point?.lng ?? routePoints[index]?.lng, -180, 180),
  })).filter(point => point.lat !== null && point.lng !== null);
}

export default function RutaMapa({ points = [], vehiclePosition = null }) {
  const [routeState, setRouteState] = useState({ key: "", data: null });
  const [loadingKey, setLoadingKey] = useState("");
  const [errorState, setErrorState] = useState({ key: "", message: "" });
  const [retry, setRetry] = useState(0);
  const requestIdRef = useRef(0);

  const pointKey = JSON.stringify(points.map((point, index) => normalizedPoint(point, index)));
  const routePoints = useMemo(() => JSON.parse(pointKey), [pointKey]);
  const routeReady = routePoints.length >= 2 && routePoints.every(isRoutePointReady);
  const route = routeState.key === pointKey ? routeState.data : null;
  const loading = loadingKey === pointKey;
  const error = errorState.key === pointKey ? errorState.message : "";
  const displayPoints = useMemo(() => resolvedDisplayPoints(route, routePoints), [route, routePoints]);
  const geometry = useMemo(() => geometryFromRoute(route), [route]);
  const vehicleCoords = useMemo(() => validLatLng(vehiclePosition || {}), [vehiclePosition]);
  useEffect(() => {
    let active = true;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!routeReady) {
      setLoadingKey("");
      setErrorState({ key: pointKey, message: "" });
      setRouteState(current => current.key === pointKey ? current : { key: pointKey, data: null });
      return () => { active = false; };
    }
    setErrorState({ key: pointKey, message: "" });
    const timer = window.setTimeout(() => {
      setLoadingKey(pointKey);
      calcularRutaGeo(routePoints)
        .then(data => {
          if (!active || requestIdRef.current !== requestId) return;
          if (!data?.ok) throw new Error(data?.error || "No se pudo calcular la ruta");
          setRouteState({ key: pointKey, data });
        })
        .catch(err => {
          if (!active || requestIdRef.current !== requestId) return;
          setRouteState({ key: pointKey, data: null });
          setErrorState({ key: pointKey, message: err?.message || "No se pudo calcular la ruta." });
        })
        .finally(() => {
          if (active && requestIdRef.current === requestId) setLoadingKey("");
        });
    }, 800);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pointKey, retry, routePoints, routeReady]);

  return (
    <div style={{ position:"relative", zIndex:0, isolation:"isolate", border:"1px solid var(--border2)", borderRadius:8, overflow:"hidden", background:"var(--bg3)" }}>
      <RouteMapCanvas points={displayPoints} geometry={geometry} vehicle={vehicleCoords} />
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"9px 11px", flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:12, alignItems:"center", flexWrap:"wrap", fontSize:11, color:"var(--text4)" }}>
          {loading && <strong style={{ color:"var(--accent)" }}>Calculando ruta...</strong>}
          {!routeReady && <span>Completa origen y destino para mostrar la ruta.</span>}
          {!loading && route && <strong style={{ color:"var(--text)" }}>{providerLabel(route)}</strong>}
          {Number(route?.km) > 0 && <span>{Number(route.km).toLocaleString("es-ES", { maximumFractionDigits:1 })} km</span>}
          {Number(route?.duration_min) > 0 && <span>{Math.floor(route.duration_min / 60)} h {route.duration_min % 60} min</span>}
          {route?.warning && <span style={{ color:"#b45309" }}>{route.warning}</span>}
          {error && <span role="alert" style={{ color:"#64748b" }}>{error}</span>}
        </div>
        {error && (
          <button type="button" onClick={() => setRetry(value => value + 1)} style={{ border:"1px solid var(--border2)", background:"var(--button-bg)", color:"var(--text)", borderRadius:7, padding:"6px 10px", fontWeight:800, cursor:"pointer" }}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

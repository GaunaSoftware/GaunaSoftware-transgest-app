import { useEffect, useMemo, useRef, useState } from "react";
import { calcularRutaGeo } from "../services/api";

const TILE_SIZE = 256;
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 420;
const DEFAULT_CENTER = { lat: 40.2, lng: -3.7 };
const MIN_LAT = -85.05112878;
const MAX_LAT = 85.05112878;

const MAP_LAYERS = {
  streets: { label: "Mapa", attribution: "OpenStreetMap contributors" },
  relief: { label: "Relieve", attribution: "OpenTopoMap / OpenStreetMap contributors" },
  light: { label: "Claro", attribution: "CARTO / OpenStreetMap contributors" },
};
const MAP_BRAND = "Mapa TransGest";

function safeCoordinate(value, min, max) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function clampLat(lat) {
  return Math.max(MIN_LAT, Math.min(MAX_LAT, Number(lat) || 0));
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
    : [address, city, region, country].filter(Boolean).join(", ") || label
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

function tileUrl(layer, z, x, y) {
  const key = process.env.REACT_APP_MAPTILER_KEY || "";
  if (key) {
    const style = layer === "relief" ? "outdoor-v2" : layer === "light" ? "basic-v2-light" : "streets-v2";
    return `https://api.maptiler.com/maps/${style}/${z}/${x}/${y}.png?key=${encodeURIComponent(key)}`;
  }
  if (layer === "relief") return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`;
  if (layer === "light") return `https://a.basemaps.cartocdn.com/light_all/${z}/${x}/${y}.png`;
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

function project(lat, lng, zoom) {
  const scale = TILE_SIZE * (2 ** zoom);
  const x = ((Number(lng) + 180) / 360) * scale;
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

function validLatLng(point = {}) {
  const lat = safeCoordinate(point.lat, -90, 90);
  const lng = safeCoordinate(point.lng, -180, 180);
  return lat === null || lng === null ? null : { lat, lng };
}

function geometryFromRoute(route, routePoints) {
  const routeGeometry = Array.isArray(route?.geometry)
    ? route.geometry
        .map(item => Array.isArray(item) ? { lat: safeCoordinate(item[0], -90, 90), lng: safeCoordinate(item[1], -180, 180) } : null)
        .filter(point => point?.lat !== null && point?.lng !== null)
    : [];
  if (routeGeometry.length >= 2) return routeGeometry;
  return routePoints.map(validLatLng).filter(Boolean);
}

function resolvedDisplayPoints(route, routePoints) {
  const resolved = Array.isArray(route?.points) && route.points.length ? route.points : routePoints;
  return resolved.map((point, index) => ({
    ...(routePoints[index] || {}),
    ...(point || {}),
    lat: safeCoordinate(point?.lat ?? routePoints[index]?.lat, -90, 90),
    lng: safeCoordinate(point?.lng ?? routePoints[index]?.lng, -180, 180),
  })).filter(point => point.lat !== null && point.lng !== null);
}

function boundsFor(points = []) {
  const valid = points.map(validLatLng).filter(Boolean);
  if (!valid.length) return null;
  return valid.reduce((acc, point) => ({
    minLat: Math.min(acc.minLat, point.lat),
    maxLat: Math.max(acc.maxLat, point.lat),
    minLng: Math.min(acc.minLng, point.lng),
    maxLng: Math.max(acc.maxLng, point.lng),
  }), { minLat: valid[0].lat, maxLat: valid[0].lat, minLng: valid[0].lng, maxLng: valid[0].lng });
}

function zoomForBounds(bounds) {
  if (!bounds) return 5;
  const latPad = Math.max(0.12, (bounds.maxLat - bounds.minLat) * 0.24);
  const lngPad = Math.max(0.12, (bounds.maxLng - bounds.minLng) * 0.24);
  const nw = { lat: bounds.maxLat + latPad, lng: bounds.minLng - lngPad };
  const se = { lat: bounds.minLat - latPad, lng: bounds.maxLng + lngPad };
  for (let zoom = 13; zoom >= 4; zoom -= 1) {
    const a = project(nw.lat, nw.lng, zoom);
    const b = project(se.lat, se.lng, zoom);
    if (Math.abs(b.x - a.x) <= VIEW_WIDTH * 0.86 && Math.abs(b.y - a.y) <= VIEW_HEIGHT * 0.82) return zoom;
  }
  return 4;
}

function buildFrame(points = [], layer = "streets") {
  const bounds = boundsFor(points);
  const center = bounds
    ? { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }
    : DEFAULT_CENTER;
  const zoom = zoomForBounds(bounds);
  const centerPx = project(center.lat, center.lng, zoom);
  const start = { x: centerPx.x - VIEW_WIDTH / 2, y: centerPx.y - VIEW_HEIGHT / 2 };
  const tileCount = 2 ** zoom;
  const firstX = Math.floor(start.x / TILE_SIZE) - 1;
  const lastX = Math.floor((start.x + VIEW_WIDTH) / TILE_SIZE) + 1;
  const firstY = Math.floor(start.y / TILE_SIZE) - 1;
  const lastY = Math.floor((start.y + VIEW_HEIGHT) / TILE_SIZE) + 1;
  const tiles = [];
  for (let tx = firstX; tx <= lastX; tx += 1) {
    const wrappedX = ((tx % tileCount) + tileCount) % tileCount;
    for (let ty = firstY; ty <= lastY; ty += 1) {
      if (ty < 0 || ty >= tileCount) continue;
      tiles.push({
        key: `${zoom}-${tx}-${ty}-${layer}`,
        x: tx * TILE_SIZE - start.x,
        y: ty * TILE_SIZE - start.y,
        url: tileUrl(layer, zoom, wrappedX, ty),
      });
    }
  }
  return { zoom, start, tiles };
}

function screenPoint(point, frame) {
  const px = project(point.lat, point.lng, frame.zoom);
  return { x: px.x - frame.start.x, y: px.y - frame.start.y };
}

function markerColor(point, index) {
  if (point?.tone?.color) return point.tone.color;
  const role = String(point?.role || point?.tipo || "").toLowerCase();
  if (role.includes("descarga") || role.includes("destino")) return "#f97316";
  return index === 0 ? "#0f766e" : "#3b82f6";
}

function pointTitle(point, index) {
  return point.title || (String(point.role || point.tipo || "").toLowerCase().includes("descarga") ? `Descarga ${index + 1}` : `Parada ${index + 1}`);
}

export default function RutaMapa({ points = [], vehiclePosition = null }) {
  const [routeState, setRouteState] = useState({ key: "", data: null });
  const [loadingKey, setLoadingKey] = useState("");
  const [errorState, setErrorState] = useState({ key: "", message: "" });
  const [retry, setRetry] = useState(0);
  const [layer, setLayer] = useState("streets");
  const requestIdRef = useRef(0);

  const pointKey = JSON.stringify(points.map((point, index) => normalizedPoint(point, index)));
  const routePoints = useMemo(() => JSON.parse(pointKey), [pointKey]);
  const routeReady = routePoints.length >= 2 && routePoints.every(isRoutePointReady);
  const route = routeState.key === pointKey ? routeState.data : null;
  const loading = loadingKey === pointKey;
  const error = errorState.key === pointKey ? errorState.message : "";
  const displayPoints = useMemo(() => resolvedDisplayPoints(route, routePoints), [route, routePoints]);
  const geometry = useMemo(() => geometryFromRoute(route, displayPoints), [route, displayPoints]);
  const vehicleCoords = useMemo(() => validLatLng(vehiclePosition || {}), [vehiclePosition]);
  const framePoints = useMemo(
    () => [...displayPoints, ...geometry, ...(vehicleCoords ? [vehicleCoords] : [])],
    [displayPoints, geometry, vehicleCoords]
  );
  const frame = useMemo(() => buildFrame(framePoints, layer), [framePoints, layer]);
  const routeLine = geometry.map(point => screenPoint(point, frame));

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
      <div style={{ position:"relative", width:"100%", height:"clamp(280px, 38vh, 440px)", overflow:"hidden", background:"#dbeafe" }} role="img" aria-label="Ruta y puntos operativos del pedido">
        <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid slice" style={{ width:"100%", height:"100%", display:"block" }}>
          <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill="#dbeafe" />
          {frame.tiles.map(tile => (
            <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={TILE_SIZE} height={TILE_SIZE} preserveAspectRatio="none" />
          ))}
          {routeLine.length >= 2 && (
            <>
              <polyline
                points={routeLine.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="rgba(255,255,255,.95)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={routeLine.map(point => `${point.x},${point.y}`).join(" ")}
                fill="none"
                stroke="#0f766e"
                strokeWidth="5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </>
          )}
          {displayPoints.map((point, index) => {
            const pos = screenPoint(point, frame);
            const color = markerColor(point, index);
            return (
              <g key={`${point.label}-${index}`} transform={`translate(${pos.x} ${pos.y})`}>
                <title>{`${pointTitle(point, index)}: ${point.label || "Punto"}`}</title>
                <circle r="16" fill={color} stroke="#fff" strokeWidth="4" />
                <circle r="20" fill="none" stroke="rgba(15,23,42,.22)" strokeWidth="2" />
                <text textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize="13" fontWeight="900">{index + 1}</text>
              </g>
            );
          })}
          {vehicleCoords && (() => {
            const pos = screenPoint(vehicleCoords, frame);
            return (
              <g transform={`translate(${pos.x} ${pos.y})`}>
                <title>Posicion conocida mas reciente del vehiculo</title>
                <path d="M0 -19 L15 17 L0 10 L-15 17 Z" fill="#1d4ed8" stroke="#fff" strokeWidth="4" />
              </g>
            );
          })()}
        </svg>
        <div style={{ position:"absolute", top:10, right:10, display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
          {Object.entries(MAP_LAYERS).map(([key, item]) => (
            <button
              key={key}
              type="button"
              onClick={() => setLayer(key)}
              style={{
                border:"1px solid rgba(15,23,42,.16)",
                background:layer === key ? "#0f766e" : "rgba(255,255,255,.88)",
                color:layer === key ? "#fff" : "#0f172a",
                borderRadius:7,
                padding:"6px 9px",
                fontSize:11,
                fontWeight:900,
                cursor:"pointer",
                boxShadow:"0 8px 20px rgba(15,23,42,.12)",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div style={{ position:"absolute", right:9, bottom:7, borderRadius:5, padding:"3px 6px", fontSize:10, color:"#0f172a", background:"rgba(255,255,255,.78)" }}>
          {MAP_BRAND} · Datos: {MAP_LAYERS[layer]?.attribution || "OpenStreetMap contributors"}
        </div>
      </div>
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

import { memo, useEffect, useMemo, useRef, useState } from "react";
import { calcularRutaGeo } from "../services/api";

const TILE_SIZE = 256;
const VIEW_WIDTH = 960;
const VIEW_HEIGHT = 420;
const DEFAULT_CENTER = { lat: 40.2, lng: -3.7 };
const MIN_LAT = -85.05112878;
const MAX_LAT = 85.05112878;

const MAPTILER_KEY = process.env.REACT_APP_MAPTILER_KEY || "";
const HAS_REAL_TILE_PROVIDER = Boolean(MAPTILER_KEY);
const MAP_LAYERS = {
  streets: { label: "Mapa", style: "streets-v2", attribution: "MapTiler" },
  relief: { label: "Relieve", style: "outdoor-v2", attribution: "MapTiler" },
  light: { label: "Claro", style: "basic-v2-light", attribution: "MapTiler" },
};
const MAP_BRAND = "Mapa TransGest";
const GRID_X = [96, 192, 288, 384, 480, 576, 672, 768, 864];
const GRID_Y = [70, 140, 210, 280, 350];

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
  if (!MAPTILER_KEY) return "";
  const style = MAP_LAYERS[layer]?.style || MAP_LAYERS.streets.style;
  return `https://api.maptiler.com/maps/${style}/${z}/${x}/${y}.png?key=${encodeURIComponent(MAPTILER_KEY)}`;
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

function buildFrame(points = [], layer = "streets", view = { zoomAdj: 0, panX: 0, panY: 0 }) {
  const bounds = boundsFor(points);
  const center = bounds
    ? { lat: (bounds.minLat + bounds.maxLat) / 2, lng: (bounds.minLng + bounds.maxLng) / 2 }
    : DEFAULT_CENTER;
  // Zoom automatico para encuadrar la ruta + ajuste manual del usuario (+/-).
  const zoom = Math.max(3, Math.min(18, zoomForBounds(bounds) + (Number(view?.zoomAdj) || 0)));
  const centerPx = project(center.lat, center.lng, zoom);
  // Desplazamiento manual (arrastrar) en pixeles de la vista.
  const start = {
    x: centerPx.x - VIEW_WIDTH / 2 - (Number(view?.panX) || 0),
    y: centerPx.y - VIEW_HEIGHT / 2 - (Number(view?.panY) || 0),
  };
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
      const url = tileUrl(layer, zoom, wrappedX, ty);
      if (!url) continue;
      tiles.push({
        key: `${zoom}-${tx}-${ty}-${layer}`,
        x: tx * TILE_SIZE - start.x,
        y: ty * TILE_SIZE - start.y,
        url,
      });
    }
  }
  return { zoom, start, tiles };
}

function fallbackPalette(layer) {
  if (layer === "relief") return {
    sea: "#c9e8f2",
    land: "#e7f3dc",
    road: "#d7b178",
    road2: "#9cc7a8",
    grid: "#87a99a",
    label: "#45635b",
  };
  if (layer === "light") return {
    sea: "#e8f2f7",
    land: "#f7f9f6",
    road: "#d6dee7",
    road2: "#bfd8dc",
    grid: "#b8c8c9",
    label: "#64748b",
  };
  return {
    sea: "#cae7ef",
    land: "#edf4e3",
    road: "#f1b46c",
    road2: "#94c7b5",
    grid: "#8fb0a2",
    label: "#475569",
  };
}

function FallbackMapBase({ layer }) {
  const palette = fallbackPalette(layer);
  return (
    <g aria-hidden="true">
      <rect x="0" y="0" width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={palette.sea} />
      <path
        d="M-40 54 C92 22 157 62 249 49 C359 32 412 74 498 59 C605 41 676 24 782 61 C864 91 934 82 1004 45 L1004 430 L-40 430 Z"
        fill={palette.land}
      />
      <path
        d="M25 323 C117 285 185 310 278 268 C363 230 404 251 481 214 C573 170 624 182 705 143 C794 101 875 114 971 75"
        fill="none"
        stroke={palette.road}
        strokeWidth="9"
        strokeLinecap="round"
        opacity=".72"
      />
      <path
        d="M88 92 C192 119 245 163 326 170 C430 180 478 234 568 255 C648 275 718 310 854 302"
        fill="none"
        stroke={palette.road2}
        strokeWidth="7"
        strokeLinecap="round"
        opacity=".58"
      />
      <path
        d="M154 372 C258 313 266 253 344 206 C419 160 513 146 620 83"
        fill="none"
        stroke={palette.road}
        strokeWidth="5"
        strokeLinecap="round"
        opacity=".48"
      />
      {GRID_X.map(x => <line key={`fallback-x-${x}`} x1={x} x2={x} y1="0" y2={VIEW_HEIGHT} stroke={palette.grid} strokeWidth="1" opacity=".18" />)}
      {GRID_Y.map(y => <line key={`fallback-y-${y}`} y1={y} y2={y} x1="0" x2={VIEW_WIDTH} stroke={palette.grid} strokeWidth="1" opacity=".18" />)}
      <text x="28" y="38" fill={palette.label} fontSize="13" fontWeight="900" opacity=".78">Mapa tecnico TransGest</text>
      <text x="28" y="61" fill={palette.label} fontSize="10" fontWeight="700" opacity=".6">Ruta y puntos operativos</text>
    </g>
  );
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

function RutaMapa({ points = [], vehiclePosition = null }) {
  const [routeState, setRouteState] = useState({ key: "", data: null });
  const [loadingKey, setLoadingKey] = useState("");
  const [errorState, setErrorState] = useState({ key: "", message: "" });
  const [retry, setRetry] = useState(0);
  const [layer, setLayer] = useState("streets");
  const requestIdRef = useRef(0);
  const forceRef = useRef(false);
  const [view, setView] = useState({ zoomAdj: 0, panX: 0, panY: 0 });
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  function recalcular() {
    forceRef.current = true;      // fuerza saltar cache y re-geocodificar
    setRouteState({ key: "", data: null });
    setRetry(value => value + 1);
  }

  function zoomBy(delta) {
    setView(v => ({ ...v, zoomAdj: Math.max(-3, Math.min(6, (v.zoomAdj || 0) + delta)) }));
  }
  function resetView() {
    setView({ zoomAdj: 0, panX: 0, panY: 0 });
  }
  // Escala px-pantalla -> px-vista (viewBox con slice) para arrastrar el mapa.
  // Con preserveAspectRatio "slice" el SVG se escala por max(w/VW, h/VH); un pixel
  // de pantalla equivale a 1/ese_factor unidades de viewBox = min(VW/w, VH/h).
  function viewScale() {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return 1;
    return Math.min(VIEW_WIDTH / rect.width, VIEW_HEIGHT / rect.height);
  }
  function onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    // Evita que el navegador inicie un arrastre nativo de imagen/seleccion, que
    // secuestraba el gesto y solo dejaba mover el mapa unos pocos pixeles.
    e.preventDefault();
    dragRef.current = { x: e.clientX, y: e.clientY };
    try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
  }
  function onPointerMove(e) {
    const drag = dragRef.current;
    if (!drag) return;
    const scale = viewScale();
    const dx = (e.clientX - drag.x) * scale;
    const dy = (e.clientY - drag.y) * scale;
    drag.x = e.clientX;
    drag.y = e.clientY;
    setView(v => ({ ...v, panX: (v.panX || 0) + dx, panY: (v.panY || 0) + dy }));
  }
  function onPointerUp(e) {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch (_) { /* noop */ }
  }

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
  const frame = useMemo(() => buildFrame(framePoints, layer, view), [framePoints, layer, view]);
  const routeLine = geometry.map(point => screenPoint(point, frame));

  // Al cambiar de pedido/ruta, volver al encuadre automatico.
  useEffect(() => { setView({ zoomAdj: 0, panX: 0, panY: 0 }); }, [pointKey]);

  // Zoom con la rueda del raton sobre el mapa. Se usa un listener nativo NO
  // pasivo para poder hacer preventDefault y evitar que se desplace la pagina o
  // el formulario mientras se hace zoom.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 1 : -1;
      setView(v => ({ ...v, zoomAdj: Math.max(-3, Math.min(6, (v.zoomAdj || 0) + delta)) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

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
    const force = forceRef.current;
    forceRef.current = false;
    const timer = window.setTimeout(() => {
      setLoadingKey(pointKey);
      calcularRutaGeo(routePoints, { force })
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
      <div
        style={{ position:"relative", width:"100%", height:"clamp(280px, 38vh, 440px)", overflow:"hidden", background:"#dbeafe", cursor: dragRef.current ? "grabbing" : "grab", touchAction:"none", userSelect:"none", WebkitUserSelect:"none" }}
        role="img"
        aria-label="Ruta y puntos operativos del pedido"
        draggable={false}
        onDragStart={e => e.preventDefault()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <svg ref={svgRef} viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="xMidYMid slice" style={{ width:"100%", height:"100%", display:"block" }}>
          <FallbackMapBase layer={layer} />
          {frame.tiles.map(tile => (
            <image key={tile.key} href={tile.url} x={tile.x} y={tile.y} width={TILE_SIZE} height={TILE_SIZE} preserveAspectRatio="none" draggable={false} style={{ pointerEvents:"none" }} />
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
        <div
          style={{ position:"absolute", top:10, left:10, display:"flex", flexDirection:"column", gap:5 }}
          onPointerDown={e => e.stopPropagation()}
        >
          {[
            { label:"+", act:() => zoomBy(1), aria:"Acercar" },
            { label:"−", act:() => zoomBy(-1), aria:"Alejar" },
          ].map(btn => (
            <button
              key={btn.aria}
              type="button"
              onClick={btn.act}
              aria-label={btn.aria}
              style={{ width:32, height:32, border:"1px solid rgba(15,23,42,.16)", background:"rgba(255,255,255,.92)", color:"#0f172a", borderRadius:7, fontSize:18, fontWeight:900, cursor:"pointer", boxShadow:"0 8px 20px rgba(15,23,42,.12)", lineHeight:1 }}
            >
              {btn.label}
            </button>
          ))}
          {(view.zoomAdj !== 0 || view.panX !== 0 || view.panY !== 0) && (
            <button
              type="button"
              onClick={resetView}
              aria-label="Ajustar a la ruta"
              title="Ajustar a la ruta"
              style={{ width:32, height:32, border:"1px solid rgba(15,23,42,.16)", background:"rgba(255,255,255,.92)", color:"#0f766e", borderRadius:7, fontSize:14, fontWeight:900, cursor:"pointer", boxShadow:"0 8px 20px rgba(15,23,42,.12)", lineHeight:1 }}
            >
              &#9635;
            </button>
          )}
        </div>
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
          {MAP_BRAND} - {HAS_REAL_TILE_PROVIDER ? (MAP_LAYERS[layer]?.attribution || "MapTiler") : "base interna"}
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
        {(routeReady || error) && (
          <button
            type="button"
            onClick={recalcular}
            disabled={loading}
            title="Vuelve a geocodificar y recalcular la ruta ignorando la cache. Util si un punto sale en el sitio equivocado."
            style={{ border:"1px solid var(--border2)", background:"var(--button-bg)", color:"var(--text)", borderRadius:7, padding:"6px 10px", fontWeight:800, cursor:loading?"wait":"pointer", opacity:loading?0.6:1, display:"inline-flex", alignItems:"center", gap:6 }}
          >
            <span style={{ fontSize:13, lineHeight:1 }}>&#8635;</span> {loading ? "Recalculando..." : "Recalcular"}
          </button>
        )}
      </div>
    </div>
  );
}

// Solo re-renderiza el mapa cuando cambian de verdad los puntos GEOGRAFICOS o la
// posicion del vehiculo. Asi editar fechas, precio u otros campos del pedido no
// hace que el mapa se re-encuadre y "pegue saltos" mientras se rellena el viaje.
function rutaMapaPointsKey(pts = []) {
  return JSON.stringify((Array.isArray(pts) ? pts : []).map((p, i) => {
    const n = normalizedPoint(p, i);
    return [n.query, n.address, n.city, n.region, n.country, n.lat, n.lng, n.google_maps_url, n.role, n.tone?.color || ""];
  }));
}

function rutaMapaPropsEqual(prev, next) {
  return rutaMapaPointsKey(prev.points) === rutaMapaPointsKey(next.points)
    && JSON.stringify(validLatLng(prev.vehiclePosition || {})) === JSON.stringify(validLatLng(next.vehiclePosition || {}));
}

export default memo(RutaMapa, rutaMapaPropsEqual);

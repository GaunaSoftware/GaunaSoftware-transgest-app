import { useEffect, useMemo, useState } from "react";
import { getControlTower, getRouteProviders } from "../services/api";
import { setRuntimeFocus } from "../services/runtimeFocus";
import { coordsForKnownPlace, inferPlaceGeo } from "../utils/placeGeo";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:20, fontWeight:800, color:"var(--text)" },
  card: { background:"var(--card-bg)", border:"1px solid var(--border)", borderRadius:12, padding:"16px 18px" },
  sec: { fontSize:10, fontWeight:800, textTransform:"uppercase", letterSpacing:".08em", color:"var(--text5)", marginBottom:8 },
};

const SEV = {
  critica: { label:"Critica", color:"#ef4444", bg:"rgba(239,68,68,.08)", border:"rgba(239,68,68,.35)" },
  alta: { label:"Alta", color:"#f97316", bg:"rgba(249,115,22,.08)", border:"rgba(249,115,22,.35)" },
  media: { label:"Media", color:"#f59e0b", bg:"rgba(245,158,11,.08)", border:"rgba(245,158,11,.35)" },
  baja: { label:"Baja", color:"#3b82f6", bg:"rgba(59,130,246,.08)", border:"rgba(59,130,246,.32)" },
  info: { label:"Info", color:"var(--accent-xl)", bg:"rgba(20,184,166,.09)", border:"rgba(20,184,166,.28)" },
};

const PERIODS = { "7d":"7 días", mes:"Este mes", "30d":"30 días" };

function navegar(view) {
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

function abrirItem(item) {
  if (!item) return;
  const focus = {
    pedido_id: item.entity_id || "",
    factura_id: item.entity_id || "",
    vehiculo_id: item.entity_id || "",
    source: "control_tower",
    action: item.action || "",
    type: item.type || "",
    area: item.area || "",
    severity: item.severity || "",
    title: item.title || "",
    description: item.description || "",
  };
  if (item.view === "pedidos" || item.view === "gestion_trafico") {
    setRuntimeFocus("tms_trafico_focus", focus);
    navegar("gestion_trafico");
    return;
  }
  if (item.view === "facturacion") {
    setRuntimeFocus("tms_facturacion_focus", focus);
    navegar("facturacion");
    return;
  }
  if (item.view === "vehiculos") {
    setRuntimeFocus("tms_vehiculos_gps_focus", focus);
    navegar("vehiculos");
    return;
  }
  navegar(item.view || "excepciones");
}

function abrirAccion(item, action) {
  if (!item || !action) return;
  const focus = {
    pedido_id: item.entity_id || "",
    factura_id: item.entity_id || "",
    vehiculo_id: item.entity_id || "",
    source: "control_tower",
    action: action.label || item.action || "",
    action_key: action.key || "",
    type: item.type || "",
    area: item.area || "",
    severity: item.severity || "",
    title: item.title || "",
    description: item.description || "",
    requires_confirmation: !!action.requires_confirmation,
  };
  const targetView = action.view || item.view || "excepciones";
  if (targetView === "gestion_trafico" || targetView === "pedidos") {
    setRuntimeFocus("tms_trafico_focus", focus);
    navegar("gestion_trafico");
    return;
  }
  if (targetView === "facturacion") {
    setRuntimeFocus("tms_facturacion_focus", focus);
    navegar("facturacion");
    return;
  }
  if (targetView === "vehiculos") {
    setRuntimeFocus("tms_vehiculos_gps_focus", focus);
    navegar("vehiculos");
    return;
  }
  navegar(targetView);
}

function TowerItem({ item }) {
  const sev = SEV[item?.severity] || SEV.info;
  return (
    <div style={{border:`1px solid ${sev.border}`,background:sev.bg,borderRadius:8,padding:"12px 13px",display:"flex",flexDirection:"column",gap:7,minHeight:148}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:sev.color}}>{sev.label}</span>
        <span style={{fontSize:10,color:"var(--text5)",fontWeight:800}}>{item.area}</span>
      </div>
      <div style={{fontSize:14,fontWeight:900,color:"var(--text)",lineHeight:1.25}}>{item.title}</div>
      <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.35,flex:1}}>{item.description}</div>
      {Array.isArray(item.next_actions) && item.next_actions.length > 0 && (
        <div style={{display:"flex",gap:5,flexWrap:"wrap",marginTop:2}}>
          {item.next_actions.slice(0, 4).map(action=>(
            <button key={action.key || action.label} onClick={()=>abrirAccion(item, action)}
              style={{fontSize:10,fontWeight:800,border:`1px solid ${action.primary ? "rgba(20,184,166,.35)" : "var(--border)"}`,background:action.primary ? "rgba(20,184,166,.10)" : "var(--bg3)",color:action.primary ? "var(--accent-xl)" : "var(--text4)",borderRadius:20,padding:"3px 8px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {action.label}
            </button>
          ))}
        </div>
      )}
      <button onClick={()=>abrirItem(item)} style={{alignSelf:"flex-start",border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"6px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
        {item.action || "Abrir"}
      </button>
    </div>
  );
}

function MetricBox({ label, value, detail, color = "var(--accent-xl)" }) {
  return (
    <div style={{border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",background:"var(--bg3)",minHeight:74}}>
      <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color}}>{Number(value || 0)}</div>
      <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
      {detail && <div style={{fontSize:11,color:"var(--text4)",marginTop:4,lineHeight:1.25}}>{detail}</div>}
    </div>
  );
}

function FlowPanel({ flujo = [], selectedKey = "", onStatusClick }) {
  const rows = Array.isArray(flujo) ? flujo : [];
  const max = Math.max(1, ...rows.map(r => Number(r.total || 0)));
  return (
    <div style={S.card}>
      <div style={S.sec}>Visibilidad extremo a extremo</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:8}}>
        {rows.map(row => {
          const total = Number(row.total || 0);
          return (
            <button
              key={row.key}
              type="button"
              onClick={() => total > 0 && onStatusClick?.(row)}
              disabled={total <= 0}
              style={{
                border:`1px solid ${selectedKey === row.key ? "rgba(20,184,166,.48)" : "var(--border)"}`,
                borderRadius:8,
                padding:"9px 10px",
                background:selectedKey === row.key ? "rgba(20,184,166,.10)" : "var(--bg3)",
                cursor:total > 0 ? "pointer" : "default",
                textAlign:"left",
                fontFamily:"'DM Sans',sans-serif",
                opacity:total > 0 ? 1 : .72,
              }}
            >
              <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                <span style={{fontSize:11,fontWeight:900,color:"var(--text)",whiteSpace:"nowrap"}}>{row.label}</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:14,fontWeight:900,color:"var(--accent-xl)"}}>{total}</span>
              </div>
              <div style={{height:5,background:"var(--bg4)",borderRadius:99,overflow:"hidden",marginTop:8}}>
                <div style={{height:"100%",width:`${Math.max(4, total / max * 100)}%`,background:"var(--accent)",borderRadius:99}} />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MAP_SIZE = { width: 640, height: 300 };
const MAP_LAYERS = {
  streets: {
    label: "Mapa",
    detail: "Calles",
    attribution: "CARTO / OpenStreetMap",
    filter: "saturate(.9) contrast(1.02) brightness(1.02)",
    tileUrl: (z, x, y) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
    overlay: "linear-gradient(90deg, rgba(255,255,255,.08), rgba(255,255,255,.02))",
  },
  relief: {
    label: "Relieve",
    detail: "Terreno",
    attribution: "OpenTopoMap",
    filter: "saturate(.86) contrast(.98) brightness(.98)",
    tileUrl: (z, x, y) => `https://tile.opentopomap.org/${z}/${x}/${y}.png`,
    overlay: "linear-gradient(90deg, rgba(15,23,42,.06), rgba(255,255,255,.02))",
  },
  satellite: {
    label: "Satelite",
    detail: "Imagen",
    attribution: "Esri",
    filter: "saturate(.98) contrast(1.04) brightness(.88)",
    tileUrl: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
    overlay: "linear-gradient(90deg, rgba(2,6,23,.22), rgba(2,6,23,.04))",
  },
  traffic: {
    label: "Trafico",
    detail: "Operativo",
    attribution: "CARTO / OpenStreetMap",
    filter: "saturate(.78) contrast(1.02) brightness(1.08)",
    tileUrl: (z, x, y) => `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`,
    overlay: "linear-gradient(90deg, rgba(255,255,255,.18), rgba(254,243,199,.08))",
  },
};
const SPAIN_CENTER = { lat: 40.25, lng: -3.7 };
const CITY_COORDS = {
  madrid: { lat: 40.4168, lng: -3.7038 },
  barcelona: { lat: 41.3874, lng: 2.1686 },
  zaragoza: { lat: 41.6488, lng: -0.8891 },
  valencia: { lat: 39.4699, lng: -0.3763 },
  sevilla: { lat: 37.3891, lng: -5.9845 },
  cordoba: { lat: 37.8882, lng: -4.7794 },
  bilbao: { lat: 43.263, lng: -2.935 },
  burgos: { lat: 42.3439, lng: -3.6969 },
  albacete: { lat: 38.9943, lng: -1.8585 },
  tarragona: { lat: 41.1189, lng: 1.2445 },
  lleida: { lat: 41.6176, lng: 0.62 },
  alicante: { lat: 38.3452, lng: -0.481 },
  torrent: { lat: 39.4371, lng: -0.4655 },
  abanilla: { lat: 38.2056, lng: -1.0414 },
  ribarroja: { lat: 39.545, lng: -0.5708 },
  riba_roja: { lat: 39.545, lng: -0.5708 },
  lorqui: { lat: 38.0819, lng: -1.251 },
  arganda_del_rey: { lat: 40.3069, lng: -3.4477 },
  alcala_de_henares: { lat: 40.4819, lng: -3.3635 },
  alcala: { lat: 40.4819, lng: -3.3635 },
  cabanas_de_yepes: { lat: 39.889, lng: -3.535 },
  lucena: { lat: 37.4088, lng: -4.4852 },
  gandia: { lat: 38.968, lng: -0.1845 },
  torrelavit: { lat: 41.446, lng: 1.729 },
  santago: { lat: 40.9701, lng: -3.6434 },
};

const REGION_COORDS = {
  // Provincias espanolas y puntos frecuentes. Coordenadas aproximadas para encuadre operativo.
  a_coruna: { lat: 43.3623, lng: -8.4115 },
  alava: { lat: 42.8467, lng: -2.6727 },
  albacete: { lat: 38.9943, lng: -1.8585 },
  alicante: { lat: 38.3452, lng: -0.481 },
  almeria: { lat: 36.834, lng: -2.4637 },
  asturias: { lat: 43.3614, lng: -5.8593 },
  avila: { lat: 40.6567, lng: -4.6812 },
  badajoz: { lat: 38.8794, lng: -6.9707 },
  barcelona: { lat: 41.3874, lng: 2.1686 },
  burgos: { lat: 42.3439, lng: -3.6969 },
  caceres: { lat: 39.4753, lng: -6.3724 },
  cadiz: { lat: 36.5271, lng: -6.2886 },
  cantabria: { lat: 43.1828, lng: -3.9878 },
  castellon: { lat: 39.9864, lng: -0.0513 },
  castellon_de_la_plana: { lat: 39.9864, lng: -0.0513 },
  ciudad_real: { lat: 38.9848, lng: -3.9274 },
  cordoba: { lat: 37.8882, lng: -4.7794 },
  cuenca: { lat: 40.0704, lng: -2.1374 },
  girona: { lat: 41.9794, lng: 2.8214 },
  granada: { lat: 37.1773, lng: -3.5986 },
  guadalajara: { lat: 40.6325, lng: -3.1602 },
  gipuzkoa: { lat: 43.0756, lng: -2.2237 },
  huelva: { lat: 37.2614, lng: -6.9447 },
  huesca: { lat: 42.1401, lng: -0.4089 },
  illes_balears: { lat: 39.5716, lng: 2.6517 },
  jaen: { lat: 37.7796, lng: -3.7849 },
  la_rioja: { lat: 42.2871, lng: -2.5396 },
  las_palmas: { lat: 28.1235, lng: -15.4363 },
  leon: { lat: 42.5987, lng: -5.5671 },
  lleida: { lat: 41.6176, lng: 0.62 },
  lugo: { lat: 43.0097, lng: -7.5568 },
  madrid: { lat: 40.4168, lng: -3.7038 },
  malaga: { lat: 36.7213, lng: -4.4214 },
  murcia: { lat: 37.9922, lng: -1.1307 },
  navarra: { lat: 42.6954, lng: -1.6761 },
  ourense: { lat: 42.3358, lng: -7.8639 },
  palencia: { lat: 42.0097, lng: -4.5288 },
  pontevedra: { lat: 42.431, lng: -8.6444 },
  salamanca: { lat: 40.9701, lng: -5.6635 },
  santa_cruz_de_tenerife: { lat: 28.4636, lng: -16.2518 },
  segovia: { lat: 40.9429, lng: -4.1088 },
  sevilla: { lat: 37.3891, lng: -5.9845 },
  soria: { lat: 41.7636, lng: -2.4649 },
  tarragona: { lat: 41.1189, lng: 1.2445 },
  teruel: { lat: 40.3457, lng: -1.1065 },
  toledo: { lat: 39.8628, lng: -4.0273 },
  valencia: { lat: 39.4699, lng: -0.3763 },
  valladolid: { lat: 41.6523, lng: -4.7245 },
  bizkaia: { lat: 43.263, lng: -2.935 },
  zamora: { lat: 41.5035, lng: -5.7446 },
  zaragoza: { lat: 41.6488, lng: -0.8891 },
  espana: { lat: 40.25, lng: -3.7 },
  spain: { lat: 40.25, lng: -3.7 },
  portugal: { lat: 39.7, lng: -8.0 },
  francia: { lat: 46.6, lng: 2.2 },
  france: { lat: 46.6, lng: 2.2 },
  italia: { lat: 42.8, lng: 12.5 },
  italy: { lat: 42.8, lng: 12.5 },
  alemania: { lat: 51.2, lng: 10.4 },
  germany: { lat: 51.2, lng: 10.4 },
  belgica: { lat: 50.6, lng: 4.6 },
  paises_bajos: { lat: 52.2, lng: 5.3 },
  luxemburgo: { lat: 49.8, lng: 6.1 },
  suiza: { lat: 46.8, lng: 8.2 },
  austria: { lat: 47.6, lng: 14.2 },
  reino_unido: { lat: 54.5, lng: -2.5 },
  irlanda: { lat: 53.3, lng: -8.2 },
  marruecos: { lat: 31.8, lng: -7.1 },
  andorra: { lat: 42.5, lng: 1.55 },
};

function normalizePlaceKey(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function parseStops(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function coordsFromGoogleMaps(value = "") {
  const raw = String(value || "");
  const at = raw.match(/@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (at) return { lat: Number(at[1]), lng: Number(at[2]) };
  const bang = raw.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (bang) return { lat: Number(bang[1]), lng: Number(bang[2]) };
  const q = raw.match(/[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  if (q) return { lat: Number(q[1]), lng: Number(q[2]) };
  return null;
}

function validCoord(point) {
  const lat = Number(point?.lat ?? point?.latitud);
  const lng = Number(point?.lng ?? point?.longitud);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

function coordsForPlace(...values) {
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "object") {
      const direct = validCoord(value);
      if (direct) return direct;
      const maps = coordsFromGoogleMaps(value.google_maps_url || value.googleMapsUrl || value.maps_url || "");
      if (maps) return maps;
      const nested = coordsForPlace(value.nombre, value.name, value.direccion, value.address, value.provincia, value.pais);
      if (nested) return nested;
      continue;
    }
    const key = normalizePlaceKey(value);
    if (!key) continue;
    const known = coordsForKnownPlace(value);
    if (known) return known;
    if (CITY_COORDS[key]) return CITY_COORDS[key];
    if (REGION_COORDS[key]) return REGION_COORDS[key];
    const cityMatch = Object.keys(CITY_COORDS).find(k => key.includes(k) || k.includes(key));
    if (cityMatch) return CITY_COORDS[cityMatch];
    const regionMatch = Object.keys(REGION_COORDS).find(k => key.includes(k) || k.includes(key));
    if (regionMatch) return REGION_COORDS[regionMatch];
    const tokens = key.split("_").filter(t => t.length >= 4 && !["centro", "norte", "sur", "este", "oeste", "terminal", "plataforma"].includes(t));
    const tokenCityMatch = Object.keys(CITY_COORDS).find(k => {
      const kt = k.split("_").filter(t => t.length >= 4);
      return tokens.some(t => k.includes(t)) || kt.some(t => key.includes(t));
    });
    if (tokenCityMatch) return CITY_COORDS[tokenCityMatch];
    const tokenRegionMatch = Object.keys(REGION_COORDS).find(k => {
      const kt = k.split("_").filter(t => t.length >= 4);
      return tokens.some(t => k.includes(t)) || kt.some(t => key.includes(t));
    });
    if (tokenRegionMatch) return REGION_COORDS[tokenRegionMatch];
  }
  return null;
}

function latLngToPixels(point, zoom) {
  const scale = 256 * (2 ** zoom);
  const sinLat = Math.sin(point.lat * Math.PI / 180);
  return {
    x: ((point.lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function clampMap(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getMapLayer(layerKey = "streets") {
  return MAP_LAYERS[layerKey] || MAP_LAYERS.streets;
}

function firstStopCoords(rawStops = []) {
  const stops = parseStops(rawStops);
  for (const stop of stops) {
    const point = coordsForPlace(stop);
    if (point) return point;
  }
  return null;
}

function fitZoomForPoints(points = []) {
  const valid = points.filter(Boolean);
  if (valid.length < 2) return 6;
  for (let zoom = 8; zoom >= 3; zoom -= 1) {
    const px = valid.map(point => latLngToPixels(point, zoom));
    const xs = px.map(p => p.x);
    const ys = px.map(p => p.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    if (spanX <= MAP_SIZE.width - 120 && spanY <= MAP_SIZE.height - 80) return zoom;
  }
  return 3;
}

function getRouteGeoPoints(route = {}, item = {}) {
  const gps = Number.isFinite(Number(item?.gps_lat)) && Number.isFinite(Number(item?.gps_lng))
    ? { lat: Number(item.gps_lat), lng: Number(item.gps_lng) }
    : null;
  const origin = firstStopCoords(item?.puntos_carga) ||
    coordsForPlace(route.origen, item?.origen_provincia, item?.origen_pais);
  const destination = firstStopCoords(item?.puntos_descarga) ||
    coordsForPlace(route.destino, item?.destino_provincia, item?.destino_pais);
  return { origin, destination, gps };
}

function getMapGeometry({ route, item, zoom, layerKey = "streets" }) {
  const { origin, destination, gps } = getRouteGeoPoints(route, item);
  const center = gps || (origin && destination
    ? { lat: (origin.lat + destination.lat) / 2, lng: (origin.lng + destination.lng) / 2 }
    : origin || destination || SPAIN_CENTER);
  const centerPx = latLngToPixels(center, zoom);
  const topLeft = { x: centerPx.x - MAP_SIZE.width / 2, y: centerPx.y - MAP_SIZE.height / 2 };
  const project = point => {
    if (!point) return null;
    const px = latLngToPixels(point, zoom);
    return {
      x: clampMap(px.x - topLeft.x, 36, MAP_SIZE.width - 36),
      y: clampMap(px.y - topLeft.y, 32, MAP_SIZE.height - 34),
    };
  };
  const tileStartX = Math.floor(topLeft.x / 256);
  const tileStartY = Math.floor(topLeft.y / 256);
  const tileEndX = Math.floor((topLeft.x + MAP_SIZE.width) / 256);
  const tileEndY = Math.floor((topLeft.y + MAP_SIZE.height) / 256);
  const maxTiles = 2 ** zoom;
  const tiles = [];
  for (let x = tileStartX; x <= tileEndX; x += 1) {
    for (let y = tileStartY; y <= tileEndY; y += 1) {
      if (y < 0 || y >= maxTiles) continue;
      const wrappedX = ((x % maxTiles) + maxTiles) % maxTiles;
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        src: getMapLayer(layerKey).tileUrl(zoom, wrappedX, y),
        left: Math.round(x * 256 - topLeft.x),
        top: Math.round(y * 256 - topLeft.y),
      });
    }
  }
  return {
    center,
    origin,
    destination,
    gps,
    tiles,
    start: project(origin) || { x: 112, y: 148 },
    end: project(destination) || { x: 520, y: 106 },
    gpsPoint: project(gps),
    project,
  };
}

function centerForPoints(points = []) {
  const valid = points.filter(Boolean);
  if (!valid.length) return SPAIN_CENTER;
  if (valid.length === 1) return valid[0];
  const lats = valid.map(p => p.lat);
  const lngs = valid.map(p => p.lng);
  return {
    lat: (Math.min(...lats) + Math.max(...lats)) / 2,
    lng: (Math.min(...lngs) + Math.max(...lngs)) / 2,
  };
}

function getTileMapGeometry(points = [], zoom, layerKey = "streets") {
  const center = centerForPoints(points);
  const centerPx = latLngToPixels(center, zoom);
  const topLeft = { x: centerPx.x - MAP_SIZE.width / 2, y: centerPx.y - MAP_SIZE.height / 2 };
  const project = point => {
    if (!point) return null;
    const px = latLngToPixels(point, zoom);
    return {
      x: clampMap(px.x - topLeft.x, 22, MAP_SIZE.width - 22),
      y: clampMap(px.y - topLeft.y, 22, MAP_SIZE.height - 24),
    };
  };
  const tileStartX = Math.floor(topLeft.x / 256);
  const tileStartY = Math.floor(topLeft.y / 256);
  const tileEndX = Math.floor((topLeft.x + MAP_SIZE.width) / 256);
  const tileEndY = Math.floor((topLeft.y + MAP_SIZE.height) / 256);
  const maxTiles = 2 ** zoom;
  const tiles = [];
  for (let x = tileStartX; x <= tileEndX; x += 1) {
    for (let y = tileStartY; y <= tileEndY; y += 1) {
      if (y < 0 || y >= maxTiles) continue;
      const wrappedX = ((x % maxTiles) + maxTiles) % maxTiles;
      tiles.push({
        key: `${zoom}-${x}-${y}`,
        src: getMapLayer(layerKey).tileUrl(zoom, wrappedX, y),
        left: Math.round(x * 256 - topLeft.x),
        top: Math.round(y * 256 - topLeft.y),
      });
    }
  }
  return { center, tiles, project };
}

function tripIdentity(item = {}) {
  return String(item.id || item.entity_id || item.numero || item.pedido_numero || item.title || "");
}

function normalizeTripForMap(item = {}) {
  const route = parseRouteFromItem(item);
  const points = getRouteGeoPoints(route, item);
  const current = points.gps || points.origin || points.destination;
  if (!current) return null;
  return {
    ...item,
    id: item.id || item.entity_id || item.numero || item.pedido_numero || `trip-${current.lat}-${current.lng}`,
    entity_id: item.entity_id || item.id || "",
    title: item.title || `Viaje ${item.numero || item.pedido_numero || ""}`.trim(),
    view: item.view || "pedidos",
    description: item.description || `${item.cliente_nombre || "Cliente"} - ${route.origen || "-"} > ${route.destino || "-"}`,
    route,
    points,
    current,
  };
}

function collectMapTrips(viajesPorEstado = {}, fallbackItems = []) {
  const raw = [
    ...Object.values(viajesPorEstado || {}).flatMap(group => Array.isArray(group) ? group : []),
    ...(Array.isArray(fallbackItems) ? fallbackItems : []),
  ];
  const seen = new Set();
  return raw
    .map(normalizeTripForMap)
    .filter(Boolean)
    .filter(item => {
      const key = tripIdentity(item);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function parseRouteFromItem(item = {}) {
  const text = [item.ruta, item.route, item.description, item.title].filter(Boolean).join(" ");
  const match = String(text).match(/([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})\s*(?:>|->|→|a)\s*([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})/i);
  const origen = item.origen || match?.[1]?.trim() || "";
  const destino = item.destino || match?.[2]?.replace(/\s+-\s+.*/, "").trim() || "";
  return { origen, destino };
}

// eslint-disable-next-line no-unused-vars
function RouteMapPanelLegacy({ item }) {
  const route = useMemo(() => parseRouteFromItem(item || {}), [item]);
  const hasGps = Number.isFinite(Number(item?.gps_lat)) && Number.isFinite(Number(item?.gps_lng));
  const title = item?.title || item?.numero || item?.pedido_numero || "Viaje en seguimiento";
  const [providerInfo, setProviderInfo] = useState(null);
  const [routeMode, setRouteMode] = useState("camion");
  const [mapZoomDelta, setMapZoomDelta] = useState(0);
  useEffect(() => {
    let alive = true;
    getRouteProviders()
      .then(info => { if (alive) setProviderInfo(info); })
      .catch(() => { if (alive) setProviderInfo(null); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    setMapZoomDelta(0);
  }, [item?.id, item?.numero, route.origen, route.destino]);
  const hereConfigured = Boolean(providerInfo?.providers?.here?.configured || providerInfo?.here?.configured);
  const routePoints = useMemo(() => getRouteGeoPoints(route, item || {}), [route, item]);
  const baseZoom = useMemo(
    () => fitZoomForPoints([routePoints.origin, routePoints.destination, routePoints.gps]),
    [routePoints]
  );
  const mapZoom = Math.max(3, Math.min(9, baseZoom + mapZoomDelta));
  const map = useMemo(() => getMapGeometry({
    route,
    item: item || {},
    zoom: mapZoom,
  }), [route, item, mapZoom]);
  const routeModes = [
    { key:"camion", label:"Camion", detail:"Perfil pesado" },
    { key:"rapida", label:"Rapida", detail:"Menor tiempo" },
    { key:"economica", label:"Economica", detail:"Menor coste" },
  ];
  const routeLabel = routeModes.find(m => m.key === routeMode)?.detail || "Ruta prevista";
  const cx = Math.max(70, Math.min(570, (map.start.x + map.end.x) / 2));
  const cy = Math.max(42, Math.min(178, Math.min(map.start.y, map.end.y) - 44));
  const routePath = `M${map.start.x} ${map.start.y} C${cx} ${cy}, ${cx} ${cy}, ${map.end.x} ${map.end.y}`;
  return (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10}}>
        <div>
          <div style={S.sec}>Visibilidad extremo a extremo</div>
          <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{title}</div>
        </div>
        <span style={{fontSize:10,fontWeight:900,color:hasGps ? "var(--green)" : "var(--accent-xl)",border:`1px solid ${hasGps ? "rgba(16,185,129,.30)" : "rgba(20,184,166,.30)"}`,background:hasGps ? "rgba(16,185,129,.10)" : "rgba(20,184,166,.10)",borderRadius:20,padding:"3px 8px"}}>
          {hasGps ? "GPS activo" : "Ruta prevista"}
        </span>
      </div>
      <div style={{position:"relative",height:220,borderRadius:10,overflow:"hidden",border:"1px solid var(--border)",background:"linear-gradient(135deg, rgba(230,244,241,.95), rgba(248,250,252,.95))"}}>
        <div style={{position:"absolute",inset:0,overflow:"hidden",opacity:.82}}>
          {map.tiles.map(tile => (
            <img key={tile.key} src={tile.src} alt="" style={{position:"absolute",left:tile.left,top:tile.top,width:256,height:256,userSelect:"none",pointerEvents:"none",filter:"saturate(.65) contrast(.92) brightness(1.08)"}} />
          ))}
        </div>
        <div style={{position:"absolute",inset:0,background:"linear-gradient(90deg, rgba(240,253,250,.46), rgba(255,255,255,.20))"}} />
        <svg viewBox="0 0 640 220" style={{position:"absolute",inset:0,width:"100%",height:"100%"}}>
          <defs>
            <linearGradient id="ct-sea" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0%" stopColor="#e6f4f1" />
              <stop offset="100%" stopColor="#f8fafc" />
            </linearGradient>
            <filter id="ct-map-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0f172a" floodOpacity=".10" />
            </filter>
          </defs>
          <rect width="640" height="220" fill="transparent" />
          <path d={routePath} fill="none" stroke="rgba(15,118,110,.30)" strokeWidth="9" strokeLinecap="round" filter="url(#ct-map-shadow)" />
          <path d={routePath} fill="none" stroke="rgba(20,184,166,.86)" strokeWidth="4" strokeLinecap="round" strokeDasharray={hasGps ? "0" : "9 9"} />
          <circle cx={map.start.x} cy={map.start.y} r="12" fill="#fff" stroke="var(--accent)" strokeWidth="4" />
          <circle cx={map.end.x} cy={map.end.y} r="12" fill="#fff" stroke="var(--accent)" strokeWidth="4" />
          <text x="92" y="190" fill="rgba(15,23,42,.18)" fontSize="18" fontWeight="800">Portugal</text>
          <text x="472" y="182" fill="rgba(15,23,42,.18)" fontSize="18" fontWeight="800">Mediterraneo</text>
          <text x="300" y="42" fill="rgba(15,23,42,.20)" fontSize="18" fontWeight="900">España</text>
          {hasGps ? (
            <g transform={`translate(${(map.gpsPoint?.x || cx) - 12} ${(map.gpsPoint?.y || cy) - 12})`}>
              <circle cx="12" cy="12" r="18" fill="rgba(16,185,129,.18)" stroke="rgba(16,185,129,.42)" />
              <rect x="3" y="7" width="18" height="10" rx="3" fill="var(--green)" />
              <circle cx="7" cy="19" r="3" fill="#fff" />
              <circle cx="19" cy="19" r="3" fill="#fff" />
            </g>
          ) : (
            <circle cx={cx} cy={cy + 32} r="9" fill="var(--accent)" stroke="#fff" strokeWidth="3" />
          )}
        </svg>
        <div style={{position:"absolute",right:12,bottom:14,display:"grid",overflow:"hidden",border:"1px solid rgba(148,163,184,.32)",borderRadius:8,background:"rgba(255,255,255,.88)",boxShadow:"0 8px 20px rgba(15,23,42,.08)"}}>
          <button onClick={() => setMapZoomDelta(z => Math.min(3, z + 1))} style={{width:34,height:32,border:"none",borderBottom:"1px solid rgba(148,163,184,.22)",background:"transparent",fontSize:18,fontWeight:900,cursor:"pointer",color:"#334155"}}>+</button>
          <button onClick={() => setMapZoomDelta(z => Math.max(-2, z - 1))} style={{width:34,height:32,border:"none",background:"transparent",fontSize:20,fontWeight:900,cursor:"pointer",color:"#334155"}}>-</button>
        </div>
        <span style={{position:"absolute",right:56,bottom:14,fontSize:9,color:"rgba(15,23,42,.55)",background:"rgba(255,255,255,.78)",border:"1px solid rgba(148,163,184,.24)",borderRadius:6,padding:"3px 6px"}}>
          © OpenStreetMap
        </span>
        <div style={{position:"absolute",left:14,bottom:14,width:220,background:"rgba(255,255,255,.88)",color:"#0f172a",border:"1px solid rgba(148,163,184,.28)",borderRadius:10,padding:"10px 12px",boxShadow:"0 10px 30px rgba(15,23,42,.10)"}}>
          <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"#0f766e",marginBottom:5}}>{hasGps ? "Ubicacion actual" : "Ruta"}</div>
          <div style={{fontSize:12,fontWeight:900,lineHeight:1.35}}>{route.origen || "Origen"} -> {route.destino || "Destino"}</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:5}}>{hasGps ? "Mostrando posicion GPS recibida." : `Sin GPS reciente: ${routeLabel.toLowerCase()}.`}</div>
          <button onClick={()=>abrirItem(item)} style={{marginTop:9,border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.10)",color:"#0f766e",borderRadius:7,padding:"6px 9px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Ver detalle del viaje
          </button>
        </div>
      </div>
      {hereConfigured && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10,alignItems:"center"}}>
          <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>Rutas HERE</span>
          {routeModes.map(mode => (
            <button
              key={mode.key}
              onClick={() => setRouteMode(mode.key)}
              style={{
                border:`1px solid ${routeMode === mode.key ? "rgba(20,184,166,.45)" : "var(--border2)"}`,
                background:routeMode === mode.key ? "rgba(20,184,166,.12)" : "var(--bg3)",
                color:routeMode === mode.key ? "var(--accent-xl)" : "var(--text4)",
                borderRadius:20,
                padding:"5px 10px",
                fontSize:11,
                fontWeight:900,
                cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ControlTowerTripDetail({ item, onClose, onOpenTraffic }) {
  const normalized = useMemo(() => normalizeTripForMap(item || {}) || item || {}, [item]);
  const route = normalized?.route || parseRouteFromItem(normalized || {});
  const originGeo = inferPlaceGeo(route.origen, normalized?.origen_provincia, normalized?.origen_pais);
  const destinationGeo = inferPlaceGeo(route.destino, normalized?.destino_provincia, normalized?.destino_pais);
  if (!item) return null;
  const facts = [
    ["Cliente", normalized.cliente_nombre || normalized.cliente || "-"],
    ["Origen", [route.origen, originGeo?.provincia || normalized.origen_provincia].filter(Boolean).join(" · ") || "-"],
    ["Destino", [route.destino, destinationGeo?.provincia || normalized.destino_provincia].filter(Boolean).join(" · ") || "-"],
    ["Estado", normalized.estado || normalized.status || "-"],
    ["Carga", normalized.fecha_carga || normalized.fecha || "-"],
    ["Descarga", normalized.fecha_descarga || normalized.fecha_entrega || "-"],
    ["Vehiculo", normalized.matricula || normalized.vehiculo || "Sin asignar"],
    ["Chofer", normalized.chofer_nombre || normalized.chofer || "Sin asignar"],
  ];
  return (
    <div
      style={{position:"fixed",inset:0,zIndex:520,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={e => e.target === e.currentTarget && onClose?.()}
    >
      <div style={{width:"min(720px,96vw)",maxHeight:"86vh",overflowY:"auto",background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:14,padding:18,boxShadow:"0 24px 70px rgba(15,23,42,.28)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:14}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--accent-xl)"}}>Detalle operativo</div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:20,fontWeight:900,color:"var(--text)",marginTop:4}}>{normalized.numero || normalized.pedido_numero || normalized.title || "Viaje"}</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>{normalized.description || `${route.origen || "-"} -> ${route.destino || "-"}`}</div>
          </div>
          <button onClick={onClose} style={{border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",borderRadius:8,width:34,height:34,fontSize:18,fontWeight:900,cursor:"pointer"}}>x</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:8}}>
          {facts.map(([label, value]) => (
            <div key={label} style={{border:"1px solid var(--border)",background:"var(--bg3)",borderRadius:9,padding:"9px 10px"}}>
              <div style={{fontSize:9,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>{label}</div>
              <div style={{fontSize:13,fontWeight:800,color:"var(--text)",marginTop:4,lineHeight:1.3}}>{value}</div>
            </div>
          ))}
        </div>
        {(!normalized.destino_provincia && destinationGeo?.provincia) || (!normalized.origen_provincia && originGeo?.provincia) ? (
          <div style={{marginTop:12,border:"1px solid rgba(20,184,166,.28)",background:"rgba(20,184,166,.10)",borderRadius:10,padding:"10px 12px",fontSize:12,color:"var(--text2)",lineHeight:1.45}}>
            Geografia detectada: {[originGeo && `${route.origen}: ${originGeo.provincia}`, destinationGeo && `${route.destino}: ${destinationGeo.provincia}`].filter(Boolean).join(" · ")}.
            Al guardar desde Trafico se completara en el pedido si estaba vacia.
          </div>
        ) : null}
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:14}}>
          <button onClick={() => onOpenTraffic?.(normalized)} style={{border:"1px solid rgba(20,184,166,.35)",background:"rgba(20,184,166,.12)",color:"var(--accent-xl)",borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Editar en trafico
          </button>
          <button onClick={onClose} style={{border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",borderRadius:8,padding:"8px 12px",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Volver al mapa
          </button>
        </div>
      </div>
    </div>
  );
}

function RouteMapPanelReal({ item, trips = [], onSelectTrip, onOpenDetail, mapLayer = "streets", onMapLayerChange }) {
  const normalizedItem = useMemo(() => normalizeTripForMap(item || {}) || null, [item]);
  const route = normalizedItem?.route || parseRouteFromItem(item || {});
  const selectedPoints = normalizedItem?.points || getRouteGeoPoints(route, item || {});
  const hasGps = Boolean(selectedPoints.gps);
  const title = normalizedItem?.title || item?.numero || item?.pedido_numero || "Viaje en seguimiento";
  const [providerInfo, setProviderInfo] = useState(null);
  const [routeMode, setRouteMode] = useState("camion");
  const [mapZoomDelta, setMapZoomDelta] = useState(0);

  useEffect(() => {
    let alive = true;
    getRouteProviders()
      .then(info => { if (alive) setProviderInfo(info); })
      .catch(() => { if (alive) setProviderInfo(null); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setMapZoomDelta(0);
  }, [item?.id, item?.numero, route.origen, route.destino]);

  const hereConfigured = Boolean(providerInfo?.providers?.here?.configured || providerInfo?.here?.configured);
  const mapTrips = useMemo(() => {
    const selected = normalizedItem ? [normalizedItem] : [];
    return collectMapTrips({}, [...selected, ...(Array.isArray(trips) ? trips : [])]);
  }, [trips, normalizedItem]);
  const selectedKey = tripIdentity(normalizedItem || item || {});
  const mapPoints = useMemo(() => [
    selectedPoints.origin,
    selectedPoints.destination,
    selectedPoints.gps,
    ...mapTrips.map(t => t.current),
  ].filter(Boolean), [selectedPoints, mapTrips]);
  const baseZoom = useMemo(() => fitZoomForPoints(mapPoints), [mapPoints]);
  const mapZoom = Math.max(3, Math.min(9, baseZoom + mapZoomDelta));
  const activeLayer = getMapLayer(mapLayer);
  const map = useMemo(() => getTileMapGeometry(mapPoints, mapZoom, mapLayer), [mapPoints, mapZoom, mapLayer]);
  const start = map.project(selectedPoints.origin);
  const end = map.project(selectedPoints.destination);
  const gpsPoint = map.project(selectedPoints.gps);
  const tripMarkers = mapTrips.map(trip => ({
    ...trip,
    screen: map.project(trip.current),
    selected: tripIdentity(trip) === selectedKey,
  })).filter(m => m.screen);
  const routeModes = [
    { key:"camion", label:"Camion", detail:"Perfil pesado" },
    { key:"rapida", label:"Rapida", detail:"Menor tiempo" },
    { key:"economica", label:"Economica", detail:"Menor coste" },
  ];
  const routeLabel = routeModes.find(m => m.key === routeMode)?.detail || "Ruta prevista";
  const hasRouteLine = Boolean(start && end);
  const cx = hasRouteLine ? Math.max(70, Math.min(570, (start.x + end.x) / 2)) : 320;
  const cy = hasRouteLine ? Math.max(42, Math.min(250, Math.min(start.y, end.y) - 44)) : 120;
  const routePath = hasRouteLine ? `M${start.x} ${start.y} C${cx} ${cy}, ${cx} ${cy}, ${end.x} ${end.y}` : "";
  return (
    <div style={S.card}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10}}>
        <div>
          <div style={S.sec}>Mapa operativo real</div>
          <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{title}</div>
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginTop:7}}>
            {Object.entries(MAP_LAYERS).map(([key, layer]) => (
              <button
                key={key}
                type="button"
                onClick={() => onMapLayerChange?.(key)}
                onPointerDown={() => onMapLayerChange?.(key)}
                onMouseDown={() => onMapLayerChange?.(key)}
                aria-pressed={mapLayer === key}
                title={layer.detail}
                style={{
                  border:`1px solid ${mapLayer === key ? "rgba(20,184,166,.50)" : "var(--border2)"}`,
                  background:mapLayer === key ? "rgba(15,118,110,.92)" : "var(--bg3)",
                  color:mapLayer === key ? "#fff" : "var(--text4)",
                  borderRadius:7,
                  padding:"4px 8px",
                  fontSize:10,
                  fontWeight:900,
                  cursor:"pointer",
                  fontFamily:"'DM Sans',sans-serif",
                }}
              >
                {layer.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
          <span style={{fontSize:10,fontWeight:900,color:hasGps ? "var(--green)" : "var(--accent-xl)",border:`1px solid ${hasGps ? "rgba(16,185,129,.30)" : "rgba(20,184,166,.30)"}`,background:hasGps ? "rgba(16,185,129,.10)" : "rgba(20,184,166,.10)",borderRadius:20,padding:"3px 8px"}}>
            {hasGps ? "GPS activo" : "Ruta prevista"}
          </span>
          <span style={{fontSize:10,fontWeight:900,color:"var(--text4)",border:"1px solid var(--border2)",background:"var(--bg3)",borderRadius:20,padding:"3px 8px"}}>
            {tripMarkers.length} viaje{tripMarkers.length!==1?"s":""}
          </span>
        </div>
      </div>

      <div style={{position:"relative",height:300,borderRadius:10,overflow:"hidden",border:"1px solid var(--border)",background:"linear-gradient(135deg,#dbeafe 0%,#dcfce7 45%,#f8fafc 100%)"}}>
        <div style={{position:"absolute",inset:0,opacity:.46,backgroundImage:"linear-gradient(rgba(15,23,42,.09) 1px, transparent 1px), linear-gradient(90deg, rgba(15,23,42,.08) 1px, transparent 1px), radial-gradient(circle at 22% 28%, rgba(20,184,166,.20), transparent 24%), radial-gradient(circle at 72% 68%, rgba(59,130,246,.18), transparent 26%)",backgroundSize:"42px 42px,42px 42px,100% 100%,100% 100%"}} />
        <div style={{position:"absolute",inset:0,overflow:"hidden",opacity:.96}}>
          {map.tiles.map(tile => (
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              onError={(e) => { e.currentTarget.style.display = "none"; }}
              style={{position:"absolute",left:tile.left,top:tile.top,width:256,height:256,userSelect:"none",pointerEvents:"none",filter:activeLayer.filter}}
            />
          ))}
        </div>
        <div style={{position:"absolute",inset:0,background:activeLayer.overlay}} />
        <svg viewBox="0 0 640 300" style={{position:"absolute",inset:0,width:"100%",height:"100%",pointerEvents:"none"}}>
          <defs>
            <filter id="ct-map-shadow-real" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#0f172a" floodOpacity=".10" />
            </filter>
          </defs>
          <rect width="640" height="300" fill="transparent" />
          {hasRouteLine && (
            <>
              <path d={routePath} fill="none" stroke="rgba(15,118,110,.30)" strokeWidth="9" strokeLinecap="round" filter="url(#ct-map-shadow-real)" />
              <path d={routePath} fill="none" stroke="rgba(20,184,166,.90)" strokeWidth="4" strokeLinecap="round" strokeDasharray={hasGps ? "0" : "9 9"} />
              {mapLayer === "traffic" && (
                <path d={routePath} fill="none" stroke="#f97316" strokeWidth="6" strokeLinecap="round" strokeDasharray="18 13" opacity=".78" />
              )}
              <circle cx={start.x} cy={start.y} r="10" fill="#fff" stroke="var(--accent)" strokeWidth="4" />
              <circle cx={end.x} cy={end.y} r="10" fill="#fff" stroke="var(--accent)" strokeWidth="4" />
            </>
          )}
          {hasGps && gpsPoint && (
            <g transform={`translate(${gpsPoint.x - 12} ${gpsPoint.y - 12})`}>
              <circle cx="12" cy="12" r="18" fill="rgba(16,185,129,.18)" stroke="rgba(16,185,129,.42)" />
              <rect x="3" y="7" width="18" height="10" rx="3" fill="var(--green)" />
              <circle cx="7" cy="19" r="3" fill="#fff" />
              <circle cx="19" cy="19" r="3" fill="#fff" />
            </g>
          )}
        </svg>

        {tripMarkers.map(marker => {
          const color = marker.selected ? "#0f766e" : marker.points.gps ? "#10b981" : "#3b82f6";
          return (
            <button
              key={tripIdentity(marker)}
              type="button"
              title={`${marker.numero || marker.pedido_numero || marker.title || "Viaje"} - ${marker.route?.origen || "-"} > ${marker.route?.destino || "-"}`}
              onClick={() => onSelectTrip?.(marker)}
              style={{
                position:"absolute",
                left:marker.screen.x - 12,
                top:marker.screen.y - 12,
                width:24,
                height:24,
                borderRadius:999,
                border:`3px solid ${marker.selected ? "#fff" : "rgba(255,255,255,.92)"}`,
                background:color,
                boxShadow:marker.selected ? "0 0 0 4px rgba(20,184,166,.24), 0 10px 24px rgba(15,23,42,.28)" : "0 6px 16px rgba(15,23,42,.22)",
                cursor:"pointer",
                padding:0,
                zIndex:marker.selected ? 5 : 4,
              }}
            />
          );
        })}

        <div style={{position:"absolute",right:12,bottom:14,display:"grid",overflow:"hidden",border:"1px solid rgba(148,163,184,.32)",borderRadius:8,background:"rgba(255,255,255,.90)",boxShadow:"0 8px 20px rgba(15,23,42,.08)",zIndex:6}}>
          <button onClick={() => setMapZoomDelta(z => Math.min(3, z + 1))} style={{width:34,height:32,border:"none",borderBottom:"1px solid rgba(148,163,184,.22)",background:"transparent",fontSize:18,fontWeight:900,cursor:"pointer",color:"#334155"}}>+</button>
          <button onClick={() => setMapZoomDelta(z => Math.max(-2, z - 1))} style={{width:34,height:32,border:"none",background:"transparent",fontSize:20,fontWeight:900,cursor:"pointer",color:"#334155"}}>-</button>
        </div>
        <span style={{position:"absolute",right:56,bottom:14,fontSize:9,color:"rgba(15,23,42,.62)",background:"rgba(255,255,255,.86)",border:"1px solid rgba(148,163,184,.24)",borderRadius:6,padding:"3px 6px",zIndex:6}}>
          Datos mapa: {activeLayer.attribution}
        </span>
        <div style={{position:"absolute",left:14,bottom:14,width:250,background:"rgba(255,255,255,.92)",color:"#0f172a",border:"1px solid rgba(148,163,184,.28)",borderRadius:10,padding:"10px 12px",boxShadow:"0 10px 30px rgba(15,23,42,.10)",zIndex:6}}>
          <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"#0f766e",marginBottom:5}}>{hasGps ? "Ubicacion actual" : "Ruta"}</div>
          <div style={{fontSize:12,fontWeight:900,lineHeight:1.35}}>{route.origen || "Origen"} -> {route.destino || "Destino"}</div>
          <div style={{fontSize:11,color:"#64748b",marginTop:5}}>{hasGps ? "Mostrando posicion GPS recibida." : `Sin GPS reciente: ${routeLabel.toLowerCase()}.`}</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:9}}>
            <button onClick={()=>onOpenDetail?.(normalizedItem || item)} style={{border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.10)",color:"#0f766e",borderRadius:7,padding:"6px 9px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Ver detalle
            </button>
            <button onClick={() => setMapZoomDelta(0)} style={{border:"1px solid rgba(59,130,246,.25)",background:"rgba(59,130,246,.08)",color:"#2563eb",borderRadius:7,padding:"6px 9px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Centrar
            </button>
          </div>
          {mapLayer === "traffic" && (
            <div style={{fontSize:10,color:"#b45309",fontWeight:800,marginTop:7}}>
              Trafico mostrado como capa operativa interna.
            </div>
          )}
        </div>
      </div>

      {hereConfigured && (
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10,alignItems:"center"}}>
          <span style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>Rutas HERE</span>
          {routeModes.map(mode => (
            <button
              key={mode.key}
              onClick={() => setRouteMode(mode.key)}
              style={{
                border:`1px solid ${routeMode === mode.key ? "rgba(20,184,166,.45)" : "var(--border2)"}`,
                background:routeMode === mode.key ? "rgba(20,184,166,.12)" : "var(--bg3)",
                color:routeMode === mode.key ? "var(--accent-xl)" : "var(--text4)",
                borderRadius:20,
                padding:"5px 10px",
                fontSize:11,
                fontWeight:900,
                cursor:"pointer",
                fontFamily:"'DM Sans',sans-serif",
              }}
            >
              {mode.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function DecisionsPanel({ decisiones = [] }) {
  const rows = Array.isArray(decisiones) ? decisiones.slice(0, 5) : [];
  return (
    <div style={S.card}>
      <div style={S.sec}>Gestión proactiva</div>
      {rows.length === 0 ? (
        <div style={{fontSize:12,color:"var(--text4)"}}>Sin decisiones urgentes. Operación estable para el filtro actual.</div>
      ) : (
        <div style={{display:"grid",gap:8}}>
          {rows.map((d, idx) => {
            const sev = SEV[d.severity] || SEV.info;
            return (
              <button key={d.id || idx} onClick={()=>navegar(d.view || "gestion_trafico")}
                style={{textAlign:"left",border:`1px solid ${sev.border}`,background:sev.bg,borderRadius:8,padding:"9px 11px",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center"}}>
                  <span style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{d.title}</span>
                  <span style={{fontSize:10,fontWeight:900,color:sev.color,textTransform:"uppercase"}}>{sev.label}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.3}}>{d.recommended_action}</div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function actorEventoLabel(ev = {}) {
  if (ev.actor_nombre) return ev.actor_nombre;
  if (ev.actor_email) return ev.actor_email;
  if (String(ev.actor_tipo || "").toLowerCase() === "sistema") return "Sistema";
  if (String(ev.actor_tipo || "").toLowerCase() === "cliente") return "Cliente";
  return "Usuario";
}

function accionEventoAmigable(ev = {}) {
  const tipo = String(ev.tipo || "").toLowerCase();
  const detalle = ev.detalle && typeof ev.detalle === "object" ? ev.detalle : {};
  const estado = detalle.estado_nuevo || detalle.estado || detalle.to || detalle.next_estado;
  const map = {
    "pedido.creado": "creo el pedido",
    "pedido.editado": "edito el pedido",
    "pedido.actualizado": "actualizo el pedido",
    "pedido.editado_estado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "pedido.estado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "estado.actualizado": estado ? `cambio el estado a ${estado}` : "cambio el estado",
    "documento.generado": "genero documentacion",
    "documento.firmado": "firmo documentacion",
    "ruta.enviada": "envio la ruta al conductor",
    "chofer.actualizo_pasos": "actualizo el seguimiento del viaje",
  };
  if (map[tipo]) return map[tipo];
  return tipo.replace(/^pedido[._-]?/i, "").replace(/[._-]+/g, " ").trim() || "registro actividad";
}

function EventsPanel({ eventos = [] }) {
  const rows = Array.isArray(eventos) ? eventos.slice(0, 8) : [];
  return (
    <div style={S.card}>
      <div style={S.sec}>Eventos recientes</div>
      {rows.length === 0 ? (
        <div style={{fontSize:12,color:"var(--text4)"}}>Aún no hay eventos recientes de app, portal, WhatsApp o pedidos.</div>
      ) : rows.map(ev => (
        <div key={ev.id} style={{display:"grid",gridTemplateColumns:"92px 1fr",gap:10,borderTop:"1px solid var(--border)",padding:"8px 0"}}>
          <div style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>
            {ev.created_at ? new Date(ev.created_at).toLocaleTimeString("es-ES", { hour:"2-digit", minute:"2-digit" }) : "--:--"}
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{ev.pedido_numero || "Pedido"} - {actorEventoLabel(ev)} {accionEventoAmigable(ev)}</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{ev.ruta}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ControlTower() {
  const [period, setPeriod] = useState("7d");
  const [tab, setTab] = useState("todas");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [statusPicker, setStatusPicker] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [detailTrip, setDetailTrip] = useState(null);
  const [mapLayer, setMapLayer] = useState("streets");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError("");
    getControlTower(period)
      .then(d => { if (alive) setData(d && typeof d === "object" ? d : null); })
      .catch((e) => { if (alive) { setData(null); setLoadError(e.message || "No se pudo cargar Control Tower."); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  const items = useMemo(() => Array.isArray(data?.items) ? data.items : [], [data]);
  const incidencias = useMemo(
    () => Array.isArray(data?.incidencias) ? data.incidencias : items.filter(item => item?.type === "incidencia_pedido"),
    [data, items]
  );
  const resumen = data?.resumen || {};
  const kpis = data?.kpis || {};
  const vistas = data?.vistas || {};
  const flujo = Array.isArray(data?.flujo_operativo) ? data.flujo_operativo : [];
  const viajesPorEstado = useMemo(
    () => data?.viajes_por_estado && typeof data.viajes_por_estado === "object" ? data.viajes_por_estado : {},
    [data]
  );
  const recursos = data?.recursos || {};
  const visibilidad = data?.visibilidad || {};
  const decisiones = Array.isArray(data?.decisiones) ? data.decisiones : [];
  const eventos = Array.isArray(data?.eventos_recientes) ? data.eventos_recientes : [];
  const mapTrips = useMemo(() => collectMapTrips(viajesPorEstado, items), [viajesPorEstado, items]);
  const mapItem = useMemo(() => {
    if (selectedTrip) return selectedTrip;
    const enRuta = Array.isArray(viajesPorEstado.en_curso) ? viajesPorEstado.en_curso[0] : null;
    if (enRuta) return enRuta;
    return items.find(item => ["en_ruta", "gps_sin_senal", "retraso", "incidencia_pedido"].includes(String(item?.type || ""))) ||
      items.find(item => parseRouteFromItem(item).origen && parseRouteFromItem(item).destino) ||
      null;
  }, [items, selectedTrip, viajesPorEstado]);

  function abrirEstadoFlujo(row) {
    const key = row?.key || "";
    const trips = Array.isArray(viajesPorEstado[key]) ? viajesPorEstado[key] : [];
    if (!trips.length) return;
    setStatusPicker({ ...row, trips });
  }

  function seleccionarViajeFlujo(trip) {
    setSelectedTrip({
      ...trip,
      title: `Viaje ${trip.numero || ""}`,
      entity_id: trip.id,
      view: "pedidos",
      description: `${trip.cliente_nombre || "Cliente"} - ${trip.origen || "-"} > ${trip.destino || "-"}`,
    });
    setStatusPicker(null);
  }
  function seleccionarViajeMapa(trip) {
    const route = trip?.route || parseRouteFromItem(trip || {});
    setSelectedTrip({
      ...trip,
      title: trip?.title || `Viaje ${trip?.numero || trip?.pedido_numero || ""}`.trim(),
      entity_id: trip?.entity_id || trip?.id || "",
      view: trip?.view || "pedidos",
      description: trip?.description || `${trip?.cliente_nombre || "Cliente"} - ${route.origen || "-"} > ${route.destino || "-"}`,
    });
  }
  const grupos = useMemo(() => ({
    todas: items,
    hoy: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("hoy")),
    riesgos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("riesgos")),
    rentabilidad: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("rentabilidad")),
    recursos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("recursos")),
    documentos: items.filter(item => Array.isArray(item?.buckets) && item.buckets.includes("documentos")),
    incidencias,
  }), [items, incidencias]);
  const visible = grupos[tab] || items;
  const visibleGroups = useMemo(() => {
    const grouped = visible.reduce((acc, item) => {
      const key = item?.area || "Operacion";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
    return Object.entries(grouped).sort(([a], [b]) => String(a).localeCompare(String(b), "es"));
  }, [visible]);

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:18}}>
        <div>
          <div style={S.title}>Control Tower</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Prioridades de tráfico, margen, documentos, cobros y GPS.</div>
        </div>
        <div style={{display:"flex",gap:5,background:"var(--bg3)",padding:4,borderRadius:9,border:"1px solid var(--border)"}}>
          {Object.entries(PERIODS).map(([key,label])=>(
            <button key={key} onClick={()=>setPeriod(key)} style={{padding:"5px 12px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer",background:period===key?"var(--accent)":"transparent",color:period===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div style={{...S.card,marginBottom:12,borderColor:Number(resumen.critica||0)>0?"rgba(239,68,68,.40)":Number(resumen.alta||0)>0?"rgba(249,115,22,.35)":"var(--border)"}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
          {[
            ["Activos", kpis.activos, "var(--accent-xl)"],
            ["Cargas hoy", kpis.cargas_hoy, "#f59e0b"],
            ["Descargas hoy", kpis.descargas_hoy, "var(--green)"],
            ["Criticas", resumen.critica, "#ef4444"],
            ["Altas", resumen.alta, "#f97316"],
          ].map(([label,value,color])=>(
            <div key={label} style={{border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",background:"var(--bg3)"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color}}>{Number(value || 0)}</div>
              <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      {statusPicker && (
        <div
          style={{position:"fixed",inset:0,zIndex:420,background:"rgba(15,23,42,.58)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
          onClick={e => e.target === e.currentTarget && setStatusPicker(null)}
        >
          <div style={{width:"min(680px,96vw)",maxHeight:"82vh",overflowY:"auto",background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:14,padding:18,boxShadow:"0 24px 70px rgba(15,23,42,.24)"}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontSize:18,fontWeight:900,color:"var(--text)"}}>{statusPicker.label}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Selecciona un viaje para cargar su ruta en el mapa.</div>
              </div>
              <button onClick={() => setStatusPicker(null)} style={{border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",borderRadius:8,width:34,height:34,fontSize:18,fontWeight:900,cursor:"pointer"}}>x</button>
            </div>
            <div style={{display:"grid",gap:8}}>
              {statusPicker.trips.map(trip => (
                <button
                  key={trip.id}
                  type="button"
                  onClick={() => seleccionarViajeFlujo(trip)}
                  style={{
                    textAlign:"left",
                    border:"1px solid var(--border)",
                    background:"var(--bg3)",
                    borderRadius:10,
                    padding:"10px 12px",
                    cursor:"pointer",
                    fontFamily:"'DM Sans',sans-serif",
                  }}
                >
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
                    <span style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{trip.numero || "Pedido"} - {trip.cliente_nombre || "Cliente"}</span>
                    <span style={{fontSize:11,fontWeight:900,color:"var(--accent-xl)",whiteSpace:"nowrap"}}>{trip.vehiculo_matricula || trip.colaborador_nombre || "Sin matricula"}</span>
                  </div>
                  <div style={{fontSize:12,color:"var(--text4)",marginTop:4}}>
                    {trip.origen || "-"} - {trip.destino || "-"}{trip.fecha_carga ? ` - ${String(trip.fecha_carga).slice(0,10)}` : ""}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!loading && data && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12,marginBottom:12}}>
          <div style={{display:"grid",gap:12}}>
            <FlowPanel flujo={flujo} selectedKey={statusPicker?.key || selectedTrip?.estado || ""} onStatusClick={abrirEstadoFlujo} />
            {mapItem && <RouteMapPanelReal item={mapItem} trips={mapTrips} onSelectTrip={seleccionarViajeMapa} onOpenDetail={setDetailTrip} mapLayer={mapLayer} onMapLayerChange={setMapLayer} />}
            <div style={{...S.card}}>
              <div style={S.sec}>Flota, recursos y señales</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8}}>
                <MetricBox label="Disponibles" value={recursos.disponibles} detail={`${recursos.choferes_activos || 0} choferes activos`} color="var(--green)" />
                <MetricBox label="En ruta" value={recursos.en_ruta} detail="Chóferes ocupados" color="var(--accent-xl)" />
                <MetricBox label="Vacaciones" value={recursos.vacaciones} detail={`${recursos.solicitudes_vacaciones || 0} solicitudes`} color="#8b5cf6" />
                <MetricBox label="GPS OK" value={visibilidad.gps_ok} detail={`${visibilidad.gps_enlazados || 0} enlazados`} color="var(--green)" />
                <MetricBox label="Sin señal" value={visibilidad.gps_sin_senal} detail="Revisar localización" color="#f97316" />
                <MetricBox label="Esperas" value={visibilidad.esperas_activas} detail="Carga/descarga" color="#ef4444" />
              </div>
            </div>
          </div>
          <div style={{display:"grid",gap:12}}>
            <DecisionsPanel decisiones={decisiones} />
            <EventsPanel eventos={eventos} />
          </div>
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
        <div style={{display:"flex",gap:6,background:"var(--bg3)",padding:4,borderRadius:8,border:"1px solid var(--border)",flexWrap:"wrap"}}>
          {[
            ["todas", `Todas (${vistas.todas ?? items.length})`],
            ["hoy", `Hoy (${vistas.hoy ?? grupos.hoy.length})`],
            ["riesgos", `Riesgos (${vistas.riesgos ?? grupos.riesgos.length})`],
            ["rentabilidad", `Rentabilidad (${vistas.rentabilidad ?? grupos.rentabilidad.length})`],
            ["recursos", `Recursos (${vistas.recursos ?? grupos.recursos.length})`],
            ["documentos", `Docs (${vistas.documentos ?? grupos.documentos.length})`],
            ["incidencias", `Incidencias (${vistas.incidencias ?? incidencias.length})`],
          ].map(([key,label])=>(
            <button key={key} onClick={()=>setTab(key)}
              style={{padding:"6px 11px",borderRadius:6,border:"none",fontFamily:"'DM Sans',sans-serif",fontSize:11,fontWeight:800,cursor:"pointer",background:tab===key?"var(--accent)":"transparent",color:tab===key?"#fff":"var(--text4)"}}>
              {label}
            </button>
          ))}
        </div>
        <div style={{fontSize:11,color:"var(--text5)",fontWeight:800}}>{visible.length} señales visibles</div>
      </div>

      {loading ? (
        <div style={{color:"var(--text4)",padding:40,textAlign:"center"}}>Cargando Control Tower...</div>
      ) : loadError ? (
        <div style={{...S.card,borderColor:"rgba(239,68,68,.32)",background:"rgba(239,68,68,.06)"}}>
          <div style={{fontSize:14,color:"#ef4444",fontWeight:900,marginBottom:6}}>No se pudo cargar Control Tower</div>
          <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:12}}>
            No se han perdido los viajes: la consulta al servidor ha fallado o ha tardado demasiado.
          </div>
          <button onClick={() => { setLoading(true); setLoadError(""); getControlTower(period).then(d => setData(d && typeof d === "object" ? d : null)).catch(e => setLoadError(e.message || "No se pudo cargar Control Tower.")).finally(() => setLoading(false)); }} style={{border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.10)",color:"#ef4444",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            Reintentar
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div style={S.card}>
          <div style={{fontSize:14,color:"var(--green)",fontWeight:900,marginBottom:6}}>Sin señales activas en esta vista</div>
          <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45,marginBottom:12}}>
            No se han detectado retrasos, incidencias, margen bajo, documentos pendientes, cobros en riesgo, preparación regulatoria o GPS sin señal para este filtro.
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>navegar("gestion_trafico")} style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Abrir tráfico
            </button>
            <button onClick={()=>navegar("excepciones")} style={{border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:7,padding:"7px 10px",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Ver excepciones
            </button>
          </div>
        </div>
      ) : (
        <div style={{display:"grid",gap:16}}>
          {visibleGroups.map(([area, group]) => (
            <section key={area} style={{display:"grid",gap:10}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",whiteSpace:"nowrap"}}>
                  {area}
                </div>
                <div style={{height:1,background:"var(--border)",flex:1}} />
                <div style={{fontSize:10,fontWeight:900,color:"var(--text5)",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:999,padding:"3px 8px"}}>
                  {group.length}
                </div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10}}>
                {group.map(item => <TowerItem key={item.id || `${item.type}-${item.entity_id}`} item={item} />)}
              </div>
            </section>
          ))}
        </div>
      )}
      {detailTrip && (
        <ControlTowerTripDetail
          item={detailTrip}
          onClose={() => setDetailTrip(null)}
          onOpenTraffic={(trip) => {
            setDetailTrip(null);
            abrirItem(trip);
          }}
        />
      )}
    </div>
  );
}

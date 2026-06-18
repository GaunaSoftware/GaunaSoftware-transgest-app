import { useEffect, useMemo, useState } from "react";
import { getControlTower, getRouteProviders } from "../services/api";
import { setRuntimeFocus } from "../services/runtimeFocus";

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

const MAP_SIZE = { width: 640, height: 220 };
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
  lucena: { lat: 37.4088, lng: -4.4852 },
  gandia: { lat: 38.968, lng: -0.1845 },
  santago: { lat: 40.9701, lng: -3.6434 },
};

function normalizePlaceKey(value = "") {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function coordsForPlace(value = "") {
  const key = normalizePlaceKey(value);
  if (!key) return null;
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  const match = Object.keys(CITY_COORDS).find(k => key.includes(k) || k.includes(key));
  return match ? CITY_COORDS[match] : null;
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

function getMapGeometry({ route, hasGps, gpsLat, gpsLng, zoom }) {
  const gps = hasGps ? { lat: Number(gpsLat), lng: Number(gpsLng) } : null;
  const origin = coordsForPlace(route.origen);
  const destination = coordsForPlace(route.destino);
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
        src: `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`,
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
  };
}

function parseRouteFromItem(item = {}) {
  const text = [item.ruta, item.route, item.description, item.title].filter(Boolean).join(" ");
  const match = String(text).match(/([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})\s*(?:>|->|→|a)\s*([A-ZÁÉÍÓÚÜÑ0-9 .,'/-]{2,})/i);
  const origen = item.origen || match?.[1]?.trim() || "";
  const destino = item.destino || match?.[2]?.replace(/\s+-\s+.*/, "").trim() || "";
  return { origen, destino };
}

function RouteMapPanel({ item }) {
  const route = useMemo(() => parseRouteFromItem(item || {}), [item]);
  const hasGps = Number.isFinite(Number(item?.gps_lat)) && Number.isFinite(Number(item?.gps_lng));
  const title = item?.title || item?.numero || item?.pedido_numero || "Viaje en seguimiento";
  const [providerInfo, setProviderInfo] = useState(null);
  const [routeMode, setRouteMode] = useState("camion");
  const [mapZoom, setMapZoom] = useState(6);
  useEffect(() => {
    let alive = true;
    getRouteProviders()
      .then(info => { if (alive) setProviderInfo(info); })
      .catch(() => { if (alive) setProviderInfo(null); });
    return () => { alive = false; };
  }, []);
  const hereConfigured = Boolean(providerInfo?.providers?.here?.configured || providerInfo?.here?.configured);
  const map = useMemo(() => getMapGeometry({
    route,
    hasGps,
    gpsLat: item?.gps_lat,
    gpsLng: item?.gps_lng,
    zoom: mapZoom,
  }), [route, hasGps, item?.gps_lat, item?.gps_lng, mapZoom]);
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
          <button onClick={() => setMapZoom(z => Math.min(8, z + 1))} style={{width:34,height:32,border:"none",borderBottom:"1px solid rgba(148,163,184,.22)",background:"transparent",fontSize:18,fontWeight:900,cursor:"pointer",color:"#334155"}}>+</button>
          <button onClick={() => setMapZoom(z => Math.max(5, z - 1))} style={{width:34,height:32,border:"none",background:"transparent",fontSize:20,fontWeight:900,cursor:"pointer",color:"#334155"}}>-</button>
        </div>
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" style={{position:"absolute",right:56,bottom:14,fontSize:9,color:"rgba(15,23,42,.55)",background:"rgba(255,255,255,.78)",border:"1px solid rgba(148,163,184,.24)",borderRadius:6,padding:"3px 6px",textDecoration:"none"}}>
          © OpenStreetMap
        </a>
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
            <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{ev.pedido_numero || "Pedido"} · {ev.tipo}</div>
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
  const [statusPicker, setStatusPicker] = useState(null);
  const [selectedTrip, setSelectedTrip] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    getControlTower(period)
      .then(d => { if (alive) setData(d && typeof d === "object" ? d : null); })
      .catch(() => { if (alive) setData(null); })
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
            {mapItem && <RouteMapPanel item={mapItem} />}
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
    </div>
  );
}

import { useState, useRef } from "react";
import { cambiarEstadoPedido, subirPedidoDocChofer } from "../../services/api";


import { notify } from "../../services/notify";
import { getCurrentLocation } from "../../services/mobileRuntime";
import { enqueueOfflineItem, getOfflineOwner, queueSummary, readOfflineQueue, writeOfflineQueue } from "../../services/offlineQueue";



const EC = {
  pendiente:  { l:"Pendiente",   c:"#9ca3af", bg:"rgba(156,163,175,.15)" },
  confirmado: { l:"Confirmado",  c:"#3b82f6", bg:"rgba(59,130,246,.15)" },
  espera_carga: { l:"Espera carga", c:"#eab308", bg:"rgba(234,179,8,.15)" },
  cargando: { l:"Cargando", c:"var(--accent-l)", bg:"var(--accent-a15)" },
  en_curso:   { l:"En ruta",     c:"#f97316", bg:"rgba(249,115,22,.15)" },
  espera_descarga: { l:"Espera descarga", c:"#d946ef", bg:"rgba(217,70,239,.15)" },
  descarga:   { l:"Descargando", c:"#a78bfa", bg:"rgba(167,139,250,.15)" },
  entregado:  { l:"Entregado",   c:"#10b981", bg:"rgba(16,185,129,.15)" },
  cancelado:  { l:"Cancelado",   c:"#ef4444", bg:"rgba(239,68,68,.15)" },
  incidencia: { l:"Incidencia",  c:"#fbbf24", bg:"rgba(251,191,36,.15)" },
};

const PASOS_KEY = id => `tms_chofer_pasos_${id}`;
const LEGACY_SOLICITUDES_KEY = "tms_solicitudes_mecanico";
const PROTOCOLO_CISTERNA = [
  { key:"protocolo_cisterna_epi", label:"EPI colocado", detail:"Guantes, gafas/pantalla y protección requerida para el producto." },
  { key:"protocolo_cisterna_zona", label:"Zona segura", detail:"Vehículo inmovilizado, zona acotada y sin fuentes de ignición." },
  { key:"protocolo_cisterna_tierra", label:"Toma de tierra", detail:"Puesta a tierra conectada antes de manipular mangueras." },
  { key:"protocolo_cisterna_producto", label:"Producto/cisterna verificados", detail:"Mercancía, compatibilidad, compartimento y documentación revisados." },
  { key:"protocolo_cisterna_mangueras", label:"Mangueras y válvulas OK", detail:"Conexiones, juntas, válvulas y tapas revisadas antes de carga/descarga." },
  { key:"protocolo_cisterna_fugas", label:"Sin fugas", detail:"Comprobación visual de fugas y derrames antes de iniciar operación." },
];
let choferPasosCache = {};
let solicitudesTallerCache = null;
if (typeof window !== "undefined") window.addEventListener("tms:session-cleared", () => {
  choferPasosCache = {};
  solicitudesTallerCache = [];
});

export function restoreDriverSteps(id, previous) {
  choferPasosCache[String(id)] = normalizeChoferPasos(previous);
}

function normalizeChoferPasos(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const next = {};
  [
    "carga_iniciada",
    "carga_proceso",
    "carga_ok",
    "viaje_iniciado",
    "posicionado_descarga",
    "descarga_iniciada",
    "descarga_ok",
    "albaran_carga",
    "albaran_descarga",
    "firma_entrega",
    "mercancia_confirmada",
    "firma_cargador",
    "aviso_espera_carga",
    "aviso_espera_descarga",
    "dcd_revisado",
    "dcd_disponible",
  ].forEach((key) => {
    if (source[key] !== undefined) next[key] = Boolean(source[key]);
  });
  ["km_carga", "km_descarga"].forEach((key) => {
    if (source[key] !== undefined && source[key] !== "") {
      const n = Number(source[key]);
      if (Number.isFinite(n) && n >= 0) next[key] = Math.round(n * 10) / 10;
    }
  });
  if (source.carga_ubicacion && typeof source.carga_ubicacion === "object") {
    const lat = Number(source.carga_ubicacion.lat);
    const lng = Number(source.carga_ubicacion.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      next.carga_ubicacion = {
        lat,
        lng,
        accuracy_m: source.carga_ubicacion.accuracy_m ?? null,
        captured_at: source.carga_ubicacion.captured_at || new Date().toISOString(),
      };
    }
  }
  [
    "carga_iniciada_at",
    "carga_proceso_at",
    "carga_ok_at",
    "viaje_iniciado_at",
    "posicionado_descarga_at",
    "descarga_iniciada_at",
    "descarga_ok_at",
    "albaran_carga_at",
    "albaran_descarga_at",
    "firma_entrega_at",
    "mercancia_confirmada_at",
    "firma_cargador_at",
    "aviso_espera_carga_at",
    "aviso_espera_descarga_at",
    "dcd_revisado_at",
    "dcd_disponible_at",
  ].forEach((key) => {
    if (source[key]) next[key] = String(source[key]);
  });
  ["mercancia_cargada", "mercancia_palets", "mercancia_peso_kg", "mercancia_referencia"].forEach((key) => {
    if (source[key] !== undefined) next[key] = String(source[key] || "").trim();
  });
  Object.entries(source).forEach(([key, value]) => {
    if (!key.startsWith("protocolo_")) return;
    if (key.endsWith("_at")) {
      if (value) next[key] = String(value);
    } else {
      next[key] = Boolean(value);
    }
  });
  if (source.updated_at) next.updated_at = source.updated_at;
  return next;
}

function esViajeCisterna(pedido = {}) {
  const raw = [
    pedido.vehiculo_clase,
    pedido.vehiculo_tipo,
    pedido.tipo_vehiculo,
    pedido.remolque_clase,
    pedido.remolque_tipo,
    pedido.mercancia,
    pedido.descripcion_carga,
  ].filter(Boolean).join(" ").toLowerCase();
  return /cisterna|tank|adr|liquido|líquido|granel liquido|granel líquido|combustible|gasoleo|gasoil|quimic/.test(raw);
}

function importLegacyChoferPasos(id) {
  try {
    const legacy = normalizeChoferPasos(JSON.parse(localStorage.getItem(PASOS_KEY(id)) || "{}"));
    try { localStorage.removeItem(PASOS_KEY(id)); } catch {}
    return legacy;
  } catch {
    return {};
  }
}

function leerPasosViaje(id) {
  const key = String(id || "");
  if (!key) return {};
  const cached = choferPasosCache[key];
  if (cached && typeof cached === "object") return normalizeChoferPasos(cached);
  const imported = importLegacyChoferPasos(key);
  choferPasosCache[key] = imported;
  if (typeof window !== "undefined") window.__TMS_CHOFER_PASOS = choferPasosCache;
  return imported;
}

function guardarPasosViaje(id, patch) {
  const key = String(id || "");
  const next = { ...leerPasosViaje(key), ...normalizeChoferPasos(patch), updated_at: new Date().toISOString() };
  choferPasosCache[key] = next;
  if (typeof window !== "undefined") window.__TMS_CHOFER_PASOS = choferPasosCache;
  try { localStorage.removeItem(PASOS_KEY(key)); } catch {}
  return next;
}

function leerSolicitudesCache() {
  if (Array.isArray(solicitudesTallerCache)) return solicitudesTallerCache.slice(0, 50);
  try {
    const imported = JSON.parse(localStorage.getItem(LEGACY_SOLICITUDES_KEY) || "[]");
    try { localStorage.removeItem(LEGACY_SOLICITUDES_KEY); } catch {}
    solicitudesTallerCache = Array.isArray(imported) ? imported.slice(0, 50) : [];
    if (typeof window !== "undefined") window.__TMS_SOLICITUDES_TALLER = solicitudesTallerCache;
    return solicitudesTallerCache.slice(0, 50);
  } catch {
    solicitudesTallerCache = [];
    return [];
  }
}

function guardarSolicitudesCache(items = []) {
  solicitudesTallerCache = Array.isArray(items) ? items.slice(0, 50) : [];
  if (typeof window !== "undefined") window.__TMS_SOLICITUDES_TALLER = solicitudesTallerCache;
  try { localStorage.removeItem(LEGACY_SOLICITUDES_KEY); } catch {}
  return solicitudesTallerCache.slice(0, 50);
}

function leerOfflineQueue() {
  return readOfflineQueue();
}

function guardarOfflineQueue(items = []) {
  return writeOfflineQueue(items);
}

function encolarOffline(item) {
  return enqueueOfflineItem(item);
}

export function createDriverOfflineActions() {
  const owner = getOfflineOwner();
  const enqueue = item => enqueueOfflineItem(item, owner);
  return {encolarOffline: enqueue, queueOfflineCriticalAction(item, message = "Guardado pendiente de sincronizar") {
    const queue = enqueue(item);
    if(owner && owner === getOfflineOwner()) {
      const summary = queueSummary(queue);
      notify(`${message}. ${summary.pending} pendiente${summary.pending === 1 ? "" : "s"}.`, "warning");
    }
    return queue;
  }};
}

function payloadSizeKb(payload = {}) {
  try { return Math.round(JSON.stringify(payload).length / 1024); }
  catch { return 0; }
}

function esErrorOffline(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("no se pudo conectar con el servidor") ||
    msg.includes("la conexión con el servidor se ha cortado") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("fetch failed")
  );
}

function queueOfflineCriticalAction(item, successMessage = "Guardado pendiente de sincronizar") {
  const queue = encolarOffline(item);
  const summary = queueSummary(queue);
  notify(`${successMessage}. ${summary.pending} pendiente${summary.pending === 1 ? "" : "s"}.`, "warning");
  return queue;
}

function faseLabel(fase) {
  if (fase === "carga") return "Carga";
  if (fase === "descarga") return "Descarga";
  return "Ruta";
}

function leerArchivoComoDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cargarImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

function detectarRectanguloPapel(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return { x: 0, y: 0, w: canvas.width, h: canvas.height, detected: false };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  const lumaAt = (x, y) => {
    const i = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
    return data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  };
  const corner = Math.max(8, Math.round(Math.min(w, h) * 0.04));
  const bgSamples = [];
  for (let y = 0; y < corner; y += 3) {
    for (let x = 0; x < corner; x += 3) {
      bgSamples.push(lumaAt(x, y), lumaAt(w - 1 - x, y), lumaAt(x, h - 1 - y), lumaAt(w - 1 - x, h - 1 - y));
    }
  }
  const bg = bgSamples.reduce((sum, v) => sum + v, 0) / Math.max(1, bgSamples.length);
  const step = Math.max(3, Math.round(Math.min(w, h) / 260));
  const margin = Math.max(step * 2, Math.round(Math.min(w, h) * 0.02));
  let minX = w, minY = h, maxX = 0, maxY = 0, hits = 0;
  let strongMinX = w, strongMinY = h, strongMaxX = 0, strongMaxY = 0, strongHits = 0;
  for (let y = margin; y < h - margin; y += step) {
    for (let x = margin; x < w - margin; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const edge = Math.max(Math.abs(lum - lumaAt(x + step, y)), Math.abs(lum - lumaAt(x, y + step)));
      const looksPaper = (lum > 142 && sat < 88 && Math.abs(lum - bg) > 8) || (lum > 188 && sat < 105) || edge > 46;
      if (!looksPaper) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const strongPaper = lum > 166 && sat < 78 && Math.abs(lum - bg) > 14;
      if (strongPaper) {
        strongHits += 1;
        if (x < strongMinX) strongMinX = x;
        if (x > strongMaxX) strongMaxX = x;
        if (y < strongMinY) strongMinY = y;
        if (y > strongMaxY) strongMaxY = y;
      }
    }
  }
  const hitRatio = hits / Math.max(1, ((w - margin * 2) / step) * ((h - margin * 2) / step));
  if (!hits || hitRatio < 0.015) return { x: 0, y: 0, w, h, detected: false };
  const strongArea = strongHits ? ((strongMaxX - strongMinX) * (strongMaxY - strongMinY)) / Math.max(1, w * h) : 0;
  if (strongHits > hits * 0.22 && strongArea > 0.18 && strongArea < 0.96) {
    minX = strongMinX;
    minY = strongMinY;
    maxX = strongMaxX;
    maxY = strongMaxY;
  }
  const pad = Math.round(Math.min(w, h) * 0.025);
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w, maxX + pad);
  maxY = Math.min(h, maxY + pad);
  const bw = Math.max(1, maxX - minX);
  const bh = Math.max(1, maxY - minY);
  const areaRatio = (bw * bh) / Math.max(1, w * h);
  if (areaRatio < 0.18 || areaRatio > 0.985) return { x: 0, y: 0, w, h, detected: areaRatio > 0.72 };
  return { x: minX, y: minY, w: bw, h: bh, detected: true };
}

function recortarCanvas(canvas, rect) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(rect.w));
  out.height = Math.max(1, Math.round(rect.h));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, rect.x, rect.y, rect.w, rect.h, 0, 0, out.width, out.height);
  return out;
}

function limpiarCanvasComoEscaner(canvas) {
  const out = document.createElement("canvas");
  out.width = canvas.width;
  out.height = canvas.height;
  const ctx = out.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(canvas, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    const normalized = gray > 218 ? 255 : gray < 72 ? 0 : Math.round(((gray - 72) / 146) * 255);
    const scan = gray < 160 ? Math.max(0, normalized - 22) : Math.min(255, normalized + 18);
    d[i] = scan;
    d[i + 1] = scan;
    d[i + 2] = scan;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

async function prepararArchivoEscaner(file) {
  const dataUrl = await leerArchivoComoDataUrl(file);
  if (!file.type?.startsWith("image/")) {
    return {
      preview: "",
      base64: String(dataUrl).split(",")[1] || "",
      mime: file.type || "application/pdf",
      sizeKb: Math.max(1, Math.round(file.size / 1024)),
    };
  }

  const img = await cargarImagen(dataUrl);
  const maxSide = 1350;
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = "contrast(1.05) brightness(1.02)";
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  ctx.filter = "none";
  const rect = detectarRectanguloPapel(canvas);
  const recortado = recortarCanvas(canvas, rect);
  const escaneado = limpiarCanvasComoEscaner(recortado);
  let quality = 0.82;
  let out = escaneado.toDataURL("image/jpeg", quality);
  while (out.length > 3600000 && quality > 0.58) {
    quality -= 0.08;
    out = escaneado.toDataURL("image/jpeg", quality);
  }
  return {
    preview: out,
    base64: out.split(",")[1] || "",
    mime: "image/jpeg",
    sizeKb: Math.max(1, Math.round((out.length * 0.75) / 1024)),
    scan_detected: rect.detected,
    scan_crop: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    scan_quality: Math.round(quality * 100) / 100,
  };
}

async function capturarUbicacionActual(timeoutMs = 4500) {
  const loc = await getCurrentLocation({ enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 });
  if (!loc) return null;
  return {
    lat: loc.lat,
    lng: loc.lng,
    accuracy_m: Math.round(Number(loc.accuracy_m || 0)),
    captured_at: loc.captured_at || new Date().toISOString(),
  };
}

function buildUploadEvidence(kind, location) {
  const at = new Date().toISOString();
  const evidence = {
    source: "app_chofer",
    kind,
    captured_at: at,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    location: location || null,
  };
  const locText = location
    ? `ubicacion ${location.lat.toFixed(6)},${location.lng.toFixed(6)} precision ${location.accuracy_m || "-"}m`
    : "ubicación no disponible";
  return {
    evidence,
    note: `Evidencia app chofer: ${new Date(at).toLocaleString("es-ES")} - ${locText}`,
  };
}

function direccionCompletaPuntoChofer(punto = {}) {
  return [
    punto.direccion,
    punto.codigo_postal,
    punto.ciudad,
    punto.provincia,
    punto.pais,
  ].map(x => String(x || "").trim()).filter(Boolean).join(", ");
}

function puntoCargaToPedidoStop(punto = {}, fallbackDate = "", fallbackTime = "") {
  const direccion = direccionCompletaPuntoChofer(punto) || punto.direccion || punto.nombre || "";
  return {
    nombre: punto.nombre || direccion,
    direccion,
    cliente_nombre: punto.nombre || "",
    fecha: fallbackDate || "",
    hora: fallbackTime || "",
    ventana: punto.ventana || "",
    notas: punto.pendiente_revision ? "Punto creado por chófer pendiente de revisión de tráfico" : (punto.notas || ""),
    pais: punto.pais || "Espana",
    provincia: punto.provincia || "",
    google_maps_url: punto.google_maps_url || punto.metadata?.google_maps_url || "",
    lat: punto.lat ?? null,
    lng: punto.lng ?? null,
    punto_interes_id: punto.id || null,
    pendiente_revision: Boolean(punto.pendiente_revision || punto.metadata?.pending_review),
  };
}

function Mini({ label, value }) {
  return <div className="driver-mini"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

// Firma canvas
function FirmaCanvas({ pedido, onFirma, onCancel, title = "Confirmación de entrega", detail = "", confirmLabel = "Confirmar", placeholder = "Nombre y apellidos de quien firma" }){
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const hasInk = useRef(false);
  const lastPt    = useRef(null);
  const [firmaNombre, setFirmaNombre] = useState("");

  function getPos(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: (src.clientX - rect.left) * canvas.width / rect.width, y: (src.clientY - rect.top) * canvas.height / rect.height };
  }
  function start(e){ e.preventDefault(); drawing.current=true; lastPt.current=getPos(e,canvasRef.current); }
  function move(e){
    e.preventDefault();
    if(!drawing.current) return;
    const ctx=canvasRef.current.getContext("2d");
    const pt=getPos(e,canvasRef.current);
    ctx.beginPath(); ctx.strokeStyle="#111"; ctx.lineWidth=2.5; ctx.lineCap="round";
    ctx.moveTo(lastPt.current.x,lastPt.current.y);
    ctx.lineTo(pt.x,pt.y); ctx.stroke();
    if (Math.hypot(pt.x-lastPt.current.x,pt.y-lastPt.current.y)>1) hasInk.current=true;
    lastPt.current=pt;
  }
  function end(){ drawing.current=false; }
  function limpiar(){ const ctx=canvasRef.current.getContext("2d"); ctx.clearRect(0,0,300,150); hasInk.current=false; }
  function confirmar(){
    if (!String(firmaNombre || "").trim()) {
      notify("Indica el nombre de quien firma la entrega", "warning");
      return;
    }
    if (!hasInk.current) { notify("Firma en el recuadro antes de continuar.", "warning"); return; }
    onFirma(canvasRef.current.toDataURL("image/png"), String(firmaNombre || "").trim());
  }

  return(
    <div role="dialog" aria-modal="true" aria-label={title} className="driver-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:500,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:16,width:"min(340px,95vw)"}}>
        <div style={{fontWeight:700,fontSize:15,color:"#111",marginBottom:8,textAlign:"center"}}>{title}</div>
        <div style={{fontSize:14,color:"#666",marginBottom:10,textAlign:"center"}}>
          Documento interno de entrega correcta. Origen: {pedido?.origen || "-"} · Destino: {pedido?.destino || "-"} · Mercancía: {pedido?.mercancia || pedido?.descripcion_carga || "-"}
        </div>
        <input aria-label="Nombre y apellidos de quien firma" value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)} placeholder="Nombre y apellidos de quien firma"
          style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:8,padding:"9px 10px",fontSize:14,marginBottom:10,color:"#111"}}/>
        <canvas ref={canvasRef} width={300} height={150}
          style={{border:"2px solid #ddd",borderRadius:8,width:"100%",height:150,touchAction:"none",background:"#fafafa"}}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start(e);}} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={limpiar} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:14,fontWeight:600,cursor:"pointer"}}>Borrar</button>
          <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:14,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={confirmar} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer"}}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function FirmaLaboralCanvas({ title = "Firma", detail = "", defaultName = "", onFirma, onCancel, required = false }){
  const canvasRef = useRef(null);
  const hasInk = useRef(false);
  const drawing = useRef(false);
  const lastPt = useRef(null);
  const [firmaNombre, setFirmaNombre] = useState(defaultName || "");

  function getPos(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: (src.clientX - rect.left) * canvas.width / rect.width, y: (src.clientY - rect.top) * canvas.height / rect.height };
  }
  function start(e){ e.preventDefault(); drawing.current=true; lastPt.current=getPos(e,canvasRef.current); }
  function move(e){
    e.preventDefault();
    if(!drawing.current) return;
    const ctx=canvasRef.current.getContext("2d");
    const pt=getPos(e,canvasRef.current);
    ctx.beginPath(); ctx.strokeStyle="#111"; ctx.lineWidth=2.5; ctx.lineCap="round";
    ctx.moveTo(lastPt.current.x,lastPt.current.y);
    ctx.lineTo(pt.x,pt.y); ctx.stroke();
    if (Math.hypot(pt.x-lastPt.current.x,pt.y-lastPt.current.y)>1) hasInk.current=true;
    lastPt.current=pt;
  }
  function end(){ drawing.current=false; }
  function limpiar(){ const ctx=canvasRef.current.getContext("2d"); ctx.clearRect(0,0,300,150); hasInk.current=false; }
  function confirmar(){
    const nombre = String(firmaNombre || "").trim();
    if (!nombre) { notify("Indica nombre y apellidos para firmar", "warning"); return; }
    if (!hasInk.current) { notify("Firma en el recuadro antes de continuar.", "warning"); return; }
    onFirma?.({ firma_png: canvasRef.current.toDataURL("image/png"), nombre, user_agent: navigator.userAgent, at: new Date().toISOString() });
  }

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="driver-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:520,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:16,width:"min(360px,95vw)"}}>
        <div style={{fontWeight:800,fontSize:15,color:"#111",marginBottom:6,textAlign:"center"}}>{title}</div>
        {detail && <div style={{fontSize:14,color:"#666",marginBottom:10,textAlign:"center",lineHeight:1.35}}>{detail}</div>}
        <input aria-label="Nombre y apellidos" value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)} placeholder="Nombre y apellidos"
          style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:8,padding:"9px 10px",fontSize:14,marginBottom:10,color:"#111"}}/>
        <canvas ref={canvasRef} width={300} height={150}
          style={{border:"2px solid #ddd",borderRadius:8,width:"100%",height:150,touchAction:"none",background:"#fafafa"}}
          onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);start(e);}} onPointerMove={move} onPointerUp={end} onPointerCancel={end}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={limpiar} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:14,fontWeight:600,cursor:"pointer"}}>Borrar</button>
          {!required && (
            <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:14,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          )}
          <button onClick={confirmar} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:14,fontWeight:800,cursor:"pointer"}}>Firmar</button>
        </div>
        {required && (
          <div style={{marginTop:10,fontSize:14,color:"#92400e",background:"#fff7ed",border:"1px solid #fed7aa",borderRadius:8,padding:"8px 10px",lineHeight:1.35}}>
            La firma es obligatoria para usar la app. Se guardará en tu ficha de chófer y podrás cambiarla después desde Datos.
          </div>
        )}
      </div>
    </div>
  );
}

// Modal de incidencia
function ModalIncidencia({ pedido, fase="ruta", onClose, onGuardado }){
  const [{encolarOffline, queueOfflineCriticalAction}] = useState(createDriverOfflineActions);
  const [texto,setTexto]=useState("");
  const [archivo,setArchivo]=useState(null);
  const [doc,setDoc]=useState(null);
  const [procesando,setProcesando]=useState(false);
  const [guardando,setGuardando]=useState(false);
  const [error,setError]=useState("");
  const inputId = `incidencia-${fase}-${pedido.id}`;

  async function seleccionarFoto(e) {
    const file = e.target.files?.[0];
    setError("");
    setArchivo(null);
    setDoc(null);
    if (!file) return;
    setProcesando(true);
    try {
      const preparado = await prepararArchivoEscaner(file);
      if (preparado.base64.length > 5000000) {
        throw new Error("La foto es demasiado grande. Hazla con menos zoom o elige otra imagen.");
      }
      setArchivo(file);
      setDoc(preparado);
    } catch (err) {
      setError(err.message || "No se pudo preparar la foto");
    } finally {
      setProcesando(false);
    }
  }

  async function guardar(){
    if(!texto.trim()){notify("Describe la incidencia", "warning");return;}
    setGuardando(true);
    setError("");
    const incidenciaPayload = { incidencia: `[${faseLabel(fase)}] ${texto}` };
    let uploadPayload = null;
    try {
      if (doc) {
        const location = await capturarUbicacionActual();
        const uploadEvidence = buildUploadEvidence(`incidencia_${fase}`, location);
        uploadPayload = {
          nombre: `Incidencia ${faseLabel(fase)} - ${pedido.numero || pedido.id}`,
          tipo: "incidencia_chofer",
          file_base64: doc.base64,
          file_mime: doc.mime,
          file_size_kb: doc.sizeKb,
          notas: `${texto}\n\n${uploadEvidence.note}`,
          metadata: uploadEvidence.evidence,
        };
      }
      await cambiarEstadoPedido(pedido.id, "incidencia", incidenciaPayload);
      if (doc) {
        await subirPedidoDocChofer(pedido.id, uploadPayload);
      }
      onGuardado();
    } catch (err) {
      if (esErrorOffline(err)) {
        try {
          queueOfflineCriticalAction({
            tipo: "pedido_estado",
            pedido_id: pedido.id,
            estado: "incidencia",
            body: incidenciaPayload,
            dedupe_key: `pedido_estado:${pedido.id}:incidencia:${Date.now()}`,
            fecha: new Date().toISOString(),
          }, "Incidencia guardada para sincronizar");
          if (uploadPayload) {
            if (payloadSizeKb(uploadPayload) > 4200) {
              throw new Error("La foto se queda fuera de la cola porque pesa demasiado. Sube la evidencia cuando vuelva la cobertura.");
            }
            encolarOffline({
              tipo: "pedido_doc_chofer",
              pedido_id: pedido.id,
              body: uploadPayload,
              dedupe_key: `pedido_doc_empresa:${pedido.id}:${uploadPayload.tipo}:${uploadPayload.metadata?.captured_at || Date.now()}`,
              fecha: new Date().toISOString(),
            });
          }
          onGuardado();
          return;
        } catch (queueErr) {
          setError(queueErr.message || "No se pudo guardar la incidencia sin conexión");
          return;
        }
      }
      setError(err.message || "No se pudo registrar la incidencia");
    } finally {
      setGuardando(false);
    }
  }
  return(
    <div className="driver-overlay" style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",borderRadius:12,padding:20,width:"min(360px,95vw)"}}>
        <div style={{fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Registrar incidencia</div>
        <div style={{fontSize:14,color:"var(--text5)",marginBottom:10}}>Fase: {faseLabel(fase)}</div>
        <textarea aria-label="Describe el problema: retraso, accidente, mercancía danada..." value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Describe el problema: retraso, accidente, mercancía danada..."
          style={{width:"100%",minHeight:100,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",resize:"none",boxSizing:"border-box"}}/>
        <input id={inputId} type="file" accept="image/*" capture="environment" onChange={seleccionarFoto} style={{display:"none"}}/>
        <button onClick={()=>document.getElementById(inputId)?.click()} disabled={procesando}
          style={{width:"100%",marginTop:10,padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          {procesando ? "Preparando foto..." : archivo ? `Foto adjunta: ${archivo.name}` : "Adjuntar foto de la incidencia"}
        </button>
        {doc?.preview && (
          <img src={doc.preview} alt="Vista previa albarán" style={{width:"100%",height:190,objectFit:"cover",display:"block",background:"#111827"}}/>
        )}
        {error && <div style={{fontSize:14,color:"#ef4444",marginTop:8}}>{error}</div>}
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Cancelar</button>
          <button onClick={guardar} disabled={guardando} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#fbbf24",color:"#111",fontWeight:700,cursor:guardando?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>{guardando ? "Guardando..." : "Registrar"}</button>
        </div>
      </div>
    </div>
  );
}

// Tarjeta de viaje movil
function EscanerAlbaran({ pedido, fase, onUploaded }) {
  const [{queueOfflineCriticalAction}] = useState(createDriverOfflineActions);
  const [procesando, setProcesando] = useState(false);
  const [subiendo, setSubiendo] = useState(false);
  const [archivo, setArchivo] = useState(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState("");
  const cameraInputId = `albaran-camera-${fase}-${pedido.id}`;
  const fileInputId = `albaran-file-${fase}-${pedido.id}`;

  async function seleccionarArchivo(e) {
    const file = e.target.files?.[0];
    setError("");
    setArchivo(null);
    setDoc(null);
    if (!file) return;
    setProcesando(true);
    try {
      const preparado = await prepararArchivoEscaner(file);
      if (preparado.base64.length > 4000000 || Number(preparado.sizeKb || 0) > 3072) {
        throw new Error("El archivo es demasiado grande. Haz la foto con el documento mas cerca y buena luz, o usa una imagen mas ligera.");
      }
      setArchivo(file);
      setDoc(preparado);
    } catch (err) {
      setError(err.message || "No se pudo preparar el archivo");
    } finally {
      setProcesando(false);
      try { e.target.value = ""; } catch {}
    }
  }

  async function subir() {
    if (!archivo || !doc) return;
    setSubiendo(true);
    setError("");
    let tipo = fase === "carga" ? "albaran_carga" : "albaran_descarga";
    let uploadPayload = null;
    try {
      const location = await capturarUbicacionActual();
      const uploadEvidence = buildUploadEvidence(tipo, location);
      uploadPayload = {
        nombre: `${faseLabel(fase)} - albaran ${pedido.numero || pedido.id}`,
        tipo,
        file_base64: doc.base64,
        file_mime: doc.mime,
        file_size_kb: doc.sizeKb,
        notas: `Subido desde app chofer en fase ${faseLabel(fase)}\n${uploadEvidence.note}`,
        metadata: {
          ...uploadEvidence.evidence,
          scan: {
            detected: !!doc.scan_detected,
            crop: doc.scan_crop || null,
            quality: doc.scan_quality || null,
            size_kb: doc.sizeKb || null,
          },
        },
      };
      await subirPedidoDocChofer(pedido.id, uploadPayload);
      setArchivo(null);
      setDoc(null);
      await onUploaded?.(tipo);
    } catch (err) {
      if (esErrorOffline(err) && uploadPayload) {
        try {
          if (payloadSizeKb(uploadPayload) > 4200) {
            throw new Error("El archivo es demasiado grande para guardarlo sin conexión. Inténtalo cuando vuelva la cobertura.");
          }
          queueOfflineCriticalAction({
            tipo: "pedido_doc_chofer",
            pedido_id: pedido.id,
            body: uploadPayload,
            dedupe_key: `pedido_doc_chofer:${pedido.id}:${tipo}:${uploadPayload.metadata?.captured_at || Date.now()}`,
            fecha: new Date().toISOString(),
          }, "Albarán guardado para sincronizar");
          setArchivo(null);
          setDoc(null);
          await onUploaded?.(tipo);
          return;
        } catch (queueErr) {
          setError(queueErr.message || "No se pudo guardar el albarán sin conexión");
          return;
        }
      }
      setError(err.message || "No se pudo subir el albarán");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div style={{border:"1px solid var(--border)",background:"var(--bg4)",borderRadius:10,padding:12,marginTop:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>Albarán de {faseLabel(fase).toLowerCase()}</div>
          <div style={{fontSize:14,color:"var(--text5)"}}>Encuadra el documento y súbelo al viaje</div>
        </div>
        <span style={{fontSize:12,fontWeight:800,color:"#3b82f6",background:"rgba(59,130,246,.12)",padding:"3px 8px",borderRadius:20}}>ESCÁNER</span>
      </div>

      <div
        style={{display:"block",position:"relative",minHeight:150,border:"2px dashed rgba(59,130,246,.55)",borderRadius:10,background:"#111827",overflow:"hidden"}}>
        {doc?.preview ? (
          <img src={doc.preview} alt="Vista previa albarán" style={{width:"100%",height:190,objectFit:"cover",display:"block",background:"#111827"}}/>
        ) : (
          <div style={{height:170,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#e5e7eb",textAlign:"center",padding:18,boxSizing:"border-box"}}>
          <div style={{fontSize:14,fontWeight:800,marginBottom:6}}>Coloca el albarán dentro del marco</div>
            <div style={{fontSize:14,lineHeight:1.45,color:"#cbd5e1"}}>La app detecta el papel, recorta el fondo y lo guarda con aspecto de escáner. Buena luz y esquinas visibles ayudan mucho.</div>
          </div>
        )}
        {["tl","tr","bl","br"].map(pos => (
          <span key={pos} style={{
            position:"absolute",width:28,height:28,borderColor:"#60a5fa",
            borderTop:pos.includes("t")?"3px solid":"none",
            borderBottom:pos.includes("b")?"3px solid":"none",
            borderLeft:pos.includes("l")?"3px solid":"none",
            borderRight:pos.includes("r")?"3px solid":"none",
            top:pos.includes("t")?10:"auto",bottom:pos.includes("b")?10:"auto",
            left:pos.includes("l")?10:"auto",right:pos.includes("r")?10:"auto",
          }}/>
        ))}
      </div>
      <input id={cameraInputId} type="file" accept="image/*" capture="environment" onChange={seleccionarArchivo} style={{display:"none"}}/>
      <input id={fileInputId} type="file" accept="image/*,application/pdf" onChange={seleccionarArchivo} style={{display:"none"}}/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:9}}>
        <button type="button" disabled={procesando || subiendo} onClick={()=>document.getElementById(cameraInputId)?.click()}
          style={{padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.35)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Abrir cámara
        </button>
        <button type="button" disabled={procesando || subiendo} onClick={()=>document.getElementById(fileInputId)?.click()}
          style={{padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:14,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Elegir archivo
        </button>
      </div>

      {archivo && (
        <div style={{fontSize:14,color:"var(--text4)",marginTop:7}}>
          Preparado: <strong style={{color:"var(--text)"}}>{archivo.name}</strong> - {doc?.sizeKb || Math.round(archivo.size/1024)} KB
          {doc?.mime?.startsWith("image/") && (
            <span style={{display:"block",marginTop:3,color:doc.scan_detected ? "#10b981" : "#f59e0b",fontWeight:800}}>
              {doc.scan_detected ? "Documento detectado y recortado automáticamente." : "Imagen limpiada como escáner; no se detectaron bien los bordes del papel."}
            </span>
          )}
        </div>
      )}
      {error && <div style={{fontSize:14,color:"#ef4444",marginTop:8}}>{error}</div>}

      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={subir} disabled={!doc || subiendo}
          style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:doc ? "#10b981" : "var(--border2)",color:"#fff",fontWeight:800,fontSize:14,cursor:doc?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif"}}>
          {subiendo ? "Subiendo..." : "Adjuntar"}
        </button>
      </div>
    </div>
  );
}

function segundosDesdeIso(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 1000));
}

function fmtDuracionSegundos(segundos) {
  const n = Math.max(0, Number(segundos) || 0);
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = n % 60;
  if (h) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}


export { normalizeChoferPasos, esViajeCisterna, importLegacyChoferPasos, leerPasosViaje, guardarPasosViaje, leerSolicitudesCache, guardarSolicitudesCache, leerOfflineQueue, guardarOfflineQueue, encolarOffline, payloadSizeKb, esErrorOffline, queueOfflineCriticalAction, faseLabel, leerArchivoComoDataUrl, cargarImagen, detectarRectanguloPapel, recortarCanvas, limpiarCanvasComoEscaner, prepararArchivoEscaner, capturarUbicacionActual, buildUploadEvidence, direccionCompletaPuntoChofer, puntoCargaToPedidoStop, Mini, FirmaCanvas, FirmaLaboralCanvas, ModalIncidencia, EscanerAlbaran, segundosDesdeIso, fmtDuracionSegundos, EC, PROTOCOLO_CISTERNA };

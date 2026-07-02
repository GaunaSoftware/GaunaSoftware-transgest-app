import { useState, useEffect, useRef, useCallback } from "react";
import { getPedidos, crearPedidoChofer, getChoferClientes, getChoferClientePuntosCarga, crearChoferClientePuntoCarga, getChoferClienteRutas, crearChoferRuta, cambiarEstadoPedido, editarPedido, guardarFirmaEntrega, actualizarGpsPedido, registrarGpsChoferApp, getTallerSolicitudes, getTallerSolicitudCapacidades, crearTallerSolicitud, subirPedidoDoc, subirPedidoDocChofer, getPedidoDocumentoControl, registrarPedidoDocumentoControlEvento, getPedidoChoferPasos, guardarPedidoChoferPasos, getToken, getChoferJornadaApp, iniciarChoferJornada, cambiarChoferJornadaActividad, cerrarChoferJornada, getChoferConjuntoApp, cambiarChoferConjuntoApp, guardarChoferFirmaBaseApp, getChoferVacacionesApp, solicitarChoferVacacionesApp, firmarChoferVacacionesApp, getNotificaciones, marcarNotificacionLeida } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";

const EC = {
  pendiente:  { l:"Pendiente",   c:"#9ca3af", bg:"rgba(156,163,175,.15)" },
  confirmado: { l:"Confirmado",  c:"#3b82f6", bg:"rgba(59,130,246,.15)" },
  en_curso:   { l:"En ruta",     c:"#f97316", bg:"rgba(249,115,22,.15)" },
  descarga:   { l:"Descargando", c:"#a78bfa", bg:"rgba(167,139,250,.15)" },
  entregado:  { l:"Entregado",   c:"#10b981", bg:"rgba(16,185,129,.15)" },
  cancelado:  { l:"Cancelado",   c:"#ef4444", bg:"rgba(239,68,68,.15)" },
  incidencia: { l:"Incidencia",  c:"#fbbf24", bg:"rgba(251,191,36,.15)" },
};

const PASOS_KEY = id => `tms_chofer_pasos_${id}`;
const OFFLINE_QUEUE_KEY = "tms_offline_queue";
const LEGACY_SOLICITUDES_KEY = "tms_solicitudes_mecanico";
const PROTOCOLO_CISTERNA = [
  { key:"protocolo_cisterna_epi", label:"EPI colocado", detail:"Guantes, gafas/pantalla y proteccion requerida para el producto." },
  { key:"protocolo_cisterna_zona", label:"Zona segura", detail:"Vehiculo inmovilizado, zona acotada y sin fuentes de ignicion." },
  { key:"protocolo_cisterna_tierra", label:"Toma de tierra", detail:"Puesta a tierra conectada antes de manipular mangueras." },
  { key:"protocolo_cisterna_producto", label:"Producto/cisterna verificados", detail:"Mercancia, compatibilidad, compartimento y documentacion revisados." },
  { key:"protocolo_cisterna_mangueras", label:"Mangueras y valvulas OK", detail:"Conexiones, juntas, valvulas y tapas revisadas antes de carga/descarga." },
  { key:"protocolo_cisterna_fugas", label:"Sin fugas", detail:"Comprobacion visual de fugas y derrames antes de iniciar operacion." },
];
let choferPasosCache = {};
let solicitudesTallerCache = null;

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
  try { return JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]"); }
  catch { return []; }
}

function guardarOfflineQueue(items = []) {
  const next = Array.isArray(items) ? items.slice(-100) : [];
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
  try {
    window.dispatchEvent(new CustomEvent("tms:offline-queue-changed", { detail: next }));
  } catch {}
  return next;
}

function esErrorOffline(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("no se pudo conectar con el servidor") ||
    msg.includes("la conexion con el servidor se ha cortado") ||
    msg.includes("failed to fetch") ||
    msg.includes("network request failed") ||
    msg.includes("fetch failed")
  );
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
  for (let y = margin; y < h - margin; y += step) {
    for (let x = margin; x < w - margin; x += step) {
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const sat = max - min;
      const lum = r * 0.299 + g * 0.587 + b * 0.114;
      const edge = Math.max(Math.abs(lum - lumaAt(x + step, y)), Math.abs(lum - lumaAt(x, y + step)));
      const looksPaper = (lum > 145 && sat < 70 && Math.abs(lum - bg) > 10) || (lum > 178 && sat < 92) || edge > 42;
      if (!looksPaper) continue;
      hits += 1;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const hitRatio = hits / Math.max(1, ((w - margin * 2) / step) * ((h - margin * 2) / step));
  if (!hits || hitRatio < 0.015) return { x: 0, y: 0, w, h, detected: false };
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
  const maxSide = 1600;
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
  const out = escaneado.toDataURL("image/jpeg", 0.88);
  return {
    preview: out,
    base64: out.split(",")[1] || "",
    mime: "image/jpeg",
    sizeKb: Math.max(1, Math.round((out.length * 0.75) / 1024)),
    scan_detected: rect.detected,
    scan_crop: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
  };
}

function capturarUbicacionActual(timeoutMs = 4500) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.resolve(null);
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: Number(pos.coords.latitude),
        lng: Number(pos.coords.longitude),
        accuracy_m: Math.round(Number(pos.coords.accuracy || 0)),
        captured_at: new Date().toISOString(),
      }),
      () => resolve(null),
      { enableHighAccuracy:true, timeout:timeoutMs, maximumAge:60000 }
    );
  });
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
    : "ubicacion no disponible";
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
    notas: punto.pendiente_revision ? "Punto creado por chofer pendiente de revision de trafico" : (punto.notas || ""),
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
  return (
    <div style={{background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px"}}>
      <div style={{fontSize:9,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",fontWeight:800}}>{label}</div>
      <div style={{marginTop:2,color:"var(--text)",fontSize:12,fontWeight:800}}>{value || "-"}</div>
    </div>
  );
}

// Firma canvas
function FirmaCanvas({ pedido, onFirma, onCancel, title = "Confirmacion de entrega", detail = "", confirmLabel = "Confirmar", placeholder = "Nombre y apellidos de quien firma" }){
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const lastPt    = useRef(null);
  const [firmaNombre, setFirmaNombre] = useState("");

  function getPos(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
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
    lastPt.current=pt;
  }
  function end(){ drawing.current=false; }
  function limpiar(){ const ctx=canvasRef.current.getContext("2d"); ctx.clearRect(0,0,300,150); }
  function confirmar(){
    if (!String(firmaNombre || "").trim()) {
      notify("Indica el nombre de quien firma la entrega", "warning");
      return;
    }
    onFirma(canvasRef.current.toDataURL("image/png"), String(firmaNombre || "").trim());
  }

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:500,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:16,width:"min(340px,95vw)"}}>
        <div style={{fontWeight:700,fontSize:15,color:"#111",marginBottom:8,textAlign:"center"}}>{title}</div>
        <div style={{fontSize:11,color:"#666",marginBottom:10,textAlign:"center"}}>
          Documento interno de entrega correcta. Origen: {pedido?.origen || "-"} · Destino: {pedido?.destino || "-"} · Mercancia: {pedido?.mercancia || pedido?.descripcion_carga || "-"}
        </div>
        <input value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)} placeholder="Nombre y apellidos de quien firma"
          style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:8,padding:"9px 10px",fontSize:13,marginBottom:10,color:"#111"}}/>
        <canvas ref={canvasRef} width={300} height={150}
          style={{border:"2px solid #ddd",borderRadius:8,width:"100%",height:150,touchAction:"none",background:"#fafafa"}}
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={limpiar} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:13,fontWeight:600,cursor:"pointer"}}>Borrar</button>
          <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={confirmar} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Confirmar</button>
        </div>
      </div>
    </div>
  );
}

function FirmaLaboralCanvas({ title = "Firma", detail = "", defaultName = "", onFirma, onCancel }){
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPt = useRef(null);
  const [firmaNombre, setFirmaNombre] = useState(defaultName || "");

  function getPos(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const src = e.touches?.[0] || e;
    return { x: src.clientX - rect.left, y: src.clientY - rect.top };
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
    lastPt.current=pt;
  }
  function end(){ drawing.current=false; }
  function limpiar(){ const ctx=canvasRef.current.getContext("2d"); ctx.clearRect(0,0,300,150); }
  function confirmar(){
    const nombre = String(firmaNombre || "").trim();
    if (!nombre) { notify("Indica nombre y apellidos para firmar", "warning"); return; }
    onFirma?.({ firma_png: canvasRef.current.toDataURL("image/png"), nombre, user_agent: navigator.userAgent, at: new Date().toISOString() });
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:520,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:12,padding:16,width:"min(360px,95vw)"}}>
        <div style={{fontWeight:800,fontSize:15,color:"#111",marginBottom:6,textAlign:"center"}}>{title}</div>
        {detail && <div style={{fontSize:11,color:"#666",marginBottom:10,textAlign:"center",lineHeight:1.35}}>{detail}</div>}
        <input value={firmaNombre} onChange={e=>setFirmaNombre(e.target.value)} placeholder="Nombre y apellidos"
          style={{width:"100%",boxSizing:"border-box",border:"1px solid #ddd",borderRadius:8,padding:"9px 10px",fontSize:13,marginBottom:10,color:"#111"}}/>
        <canvas ref={canvasRef} width={300} height={150}
          style={{border:"2px solid #ddd",borderRadius:8,width:"100%",height:150,touchAction:"none",background:"#fafafa"}}
          onMouseDown={start} onMouseMove={move} onMouseUp={end}
          onTouchStart={start} onTouchMove={move} onTouchEnd={end}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <button onClick={limpiar} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:13,fontWeight:600,cursor:"pointer"}}>Borrar</button>
          <button onClick={onCancel} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #ddd",background:"#f5f5f5",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
          <button onClick={confirmar} style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:13,fontWeight:800,cursor:"pointer"}}>Firmar</button>
        </div>
      </div>
    </div>
  );
}

// Modal de incidencia
function ModalIncidencia({ pedido, fase="ruta", onClose, onGuardado }){
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
    try {
      await cambiarEstadoPedido(pedido.id, "incidencia", { incidencia: `[${faseLabel(fase)}] ${texto}` });
      if (doc) {
        const location = await capturarUbicacionActual();
        const uploadEvidence = buildUploadEvidence(`incidencia_${fase}`, location);
        await subirPedidoDoc(pedido.id, {
          nombre: `Incidencia ${faseLabel(fase)} - ${pedido.numero || pedido.id}`,
          tipo: `incidencia_${fase}`,
          file_base64: doc.base64,
          file_mime: doc.mime,
          file_size_kb: doc.sizeKb,
          notas: `${texto}\n\n${uploadEvidence.note}`,
          metadata: uploadEvidence.evidence,
        });
      }
      onGuardado();
    } catch (err) {
      setError(err.message || "No se pudo registrar la incidencia");
    } finally {
      setGuardando(false);
    }
  }
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"var(--bg2)",borderRadius:12,padding:20,width:"min(360px,95vw)"}}>
        <div style={{fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Registrar incidencia</div>
        <div style={{fontSize:11,color:"var(--text5)",marginBottom:10}}>Fase: {faseLabel(fase)}</div>
        <textarea value={texto} onChange={e=>setTexto(e.target.value)} placeholder="Describe el problema: retraso, accidente, mercancia danada..."
          style={{width:"100%",minHeight:100,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",resize:"none",boxSizing:"border-box"}}/>
        <input id={inputId} type="file" accept="image/*" capture="environment" onChange={seleccionarFoto} style={{display:"none"}}/>
        <button onClick={()=>document.getElementById(inputId)?.click()} disabled={procesando}
          style={{width:"100%",marginTop:10,padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          {procesando ? "Preparando foto..." : archivo ? `Foto adjunta: ${archivo.name}` : "Adjuntar foto de la incidencia"}
        </button>
        {doc?.preview && (
          <img src={doc.preview} alt="Vista previa albaran" style={{width:"100%",height:190,objectFit:"cover",display:"block",background:"#111827"}}/>
        )}
        {error && <div style={{fontSize:12,color:"#ef4444",marginTop:8}}>{error}</div>}
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
      if (preparado.base64.length > 5000000) {
        throw new Error("El archivo es demasiado grande. Haz la foto con menos zoom o usa una imagen mas ligera.");
      }
      setArchivo(file);
      setDoc(preparado);
    } catch (err) {
      setError(err.message || "No se pudo preparar el archivo");
    } finally {
      setProcesando(false);
    }
  }

  async function subir() {
    if (!archivo || !doc) return;
    setSubiendo(true);
    setError("");
    try {
      const tipo = fase === "carga" ? "albaran_carga" : "albaran_descarga";
      const location = await capturarUbicacionActual();
      const uploadEvidence = buildUploadEvidence(tipo, location);
      await subirPedidoDocChofer(pedido.id, {
        nombre: `${faseLabel(fase)} - albaran ${pedido.numero || pedido.id}`,
        tipo,
        file_base64: doc.base64,
        file_mime: doc.mime,
        file_size_kb: doc.sizeKb,
        notas: `Subido desde app chofer en fase ${faseLabel(fase)}\n${uploadEvidence.note}`,
        metadata: uploadEvidence.evidence,
      });
      setArchivo(null);
      setDoc(null);
      await onUploaded?.(tipo);
    } catch (err) {
      setError(err.message || "No se pudo subir el albaran");
    } finally {
      setSubiendo(false);
    }
  }

  return (
    <div style={{border:"1px solid var(--border)",background:"var(--bg4)",borderRadius:10,padding:12,marginTop:10}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,marginBottom:8}}>
        <div>
          <div style={{fontWeight:800,fontSize:13,color:"var(--text)"}}>Albaran de {faseLabel(fase).toLowerCase()}</div>
          <div style={{fontSize:11,color:"var(--text5)"}}>Encuadra el documento y subelo al viaje</div>
        </div>
        <span style={{fontSize:10,fontWeight:800,color:"#3b82f6",background:"rgba(59,130,246,.12)",padding:"3px 8px",borderRadius:20}}>ESCANER</span>
      </div>

      <div
        style={{display:"block",position:"relative",minHeight:150,border:"2px dashed rgba(59,130,246,.55)",borderRadius:10,background:"#111827",overflow:"hidden"}}>
        {doc?.preview ? (
          <img src={doc.preview} alt="Vista previa albaran" style={{width:"100%",height:190,objectFit:"cover",display:"block",background:"#111827"}}/>
        ) : (
          <div style={{height:170,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:"#e5e7eb",textAlign:"center",padding:18,boxSizing:"border-box"}}>
          <div style={{fontSize:13,fontWeight:800,marginBottom:6}}>Coloca el albaran dentro del marco</div>
            <div style={{fontSize:11,lineHeight:1.45,color:"#cbd5e1"}}>La app detecta el papel, recorta el fondo y lo guarda con aspecto de escaner. Buena luz y esquinas visibles ayudan mucho.</div>
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
          style={{padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.35)",background:"rgba(59,130,246,.10)",color:"#60a5fa",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Abrir camara
        </button>
        <button type="button" disabled={procesando || subiendo} onClick={()=>document.getElementById(fileInputId)?.click()}
          style={{padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Elegir archivo
        </button>
      </div>

      {archivo && (
        <div style={{fontSize:11,color:"var(--text4)",marginTop:7}}>
          Preparado: <strong style={{color:"var(--text)"}}>{archivo.name}</strong> - {doc?.sizeKb || Math.round(archivo.size/1024)} KB
          {doc?.mime?.startsWith("image/") && (
            <span style={{display:"block",marginTop:3,color:doc.scan_detected ? "#10b981" : "#f59e0b",fontWeight:800}}>
              {doc.scan_detected ? "Documento detectado y recortado automaticamente." : "Imagen limpiada como escaner; no se detectaron bien los bordes del papel."}
            </span>
          )}
        </div>
      )}
      {error && <div style={{fontSize:12,color:"#ef4444",marginTop:8}}>{error}</div>}

      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={subir} disabled={!doc || subiendo}
          style={{flex:1,padding:"10px",borderRadius:8,border:"none",background:doc ? "#10b981" : "var(--border2)",color:"#fff",fontWeight:800,fontSize:12,cursor:doc?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif"}}>
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

function TarjetaViaje({ pedido, onActualizar, jornadaInfo, onAbrirJornada, expanded = false, onExpandedChange, onFoto }){
  const [firmando,     setFirmando]     = useState(false);
  const [incidencia,   setIncidencia]   = useState(false);
  const [incidenciaFase,setIncidenciaFase]=useState("ruta");
  const [loading,      setLoading]      = useState(false);
  const [proximaCarga, setProximaCarga] = useState(null);
  const [kmActuales,   setKmActuales]   = useState("");
  const [pasos,        setPasos]        = useState({});
  const [tick,         setTick]         = useState(0);
  const [docControl,   setDocControl]   = useState(null);
  const [docControlLoading, setDocControlLoading] = useState(false);
  const [qrVisible, setQrVisible] = useState(false);
  const [firmandoCargador, setFirmandoCargador] = useState(false);
  const [mercanciaCarga, setMercanciaCarga] = useState({
    mercancia: pedido.mercancia || pedido.descripcion_carga || "",
    palets: pedido.bultos || "",
    peso_kg: pedido.peso_kg || "",
    referencia: pedido.referencia_cliente || "",
  });
  const e = EC[pedido.estado]||EC.pendiente;
  const isEnCurso = ["en_curso","descarga"].includes(pedido.estado);
  const isProxima = pedido.es_proxima_carga;

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let alive = true;
    const local = leerPasosViaje(pedido.id);
    setPasos({});
    getPedidoChoferPasos(pedido.id)
      .then((payload) => {
        if (!alive) return;
        const remote = normalizeChoferPasos(payload?.data || payload || {});
        if (Object.keys(remote).length) {
          setPasos(guardarPasosViaje(pedido.id, remote));
          return;
        }
        setPasos(local);
      })
      .catch(() => {
        if (!alive) return;
        setPasos(local);
      });
    return () => { alive = false; };
  }, [pedido.id]);

  const cargarDocumentoControl = useCallback(async () => {
    setDocControlLoading(true);
    try {
      const data = await getPedidoDocumentoControl(pedido.id);
      setDocControl(data || null);
      return data || null;
    } catch {
      setDocControl(null);
      return null;
    } finally {
      setDocControlLoading(false);
    }
  }, [pedido.id]);

  useEffect(() => {
    let alive = true;
    if (!expanded) return undefined;
    cargarDocumentoControl().then(data => { if (!alive) return; if (data) setDocControl(data); });
    return () => { alive = false; };
  }, [expanded, cargarDocumentoControl]);

  const docControlSupportUrl = docControl?.documento?.soporte_url || docControl?.soporte_url || "";
  const dcd = docControl?.documento || null;
  const dcdHorarios = dcd?.horarios || {};
  const dcdCargas = Array.isArray(dcd?.cargas) ? dcd.cargas : [];
  const dcdDescargas = Array.isArray(dcd?.descargas) ? dcd.descargas : [];
  const dcdReady = !!docControl?.status?.ready;
  const dcdRevisado = !!pasos.dcd_revisado;
  const dcdDisponible = !!pasos.dcd_disponible || !!pasos.dcd_revisado;
  const dcdOperativoOk = dcdReady && dcdRevisado && dcdDisponible;
  const requiereProtocoloCisterna = esViajeCisterna(pedido);
  const protocoloCisternaCompletado = !requiereProtocoloCisterna || PROTOCOLO_CISTERNA.every(step => pasos[step.key]);
  const protocoloCisternaPendientes = PROTOCOLO_CISTERNA.filter(step => !pasos[step.key]);
  const fmtDcdFecha = (v) => v ? new Date(`${String(v).slice(0,10)}T12:00:00`).toLocaleDateString("es-ES") : "-";
  const fmtDcdHora = (hora, ventana) => hora || ventana || "-";
  const registrarDcdEvento = useCallback((action) => {
    if (!pedido?.id) return;
    registrarPedidoDocumentoControlEvento(pedido.id, { action, source:"app_chofer" }).catch(() => {});
  }, [pedido?.id]);

  function abrirDocumentoControl(printMode = false) {
    if (!docControlSupportUrl) return;
    const url = printMode
      ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}print=1`
      : docControlSupportUrl;
    registrarDcdEvento(printMode ? "impreso" : "abierto");
    const opened = window.open(url, "_blank");
    if (!opened) window.location.href = url;
  }

  async function verQrDocumentoControl() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.qr?.data_url && !data?.qr?.url && !data?.documento?.soporte_url) {
      notify("No se pudo preparar el QR del DCD.", "warning");
      return;
    }
    setDocControl(data);
    registrarDcdEvento("qr_mostrado");
    setQrVisible(true);
  }

  function descargarDocumentoControl() {
    const url = docControl?.remision?.download_url || (docControlSupportUrl ? `${docControlSupportUrl}${docControlSupportUrl.includes("?") ? "&" : "?"}download=1` : "");
    if (!url) return;
    registrarDcdEvento("descargado");
    registrarDcdEvento("disponible");
    persistirPasos({ dcd_disponible:true, dcd_disponible_at:new Date().toISOString() }, { silent:true }).catch(() => {});
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function compartirDocumentoControl() {
    if (!docControlSupportUrl) return;
    const shareData = {
      title: `Documento de control ${pedido.numero || ""}`.trim(),
      text: `Documento de control del viaje ${pedido.numero || ""}`.trim(),
      url: docControlSupportUrl,
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        registrarDcdEvento("compartido");
        return;
      }
      await navigator.clipboard.writeText(docControlSupportUrl);
      registrarDcdEvento("copiado");
      notify("Enlace del documento digital copiado");
    } catch {
      notify("No se pudo compartir el documento digital", "error");
    }
  }

  async function marcarDcdRevisado() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.documento) {
      notify("No se pudo cargar el DCD. Revisa la conexion o avisa a trafico.", "warning");
      return;
    }
    if (!data?.status?.ready) {
      notify("El DCD aun tiene datos pendientes. Puedes consultarlo, pero trafico debe completarlo.", "warning");
    }
    registrarDcdEvento("consultado");
    registrarDcdEvento("revisado");
    await persistirPasos({
      dcd_revisado:true,
      dcd_disponible:true,
      dcd_revisado_at:new Date().toISOString(),
      dcd_disponible_at:new Date().toISOString(),
    }, { silent:true });
    notify("DCD revisado y marcado como disponible.", "success");
  }

  async function confirmarDcdAntesDeSalir() {
    const data = docControl || await cargarDocumentoControl();
    if (!data?.documento) {
      const ok = await confirmDialog({
        title: "DCD no disponible",
        message: "No se ha podido cargar el documento de control digital. Puedes continuar para no bloquear la operativa, pero quedara pendiente para trafico.",
        confirmText: "Continuar igualmente",
        cancelText: "Revisar",
        tone: "warning",
      });
      return ok;
    }
    if (pasos.dcd_revisado && pasos.dcd_disponible && data?.status?.ready) return true;
    const ok = await confirmDialog({
      title: data?.status?.ready ? "Confirmar DCD" : "DCD con datos pendientes",
      message: data?.status?.ready
        ? "Antes de salir, confirma que has revisado el DCD y lo llevas disponible en el movil o impreso."
        : "El DCD esta pendiente de revision interna. Puedes continuar con aviso, pero informa a trafico si necesitas el soporte definitivo.",
      confirmText: data?.status?.ready ? "Lo llevo revisado" : "Continuar con aviso",
      cancelText: "Volver",
      tone: data?.status?.ready ? "success" : "warning",
    });
    if (!ok) return false;
    registrarDcdEvento("revisado");
    await persistirPasos({
      dcd_revisado:true,
      dcd_disponible:true,
      dcd_revisado_at:new Date().toISOString(),
      dcd_disponible_at:new Date().toISOString(),
    }, { silent:true });
    return true;
  }

  async function persistirPasos(patch, { silent = false } = {}) {
    const normalized = normalizeChoferPasos(patch);
    const optimistic = guardarPasosViaje(pedido.id, normalized);
    setPasos(optimistic);
    try {
      const saved = await guardarPedidoChoferPasos(pedido.id, normalized);
      const remote = normalizeChoferPasos(saved?.data || saved || {});
      if (Object.keys(remote).length) {
        setPasos(guardarPasosViaje(pedido.id, remote));
      }
      return remote;
    } catch (err) {
      const queued = guardarOfflineQueue([
        ...leerOfflineQueue(),
        { tipo: "pedido_chofer_pasos", pedido_id: pedido.id, patch: normalized, fecha: new Date().toISOString() },
      ]);
      if (!silent) notify("Guardado pendiente de sincronizar", "warning");
      return { ...optimistic, offline_queue: queued.length };
    }
  }

  function kmLectura() {
    const n = Number(kmActuales);
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : null;
  }

  function patchKmParaPaso(key) {
    const km = kmLectura();
    if (km == null) return {};
    if (key === "carga_iniciada" || key === "carga_ok") return { km_carga: km };
    if (key === "descarga_iniciada" || key === "descarga_ok" || key === "firma_entrega") return { km_descarga: km };
    return {};
  }

  async function marcarPaso(key, value=true) {
    const patch = { [key]: value, [`${key}_at`]: new Date().toISOString(), ...patchKmParaPaso(key) };
    return persistirPasos(patch, { silent: true });
  }

  async function albaranSubido(key) {
    await marcarPaso(key);
    const fresh = await cargarDocumentoControl();
    if (fresh) setDocControl(fresh);
    onActualizar();
  }

  async function confirmarDatosMercanciaCarga() {
    const mercancia = String(mercanciaCarga.mercancia || "").trim();
    const palets = String(mercanciaCarga.palets || "").trim();
    const peso = String(mercanciaCarga.peso_kg || "").trim();
    if (!mercancia || !palets || !peso) {
      notify("Indica mercancia, palets/bultos y peso antes de cerrar la carga.", "warning");
      return;
    }
    const pesoNum = Number(String(peso).replace(",", "."));
    if (!Number.isFinite(pesoNum) || pesoNum <= 0) {
      notify("El peso debe ser un numero valido.", "warning");
      return;
    }
    await editarPedido(pedido.id, {
      mercancia,
      bultos: palets,
      peso_kg: pesoNum,
      referencia_cliente: pedido.referencia_cliente || mercanciaCarga.referencia || null,
    });
    await persistirPasos({
      mercancia_confirmada: true,
      mercancia_confirmada_at: new Date().toISOString(),
      mercancia_cargada: mercancia,
      mercancia_palets: palets,
      mercancia_peso_kg: String(pesoNum),
      mercancia_referencia: String(mercanciaCarga.referencia || "").trim(),
    }, { silent: true });
    const fresh = await cargarDocumentoControl();
    if (fresh) setDocControl(fresh);
    notify("Datos de mercancia guardados.", "success");
    onActualizar();
  }

  async function registrarFirmaCargador(dataURL, firmaNombre) {
    try {
      await guardarFirmaEntrega(pedido.id, {
        rol: "cargador",
        firma_destinatario: dataURL,
        firma_nombre: firmaNombre || "Remitente",
        source: "app_chofer_carga",
      });
      await persistirPasos({ firma_cargador:true, firma_cargador_at:new Date().toISOString() }, { silent:true });
      const fresh = await cargarDocumentoControl();
      if (fresh) setDocControl(fresh);
      setFirmandoCargador(false);
      notify("Firma del remitente registrada en el DCD.", "success");
      onActualizar();
    } catch(err) {
      notify(err.message, "error");
    }
  }

  const timerActual = (() => {
    void tick;
    if (pasos.carga_iniciada && !pasos.carga_proceso) {
      const seconds = segundosDesdeIso(pasos.carga_iniciada_at);
      return { fase:"espera_carga", label:"Espera para iniciar carga", seconds, mins:Math.floor(seconds / 60), alertKey:"aviso_espera_carga" };
    }
    if (pasos.carga_proceso && !pasos.carga_ok) {
      const seconds = segundosDesdeIso(pasos.carga_proceso_at);
      const totalSeconds = segundosDesdeIso(pasos.carga_iniciada_at);
      return { fase:"carga", label:"Carga en curso", seconds, totalSeconds, mins:Math.floor(seconds / 60), total:Math.floor(totalSeconds / 60), alertKey:"aviso_espera_carga" };
    }
    if (pasos.posicionado_descarga && !pasos.descarga_iniciada) {
      const seconds = segundosDesdeIso(pasos.posicionado_descarga_at);
      return { fase:"espera_descarga", label:"Espera para iniciar descarga", seconds, mins:Math.floor(seconds / 60), alertKey:"aviso_espera_descarga" };
    }
    if (pasos.descarga_iniciada && !pasos.descarga_ok) {
      const seconds = segundosDesdeIso(pasos.descarga_iniciada_at);
      const totalSeconds = segundosDesdeIso(pasos.posicionado_descarga_at);
      return { fase:"descarga", label:"Descarga en curso", seconds, totalSeconds, mins:Math.floor(seconds / 60), total:Math.floor(totalSeconds / 60), alertKey:"aviso_espera_descarga" };
    }
    return null;
  })();

  useEffect(() => {
    if (!timerActual || timerActual.mins <= 60 || pasos[timerActual.alertKey]) return;
    persistirPasos({ [timerActual.alertKey]: true, [`${timerActual.alertKey}_at`]: new Date().toISOString() }, { silent: true })
      .then(() => notify("Aviso enviado a trafico y gerencia por superar 60 minutos.", "warning"))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerActual?.fase, timerActual?.mins, timerActual?.alertKey, pasos.aviso_espera_carga, pasos.aviso_espera_descarga]);

  async function iniciarPosicionCarga() {
    if (!jornadaInfo?.jornada) {
      notify("Abre jornada antes de iniciar el posicionamiento a carga.", "warning");
      onAbrirJornada?.();
      return;
    }
    if (!(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try {
      const location = await capturarUbicacionActual();
      if (!location) notify("No se pudo capturar la ubicacion de carga. Puedes continuar, queda pendiente para trafico.", "warning");
      if (!["en_curso","descarga","entregado"].includes(pedido.estado)) await cambiarEstadoPedido(pedido.id, "en_curso");
      await persistirPasos({
        carga_iniciada:true,
        carga_iniciada_at:new Date().toISOString(),
        ...(location ? { carga_ubicacion: location } : {}),
        ...patchKmParaPaso("carga_iniciada"),
      }, { silent:true });
      onActualizar();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function iniciarCarga() {
    if (!pasos.carga_iniciada) {
      notify("Primero marca posicionado en carga.", "warning");
      return;
    }
    if (requiereProtocoloCisterna && !protocoloCisternaCompletado) {
      notify("Completa el protocolo de seguridad de cisterna antes de iniciar la carga.", "warning");
      return;
    }
    await marcarPaso("carga_proceso");
    notify("Carga iniciada. El contador de carga empieza ahora.", "success");
  }

  async function finalizarCarga() {
    if (!pasos.carga_proceso) {
      notify("Primero inicia la carga.", "warning");
      return;
    }
    if (!pasos.mercancia_confirmada || !pasos.albaran_carga || !pasos.firma_cargador) {
      notify("Antes de finalizar la carga debes confirmar mercancia, adjuntar albaran y registrar la firma del remitente.", "warning");
      return;
    }
    await marcarPaso("carga_ok");
    notify("Carga finalizada con mercancia, albaran y firma registrados.", "success");
    onActualizar();
  }

  async function iniciarViaje() {
    if (!pasos.albaran_carga) {
      notify("Sube el albaran de carga antes de iniciar el viaje.", "warning");
      return;
    }
    if (!(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try {
      await cambiarEstadoPedido(pedido.id, "en_curso");
      await marcarPaso("viaje_iniciado");
      notify("Viaje iniciado hacia descarga.", "success");
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
    onActualizar();
  }

  async function posicionarDescarga() {
    if (!pasos.carga_ok) {
      notify("Primero finaliza la carga.", "warning");
      return;
    }
    await marcarPaso("posicionado_descarga");
    notify("Posicionamiento para descarga registrado.", "success");
  }

  async function iniciarDescarga() {
    if (!pasos.posicionado_descarga) {
      notify("Marca antes el posicionamiento para descarga.", "warning");
      return;
    }
    setLoading(true);
    try {
      await cambiarEstadoPedido(pedido.id, "descarga");
      await marcarPaso("descarga_iniciada");
      onActualizar();
    } catch (err) {
      notify(err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  async function finalizarDescarga() {
    if (!pasos.descarga_iniciada) {
      notify("Primero marca descarga iniciada.", "warning");
      return;
    }
    await marcarPaso("descarga_ok");
    notify("Descarga finalizada. Sube el albaran de descarga para poder firmar.", "success");
  }

  function siguientePaso() {
    if (!pasos.carga_iniciada) {
      return { label:"Posicionado en carga", help:"Registra que ya estas en el punto de carga. Desde aqui empieza la espera.", run: iniciarPosicionCarga, color:"#3b82f6" };
    }
    if (!pasos.carga_proceso) return { label:"Iniciar carga", help:"Empieza el contador real de carga y reinicia el temporizador visual del chofer.", run: iniciarCarga, color:"#f59e0b" };
    if (!pasos.mercancia_confirmada) return { type:"mercancia_carga", label:"Confirmar mercancia cargada", help:"Antes de firmar la carga, introduce mercancia, palets/bultos, peso y referencia si procede." };
    if (!pasos.albaran_carga) return { type:"albaran_carga", label:"Subir albaran de carga", help:"Adjunta el albaran de carga para incorporarlo al DCD." };
    if (!pasos.firma_cargador) return { label:"Firma del remitente", help:"El remitente/cargador firma la carga y la firma aparece en el bloque Sender del DCD.", run:()=>setFirmandoCargador(true), color:"#10b981" };
    if (!pasos.carga_ok) return { label:"Carga finalizada", help:"Marca este paso cuando la mercancia ya este cargada, documentada y firmada.", run: finalizarCarga, color:"#10b981" };
    if (!pasos.viaje_iniciado) return { label:"Iniciar viaje", help:"Comienza el trayecto hacia destino. El viaje sigue activo hasta finalizar descarga y firma.", run: iniciarViaje, color:"#3b82f6" };
    if (!pasos.posicionado_descarga) return { label:"Posicionado para descarga", help:"Registra la llegada o posicionamiento en destino. Empieza la espera de descarga.", run: posicionarDescarga, color:"#3b82f6" };
    if (!pasos.descarga_iniciada) return { label:"Descarga iniciada", help:"Empieza el contador de descarga y avisa si supera 60 minutos.", run: iniciarDescarga, color:"#a78bfa" };
    if (!pasos.descarga_ok) return { label:"Descarga finalizada", help:"Marca este paso al terminar la descarga.", run: finalizarDescarga, color:"#10b981" };
    if (!pasos.albaran_descarga) return { type:"albaran_descarga", label:"Subir albaran de descarga", help:"El albaran de descarga aparece ahora porque la descarga ya esta marcada como finalizada." };
    if (!pasos.firma_entrega) return { label:"Firmar entrega cliente", help:"Firma interna de entrega correcta con origen, destino y mercancia.", run:()=>setFirmando(true), color:"#10b981" };
    return null;
  }

  function abrirIncidencia(fase="ruta") {
    setIncidenciaFase(fase);
    setIncidencia(true);
  }

  async function cambiarEstado(nuevoEstado){
    if (nuevoEstado === "en_curso" && !jornadaInfo?.jornada) {
      notify("Abre jornada antes de iniciar el viaje. Asi queda registrado el turno y los tiempos.", "warning");
      onAbrirJornada?.();
      return;
    }
    if (nuevoEstado === "en_curso" && !(await confirmarDcdAntesDeSalir())) return;
    setLoading(true);
    try{
      await cambiarEstadoPedido(pedido.id,nuevoEstado);
      if(nuevoEstado==="en_curso") {
        const location = await capturarUbicacionActual();
        await persistirPasos({ carga_iniciada:true, carga_iniciada_at:new Date().toISOString(), ...(location ? { carga_ubicacion: location } : {}), ...patchKmParaPaso("carga_iniciada") }, { silent:true });
      }
      if(nuevoEstado==="descarga") await persistirPasos({ descarga_iniciada:true, ...patchKmParaPaso("descarga_iniciada") }, { silent:true });
      if(nuevoEstado==="entregado") {
        await persistirPasos({ descarga_ok:true, firma_entrega:true, ...patchKmParaPaso("firma_entrega") }, { silent:true });
      }
      // Si marcamos entregado, mostrar proxima carga si existe
      if(nuevoEstado==="entregado"){
        try{
          const all = await getPedidos();
          const arr = Array.isArray(all) ? all : Array.isArray(all?.data) ? all.data : [];
          const proxima = arr.find(p=>
            p.vehiculo_id===pedido.vehiculo_id &&
            p.id!==pedido.id &&
            ["confirmado","pendiente"].includes(p.estado)
          );
          if(proxima){
            setProximaCarga(proxima);
          }
        }catch(e){}
      }
      onActualizar();
    }catch(err){notify(err.message, "error");}
    finally{setLoading(false);}
  }

  async function registrarFirma(dataURL, firmaNombre){
    try{
      // Save digital signature to backend
      await guardarFirmaEntrega(pedido.id, {
        firma_destinatario: dataURL,
        firma_nombre: firmaNombre || "Destinatario",
        source: "app_chofer",
      });
      await cambiarEstadoPedido(pedido.id,"entregado");
      await persistirPasos({ descarga_ok:true, firma_entrega:true, firma_entrega_at:new Date().toISOString(), ...patchKmParaPaso("firma_entrega") }, { silent:true });
      const fresh = await cargarDocumentoControl();
      if (fresh) setDocControl(fresh);
      setFirmando(false);
      onActualizar();
    }catch(err){notify(err.message, "error");}
  }

  async function abrirFirmaFinalizacionManual() {
    const faltan = [];
    if (!pasos.descarga_ok) faltan.push("descarga finalizada");
    if (!pasos.albaran_descarga) faltan.push("albaran de descarga");
    if (faltan.length) {
      const ok = await confirmDialog({
        title: "Finalizar viaje",
        message: `Faltan estos pasos: ${faltan.join(", ")}.\n\nPuedes finalizar igualmente para que el viaje no quede colgado, pero quedara trazado para administracion.`,
        confirmText: "Firmar y finalizar",
        tone: "warning",
      });
      if (!ok) return;
    }
    setFirmando(true);
  }

  async function actualizarPosicion(){
    if(!navigator.geolocation){notify("GPS no disponible", "warning");return;}
    navigator.geolocation.getCurrentPosition(async(pos)=>{
      try{
        await actualizarGpsPedido(pedido.id, {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Math.round(Number(pos.coords.accuracy || 0)),
          captured_at: new Date().toISOString(),
        });
        notify("Posicion actualizada", "success");
      }catch(err){notify(err.message, "error");}
    },()=>notify("No se pudo obtener la ubicacion", "error"));
  }

  async function abrirUbicacionEnApps(){
    const location = await capturarUbicacionActual();
    if (!location) {
      notify("No se pudo obtener la ubicacion", "error");
      return;
    }
    const label = encodeURIComponent(`TransGest ${pedido.numero || "viaje"}`);
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`;
    const geoUrl = `geo:${location.lat},${location.lng}?q=${location.lat},${location.lng}(${label})`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: `Ubicacion viaje ${pedido.numero || ""}`.trim(),
          text: `Ubicacion registrada por app chofer (${location.lat.toFixed(6)}, ${location.lng.toFixed(6)})`,
          url: mapsUrl,
        });
        return;
      }
    } catch {}
    window.location.href = geoUrl;
    window.setTimeout(() => window.open(mapsUrl, "_blank", "noopener,noreferrer"), 700);
  }

  async function registrarVariacionCarga(){
    const peso = window.prompt("Peso real o variacion detectada (opcional)", pedido.peso_kg || "");
    if (peso === null) return;
    const mercancia = window.prompt("Mercancia real o variacion detectada (opcional)", pedido.mercancia || pedido.descripcion_carga || "");
    if (mercancia === null) return;
    const detalle = window.prompt("Describe la variacion/incidencia para trafico", "");
    if (detalle === null) return;
    const partes = [
      peso ? `Peso indicado por chofer: ${peso}` : null,
      mercancia ? `Mercancia indicada por chofer: ${mercancia}` : null,
      detalle ? `Detalle: ${detalle}` : null,
    ].filter(Boolean);
    if (!partes.length) {
      notify("No se ha indicado ninguna variacion.", "warning");
      return;
    }
    try {
      await cambiarEstadoPedido(pedido.id, "incidencia", { incidencia: `[Variacion carga] ${partes.join(" | ")}` });
      notify("Variacion registrada para revision de trafico.", "success");
      onActualizar();
    } catch (err) {
      notify(err.message || "No se pudo registrar la variacion", "error");
    }
  }

  const ACCIONES = {
    confirmado: [{label:"Iniciar viaje",   estado:"en_curso",   bg:"#3b82f6"}],
    en_curso:   [{label:"En descarga",      estado:"descarga",   bg:"#a78bfa"},
                 {label:"Entregar + Firma", action:"firma",      bg:"#10b981"}],
    descarga:   [{label:"Entregar + Firma", action:"firma",      bg:"#10b981"}],
    pendiente:  [{label:"Iniciar viaje",    estado:"en_curso",   bg:"#3b82f6"}],
  };
  const acciones = ACCIONES[pedido.estado]||[];
  const nextStep = siguientePaso();

  return(
    <>
      {/* Proxima carga banner */}
      {proximaCarga&&(
        <div style={{background:"rgba(16,185,129,.12)",border:"1.5px solid rgba(16,185,129,.4)",borderRadius:12,padding:"12px 16px",marginBottom:8,animation:"pulse 2s infinite"}}>
          <div style={{fontWeight:800,fontSize:13,color:"#10b981",marginBottom:4}}>Tu proxima carga esta lista</div>
          <div style={{fontWeight:700,fontSize:15,color:"var(--text)"}}>{proximaCarga.origen||"-"} -> {proximaCarga.destino||"-"}</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>{proximaCarga.numero} - {proximaCarga.cliente_nombre||""}</div>
          <button onClick={()=>setProximaCarga(null)} style={{marginTop:8,padding:"6px 14px",borderRadius:7,border:"none",background:"#10b981",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Ver detalles</button>
        </div>
      )}
      <div onClick={()=>onExpandedChange?.(!expanded)}
        style={{background:isEnCurso?"rgba(249,115,22,.06)":isProxima?"rgba(59,130,246,.06)":"var(--bg2)",
          border:`1.5px solid ${e.c}${isEnCurso?"99":"40"}`,
          borderLeft:`4px solid ${e.c}`,borderRadius:12,padding:"14px 16px",marginBottom:10,cursor:"pointer",userSelect:"none",
          boxShadow:isEnCurso?"0 0 0 2px rgba(249,115,22,.15)":"none"}}>
        {/* En curso indicator */}
        {isEnCurso&&<div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:"#f97316",display:"inline-block",animation:"pulse 1.5s infinite"}}/>
          <span style={{fontSize:11,fontWeight:700,color:"#f97316",textTransform:"uppercase",letterSpacing:".06em"}}>En curso ahora</span>
        </div>}
        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:14,color:e.c}}>{pedido.numero}</div>
          <span style={{padding:"3px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:e.bg,color:e.c}}>{e.l}</span>
        </div>

        {/* Ruta */}
        <div style={{fontWeight:700,fontSize:16,color:"var(--text)",marginBottom:4}}>
          {pedido.origen||"-"} -> {pedido.destino||"-"}
        </div>

        {/* Meta */}
        <div style={{display:"flex",gap:12,fontSize:12,color:"var(--text4)",flexWrap:"wrap"}}>
          {pedido.hora_carga&&<span>Hora {pedido.hora_carga}</span>}
          {pedido.cliente_nombre&&<span>Cliente {pedido.cliente_nombre}</span>}
          {pedido.fecha_carga&&<span>Fecha {new Date(pedido.fecha_carga).toLocaleDateString("es-ES")}</span>}
        </div>

        {/* Expand indicator */}
        <div style={{textAlign:"right",fontSize:11,color:"var(--text5)",marginTop:4}}>{expanded?"Menos":"Mas detalles"}</div>
      </div>

      {expanded&&(
        <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:10,padding:"14px 16px",marginTop:-8,marginBottom:10}}>
          {/* Detalles */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            {[
              ["Mercancia",pedido.mercancia||pedido.descripcion_carga||"-"],
              ["Peso",pedido.peso_kg?(pedido.peso_kg+" kg"):"-"],
              ["Bultos/Palets",pedido.bultos||"-"],
              ["Km ruta",pedido.km_ruta||pedido.km?(pedido.km_ruta||pedido.km)+" km":"-"],
              ["F. descarga",pedido.fecha_descarga?new Date(pedido.fecha_descarga).toLocaleDateString("es-ES"):"-"],
              ["Hora descarga",pedido.hora_descarga||"-"],
            ].map(([l,v])=>(
              <div key={l} style={{background:"var(--bg4)",borderRadius:7,padding:"8px 10px"}}>
                <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>{l}</div>
                <div style={{fontSize:13,fontWeight:600,color:"var(--text)"}}>{v}</div>
              </div>
            ))}
          </div>
          {pedido.notas&&(
            <div style={{background:"rgba(251,191,36,.08)",border:"1px solid rgba(251,191,36,.2)",borderRadius:7,padding:"8px 12px",marginBottom:12,fontSize:12,color:"var(--text3)"}}>
              Notas: {pedido.notas}
            </div>
          )}

          {requiereProtocoloCisterna && (
            <div style={{background:protocoloCisternaCompletado ? "rgba(16,185,129,.08)" : "rgba(245,158,11,.08)",border:`1px solid ${protocoloCisternaCompletado ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.28)"}`,borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:8}}>
                <div>
                  <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Protocolo cisterna</div>
                  <div style={{fontSize:11,color:"var(--text5)",lineHeight:1.4}}>
                    Confirma los pasos de seguridad antes de iniciar carga o descarga. Queda registrado con fecha y hora.
                  </div>
                </div>
                <span style={{fontSize:11,fontWeight:900,color:protocoloCisternaCompletado ? "#10b981" : "#f59e0b",whiteSpace:"nowrap"}}>
                  {protocoloCisternaCompletado ? "Completo" : `${protocoloCisternaPendientes.length} pendiente(s)`}
                </span>
              </div>
              <div style={{display:"grid",gap:7}}>
                {PROTOCOLO_CISTERNA.map(step => {
                  const ok = !!pasos[step.key];
                  return (
                    <button
                      key={step.key}
                      type="button"
                      onClick={() => persistirPasos({ [step.key]: !ok, [`${step.key}_at`]: new Date().toISOString() }, { silent:true })}
                      style={{display:"grid",gridTemplateColumns:"28px 1fr",gap:8,textAlign:"left",alignItems:"center",padding:"8px 9px",borderRadius:8,border:`1px solid ${ok ? "rgba(16,185,129,.26)" : "var(--border)"}`,background:ok ? "rgba(16,185,129,.08)" : "var(--bg4)",color:"var(--text)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}
                    >
                      <span style={{width:22,height:22,borderRadius:999,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:900,background:ok ? "#10b981" : "rgba(148,163,184,.16)",color:ok ? "#fff" : "var(--text5)"}}>
                        {ok ? "OK" : ""}
                      </span>
                      <span>
                        <span style={{display:"block",fontSize:12,fontWeight:900}}>{step.label}</span>
                        <span style={{display:"block",fontSize:10,color:"var(--text5)",marginTop:2,lineHeight:1.35}}>{step.detail}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:10,padding:12,marginBottom:12}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,marginBottom:8}}>
              <div>
                <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Documento de control digital</div>
                <div style={{fontSize:11,color:"var(--text5)"}}>
                  {docControlLoading
                    ? "Preparando documento..."
                    : docControlSupportUrl ? "Documento disponible para mostrar, descargar o compartir." : "Documento pendiente de preparar por trafico."}
                </div>
              </div>
              <div style={{fontSize:11,fontWeight:800,color:dcdOperativoOk ? "#10b981" : dcdReady ? "#60a5fa" : "#f59e0b"}}>
                {dcdOperativoOk ? "Disponible" : dcdReady ? "Listo" : "Pendiente"}
              </div>
            </div>
            {docControl?.documento && (
              <>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
                  {[
                    ["DCD listo", dcdReady],
                    ["Revisado", dcdRevisado],
                    ["En movil/impreso", dcdDisponible],
                  ].map(([label, ok]) => (
                    <div key={label} style={{background:ok ? "rgba(16,185,129,.09)" : "rgba(245,158,11,.08)",border:`1px solid ${ok ? "rgba(16,185,129,.22)" : "rgba(245,158,11,.2)"}`,borderRadius:8,padding:"7px 8px",textAlign:"center"}}>
                      <div style={{fontSize:14,fontWeight:900,color:ok ? "#10b981" : "#f59e0b"}}>{ok ? "OK" : "Pend."}</div>
                      <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:".04em",color:"var(--text5)"}}>{label}</div>
                    </div>
                  ))}
                </div>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Sistema</div>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{docControl.documento.sistema === "qr_url" ? "QR / URL" : "Codigo numerico"}</div>
                  </div>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Codigo</div>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text)",fontFamily:"'JetBrains Mono',monospace"}}>{docControl.documento.codigo_control || "Pendiente"}</div>
                  </div>
                </div>
                <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Carga DCD</div>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{fmtDcdFecha(dcdHorarios.fecha_carga)}</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{fmtDcdHora(dcdHorarios.hora_carga, dcdHorarios.ventana_carga)}</div>
                  </div>
                  <div style={{background:"var(--bg3)",borderRadius:8,padding:"8px 10px"}}>
                    <div style={{fontSize:9,fontWeight:700,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:2}}>Descarga DCD</div>
                    <div style={{fontSize:12,fontWeight:800,color:"var(--text)"}}>{fmtDcdFecha(dcdHorarios.fecha_descarga)}</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{fmtDcdHora(dcdHorarios.hora_descarga, dcdHorarios.ventana_descarga)}</div>
                  </div>
                </div>
                {(dcdCargas.length > 0 || dcdDescargas.length > 0) && (
                  <div className="tg-driver-dcd-internal" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
                    {[
                      ["Cargas", dcdCargas],
                      ["Descargas", dcdDescargas],
                    ].map(([titulo, items])=>(
                      <div key={titulo} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 10px"}}>
                        <div style={{fontSize:9,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:6}}>{titulo}</div>
                        {items.length === 0 ? (
                          <div style={{fontSize:11,color:"var(--text5)"}}>Sin paradas adicionales</div>
                        ) : items.slice(0,3).map(stop=>(
                          <div key={`${titulo}-${stop.orden}-${stop.direccion}`} style={{fontSize:11,color:"var(--text3)",padding:"5px 0",borderTop:stop.orden>1?"1px solid var(--border2)":"none"}}>
                            <div style={{fontWeight:800,color:"var(--text)"}}>{stop.orden}. {stop.nombre || stop.direccion || "-"}</div>
                            <div style={{color:"var(--text4)"}}>{stop.direccion || "-"}</div>
                            <div style={{color:"var(--text5)"}}>{stop.fecha || "-"} · {stop.hora || stop.ventana || "-"}</div>
                            {stop.google_maps_url && (
                              <button type="button" onClick={()=>window.open(stop.google_maps_url,"_blank","noopener,noreferrer")}
                                style={{marginTop:4,padding:"4px 7px",borderRadius:7,border:"1px solid rgba(59,130,246,.28)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontSize:10,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                                Abrir Maps
                              </button>
                            )}
                          </div>
                        ))}
                        {items.length > 3 && <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>+ {items.length - 3} paradas mas en el soporte</div>}
                      </div>
                    ))}
                  </div>
                )}
                {Array.isArray(docControl.status?.faltantes) && docControl.status.faltantes.length > 0 && (
                  <div className="tg-driver-dcd-internal" style={{fontSize:11,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                    Faltan datos: {docControl.status.faltantes.slice(0, 3).join(" | ")}{docControl.status.faltantes.length > 3 ? "..." : ""}
                  </div>
                )}
                {docControl?.remision && (
                  <div className="tg-driver-dcd-internal" style={{fontSize:11,color:"var(--text3)",background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.18)",borderRadius:8,padding:"8px 10px",marginBottom:8}}>
                    <div style={{fontWeight:800,color:"var(--text)",marginBottom:4}}>Remision</div>
                    <div>{docControl.remision.etiqueta}</div>
                  </div>
                )}
                {docControlSupportUrl && (
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <button
                      onClick={marcarDcdRevisado}
                      style={{gridColumn:"1/-1",padding:"11px",borderRadius:8,border:"1px solid rgba(16,185,129,.35)",background:dcdOperativoOk ? "rgba(16,185,129,.16)" : "rgba(16,185,129,.08)",color:"#10b981",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      {dcdOperativoOk ? "DCD revisado y disponible" : "Marcar DCD revisado y disponible"}
                    </button>
                    <button
                      onClick={verQrDocumentoControl}
                      style={{gridColumn:"1/-1",padding:"13px",borderRadius:8,border:"1px solid rgba(20,184,166,.38)",background:"rgba(20,184,166,.12)",color:"#2dd4bf",fontSize:13,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Ver QR
                    </button>
                    <button
                      onClick={()=>abrirDocumentoControl(false)}
                      style={{padding:"10px",borderRadius:8,border:"1px solid rgba(16,185,129,.3)",background:"rgba(16,185,129,.08)",color:"#10b981",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Mostrar DCD
                    </button>
                    <button
                      onClick={()=>abrirDocumentoControl(true)}
                      style={{padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.3)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Imprimir
                    </button>
                    <button
                      onClick={descargarDocumentoControl}
                      style={{padding:"10px",borderRadius:8,border:"1px solid rgba(139,92,246,.3)",background:"rgba(139,92,246,.08)",color:"#c4b5fd",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Descargar
                    </button>
                    <button
                      onClick={compartirDocumentoControl}
                      style={{padding:"10px",borderRadius:8,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                      Compartir o copiar enlace
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {timerActual && (
            <div style={{
              background:(timerActual.total || timerActual.mins) > 60 ? "rgba(239,68,68,.10)" : "rgba(16,185,129,.08)",
              border:`1px solid ${(timerActual.total || timerActual.mins) > 60 ? "rgba(239,68,68,.28)" : "rgba(16,185,129,.22)"}`,
              borderRadius:10,padding:12,marginBottom:12,display:"flex",justifyContent:"space-between",alignItems:"center",gap:10
            }}>
              <div>
                <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{timerActual.label}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                  {timerActual.totalSeconds ? `Total espera + operacion: ${fmtDuracionSegundos(timerActual.totalSeconds)}` : "Aviso automatico al superar 60 minutos."}
                </div>
              </div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:(timerActual.total || timerActual.mins) > 60 ? "#ef4444" : "#10b981"}}>
                {fmtDuracionSegundos(timerActual.seconds)}
              </div>
            </div>
          )}

          {nextStep && (
            <div style={{background:"rgba(59,130,246,.08)",border:"1px solid rgba(59,130,246,.22)",borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontWeight:900,fontSize:13,color:"var(--text)",marginBottom:4}}>{nextStep.label}</div>
              <div style={{fontSize:11,color:"var(--text5)",marginBottom:10,lineHeight:1.45}}>{nextStep.help}</div>
              {nextStep.type === "mercancia_carga" ? (
                <div style={{display:"grid",gap:8}}>
                  <input
                    value={mercanciaCarga.mercancia}
                    onChange={e=>setMercanciaCarga(p=>({...p,mercancia:e.target.value}))}
                    placeholder="Mercancia cargada"
                    style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                  />
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                    <input
                      value={mercanciaCarga.palets}
                      onChange={e=>setMercanciaCarga(p=>({...p,palets:e.target.value}))}
                      placeholder="Palets / bultos"
                      inputMode="numeric"
                      style={{width:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                    />
                    <input
                      value={mercanciaCarga.peso_kg}
                      onChange={e=>setMercanciaCarga(p=>({...p,peso_kg:e.target.value}))}
                      placeholder="Peso kg"
                      inputMode="decimal"
                      style={{width:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                    />
                  </div>
                  <input
                    value={mercanciaCarga.referencia}
                    onChange={e=>setMercanciaCarga(p=>({...p,referencia:e.target.value}))}
                    placeholder="Referencia de carga (opcional)"
                    style={{width:"100%",boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg2)",color:"var(--text)",borderRadius:8,padding:"10px 12px",fontFamily:"'DM Sans',sans-serif"}}
                  />
                  <button onClick={confirmarDatosMercanciaCarga} disabled={loading}
                    style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:"#10b981",color:"#fff",fontSize:13,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    Guardar datos de carga
                  </button>
                </div>
              ) : nextStep.type === "albaran_carga" ? (
                <EscanerAlbaran pedido={pedido} fase="carga" onUploaded={()=>albaranSubido("albaran_carga")} />
              ) : nextStep.type === "albaran_descarga" ? (
                <EscanerAlbaran pedido={pedido} fase="descarga" onUploaded={()=>albaranSubido("albaran_descarga")} />
              ) : (
                <button onClick={nextStep.run} disabled={loading}
                  style={{width:"100%",padding:"12px",borderRadius:8,border:"none",background:nextStep.color || "#10b981",color:"#fff",fontSize:13,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {loading ? "Actualizando..." : nextStep.label}
                </button>
              )}
            </div>
          )}

          {["en_curso","descarga"].includes(pedido.estado) && pasos.descarga_ok && (!pasos.firma_entrega || !pedido.firma_fecha) && (
            <button onClick={abrirFirmaFinalizacionManual} disabled={loading}
              style={{width:"100%",padding:"11px",borderRadius:8,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.12)",color:"#10b981",fontSize:13,fontWeight:900,cursor:loading?"default":"pointer",fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
              {pasos.firma_entrega && !pedido.firma_fecha ? "Firmar y cerrar viaje" : "Finalizar / firmar entrega"}
            </button>
          )}

          {/* Km actuales al entregar */}
          {(pedido.estado==="en_curso"||pedido.estado==="descarga")&&(
            <div style={{marginBottom:12,background:"var(--bg4)",borderRadius:8,padding:"10px 12px"}}>
              <label style={{display:"block",fontSize:10,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:6}}>
                Km actuales del vehiculo (opcional)
              </label>
              <input type="number" value={kmActuales} onChange={e=>setKmActuales(e.target.value)}
                onFocus={e=>e.target.select()}
                placeholder="Ej: 125000"
                style={{background:"var(--bg2)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 12px",borderRadius:7,fontSize:14,outline:"none",width:"100%",boxSizing:"border-box",fontFamily:"'JetBrains Mono',monospace"}}/>
              <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>
                Al marcar carga o descarga se actualiza el camion y se calcula el km en vacio entre la descarga anterior y esta carga.
                {(pasos.km_carga||pasos.km_descarga)&&<span> Ultimos km: carga {pasos.km_carga||"-"} / descarga {pasos.km_descarga||"-"}.</span>}
              </div>
            </div>
          )}

          {/* Acciones principales */}
          <div style={{display:"none",flexDirection:"column",gap:8}}>
            {acciones.map((a,i)=>(
              <button key={i} disabled={loading}
                onClick={async()=>{
                  if(a.action==="firma"){
                    if(!pasos.albaran_descarga) {
                      const ok = await confirmDialog({
                        title: "Entregar sin albaran",
                        message: "Aun no has adjuntado el albaran?",
                        confirmText: "Firmar igualmente",
                        tone: "warning",
                      });
                      if(!ok) return;
                    }
                    setFirmando(true);
                    return;
                  }
                  // Si entrega, guardar km si los indico
                  if(a.estado==="entregado"&&kmActuales){
                    try{
                      const {actualizarKmVehiculo}=await import("../services/api");
                      if(pedido.vehiculo_id) await actualizarKmVehiculo(pedido.vehiculo_id,Number(kmActuales));
                    }catch(e){}
                  }
                  cambiarEstado(a.estado);
                }}
                style={{padding:"16px",borderRadius:12,border:"none",background:a.bg,color:"#fff",fontSize:15,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",opacity:loading?.7:1,letterSpacing:".01em",boxShadow:`0 4px 12px ${a.bg}66`}}>
                {loading?"Actualizando...":a.label}
              </button>
            ))}
          </div>

          {/* Acciones secundarias */}
          <div style={{display:"flex",gap:8,marginTop:10,flexWrap:"wrap"}}>
            <button onClick={actualizarPosicion} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Mi ubicacion
            </button>
            <button onClick={abrirUbicacionEnApps} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(16,185,129,.3)",background:"rgba(16,185,129,.1)",color:"#10b981",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Abrir mapas
            </button>
            <button onClick={()=>onFoto?.(pedido)} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.3)",background:"rgba(59,130,246,.1)",color:"#60a5fa",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Foto
            </button>
            <button onClick={registrarVariacionCarga} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(245,158,11,.3)",background:"rgba(245,158,11,.1)",color:"#fbbf24",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              Variacion
            </button>
            {pedido.estado!=="entregado"&&pedido.estado!=="cancelado"&&(
              <button onClick={()=>abrirIncidencia(pedido.estado==="descarga"?"descarga":"ruta")} style={{flex:"1 1 112px",padding:"10px",borderRadius:8,border:"1px solid rgba(251,191,36,.3)",background:"rgba(251,191,36,.1)",color:"#fbbf24",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                Aviso viaje
              </button>
            )}
            {pasos.firma_entrega&&(
              <div style={{fontSize:10,color:"#10b981",display:"flex",alignItems:"center",gap:4,padding:"0 8px"}}>Firmado</div>
            )}
          </div>
        </div>
      )}

      {firmando&&<FirmaCanvas pedido={pedido} onFirma={registrarFirma} onCancel={()=>setFirmando(false)}/>}
      {firmandoCargador&&(
        <FirmaCanvas
          pedido={pedido}
          title="Firma del remitente"
          onFirma={registrarFirmaCargador}
          onCancel={()=>setFirmandoCargador(false)}
        />
      )}
      {incidencia&&<ModalIncidencia pedido={pedido} fase={incidenciaFase} onClose={()=>setIncidencia(false)} onGuardado={()=>{setIncidencia(false);onActualizar();}}/>}
      {qrVisible&&(
        <div style={{position:"fixed",inset:0,background:"rgba(2,6,23,.96)",zIndex:700,display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div style={{width:"min(390px,94vw)",background:"#fff",color:"#111827",borderRadius:12,padding:18,textAlign:"center",boxShadow:"0 24px 80px rgba(0,0,0,.45)"}}>
            <div style={{fontSize:12,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"#0f766e",marginBottom:4}}>Documento de control digital</div>
            <div style={{fontSize:18,fontWeight:900,marginBottom:4}}>{pedido.numero || dcd?.referencia_pedido || "Viaje"}</div>
            <div style={{fontSize:11,color:"#64748b",marginBottom:12}}>Muestra este QR para abrir el documento alojado en el servidor.</div>
            {docControl?.qr?.data_url ? (
              <img src={docControl.qr.data_url} alt="QR documento de control" style={{width:"min(300px,78vw)",height:"min(300px,78vw)",objectFit:"contain",border:"1px solid #e5e7eb",borderRadius:8,padding:10,background:"#fff"}}/>
            ) : (
              <div style={{border:"1px solid #e5e7eb",borderRadius:8,padding:14,fontSize:12,wordBreak:"break-all",color:"#0f766e"}}>
                {docControl?.qr?.url || docControlSupportUrl}
              </div>
            )}
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:900,marginTop:10,color:"#0f172a"}}>{dcd?.codigo_control || ""}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:14}}>
              <button onClick={()=>abrirDocumentoControl(false)} style={{padding:"11px",borderRadius:8,border:"1px solid #99f6e4",background:"#ccfbf1",color:"#0f766e",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Abrir DCD</button>
              <button onClick={()=>setQrVisible(false)} style={{padding:"11px",borderRadius:8,border:"1px solid #cbd5e1",background:"#f8fafc",color:"#334155",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Cerrar</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Solicitudes de taller desde app chofer
const MOTIVOS_AVERIA = [
  { id:"neumatico_pinchado",  l:"Neumatico pinchado" },
  { id:"averia_motor",        l:"Averia motor" },
  { id:"frenos",              l:"Problema frenos" },
  { id:"luces_electrico",     l:"Luces / electrico" },
  { id:"caja_cambios",        l:"Caja de cambios" },
  { id:"sistema_hidraulico",  l:"Sistema hidraulico" },
  { id:"accidente_golpe",     l:"Accidente / golpe" },
  { id:"remolque_semirremolque", l:"Problema remolque" },
  { id:"temperatura_motor",   l:"Temperatura motor" },
  { id:"otro",                l:"Otro motivo" },
];

const ESTADO_SOLICITUD_TALLER = {
  pendiente: { l:"Pendiente", c:"#f59e0b", bg:"rgba(245,158,11,.14)" },
  revisada: { l:"Revisada", c:"#3b82f6", bg:"rgba(59,130,246,.14)" },
  en_proceso: { l:"En taller", c:"#a78bfa", bg:"rgba(167,139,250,.16)" },
  resuelto: { l:"Resuelta", c:"#10b981", bg:"rgba(16,185,129,.14)" },
  cerrado: { l:"Cerrada", c:"#10b981", bg:"rgba(16,185,129,.14)" },
  cancelado: { l:"Cancelada", c:"#ef4444", bg:"rgba(239,68,68,.12)" },
};

function metaSolicitudTaller(estado) {
  return ESTADO_SOLICITUD_TALLER[String(estado || "pendiente").toLowerCase()] || ESTADO_SOLICITUD_TALLER.pendiente;
}

function emitirSyncSolicitudesTaller() {
  try {
    window.dispatchEvent(new CustomEvent("taller:solicitudes-sync"));
  } catch {}
}

function SolicitudMecanico({ chofer, vehiculo, solicitudes = [], onEnviado, onSolicitudesSync }) {
  const [motivo,   setMotivo]   = useState("");
  const [obs,      setObs]      = useState("");
  const [urgencia, setUrgencia] = useState("normal"); // normal | urgente | critica
  const [capacidades, setCapacidades] = useState(null);
  const [canal, setCanal] = useState("");
  const [proveedorId, setProveedorId] = useState("");
  const [enviado,  setEnviado]  = useState(false);
  const [historial, setHistorial] = useState(() => Array.isArray(solicitudes) && solicitudes.length ? solicitudes.slice(0, 50) : []);

  useEffect(()=>{
    let alive = true;
    Promise.all([
      getTallerSolicitudes().catch(() => []),
      getTallerSolicitudCapacidades().catch(() => null),
    ]).then(([remotas, caps]) => {
      if (!alive) return;
      if (caps) {
        setCapacidades(caps);
        const nextCanal = caps.puede_mecanico ? "mecanico" : caps.puede_taller_externo ? "taller_externo" : "";
        setCanal(prev => prev || nextCanal);
        const proveedores = Array.isArray(caps.proveedores) ? caps.proveedores : [];
        if (proveedores[0]?.id) setProveedorId(prev => prev || proveedores[0].id);
      }
      if (Array.isArray(remotas)) {
        const synced = guardarSolicitudesCache(remotas);
        setHistorial(synced);
        onSolicitudesSync?.(synced);
      }
    }).catch(()=>{
      const local = leerSolicitudesCache();
      if (alive && local.length) setHistorial(local);
    });
    return () => { alive = false; };
  },[onSolicitudesSync]);

  useEffect(() => {
    if (Array.isArray(solicitudes) && solicitudes.length) {
      setHistorial(guardarSolicitudesCache(solicitudes));
    }
  }, [solicitudes]);

  async function enviar() {
    if (!motivo) { notify("Selecciona el motivo de la averia", "warning"); return; }
    const puedeMecanico = !!capacidades?.puede_mecanico;
    const puedeTallerExterno = !!capacidades?.puede_taller_externo;
    if (!puedeMecanico && !puedeTallerExterno) {
      notify("No hay mecanicos ni talleres externos configurados para recibir solicitudes.", "warning");
      return;
    }
    const canalSolicitud = canal || (puedeMecanico ? "mecanico" : "taller_externo");
    if (canalSolicitud === "taller_externo" && !proveedorId && Array.isArray(capacidades?.proveedores) && capacidades.proveedores.length > 1) {
      notify("Selecciona el taller externo.", "warning");
      return;
    }
    const solicitud = {
      id: "sol_"+Date.now(),
      chofer_nombre: chofer?.nombre || "Chofer",
      chofer_id: chofer?.id,
      vehiculo: vehiculo?.matricula || "-",
      motivo,
      motivo_label: MOTIVOS_AVERIA.find(m=>m.id===motivo)?.l || motivo,
      observaciones: obs,
      urgencia,
      canal: canalSolicitud,
      proveedor_id: canalSolicitud === "taller_externo" ? (proveedorId || capacidades?.proveedores?.[0]?.id || "") : "",
      fecha: new Date().toISOString(),
      estado: "pendiente",
      pedido_numero: vehiculo?.numero,
      vehiculo_id: vehiculo?.vehiculo_id || vehiculo?.id || null,
      vehiculo_matricula: vehiculo?.vehiculo_matricula || vehiculo?.matricula || "",
      ubicacion: vehiculo?.ubicacion_actual || vehiculo?.destino || vehiculo?.origen || "",
    };
    if (solicitud.vehiculo_matricula) solicitud.vehiculo = solicitud.vehiculo_matricula;
    const nextLocal = [solicitud, ...historial].slice(0, 50);
    try {
      const created = await crearTallerSolicitud(solicitud);
      const remotas = await getTallerSolicitudes().catch(()=>[created, ...historial].slice(0, 50));
      const merged = Array.isArray(remotas) ? remotas : nextLocal;
      const synced = guardarSolicitudesCache(merged);
      emitirSyncSolicitudesTaller();
      setHistorial(synced);
      onSolicitudesSync?.(synced);
      setEnviado(true);
      setMotivo(""); setObs("");
      onEnviado?.();
    } catch(e) {
      if (!esErrorOffline(e)) {
        notify(e?.message || "No se pudo enviar la solicitud al taller", "error");
        return;
      }
      const fallbackLocal = guardarSolicitudesCache(nextLocal);
      setHistorial(fallbackLocal);
      onSolicitudesSync?.(fallbackLocal);
      emitirSyncSolicitudesTaller();
      const q = leerOfflineQueue();
      q.push({ tipo:"solicitud_taller", solicitud, fecha:new Date().toISOString() });
      guardarOfflineQueue(q);
      notify("Sin conexion: la solicitud se ha guardado y se enviara en cuanto vuelva el sistema.", "warning");
      setEnviado(true);
      setMotivo(""); setObs("");
      onEnviado?.();
    }
  }

  const inp = {background:"var(--bg3)",border:"1px solid var(--border)",color:"var(--text)",
    padding:"10px 14px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:14,outline:"none",width:"100%",boxSizing:"border-box"};
  const URGENCIA_COLORS = {normal:"#3b82f6", urgente:"#f59e0b", critica:"#ef4444"};

  return (
    <div style={{padding:"16px"}}>
      {enviado ? (
        <div style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",
          borderRadius:12,padding:24,textAlign:"center",marginBottom:16}}>
          <div style={{fontSize:16,marginBottom:8,fontWeight:800,color:"var(--green)"}}>OK</div>
          <div style={{fontWeight:800,fontSize:16,color:"var(--green)",marginBottom:4}}>Solicitud enviada</div>
          <div style={{fontSize:13,color:"var(--text4)",marginBottom:16}}>El equipo de taller ha sido notificado</div>
          <button onClick={()=>setEnviado(false)}
            style={{padding:"8px 20px",borderRadius:8,border:"none",background:"var(--accent)",
              color:"#fff",fontWeight:700,fontSize:13,cursor:"pointer"}}>
            Nueva solicitud
          </button>
        </div>
      ) : (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:16,marginBottom:16}}>
          <div style={{fontWeight:800,fontSize:16,color:"var(--text)",marginBottom:16}}>Solicitar asistencia de taller</div>

          {/* Vehiculo info */}
          {vehiculo && (
            <div style={{padding:"8px 12px",background:"var(--bg3)",borderRadius:8,marginBottom:14,fontSize:13,color:"var(--text4)"}}>
              Vehiculo: <strong style={{color:"var(--text)"}}>{vehiculo.matricula||"-"}</strong>
              {vehiculo.numero&&<span style={{marginLeft:8}}> - Pedido {vehiculo.numero}</span>}
            </div>
          )}

          {capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo && (
            <div style={{padding:"10px 12px",borderRadius:8,border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.10)",color:"#f59e0b",fontSize:12,fontWeight:800,lineHeight:1.4,marginBottom:14}}>
              La empresa no tiene mecanico interno ni talleres externos configurados. Pide a gerencia que configure al menos un canal de taller.
            </div>
          )}

          {capacidades && capacidades.puede_mecanico && capacidades.puede_taller_externo && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Enviar a</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <button type="button" onClick={()=>setCanal("mecanico")}
                  style={{padding:"10px",borderRadius:8,border:`1.5px solid ${canal==="mecanico"?"var(--accent)":"var(--border)"}`,background:canal==="mecanico"?"rgba(59,130,246,.10)":"var(--bg3)",color:canal==="mecanico"?"var(--accent)":"var(--text3)",fontSize:12,fontWeight:900,cursor:"pointer"}}>
                  Mecanico interno
                </button>
                <button type="button" onClick={()=>setCanal("taller_externo")}
                  style={{padding:"10px",borderRadius:8,border:`1.5px solid ${canal==="taller_externo"?"var(--accent)":"var(--border)"}`,background:canal==="taller_externo"?"rgba(59,130,246,.10)":"var(--bg3)",color:canal==="taller_externo"?"var(--accent)":"var(--text3)",fontSize:12,fontWeight:900,cursor:"pointer"}}>
                  Taller externo
                </button>
              </div>
            </div>
          )}

          {capacidades && !capacidades.puede_mecanico && capacidades.puede_taller_externo && (
            <div style={{padding:"9px 11px",borderRadius:8,background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.22)",color:"#14b8a6",fontSize:12,fontWeight:800,marginBottom:14}}>
              Se enviara a taller externo.
            </div>
          )}

          {canal === "taller_externo" && Array.isArray(capacidades?.proveedores) && capacidades.proveedores.length > 0 && (
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Taller externo</div>
              <select value={proveedorId} onChange={e=>setProveedorId(e.target.value)} style={inp}>
                {capacidades.proveedores.map(p => <option key={p.id || p.nombre} value={p.id || p.nombre}>{p.nombre}</option>)}
              </select>
            </div>
          )}

          {/* Urgencia */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Urgencia</div>
            <div style={{display:"flex",gap:8}}>
              {[["normal","Normal",""],["urgente","Urgente",""],["critica","Critica",""]].map(([v,l,icon])=>(
                <button key={v} onClick={()=>setUrgencia(v)}
                  style={{flex:1,padding:"10px 6px",borderRadius:8,border:`2px solid ${urgencia===v?URGENCIA_COLORS[v]:"var(--border)"}`,
                    background:urgencia===v?`${URGENCIA_COLORS[v]}22`:"transparent",
                    color:urgencia===v?URGENCIA_COLORS[v]:"var(--text4)",
                    fontWeight:urgencia===v?800:500,fontSize:13,cursor:"pointer"}}>
                  {icon} {l}
                </button>
              ))}
            </div>
          </div>

          {/* Motivo */}
          <div style={{marginBottom:14}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Motivo de la averia *</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {MOTIVOS_AVERIA.map(m=>(
                <button key={m.id} onClick={()=>setMotivo(m.id)}
                  style={{padding:"10px 8px",borderRadius:8,textAlign:"left",fontSize:12,
                    border:`1.5px solid ${motivo===m.id?"var(--accent)":"var(--border)"}`,
                    background:motivo===m.id?"rgba(59,130,246,.1)":"var(--bg3)",
                    color:motivo===m.id?"var(--accent)":"var(--text3)",
                    fontWeight:motivo===m.id?700:400,cursor:"pointer"}}>
                  {m.l}
                </button>
              ))}
            </div>
          </div>

          {/* Observaciones */}
          <div style={{marginBottom:16}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>
              Describe el problema (opcional)
            </div>
            <textarea value={obs} onChange={e=>setObs(e.target.value)}
              rows={3} placeholder="Describe con detalle lo que ocurre..."
              style={{...inp,resize:"none"}}/>
          </div>

          <button onClick={enviar} disabled={capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo}
            style={{width:"100%",padding:"14px",borderRadius:10,border:"none",
              background:urgencia==="critica"?"#ef4444":urgencia==="urgente"?"#f59e0b":"var(--accent)",
              color:"#fff",fontWeight:800,fontSize:15,cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif",opacity:capacidades && !capacidades.puede_mecanico && !capacidades.puede_taller_externo ? .55 : 1}}>
            Enviar solicitud de taller
          </button>
        </div>
      )}

      {/* Historial de solicitudes */}
      {historial.length>0 && (
        <div style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12,padding:16}}>
          <div style={{fontWeight:700,fontSize:13,color:"var(--text5)",textTransform:"uppercase",marginBottom:10}}>
            Mis solicitudes recientes
          </div>
          {historial.slice(0,5).map(s=>{
            const estadoMeta = metaSolicitudTaller(s.estado);
            const eventos = Array.isArray(s.eventos) ? s.eventos.slice(-3).reverse() : [];
            return (
              <div key={s.id} style={{borderBottom:"1px solid var(--border)",padding:"9px 0"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:13,color:"var(--text)"}}>{s.motivo_label || s.motivo}</div>
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                      {new Date(s.fecha || s.created_at || Date.now()).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                      {s.vehiculo&&<span style={{marginLeft:6}}> - {s.vehiculo}</span>}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:5,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:800,background:estadoMeta.bg,color:estadoMeta.c}}>
                      {estadoMeta.l}
                    </span>
                    {s.canal && (
                      <span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:800,background:"rgba(20,184,166,.12)",color:"#14b8a6"}}>
                        {s.canal === "taller_externo" ? (s.proveedor_nombre || "Taller") : "Mecanico"}
                      </span>
                    )}
                    <span style={{fontSize:10,padding:"3px 8px",borderRadius:10,fontWeight:800,
                      background:s.urgencia==="critica"?"rgba(239,68,68,.15)":s.urgencia==="urgente"?"rgba(245,158,11,.15)":"rgba(59,130,246,.15)",
                      color:s.urgencia==="critica"?"#ef4444":s.urgencia==="urgente"?"#f59e0b":"var(--accent)"}}>
                      {s.urgencia || "normal"}
                    </span>
                  </div>
                </div>
                {s.observaciones&&<div style={{fontSize:12,color:"var(--text4)",marginTop:4,fontStyle:"italic"}}>"{s.observaciones}"</div>}
                {s.respuesta_taller&&(
                  <div style={{fontSize:12,color:"var(--green)",marginTop:7,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.18)",borderRadius:8,padding:"7px 9px"}}>
                    Taller: {s.respuesta_taller}
                  </div>
                )}
                {s.orden_trabajo_numero&&(
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:5}}>Orden de trabajo: {s.orden_trabajo_numero}</div>
                )}
                {eventos.length > 0 && (
                  <div style={{marginTop:7,display:"grid",gap:4}}>
                    {eventos.map((ev, idx)=>(
                      <div key={`${s.id}-ev-${idx}`} style={{fontSize:10,color:"var(--text5)"}}>
                        {new Date(ev.created_at || ev.fecha || Date.now()).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
                        {" - "}{String(ev.tipo || ev.evento || "actualizacion").replace(/\./g, " ")}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConjuntoChofer({ onRefresh }) {
  const [data, setData] = useState(null);
  const [vehiculoId, setVehiculoId] = useState("");
  const [remolqueId, setRemolqueId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const S = {
    card:{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14},
    btn:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12},
    input:{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif"},
    label:{display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"},
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getChoferConjuntoApp();
      setData(res);
      setVehiculoId(res?.conjunto?.vehiculo_id || "");
      setRemolqueId(res?.conjunto?.remolque_id || "");
    } catch (e) {
      setData({ error: e.message || "No se pudo cargar el conjunto" });
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  const tractoras = Array.isArray(data?.tractoras) ? data.tractoras : [];
  const remolques = Array.isArray(data?.remolques) ? data.remolques : [];
  const tractorasVisibles = tractoras.filter(v => !v.ocupada || String(v.id) === String(data?.conjunto?.vehiculo_id || ""));
  const remolquesVisibles = remolques.filter(r => !r.ocupado || String(r.id) === String(data?.conjunto?.remolque_id || ""));
  async function guardar() {
    setSaving(true);
    try {
      await cambiarChoferConjuntoApp({ vehiculo_id: vehiculoId || null, remolque_id: remolqueId || null });
      notify("Conjunto actualizado. Trafico queda avisado.", "success");
      await load();
      await onRefresh?.();
    } catch (e) {
      notify(e.message || "No se pudo cambiar el conjunto", "error");
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="tg-chofer-card" style={S.card}>
      <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:16,color:"var(--text)"}}>Mi conjunto</div>
      <div style={{fontSize:12,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
        Puedes seleccionar una tractora y remolque libres. Si necesitas mover un equipo ocupado, lo revisa trafico.
      </div>
      {loading ? (
        <div style={{fontSize:12,color:"var(--text4)",marginTop:10}}>Cargando conjunto...</div>
      ) : data?.error ? (
        <div style={{fontSize:12,color:"#ef4444",marginTop:10}}>{data.error}</div>
      ) : (
        <>
          <label style={S.label}>Tractora</label>
          <select style={S.input} value={vehiculoId} onChange={e => { setVehiculoId(e.target.value); if (!e.target.value) setRemolqueId(""); }}>
            <option value="">Sin tractora</option>
            {tractorasVisibles.map(v => (
              <option key={v.id} value={v.id}>{v.matricula || "Sin matricula"}</option>
            ))}
          </select>
          <label style={S.label}>Remolque</label>
          <select style={S.input} value={remolqueId} onChange={e => setRemolqueId(e.target.value)} disabled={!vehiculoId}>
            <option value="">Sin remolque</option>
            {remolquesVisibles.map(r => (
              <option key={r.id} value={r.id}>{r.matricula || "Sin matricula"}</option>
            ))}
          </select>
          <button disabled={saving} onClick={guardar} style={{...S.btn,width:"100%",marginTop:12,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)",opacity:saving?0.65:1}}>
            {saving ? "Guardando..." : "Actualizar conjunto"}
          </button>
        </>
      )}
    </div>
  );
}

function JornadaChofer({ jornadaInfo, gpsSeguimientoEstado, onRefresh }) {
  const jornada = jornadaInfo?.jornada || null;
  const chofer = jornadaInfo?.chofer || null;
  const resumen = jornada?.resumen || {};
  const [kmInicio, setKmInicio] = useState("");
  const [kmFin, setKmFin] = useState("");
  const [haceNoche, setHaceNoche] = useState(false);
  const [nocheLugar, setNocheLugar] = useState("");
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const [tick, setTick] = useState(Date.now());
  const S = {
    card:{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14},
    btn:{padding:"10px 12px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text)",fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12},
    input:{width:"100%",boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",fontFamily:"'DM Sans',sans-serif"},
    label:{display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"},
  };
  const fmtMin = (m=0) => {
    const mins = Math.max(0, Number(m || 0));
    const h = Math.floor(mins / 60);
    const r = mins % 60;
    return h ? `${h}h ${String(r).padStart(2,"0")}m` : `${r}m`;
  };
  useEffect(() => {
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const liveExtra = (() => {
    const base = new Date(resumen.calculado_at || Date.now()).getTime();
    if (!Number.isFinite(base) || tick <= base) return 0;
    return Math.floor((tick - base) / 60000);
  })();
  const actividadActual = jornada?.actividad_actual || "";
  const conduccionDesdePausaLive = Number(resumen.conduccion_desde_pausa_min || 0) + (actividadActual === "conduccion" ? liveExtra : 0);
  const conduccionHoyLive = Number(resumen.conduccion_min || 0) + (actividadActual === "conduccion" ? liveExtra : 0);
  const pausaActualLive = Number(resumen.pausa_actual_min || 0) + (["pausa","descanso"].includes(actividadActual) ? liveExtra : 0);
  const descansoActualLive = Number(resumen.descanso_diario_actual_min || 0) + (actividadActual === "descanso" ? liveExtra : 0);
  const proximaPausaLive = Math.max(0, Number(resumen.limites?.conduccionContinuaMin || 270) - conduccionDesdePausaLive);
  const puedeArrancarLive = proximaPausaLive > 0 && conduccionHoyLive < Number(resumen.limites?.conduccionDiariaExtendidaMin || 600);
  const pausaRestanteLive = Math.max(0, Number(resumen.limites?.pausaCompletaMin || 45) - pausaActualLive);
  const descanso9RestanteLive = Math.max(0, Number(resumen.limites?.descansoDiarioReducidoMin || 540) - descansoActualLive);
  const descanso11RestanteLive = Math.max(0, Number(resumen.limites?.descansoDiarioNormalMin || 660) - descansoActualLive);
  const eventos = Array.isArray(jornada?.eventos) ? jornada.eventos : [];
  const actividadLabel = (v) => v === "conduccion" ? "Conduccion" : v === "pausa" ? "Pausa" : v === "descanso" ? "Descanso" : v === "disponibilidad" ? "Disponibilidad" : v === "fin" ? "Fin" : "Otros trabajos";
  async function run(fn) {
    setSaving(true);
    try {
      await fn();
      await onRefresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }
  async function cambiarActividad(actividad, payload = {}) {
    if (jornada?.actividad_actual === actividad) {
      notify(`Ya estas en ${actividadLabel(actividad).toLowerCase()}.`, "warning");
      return;
    }
    return run(()=>cambiarChoferJornadaActividad({ actividad, ...payload }));
  }
  function kmValido(value, label) {
    const raw = String(value || "").trim().replace(",", ".");
    const n = Number(raw);
    if (!raw || !Number.isFinite(n) || n < 0) {
      notify(`${label} es obligatorio y debe ser un numero valido.`, "warning");
      return null;
    }
    return Math.round(n * 10) / 10;
  }
  async function iniciarJornadaConKm() {
    const km = kmValido(kmInicio, "Km inicio");
    if (km == null) return;
    await run(()=>iniciarChoferJornada({ km_inicio: km, actividad:"otros_trabajos", notas }));
  }
  async function cerrarJornadaCompleta() {
    const km = kmValido(kmFin, "Km cierre");
    if (km == null) return;
    await run(async () => {
      if (jornada?.actividad_actual !== "descanso") {
        await cambiarChoferJornadaActividad({
          actividad: "descanso",
          objetivo_descanso_min: 660,
          notas: "Descanso automatico al cerrar jornada",
        });
      }
      await cerrarChoferJornada({ km_fin: km, hace_noche: haceNoche, noche_lugar: nocheLugar || null, notas });
    });
    notify("Jornada cerrada y disco interno en descanso.", "success");
  }
  return (
    <div>
      <div style={S.card}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)"}}>Registro de jornada</div>
        <div style={{fontSize:12,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
          Registro interno de jornada y asistente de tiempos. No sustituye al tacografo legal del vehiculo.
        </div>
        {gpsSeguimientoEstado?.text && (
          <div style={{
            marginTop:10,
            padding:"8px 10px",
            borderRadius:8,
            border:`1px solid ${gpsSeguimientoEstado.active ? "rgba(16,185,129,.28)" : "rgba(245,158,11,.28)"}`,
            background:gpsSeguimientoEstado.active ? "rgba(16,185,129,.10)" : "rgba(245,158,11,.10)",
            color:gpsSeguimientoEstado.active ? "#10b981" : "#f59e0b",
            fontSize:11,
            fontWeight:900,
          }}>
            {gpsSeguimientoEstado.text}
          </div>
        )}
        {chofer && (
          <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <Mini label="Chofer" value={`${chofer.nombre || ""} ${chofer.apellidos || ""}`.trim()} />
            <Mini label="Conjunto" value={`${chofer.vehiculo_matricula || "Sin tractora"}${chofer.remolque_matricula ? ` + ${chofer.remolque_matricula}` : ""}`} />
          </div>
        )}
      </div>
      <ConjuntoChofer onRefresh={onRefresh} />
      {!jornada ? (
        <div style={S.card}>
          <label style={S.label}>Km inicio</label>
          <input type="number" style={S.input} value={kmInicio} onChange={e=>setKmInicio(e.target.value)} placeholder={chofer?.km_actuales ? String(chofer.km_actuales) : "Kilometros actuales"} />
          <label style={S.label}>Notas inicio</label>
          <input style={S.input} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Base, incidencia inicial, observaciones..." />
          <button disabled={saving} onClick={iniciarJornadaConKm} style={{...S.btn,width:"100%",marginTop:12,background:"var(--accent)",color:"#fff",borderColor:"var(--accent)"}}>
            Iniciar jornada
          </button>
        </div>
      ) : (
        <>
          <div style={S.card}>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8}}>
              <Mini label="Actividad" value={actividadLabel(jornada.actividad_actual)} />
              <Mini label="Desde" value={jornada.inicio_at ? new Date(jornada.inicio_at).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"}) : "-"} />
              <Mini label="Conduccion hoy" value={fmtMin(conduccionHoyLive)} />
              <Mini label="Desde pausa" value={fmtMin(conduccionDesdePausaLive)} />
            </div>
            <div style={{marginTop:10,padding:"9px 10px",borderRadius:8,background:puedeArrancarLive?"rgba(16,185,129,.10)":"rgba(239,68,68,.10)",border:`1px solid ${puedeArrancarLive?"rgba(16,185,129,.25)":"rgba(239,68,68,.25)"}`,color:puedeArrancarLive?"#10b981":"#ef4444",fontWeight:800,fontSize:12}}>
              {puedeArrancarLive ? `Puede conducir. Proxima pausa en ${fmtMin(proximaPausaLive)}.` : "No deberia iniciar conduccion hasta realizar la pausa/descanso necesario."}
            </div>
            <div style={{marginTop:10,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Mini label="Pausa actual" value={["pausa","descanso"].includes(actividadActual) ? `${fmtMin(pausaActualLive)} / faltan ${fmtMin(pausaRestanteLive)}` : "-"} />
              <Mini label="Descanso diario" value={actividadActual === "descanso" ? `9h: ${fmtMin(descanso9RestanteLive)} | 11h: ${fmtMin(descanso11RestanteLive)}` : "-"} />
            </div>
            <div style={{marginTop:8,fontSize:11,color:"var(--text4)",lineHeight:1.45}}>
              Pausa valida: 45 minutos seguidos o partida 15 + 30. Descanso diario: 11h normal o 9h reducido cuando proceda.
            </div>
            {Array.isArray(resumen.avisos) && resumen.avisos.map((a,idx)=>(
              <div key={idx} style={{marginTop:8,fontSize:12,color:"#f59e0b",background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.22)",borderRadius:8,padding:"8px 10px",lineHeight:1.4}}>{a}</div>
            ))}
          </div>
          <div style={{...S.card,display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <button disabled={saving || !puedeArrancarLive} onClick={()=>cambiarActividad("conduccion")} style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",borderColor:"rgba(249,115,22,.25)",opacity:puedeArrancarLive?1:.55}}>Conducir</button>
            <button disabled={saving} onClick={()=>cambiarActividad("pausa", { notas:"Pausa 45 min o pausa partida 15 + 30" })} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"#10b981",borderColor:"rgba(16,185,129,.25)"}}>Pausa 45 / partida</button>
            <button disabled={saving} onClick={()=>cambiarActividad("descanso", { objetivo_descanso_min:540, notas:"Descanso diario reducido 9h" })} style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#3b82f6",borderColor:"rgba(59,130,246,.25)"}}>Descanso 9h</button>
            <button disabled={saving} onClick={()=>cambiarActividad("descanso", { objetivo_descanso_min:660, notas:"Descanso diario normal 11h" })} style={{...S.btn,background:"rgba(59,130,246,.10)",color:"#3b82f6",borderColor:"rgba(59,130,246,.25)"}}>Descanso 11h</button>
            <button disabled={saving} onClick={()=>cambiarActividad("disponibilidad")} style={S.btn}>Disponibilidad</button>
            <button disabled={saving} onClick={()=>cambiarActividad("otros_trabajos")} style={S.btn}>Otros trabajos</button>
          </div>
          {eventos.length > 0 && (
            <div style={S.card}>
              <div style={{fontWeight:900,fontSize:13,color:"var(--text)",marginBottom:8}}>Registro de eventos</div>
              <div style={{display:"grid",gap:7}}>
                {eventos.slice(-8).reverse().map((ev, idx)=>(
                  <div key={`${ev.at || idx}-${idx}`} style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:12,color:"var(--text3)",borderBottom:idx===Math.min(7,eventos.length-1)?"none":"1px solid var(--border)",paddingBottom:6}}>
                    <span style={{fontWeight:800,color:"var(--text)"}}>{actividadLabel(ev.tipo)}{ev.objetivo_descanso_min ? ` ${fmtMin(ev.objetivo_descanso_min)}` : ""}</span>
                    <span>{ev.at ? new Date(ev.at).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}) : "-"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div style={S.card}>
            <label style={S.label}>Km cierre</label>
            <input type="number" style={S.input} value={kmFin} onChange={e=>setKmFin(e.target.value)} placeholder="Kilometros al terminar" />
            <label style={{display:"flex",gap:8,alignItems:"center",fontSize:12,color:"var(--text3)",fontWeight:800,marginTop:10}}>
              <input type="checkbox" checked={haceNoche} onChange={e=>setHaceNoche(e.target.checked)} />
              He hecho noche fuera
            </label>
            {haceNoche && (
              <>
                <label style={S.label}>Lugar de noche</label>
                <input style={S.input} value={nocheLugar} onChange={e=>setNocheLugar(e.target.value)} placeholder="Ciudad / parking / base" />
              </>
            )}
            <label style={S.label}>Notas cierre</label>
            <input style={S.input} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Observaciones de cierre" />
            <button disabled={saving} onClick={cerrarJornadaCompleta} style={{...S.btn,width:"100%",marginTop:12,background:"#ef4444",color:"#fff",borderColor:"#ef4444"}}>
              Cerrar jornada
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function VacacionesChofer({ items = [], chofer, onRefresh }) {
  const [form, setForm] = useState({
    fecha_inicio: new Date().toISOString().slice(0,10),
    fecha_fin: "",
    motivo: "",
  });
  const [saving, setSaving] = useState(false);
  const [firma, setFirma] = useState(null);
  const [firmaPendiente, setFirmaPendiente] = useState(null);
  const nombreChofer = `${chofer?.nombre || ""} ${chofer?.apellidos || ""}`.trim();
  const estados = {
    pendiente: ["Pendiente", "#f59e0b"],
    aprobada_pendiente_firma: ["Aprobada, falta firma", "#3b82f6"],
    aprobada_firmada: ["Aprobada y firmada", "#10b981"],
    rechazada: ["Rechazada", "#ef4444"],
  };

  async function enviarSolicitud(firmaData) {
    setSaving(true);
    try {
      await solicitarChoferVacacionesApp({ ...form, firma: firmaData });
      setForm({ fecha_inicio: new Date().toISOString().slice(0,10), fecha_fin: "", motivo: "" });
      setFirma(null);
      notify("Solicitud de vacaciones enviada", "success");
      await onRefresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function firmarAceptacion(item, firmaData) {
    setSaving(true);
    try {
      await firmarChoferVacacionesApp(item.id, { firma: firmaData });
      setFirmaPendiente(null);
      notify("Hoja de vacaciones firmada", "success");
      await onRefresh();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <div className="tg-chofer-card" style={{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:17,color:"var(--text)"}}>Vacaciones</div>
        <div style={{fontSize:12,color:"var(--text4)",marginTop:4,lineHeight:1.45}}>
          Solicita vacaciones y firma la solicitud desde la app. Si gerencia aprueba sin firma directa, aparecerá aquí para firmar la aceptación.
        </div>
        <div className="tg-chofer-vacaciones-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginTop:12}}>
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Inicio</label>
            <input type="date" value={form.fecha_inicio} onChange={e=>setForm(p=>({...p,fecha_inicio:e.target.value}))}
              style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)"}} />
          </div>
          <div>
            <label style={{display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginBottom:4}}>Fin</label>
            <input type="date" value={form.fecha_fin} onChange={e=>setForm(p=>({...p,fecha_fin:e.target.value}))}
              style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)"}} />
          </div>
        </div>
        <label style={{display:"block",fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",margin:"10px 0 4px"}}>Motivo / notas</label>
        <textarea value={form.motivo} onChange={e=>setForm(p=>({...p,motivo:e.target.value}))} placeholder="Opcional"
          style={{width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px",color:"var(--text)",minHeight:70,resize:"vertical",fontFamily:"'DM Sans',sans-serif"}} />
        <button disabled={saving || !form.fecha_inicio || !form.fecha_fin} onClick={()=>setFirma("solicitud")}
          style={{width:"100%",marginTop:12,padding:"12px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",opacity:saving ? .6 : 1}}>
          Solicitar y firmar
        </button>
      </div>

      <div className="tg-chofer-card" style={{margin:"12px 16px",background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <div style={{fontWeight:900,fontSize:13,color:"var(--text)",marginBottom:8}}>Mis solicitudes</div>
        {items.length === 0 ? (
          <div style={{fontSize:12,color:"var(--text5)"}}>Sin solicitudes registradas.</div>
        ) : items.map(item => {
          const [label, color] = estados[item.estado] || [item.estado || "Estado", "var(--text5)"];
          return (
            <div key={item.id} style={{borderTop:"1px solid var(--border)",padding:"10px 0"}}>
              <div className="tg-chofer-vacaciones-row" style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start"}}>
                <div>
                  <div style={{fontWeight:900,fontSize:13,color:"var(--text)"}}>
                    {String(item.fecha_inicio || "").slice(0,10)} a {String(item.fecha_fin || "").slice(0,10)}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{Number(item.dias || 0)} días {item.motivo ? `- ${item.motivo}` : ""}</div>
                </div>
                <span style={{fontSize:10,fontWeight:900,color,background:`${color}18`,border:`1px solid ${color}30`,borderRadius:99,padding:"3px 8px",whiteSpace:"nowrap"}}>{label}</span>
              </div>
              {item.estado === "aprobada_pendiente_firma" && (
                <button disabled={saving} onClick={()=>setFirmaPendiente(item)}
                  style={{marginTop:8,padding:"9px 11px",borderRadius:8,border:"1px solid rgba(16,185,129,.35)",background:"rgba(16,185,129,.10)",color:"#10b981",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  Firmar aceptación
                </button>
              )}
              {item.observaciones && <div style={{fontSize:11,color:"var(--text4)",marginTop:6}}>Gerencia: {item.observaciones}</div>}
            </div>
          );
        })}
      </div>

      {firma && (
        <FirmaLaboralCanvas
          title="Firmar solicitud de vacaciones"
          detail={`${form.fecha_inicio} a ${form.fecha_fin}. Esta firma acredita que solicitas estos días.`}
          defaultName={nombreChofer}
          onCancel={()=>setFirma(null)}
          onFirma={enviarSolicitud}
        />
      )}
      {firmaPendiente && (
        <FirmaLaboralCanvas
          title="Firmar hoja de vacaciones"
          detail={`${String(firmaPendiente.fecha_inicio || "").slice(0,10)} a ${String(firmaPendiente.fecha_fin || "").slice(0,10)}. Firma la aceptación de vacaciones aprobadas.`}
          defaultName={nombreChofer}
          onCancel={()=>setFirmaPendiente(null)}
          onFirma={(data)=>firmarAceptacion(firmaPendiente, data)}
        />
      )}
    </div>
  );
}

function NuevoViajeChofer({ onCreado }) {
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    cliente_id: "",
    cliente_nombre: "",
    ruta_id: "",
    origen: "",
    destino: "",
    fecha_carga: today,
    hora_carga: "",
    fecha_descarga: today,
    hora_descarga: "",
    mercancia: "",
    peso_kg: "",
    bultos: "",
    referencia_cliente: "",
    notas: "",
    puntos_carga: [],
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [clientes, setClientes] = useState([]);
  const [rutas, setRutas] = useState([]);
  const [puntosCarga, setPuntosCarga] = useState([]);
  const [loadingRutas, setLoadingRutas] = useState(false);
  const [loadingPuntos, setLoadingPuntos] = useState(false);
  const [creatingRuta, setCreatingRuta] = useState(false);
  const [creatingPunto, setCreatingPunto] = useState(false);
  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }));
  const inputStyle = {width:"100%",maxWidth:"100%",minWidth:0,boxSizing:"border-box",border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",borderRadius:8,padding:"10px 11px",fontSize:13,fontFamily:"'DM Sans',sans-serif",outline:"none"};

  useEffect(() => {
    const q = form.cliente_nombre.trim();
    const timer = setTimeout(async () => {
      try {
        const data = await getChoferClientes(q);
        setClientes(Array.isArray(data) ? data : []);
      } catch {
        setClientes([]);
      }
    }, 260);
    return () => clearTimeout(timer);
  }, [form.cliente_nombre]);

  useEffect(() => {
    if (!form.cliente_id) {
      setRutas([]);
      setPuntosCarga([]);
      return;
    }
    setLoadingRutas(true);
    getChoferClienteRutas(form.cliente_id)
      .then(data => setRutas(Array.isArray(data) ? data : []))
      .catch(() => setRutas([]))
      .finally(() => setLoadingRutas(false));
    setLoadingPuntos(true);
    getChoferClientePuntosCarga(form.cliente_id)
      .then(data => {
        const lista = Array.isArray(data) ? data : [];
        setPuntosCarga(lista);
        if (lista.length === 1 && !String(form.origen || "").trim()) {
          seleccionarPuntoCarga(lista[0]);
        }
      })
      .catch(() => setPuntosCarga([]))
      .finally(() => setLoadingPuntos(false));
    // seleccionarPuntoCarga uses current form values when the client changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.cliente_id]);

  function cambiarClienteNombre(value) {
    setForm(prev => ({
      ...prev,
      cliente_nombre: value,
      cliente_id: value.trim() === prev.cliente_nombre.trim() ? prev.cliente_id : "",
      ruta_id: "",
      puntos_carga: [],
    }));
  }

  function seleccionarCliente(cliente) {
    setForm(prev => ({
      ...prev,
      cliente_id: cliente.id,
      cliente_nombre: cliente.nombre || prev.cliente_nombre,
      ruta_id: "",
      puntos_carga: [],
    }));
  }

  function seleccionarPuntoCarga(punto) {
    setForm(prev => {
      const stop = puntoCargaToPedidoStop(punto, prev.fecha_carga, prev.hora_carga);
      return {
        ...prev,
        origen: punto.nombre || punto.direccion || prev.origen,
        puntos_carga: [stop],
      };
    });
    if (punto?.pendiente_revision || punto?.metadata?.pending_review) {
      notify("Punto de carga pendiente de revision por trafico.", "warning");
    }
  }

  function seleccionarRuta(rutaId) {
    const ruta = rutas.find(r => String(r.id) === String(rutaId));
    setForm(prev => ({
      ...prev,
      ruta_id: rutaId,
      origen: ruta?.origen || prev.origen,
      destino: ruta?.destino || prev.destino,
    }));
  }

  async function crearRutaPendiente() {
    if (!form.cliente_id || !form.origen.trim() || !form.destino.trim()) {
      notify("Selecciona cliente e indica origen y destino para crear la ruta.", "warning");
      return;
    }
    setCreatingRuta(true);
    try {
      const ruta = await crearChoferRuta({
        cliente_id: form.cliente_id,
        origen: form.origen,
        destino: form.destino,
        notas: "Propuesta desde nuevo viaje DCD.",
      });
      notify("Ruta creada y enviada a trafico para revisar tarifa.", "success");
      const fresh = await getChoferClienteRutas(form.cliente_id).catch(() => []);
      setRutas(Array.isArray(fresh) ? fresh : []);
      setForm(prev => ({ ...prev, ruta_id: ruta?.ruta_id || prev.ruta_id }));
    } catch (err) {
      notify(err.message || "No se pudo crear la ruta", "error");
    } finally {
      setCreatingRuta(false);
    }
  }

  async function crearPuntoCargaPendiente() {
    if (!form.cliente_id) {
      notify("Selecciona primero un cliente.", "warning");
      return;
    }
    const direccion = String(form.origen || "").trim();
    if (!direccion) {
      notify("Indica el punto de carga antes de guardarlo.", "warning");
      return;
    }
    setCreatingPunto(true);
    try {
      const result = await crearChoferClientePuntoCarga(form.cliente_id, {
        nombre: direccion,
        direccion,
        ventana: form.hora_carga ? `Hora indicada por chofer: ${form.hora_carga}` : "",
        notas: "Alta rapida desde nuevo viaje del chofer.",
      });
      const punto = result?.punto || result;
      const fresh = await getChoferClientePuntosCarga(form.cliente_id).catch(() => []);
      setPuntosCarga(Array.isArray(fresh) ? fresh : []);
      if (punto?.id) seleccionarPuntoCarga(punto);
      notify("Punto de carga creado y enviado a trafico para revisar.", "success");
    } catch (err) {
      notify(err.message || "No se pudo crear el punto de carga", "error");
    } finally {
      setCreatingPunto(false);
    }
  }

  async function guardar() {
    if (!form.cliente_nombre.trim() || !form.origen.trim() || !form.destino.trim() || !form.mercancia.trim()) {
      notify("Completa cliente, origen, destino y mercancia.", "warning");
      return;
    }
    setSaving(true);
    try {
      const res = await crearPedidoChofer(form);
      setCreated(res);
      notify("Viaje creado con DCD y QR.", "success");
      setForm(prev => ({
        ...prev,
        ruta_id: "",
        cliente_nombre: "",
        cliente_id: "",
        origen: "",
        destino: "",
        mercancia: "",
        peso_kg: "",
        bultos: "",
        referencia_cliente: "",
        notas: "",
        puntos_carga: [],
      }));
      setPuntosCarga([]);
      onCreado?.();
    } catch (err) {
      notify(err.message || "No se pudo crear el viaje", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tg-chofer-section-shell" style={{padding:"12px 16px"}}>
      <div className="tg-chofer-card" style={{background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:10,padding:14}}>
        <div style={{fontSize:15,fontWeight:900,color:"var(--text)",marginBottom:4}}>Nuevo viaje DCD</div>
        <div style={{fontSize:11,color:"var(--text5)",lineHeight:1.4,marginBottom:12}}>Crea un viaje propio para disponer del documento de control digital y su QR.</div>
        <div style={{display:"grid",gap:10}}>
          <input value={form.cliente_nombre} onChange={e=>cambiarClienteNombre(e.target.value)} placeholder="Cliente / destinatario" style={inputStyle}/>
          {clientes.length > 0 && (
            <div style={{display:"grid",gap:6}}>
              <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>
                {form.cliente_nombre.trim() ? "Coincidencias" : "Acceso rapido por cargas"}
              </div>
              {clientes.slice(0, form.cliente_nombre.trim() ? 8 : 5).map(cliente => (
                <button key={cliente.id} type="button" onClick={()=>seleccionarCliente(cliente)}
                  style={{textAlign:"left",padding:"8px 10px",borderRadius:8,border:`1px solid ${form.cliente_id===cliente.id ? "rgba(20,184,166,.45)" : "var(--border2)"}`,background:form.cliente_id===cliente.id ? "rgba(20,184,166,.10)" : "var(--bg3)",color:"var(--text)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {cliente.nombre}
                  {cliente.cif ? <span style={{fontWeight:600,color:"var(--text5)"}}> · {cliente.cif}</span> : null}
                  {Number(cliente.cargas_total || 0) > 0 ? <span style={{fontWeight:700,color:"#14b8a6"}}> · {cliente.cargas_total} cargas</span> : null}
                </button>
              ))}
            </div>
          )}
          {form.cliente_id && (
            <div style={{display:"grid",gap:6}}>
              <select value={form.ruta_id || ""} onChange={e=>seleccionarRuta(e.target.value)} style={inputStyle}>
                <option value="">{loadingRutas ? "Cargando rutas..." : "Sin ruta / crear manual"}</option>
                {rutas.map(r => (
                  <option key={r.id} value={r.id}>{r.origen} -> {r.destino}</option>
                ))}
              </select>
            </div>
          )}
          <input value={form.origen} onChange={e=>set("origen", e.target.value)} placeholder="Origen / punto de carga" style={inputStyle}/>
          {form.cliente_id && (
            <div style={{display:"grid",gap:7,background:"rgba(20,184,166,.06)",border:"1px solid rgba(20,184,166,.18)",borderRadius:8,padding:9}}>
              <div style={{fontSize:11,color:"var(--text4)",fontWeight:800}}>
                {loadingPuntos ? "Cargando puntos de carga..." : puntosCarga.length ? "Puntos de carga del cliente" : "Este cliente no tiene puntos de carga guardados."}
              </div>
              {puntosCarga.slice(0, 6).map(punto => (
                <button key={punto.id} type="button" onClick={()=>seleccionarPuntoCarga(punto)}
                  style={{textAlign:"left",padding:"8px 9px",borderRadius:8,border:`1px solid ${String(form.puntos_carga?.[0]?.punto_interes_id || "") === String(punto.id) ? "rgba(20,184,166,.45)" : "rgba(20,184,166,.18)"}`,background:String(form.puntos_carga?.[0]?.punto_interes_id || "") === String(punto.id) ? "rgba(20,184,166,.12)" : "var(--bg3)",color:"var(--text)",fontSize:12,fontWeight:900,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {punto.nombre || punto.direccion}
                  <span style={{display:"block",fontSize:10,fontWeight:700,color:"var(--text5)",marginTop:2}}>{direccionCompletaPuntoChofer(punto) || punto.direccion}</span>
                  {punto.pendiente_revision ? <span style={{display:"inline-block",fontSize:10,fontWeight:900,color:"#f59e0b",marginTop:4}}>Pendiente de revision trafico</span> : null}
                </button>
              ))}
              {form.origen.trim() && (
                <button type="button" onClick={crearPuntoCargaPendiente} disabled={creatingPunto}
                  style={{padding:"10px",borderRadius:8,border:"1px solid rgba(20,184,166,.30)",background:"rgba(20,184,166,.10)",color:"#14b8a6",fontSize:12,fontWeight:900,cursor:creatingPunto?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                  {creatingPunto ? "Creando punto..." : "Crear punto de carga para revisar"}
                </button>
              )}
            </div>
          )}
          <input value={form.destino} onChange={e=>set("destino", e.target.value)} placeholder="Destino / punto de descarga" style={inputStyle}/>
          {form.cliente_id && form.origen.trim() && form.destino.trim() && !form.ruta_id && (
            <button type="button" onClick={crearRutaPendiente} disabled={creatingRuta}
              style={{padding:"10px",borderRadius:8,border:"1px solid rgba(59,130,246,.3)",background:"rgba(59,130,246,.08)",color:"#60a5fa",fontSize:12,fontWeight:900,cursor:creatingRuta?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {creatingRuta ? "Creando ruta..." : "Crear ruta para revisar"}
            </button>
          )}
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <input type="date" value={form.fecha_carga} onChange={e=>set("fecha_carga", e.target.value)} style={inputStyle}/>
            <input type="time" value={form.hora_carga} onChange={e=>set("hora_carga", e.target.value)} style={inputStyle}/>
          </div>
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <input type="date" value={form.fecha_descarga} onChange={e=>set("fecha_descarga", e.target.value)} style={inputStyle}/>
            <input type="time" value={form.hora_descarga} onChange={e=>set("hora_descarga", e.target.value)} style={inputStyle}/>
          </div>
          <input value={form.mercancia} onChange={e=>set("mercancia", e.target.value)} placeholder="Mercancia" style={inputStyle}/>
          <div className="tg-chofer-nuevo-grid" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <input inputMode="decimal" value={form.peso_kg} onChange={e=>set("peso_kg", e.target.value)} placeholder="Peso kg" style={inputStyle}/>
            <input inputMode="numeric" value={form.bultos} onChange={e=>set("bultos", e.target.value)} placeholder="Bultos" style={inputStyle}/>
          </div>
          <input value={form.referencia_cliente} onChange={e=>set("referencia_cliente", e.target.value)} placeholder="Referencia cliente" style={inputStyle}/>
          <textarea value={form.notas} onChange={e=>set("notas", e.target.value)} placeholder="Notas" rows={3} style={{...inputStyle,resize:"none"}}/>
          <button onClick={guardar} disabled={saving} style={{padding:"13px",borderRadius:8,border:"none",background:"#0f766e",color:"#fff",fontSize:13,fontWeight:900,cursor:saving?"default":"pointer",fontFamily:"'DM Sans',sans-serif"}}>
            {saving ? "Creando..." : "Crear viaje y DCD"}
          </button>
        </div>
        {created?.documento_control?.qr?.data_url && (
          <div style={{marginTop:14,background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.22)",borderRadius:10,padding:12,textAlign:"center"}}>
            <div style={{fontSize:12,fontWeight:900,color:"#10b981",marginBottom:8}}>QR generado</div>
            <img src={created.documento_control.qr.data_url} alt="QR DCD creado" style={{width:190,height:190,objectFit:"contain",background:"#fff",borderRadius:8,padding:8}}/>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:8}}>El viaje aparece ya en Activos.</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function AppChofer(){
  const { user, logout } = useAuth();
  const planNorm = String(user?.plan || "").toLowerCase();
  const isLitePlan = ["lite", "mini", "transgest_lite", "transgest_mini"].includes(planNorm);
  const [pedidos,   setPedidos]   = useState([]);
  const [solicitudesChofer, setSolicitudesChofer] = useState([]);
  const [vacacionesChofer, setVacacionesChofer] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [tab,       setTab]       = useState("activos"); // activos | nuevo | historial | solicitud

  // PWA state
  const [offline,        setOffline]        = useState(!navigator.onLine);
  const [installPrompt,  setInstallPrompt]  = useState(null);
  const [showInstall,    setShowInstall]    = useState(false);
  const [notifPerm,      setNotifPerm]      = useState(() => ("Notification" in window ? Notification.permission : "default"));
  const [cameraModal,    setCameraModal]    = useState(null); // pedido for photo
  const [offlineQueue,   setOfflineQueue]   = useState(() => leerOfflineQueue());
  const [jornadaInfo, setJornadaInfo] = useState(null);
  const [expandedPedidoId, setExpandedPedidoId] = useState(null);
  const [routeNotifications, setRouteNotifications] = useState([]);
  const [firmaBaseOpen, setFirmaBaseOpen] = useState(false);
  const gpsSeguimientoRef = useRef({ lastSent: 0 });
  const [gpsSeguimientoEstado, setGpsSeguimientoEstado] = useState({
    active: false,
    text: "Ubicacion en espera hasta iniciar jornada.",
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try{
      const p = await getPedidos({chofer_id:user?.chofer_id || user?.id});
      const arr = Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [];
      setPedidos(arr);
      const jornada = await getChoferJornadaApp().catch(() => null);
      setJornadaInfo(jornada);
      const puedeLeerAvisos = user?.rol !== "chofer" || user?.permisos?.avisos?.ver === true;
      if (puedeLeerAvisos) {
        const avisos = await getNotificaciones(20).catch(() => ({ data: [] }));
        setRouteNotifications((Array.isArray(avisos?.data) ? avisos.data : [])
          .filter(n => String(n.tipo || "") === "ruta_chofer_app")
          .slice(0, 3));
      } else {
        setRouteNotifications([]);
      }
      if (isLitePlan) {
        setSolicitudesChofer([]);
        setVacacionesChofer([]);
      } else {
        const solicitudes = await getTallerSolicitudes().catch(() => []);
        const nextSolicitudes = Array.isArray(solicitudes) ? solicitudes.slice(0, 50) : [];
        setSolicitudesChofer(nextSolicitudes);
        const vacaciones = await getChoferVacacionesApp().catch(() => []);
        const vacacionesArr = Array.isArray(vacaciones) ? vacaciones : Array.isArray(vacaciones?.solicitudes) ? vacaciones.solicitudes : [];
        setVacacionesChofer(vacacionesArr.slice(0, 50));
      }
    }catch(e){ console.error(e); }
    finally{ setLoading(false); }
  }, [user?.id, user?.chofer_id, user?.rol, user?.permisos?.avisos?.ver, isLitePlan]);

  useEffect(()=>{ cargar(); },[cargar]);

  useEffect(() => {
    const chofer = jornadaInfo?.chofer;
    if (user?.rol === "chofer" && chofer?.id && !chofer?.firma_base) setFirmaBaseOpen(true);
  }, [jornadaInfo?.chofer, user?.rol]);

  async function guardarFirmaBaseChofer(firma) {
    try {
      await guardarChoferFirmaBaseApp(firma);
      setFirmaBaseOpen(false);
      notify("Firma guardada en tu ficha de chofer.", "success");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la firma", "error");
    }
  }

  useEffect(() => {
    if (isLitePlan && ["solicitud", "vacaciones"].includes(tab)) setTab("activos");
  }, [isLitePlan, tab]);

  useEffect(() => {
    const refreshQueue = (event) => {
      if (Array.isArray(event?.detail)) {
        setOfflineQueue(event.detail);
        return;
      }
      setOfflineQueue(leerOfflineQueue());
    };
    window.addEventListener("tms:offline-queue-changed", refreshQueue);
    return () => window.removeEventListener("tms:offline-queue-changed", refreshQueue);
  }, []);

  // PWA: offline detection
  useEffect(()=>{
    const goOnline  = () => { setOffline(false); syncOfflineQueue(); };
    const goOffline = () => setOffline(true);
    window.addEventListener("online",  goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online",  goOnline);
      window.removeEventListener("offline", goOffline);
    };
  // syncOfflineQueue intentionally stays stable enough for the browser online event.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PWA: install prompt
  useEffect(()=>{
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e); setShowInstall(true); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const gpsJornadaId = jornadaInfo?.jornada?.id || null;
  const gpsJornadaEstado = jornadaInfo?.jornada?.estado || "";
  const gpsJornadaActividad = jornadaInfo?.jornada?.actividad_actual || "";
  const gpsChoferVehiculoId = jornadaInfo?.chofer?.vehiculo_id || null;
  const gpsChoferProvider = jornadaInfo?.chofer?.gps_provider || "";
  const gpsChoferExternalId = jornadaInfo?.chofer?.gps_external_id || "";

  // GPS app: se activa con jornada abierta y se pausa en descanso, pausa o fin.
  useEffect(()=>{
    const actividad = String(gpsJornadaActividad || "").toLowerCase();
    const provider = String(gpsChoferProvider || "").trim().toLowerCase();
    const externalId = String(gpsChoferExternalId || "").trim();
    const hasExternalGps = provider && provider !== "manual" && provider !== "app_chofer" && externalId;
    if (!navigator.geolocation) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "GPS no disponible en este dispositivo." });
      return;
    }
    if (!gpsJornadaId || gpsJornadaEstado !== "abierta") {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Ubicacion en espera hasta iniciar jornada." });
      return;
    }
    if (["pausa", "descanso", "fin"].includes(actividad)) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Ubicacion pausada durante pausa, descanso o fin de jornada." });
      return;
    }
    if (hasExternalGps) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: true, text: "Ubicacion gestionada por GPS del vehiculo." });
      return;
    }
    if (!gpsChoferVehiculoId) {
      gpsSeguimientoRef.current.lastSent = 0;
      setGpsSeguimientoEstado({ active: false, text: "Asigna una tractora para registrar ubicacion desde la app." });
      return;
    }
    gpsSeguimientoRef.current.lastSent = 0;
    setGpsSeguimientoEstado({ active: false, text: "Solicitando permiso de ubicacion..." });
    const id = navigator.geolocation.watchPosition(
      pos => {
        const now = Date.now();
        setGpsSeguimientoEstado({
          active: true,
          text: `Ubicacion activa. Ultima senal ${new Date(now).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}.`,
        });
        if (gpsSeguimientoRef.current.lastSent && gpsSeguimientoRef.current.lastSent + 60000 > now) return;
        gpsSeguimientoRef.current.lastSent = now;
        registrarGpsChoferApp({
          vehiculo_id: gpsChoferVehiculoId,
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_m: Number.isFinite(pos.coords.accuracy) ? Number(pos.coords.accuracy.toFixed(1)) : null,
          velocidad_kmh: Number.isFinite(pos.coords.speed) && pos.coords.speed >= 0 ? Number((pos.coords.speed * 3.6).toFixed(1)) : null,
          recorded_at: new Date().toISOString(),
        }).catch(()=>{});
      },
      () => {
        setGpsSeguimientoEstado({ active: false, text: "Permiso de ubicacion denegado o no disponible." });
      },
      { enableHighAccuracy: true, maximumAge: 60000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [
    gpsJornadaId,
    gpsJornadaEstado,
    gpsJornadaActividad,
    gpsChoferVehiculoId,
    gpsChoferProvider,
    gpsChoferExternalId,
  ]);

  const ORDEN_ESTADO = {en_curso:0,descarga:1,confirmado:2,pendiente:3,entregado:4,facturado:5,cancelado:6};
  const filtrados = pedidos.filter(p=>{
    const activo=!["entregado","cancelado","facturado"].includes(p.estado);
    if(tab==="activos") return activo;
    if(tab==="historial") return !activo;
    return true;
  }).sort((a,b)=>(ORDEN_ESTADO[a.estado]??99)-(ORDEN_ESTADO[b.estado]??99));

  // Mark the next confirmed trip after any en_curso
  const enCursoIds = new Set(pedidos.filter(p=>["en_curso","descarga"].includes(p.estado)).map(p=>p.vehiculo_id));
  const filtradosConProxima = filtrados.map((p,i)=>{
    if(p.estado==="confirmado" && enCursoIds.size>0) return {...p, es_proxima_carga:true};
    return p;
  });

  const enCurso = pedidos.filter(p=>["en_curso","descarga"].includes(p.estado)).length;
  const solicitudesAbiertas = solicitudesChofer.filter(s => !["resuelto","cerrado","cancelado"].includes(String(s.estado || "").toLowerCase())).length;
  const vacacionesFirmaPendiente = vacacionesChofer.filter(v => v.estado === "aprobada_pendiente_firma").length;
  const solicitudCritica = solicitudesChofer.find(s => String(s.urgencia || "").toLowerCase() === "critica" && !["resuelto","cerrado","cancelado"].includes(String(s.estado || "").toLowerCase()));
  const vehiculoSolicitud = pedidos.find(p=>p.vehiculo_id&&["en_curso","confirmado"].includes(p.estado))
    || (jornadaInfo?.chofer?.vehiculo_id ? {
      id: jornadaInfo.chofer.vehiculo_id,
      vehiculo_id: jornadaInfo.chofer.vehiculo_id,
      matricula: jornadaInfo.chofer.matricula || jornadaInfo.chofer.vehiculo_matricula || "",
    } : null);
  const tabsChofer = isLitePlan
    ? [["activos","Activos"],["nuevo","Nuevo"],["jornada","Jornada"],["historial","Historial"]]
    : [["activos","Activos"],["nuevo","Nuevo"],["jornada","Jornada"],["vacaciones","Vacaciones"],["historial","Historial"],["solicitud","Taller"]];

  // PWA helpers
  async function installApp() {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === "accepted") setShowInstall(false);
  }

  async function pedirNotificaciones() {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    if (perm === "granted") {
      new Notification("TransGest", {
        body: "Las notificaciones estan activadas. Te avisaremos de nuevos pedidos.",
        icon: "/favicon.ico",
      });
    }
  }

  async function marcarRutaNotificacionLeida(id) {
    try { await marcarNotificacionLeida(id); } catch {}
    setRouteNotifications(prev => prev.filter(n => String(n.id) !== String(id)));
  }

  function syncOfflineQueue() {
    const q = leerOfflineQueue();
    if (!q.length) return;
    Promise.all(q.map(async item => {
      try {
        if ((item.tipo === "solicitud_mecanico" || item.tipo === "solicitud_taller") && item.solicitud) {
          await crearTallerSolicitud(item.solicitud);
          return true;
        }
        if (item.tipo === "pedido_chofer_pasos" && item.pedido_id && item.patch) {
          await guardarPedidoChoferPasos(item.pedido_id, item.patch);
          return true;
        }
        if (!item.url) return true;
        const res = await fetch(item.url, {
          method: item.method || "PUT",
          headers: { "Content-Type":"application/json",
                     "Authorization":"Bearer "+getToken() },
          body: JSON.stringify(item.body || {}),
        });
        return res.ok;
      } catch {
        return false;
      }
    })).then(results => {
      const failed = q.filter((_, i) => !results[i]);
      setOfflineQueue(guardarOfflineQueue(failed));
      if (results.some(Boolean)) {
        notify(`Sincronizadas ${results.filter(Boolean).length} accion(es) pendientes`, "success");
        cargar();
      }
    });
  }


  return(
    <>
    <style>{`
      .tg-app-chofer-page, .tg-app-chofer-page * { box-sizing:border-box; min-width:0; }
      .tg-app-chofer-page { width:min(480px, 100vw); overflow-x:hidden; }
      .tg-app-chofer-page img, .tg-app-chofer-page video, .tg-app-chofer-page canvas, .tg-app-chofer-page svg { max-width:100%; }
      .tg-driver-dcd-internal { display:none !important; }
      .tg-app-chofer-page input,
      .tg-app-chofer-page select,
      .tg-app-chofer-page textarea,
      .tg-app-chofer-page button {
        max-width:100%;
        min-width:0;
      }
      .tg-app-chofer-page input[type="date"],
      .tg-app-chofer-page input[type="time"] {
        -webkit-appearance:none;
        appearance:none;
        min-height:42px;
      }
      .tg-chofer-header-main { display:flex; align-items:center; justify-content:space-between; gap:10px; }
      .tg-chofer-header-actions { display:flex; gap:8px; align-items:center; flex:0 0 auto; }
      .tg-chofer-tabs {
        display:flex;
        gap:2px;
        overflow-x:auto;
        overflow-y:hidden;
        -webkit-overflow-scrolling:touch;
        scrollbar-width:none;
        scroll-snap-type:x proximity;
      }
      .tg-chofer-tabs::-webkit-scrollbar { display:none; }
      .tg-chofer-tab {
        flex:0 0 auto !important;
        min-width:92px;
        white-space:nowrap;
        scroll-snap-align:start;
      }
      @media (max-width: 520px) {
        .tg-chofer-section-shell {
          padding:12px 10px !important;
        }
        .tg-chofer-card {
          margin-left:10px !important;
          margin-right:10px !important;
          padding:12px !important;
          border-radius:14px !important;
        }
        .tg-chofer-nuevo-grid,
        .tg-chofer-vacaciones-grid {
          grid-template-columns:1fr !important;
        }
        .tg-chofer-vacaciones-row {
          display:grid !important;
          grid-template-columns:1fr !important;
        }
        .tg-chofer-header-main {
          align-items:flex-start;
        }
        .tg-chofer-header-actions {
          gap:6px;
        }
        .tg-chofer-header-actions button {
          padding:7px 9px !important;
          font-size:11px !important;
        }
      }
      @media (max-width: 380px) {
        .tg-chofer-tab {
          min-width:104px !important;
        }
        .tg-app-chofer-page [style*="grid-template-columns:1fr 1fr"],
        .tg-app-chofer-page [style*="grid-template-columns: 1fr 1fr"],
        .tg-app-chofer-page [style*="grid-template-columns:1fr 1fr 1fr"],
        .tg-app-chofer-page [style*="grid-template-columns: 1fr 1fr 1fr"] {
          grid-template-columns:1fr !important;
        }
        .tg-app-chofer-page [style*="position: fixed"],
        .tg-app-chofer-page [style*="position:fixed"] {
          align-items:flex-start !important;
          padding:10px !important;
          overflow:auto !important;
        }
        .tg-app-chofer-page [style*="position: fixed"] > div,
        .tg-app-chofer-page [style*="position:fixed"] > div {
          width:100% !important;
          max-width:calc(100vw - 20px) !important;
        }
      }
    `}</style>
    <div className="tg-app-chofer-page" style={{fontFamily:"'DM Sans',sans-serif",minHeight:"100vh",background:"var(--bg)",maxWidth:480,margin:"0 auto",padding:"0 0 80px 0"}}>

      {/* Header fijo movil */}
      <div style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)",padding:"14px 16px",position:"sticky",top:0,zIndex:50}}>
        <div className="tg-chofer-header-main">
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:18,color:"var(--text)"}}>Mis viajes</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:1,display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span>{user?.nombre}</span>
              {enCurso>0&&<span style={{padding:"1px 7px",borderRadius:20,background:"rgba(249,115,22,.15)",color:"#f97316",fontWeight:700,fontSize:10,animation:"pulse 2s infinite"}}>{enCurso} EN RUTA</span>}
              {pedidos.filter(p=>p.estado==="confirmado").length>0&&<span style={{padding:"1px 7px",borderRadius:20,background:"rgba(59,130,246,.15)",color:"var(--accent)",fontWeight:700,fontSize:10}}>{pedidos.filter(p=>p.estado==="confirmado").length} pendiente{pedidos.filter(p=>p.estado==="confirmado").length>1?"s":""}</span>}
            </div>
          </div>
          <div className="tg-chofer-header-actions">
            {notifPerm==="default" && (
              <button onClick={pedirNotificaciones} title="Activar notificaciones"
                style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,
                  padding:"6px 10px",fontSize:14,cursor:"pointer"}}>Avisos</button>
            )}
            <button onClick={cargar}
              style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,
                padding:"6px 10px",fontSize:12,cursor:"pointer",color:"var(--text4)",
                fontFamily:"'DM Sans',sans-serif"}}>Actualizar</button>
            <button onClick={logout} title="Cerrar sesion"
              style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.25)",borderRadius:8,
                padding:"6px 10px",fontSize:12,cursor:"pointer",color:"#ef4444",fontWeight:800,
                fontFamily:"'DM Sans',sans-serif"}}>Salir</button>
          </div>
        </div>
      </div>

      {/* Banner offline */}
      {offline && (
        <div style={{background:"rgba(239,68,68,.15)",border:"1px solid rgba(239,68,68,.3)",
          padding:"8px 16px",display:"flex",alignItems:"center",gap:8,
          fontSize:12,color:"#ef4444",fontWeight:600}}>
          <span>Offline</span>
          <span>Sin conexion - los cambios se sincronizaran cuando vuelvas a conectarte
            {offlineQueue.length>0?` (${offlineQueue.length} pendiente${offlineQueue.length>1?"s":""})`:""}</span>
        </div>
      )}

      {routeNotifications.length > 0 && (
        <div style={{padding:"10px 14px",display:"grid",gap:8}}>
          {routeNotifications.map(n => {
            const rutaUrl = n?.data?.route_url || n?.data?.maps_url || "";
            return (
              <div key={n.id} style={{background:"rgba(20,184,166,.10)",border:"1px solid rgba(20,184,166,.28)",borderRadius:10,padding:"10px 12px"}}>
                <div style={{fontSize:12,fontWeight:900,color:"#2dd4bf"}}>{n.titulo || "Ruta enviada"}</div>
                <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.4,marginTop:3}}>{n.mensaje || "Tienes una ruta recomendada pendiente de revisar."}</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginTop:9}}>
                  <button onClick={()=>rutaUrl && window.open(rutaUrl, "_blank", "noopener,noreferrer")} disabled={!rutaUrl}
                    style={{padding:"9px 10px",borderRadius:8,border:"1px solid rgba(20,184,166,.36)",background:rutaUrl ? "#0f766e" : "var(--border2)",color:"#fff",fontSize:12,fontWeight:900,cursor:rutaUrl?"pointer":"not-allowed",fontFamily:"'DM Sans',sans-serif"}}>
                    Abrir ruta
                  </button>
                  <button onClick={()=>marcarRutaNotificacionLeida(n.id)}
                    style={{padding:"9px 10px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
                    Leida
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Banner instalar PWA */}
      {showInstall && (
        <div style={{background:"rgba(59,130,246,.12)",border:"1px solid rgba(59,130,246,.25)",
          padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:20}}>App</span>
          <div style={{flex:1}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--accent-xl)"}}>Instala la app</div>
            <div style={{fontSize:11,color:"var(--text3)"}}>Acceso rapido desde tu movil, sin abrir el navegador</div>
          </div>
          <button onClick={installApp}
            style={{background:"var(--accent)",color:"#fff",border:"none",borderRadius:7,
              padding:"6px 12px",fontSize:11,fontWeight:700,cursor:"pointer",
              fontFamily:"'DM Sans',sans-serif"}}>Instalar</button>
          <button onClick={()=>setShowInstall(false)}
            style={{background:"none",border:"none",color:"var(--text4)",cursor:"pointer",fontSize:16}}>x</button>
        </div>
      )}

      {/* Tabs */}
      <div className="tg-chofer-tabs" style={{background:"var(--bg2)",borderBottom:"1px solid var(--border)"}}>
        {tabsChofer.map(([id,l])=>(
          <button className="tg-chofer-tab" key={id} onClick={()=>setTab(id)}
            style={{padding:"11px 12px",border:"none",borderBottom:`2px solid ${tab===id?"var(--accent)":"transparent"}`,
              color:tab===id?"var(--accent)":"var(--text4)",background:"transparent",
              fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            {l}
            {id==="vacaciones" && vacacionesFirmaPendiente > 0 && (
              <span style={{marginLeft:6,padding:"1px 6px",borderRadius:20,background:"rgba(59,130,246,.16)",color:"#60a5fa",fontSize:10,fontWeight:900}}>
                {vacacionesFirmaPendiente}
              </span>
            )}
            {id==="solicitud" && solicitudesAbiertas > 0 && (
              <span style={{marginLeft:6,padding:"1px 6px",borderRadius:20,background:"rgba(239,68,68,.16)",color:"#ef4444",fontSize:10,fontWeight:900}}>
                {solicitudesAbiertas}
              </span>
            )}
          </button>
        ))}
      </div>

      {vacacionesFirmaPendiente > 0 && tab !== "vacaciones" && (
        <button onClick={()=>setTab("vacaciones")}
          style={{width:"100%",textAlign:"left",background:"rgba(59,130,246,.12)",border:"none",borderBottom:"1px solid rgba(59,130,246,.25)",padding:"9px 16px",color:"#60a5fa",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Tienes vacaciones aprobadas pendientes de firma. Toca para firmar la hoja.
        </button>
      )}

      {solicitudCritica && tab !== "solicitud" && (
        <button onClick={()=>setTab("solicitud")}
          style={{width:"100%",textAlign:"left",background:"rgba(239,68,68,.12)",border:"none",borderBottom:"1px solid rgba(239,68,68,.25)",padding:"9px 16px",color:"#ef4444",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          Taller tiene una solicitud critica abierta: {solicitudCritica.motivo_label || solicitudCritica.motivo}. Toca para verla.
        </button>
      )}

      {/* Lista viajes */}
      {tab!=="solicitud" && tab!=="jornada" && tab!=="vacaciones" && tab!=="nuevo" && (
        <div style={{padding:"12px 16px"}}>
          {loading?(
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>Cargando viajes...</div>
          ):filtrados.length===0?(
            <div style={{padding:40,textAlign:"center",color:"var(--text5)"}}>
              {tab==="activos"?"No tienes viajes activos para esta fecha":"Sin historial para esta fecha"}
            </div>
          ):(
            filtradosConProxima.map(p=><TarjetaViaje
              key={p.id}
              pedido={p}
              onActualizar={cargar}
              jornadaInfo={jornadaInfo}
              onAbrirJornada={()=>setTab("jornada")}
              expanded={String(expandedPedidoId || "") === String(p.id)}
              onExpandedChange={(open)=>setExpandedPedidoId(open ? p.id : null)}
              onFoto={()=>setCameraModal(p.id)}
            />)
          )}
        </div>
      )}

      {tab==="nuevo" && (
        <NuevoViajeChofer onCreado={()=>{ cargar(); }} />
      )}

      {/* Solicitud taller */}
      {tab==="solicitud" && (
        <SolicitudMecanico
          chofer={user}
          vehiculo={vehiculoSolicitud}
          solicitudes={solicitudesChofer}
          onSolicitudesSync={setSolicitudesChofer}
          onEnviado={cargar}
        />
      )}

      {tab==="jornada" && (
        <JornadaChofer jornadaInfo={jornadaInfo} gpsSeguimientoEstado={gpsSeguimientoEstado} onRefresh={cargar} />
      )}

      {tab==="vacaciones" && (
        <VacacionesChofer items={vacacionesChofer} chofer={jornadaInfo?.chofer || user} onRefresh={cargar} />
      )}

      {firmaBaseOpen && (
        <FirmaLaboralCanvas
          title="Firma del chofer"
          detail="Firma en la pantalla para guardar tu firma base en la ficha de chofer. Se usara en documentos internos cuando corresponda."
          defaultName={`${jornadaInfo?.chofer?.nombre || user?.nombre || ""} ${jornadaInfo?.chofer?.apellidos || ""}`.trim()}
          onFirma={guardarFirmaBaseChofer}
          onCancel={()=>setFirmaBaseOpen(false)}
        />
      )}

    {/* Modal camara */}
    {cameraModal && (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.95)",zIndex:600,
        display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{color:"var(--text2)",fontSize:13,marginBottom:16,textAlign:"center"}}>
          Haz una foto de la entrega o incidencia. Se recortara y limpiara automaticamente como escaner.
        </div>
        <input type="file" accept="image/*" capture="environment"
          style={{display:"none"}} id="cam-input"
          onChange={async e => {
            const file = e.target.files?.[0];
            if (!file) { setCameraModal(null); return; }
            try {
              const preparado = await prepararArchivoEscaner(file);
              await editarPedido(cameraModal, { foto_entrega: `data:${preparado.mime};base64,${preparado.base64}` });
              notify("Foto guardada en el viaje.", "success");
              cargar();
            } catch(err) {
              notify(err.message || "Foto no guardada", "error");
            } finally {
              setCameraModal(null);
            }
          }}
        />
        <button onClick={()=>document.getElementById("cam-input").click()}
          style={{background:"#3b6ef5",color:"#fff",border:"none",borderRadius:12,
            padding:"16px 32px",fontSize:16,fontWeight:700,cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif",marginBottom:12}}>
          Abrir camara
        </button>
        <button onClick={()=>setCameraModal(null)}
          style={{background:"var(--bg3)",color:"var(--text3)",border:"1px solid var(--border)",
            borderRadius:8,padding:"10px 24px",fontSize:13,cursor:"pointer",
            fontFamily:"'DM Sans',sans-serif"}}>
          Cancelar
        </button>
      </div>
    )}
    </div>
    </>
  );
}

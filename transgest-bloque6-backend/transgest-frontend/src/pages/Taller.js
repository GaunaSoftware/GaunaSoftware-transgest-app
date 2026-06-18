import { useState, useEffect, useMemo, useCallback } from "react";
import {
  getVehiculos, getAlertasDocVehiculos, actualizarKmVehiculo, getPedidos,
  getTallerEstado, guardarTallerEstado,
  getTallerSolicitudes, actualizarTallerSolicitud,
  getTallerPiezas, getTallerPiezaPorCodigo, crearTallerPieza, editarTallerPieza,
  getTallerPiezaUnidades, getTallerUnidadesHistorial, generarTallerPiezaUnidades, asignarTallerPiezaUnidad, devolverTallerPiezaUnidad,
  getTallerIntervenciones, crearTallerIntervencion, editarTallerIntervencion, addPiezaIntervencion,
  cerrarTallerIntervencion, borrarTallerIntervencion, borrarTallerPieza,
  getTallerNeumaticos, crearTallerNeumatico, montarTallerNeumatico, bajaTallerNeumatico,
} from "../services/api";
import { confirmDialog, notify, promptDialog } from "../services/notify";
import BarcodeScanner from "../components/BarcodeScanner";
import { clearRuntimeFocus, readRuntimeFocus } from "../services/runtimeFocus";

const CATEGORIAS = ["Motor","Frenos","Neumaticos","Aceite / Lubricantes","Filtros","Electricidad","Carrocería","Hidráulica","Neumática","Refrigeración","Transmisión","EPIS","ROPA DE TRABAJO","Otros"];
const TIPOS_INT  = ["Mantenimiento preventivo","Avería / Reparación","Cambio aceite","Cambio neumáticos","Cambio filtros","Revisión ITV","Reparación carrocería","Otro"];

const EMPTY_TALLER_SHARED = Object.freeze({
  proveedores: [],
  avisos_mant: [],
  tareas_mecanicos: [],
  historial_vh: {},
  neumaticos_stock: [],
  neumaticos_vehiculos: {},
  lucro_cesante: {},
  lucro_cesante_archivo: [],
  solicitudes_mecanico: [],
  entregas_equipos_choferes: {},
});
let tallerSharedCache = { ...EMPTY_TALLER_SHARED };
let tallerLegacyMirror = null;

function clearLegacyTallerStorage() {
  try { localStorage.removeItem("tms_taller_v1"); } catch {}
}

function setTallerLegacyMirror(value) {
  tallerLegacyMirror = value && typeof value === "object"
    ? {
        stock: Array.isArray(value.stock) ? value.stock : [],
        reparaciones: Array.isArray(value.reparaciones) ? value.reparaciones : [],
        historial_vh: value.historial_vh && typeof value.historial_vh === "object" ? value.historial_vh : {},
      }
    : { stock: [], reparaciones: [], historial_vh: {} };
  return tallerLegacyMirror;
}

function setTallerSharedCache(data = {}) {
  tallerSharedCache = {
    ...EMPTY_TALLER_SHARED,
    ...tallerSharedCache,
    ...(data && typeof data === "object" ? data : {}),
  };
}

function tallerLoad()  {
  if (tallerLegacyMirror !== null) return tallerLegacyMirror;
  return setTallerLegacyMirror({ stock: [], reparaciones: [], historial_vh: {} });
}
function provLoad()    { return Array.isArray(tallerSharedCache.proveedores) ? tallerSharedCache.proveedores : []; }
function avisosCfgLoad(){ return Array.isArray(tallerSharedCache.avisos_mant) ? tallerSharedCache.avisos_mant : []; }

function tallerSnapshot(tallerData=tallerLoad()) {
  return {
    stock: Array.isArray(tallerData.stock) ? tallerData.stock : [],
    reparaciones: Array.isArray(tallerData.reparaciones) ? tallerData.reparaciones : [],
    historial_vh: tallerData.historial_vh && typeof tallerData.historial_vh === "object" ? tallerData.historial_vh : {},
    proveedores: Array.isArray(tallerSharedCache.proveedores) ? tallerSharedCache.proveedores : [],
    avisos_mant: Array.isArray(tallerSharedCache.avisos_mant) ? tallerSharedCache.avisos_mant : [],
    tareas_mecanicos: Array.isArray(tallerSharedCache.tareas_mecanicos) ? tallerSharedCache.tareas_mecanicos : [],
    neumaticos_stock: Array.isArray(tallerSharedCache.neumaticos_stock) ? tallerSharedCache.neumaticos_stock : [],
    neumaticos_vehiculos: tallerSharedCache.neumaticos_vehiculos && typeof tallerSharedCache.neumaticos_vehiculos === "object" ? tallerSharedCache.neumaticos_vehiculos : {},
    lucro_cesante: tallerSharedCache.lucro_cesante || {},
    lucro_cesante_archivo: Array.isArray(tallerSharedCache.lucro_cesante_archivo) ? tallerSharedCache.lucro_cesante_archivo : [],
    solicitudes_mecanico: Array.isArray(tallerSharedCache.solicitudes_mecanico) ? tallerSharedCache.solicitudes_mecanico : [],
    entregas_equipos_choferes: tallerSharedCache.entregas_equipos_choferes && typeof tallerSharedCache.entregas_equipos_choferes === "object" ? tallerSharedCache.entregas_equipos_choferes : {},
  };
}

let tallerSaveTimer = null;
function pushTallerEstado(tallerData=tallerLoad()) {
  clearTimeout(tallerSaveTimer);
  tallerSaveTimer = setTimeout(() => {
    guardarTallerEstado(tallerSnapshot(tallerData))
      .then(() => {
        clearLegacyTallerStorage();
      })
      .catch(() => {});
  }, 250);
}

function applyTallerEstado(data) {
  if (!data || typeof data !== "object") return;
  setTallerLegacyMirror({ stock:data.stock||[], reparaciones:data.reparaciones||[], historial_vh:data.historial_vh||{} });
  clearLegacyTallerStorage();
  setTallerSharedCache({
    proveedores: data.proveedores || [],
    avisos_mant: data.avisos_mant || [],
    tareas_mecanicos: data.tareas_mecanicos || [],
    historial_vh: data.historial_vh || {},
    neumaticos_stock: data.neumaticos_stock || [],
    neumaticos_vehiculos: data.neumaticos_vehiculos || {},
    lucro_cesante: data.lucro_cesante || {},
    lucro_cesante_archivo: data.lucro_cesante_archivo || [],
    solicitudes_mecanico: data.solicitudes_mecanico || [],
    entregas_equipos_choferes: data.entregas_equipos_choferes || {},
  });
}

function hasTallerData(data) {
  return Boolean(
    (data?.stock||[]).length ||
    (data?.reparaciones||[]).length ||
    Object.keys(data?.historial_vh||{}).length ||
    (data?.proveedores||[]).length ||
    (data?.avisos_mant||[]).length ||
    (data?.tareas_mecanicos||[]).length ||
    (data?.neumaticos_stock||[]).length ||
    (data?.solicitudes_mecanico||[]).length ||
    (data?.lucro_cesante_archivo||[]).length ||
    Object.keys(data?.entregas_equipos_choferes||{}).length ||
    Object.keys(data?.neumaticos_vehiculos||{}).length ||
    Object.keys(data?.lucro_cesante||{}).length
  );
}

function tallerSave(d) { setTallerLegacyMirror(d); pushTallerEstado(d); }
function provSave(d)   { setTallerSharedCache({ proveedores: Array.isArray(d) ? d : [] }); pushTallerEstado(); }
function avisosCfgSave(d){ setTallerSharedCache({ avisos_mant: Array.isArray(d) ? d : [] }); pushTallerEstado(); }
function tareasSave(d){ setTallerSharedCache({ tareas_mecanicos: Array.isArray(d) ? d : [] }); pushTallerEstado(); }

const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const ETIQUETA_TAMANOS = ["50x25", "70x36", "100x50"];
const CODE39 = {
  "0":"nnnwwnwnn","1":"wnnwnnnnw","2":"nnwwnnnnw","3":"wnwwnnnnn","4":"nnnwwnnnw",
  "5":"wnnwwnnnn","6":"nnwwwnnnn","7":"nnnwnnwnw","8":"wnnwnnwnn","9":"nnwwnnwnn",
  "A":"wnnnnwnnw","B":"nnwnnwnnw","C":"wnwnnwnnn","D":"nnnnwwnnw","E":"wnnnwwnnn",
  "F":"nnwnwwnnn","G":"nnnnnwwnw","H":"wnnnnwwnn","I":"nnwnnwwnn","J":"nnnnwwwnn",
  "K":"wnnnnnwnw","L":"nnwnnnwnw","M":"wnwnnnwnn","N":"nnnnwnwnw","O":"wnnnwnwnn",
  "P":"nnwnwnwnn","Q":"nnnnnnwww","R":"wnnnnnwwn","S":"nnwnnnwwn","T":"nnnnwnwwn",
  "U":"wwnnnnnnw","V":"nwwnnnnnw","W":"wwwnnnnnn","X":"nwnnwnnnw","Y":"wwnnwnnnn",
  "Z":"nwwnwnnnn","-":"nwnnnnwnw",".":"wwnnnnwnn"," ":"nwwnnnwnn","$":"nwnwnwnnn",
  "/":"nwnwnnnwn","+":"nwnnnwnwn","%":"nnnwnwnwn","*":"nwnnwnwnn",
};

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function code39Svg(code) {
  const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, "-");
  const value = `*${clean || "SIN-CODIGO"}*`;
  const narrow = 2;
  const wide = 5;
  const height = 72;
  let x = 10;
  const bars = [];
  for (const ch of value) {
    const pattern = CODE39[ch] || CODE39["-"];
    for (let idx = 0; idx < pattern.length; idx += 1) {
      const part = pattern[idx];
      const w = part === "w" ? wide : narrow;
      if (idx % 2 === 0) bars.push(`<rect x="${x}" y="8" width="${w}" height="${height}" fill="#111"/>`);
      x += w;
    }
    x += narrow;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${x + 10}" height="95" viewBox="0 0 ${x + 10} 95">${bars.join("")}</svg>`;
}

function printPiezaEtiqueta(pieza) {
  const code = pieza.codigo_barras || pieza.referencia || "";
  if (!code) { notify("La pieza no tiene codigo para imprimir.", "warning"); return; }
  const [w, h] = String(pieza.etiqueta_tamano || "50x25").split("x").map(n => Number(n) || 50);
  const win = window.open("", "_blank", "width=420,height=320");
  if (!win) { notify("El navegador ha bloqueado la ventana de impresion.", "warning"); return; }
  const svg = code39Svg(code);
  win.document.write(`<!doctype html><html><head><title>Etiqueta ${escapeHtml(code)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111; }
    .label { width: ${w}mm; height: ${h}mm; padding: 2.2mm; display: flex; flex-direction: column; justify-content: center; gap: 1.2mm; overflow: hidden; }
    .name { font-size: ${h <= 25 ? 8 : 10}px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .code { font-family: "Courier New", monospace; font-size: ${h <= 25 ? 8 : 10}px; font-weight: 700; text-align: center; letter-spacing: 0; }
    svg { width: 100%; height: ${Math.max(10, h - 13)}mm; display: block; }
  </style></head><body><div class="label">
    <div class="name">${escapeHtml(pieza.nombre)}</div>
    ${svg}
    <div class="code">${escapeHtml(code)}</div>
  </div><script>window.onload=function(){setTimeout(function(){window.print();},120);};</script></body></html>`);
  win.document.close();
}

function printUnidadEtiquetas(pieza, unidades = []) {
  const validas = (Array.isArray(unidades) ? unidades : []).filter(u => u?.codigo_unidad);
  if (!validas.length) { notify("No hay unidades con codigo para imprimir.", "warning"); return; }
  const [w, h] = String(pieza?.etiqueta_tamano || "50x25").split("x").map(n => Number(n) || 50);
  const win = window.open("", "_blank", "width=520,height=420");
  if (!win) { notify("El navegador ha bloqueado la ventana de impresion.", "warning"); return; }
  win.document.write(`<!doctype html><html><head><title>Etiquetas unidades</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Arial, sans-serif; color: #111; }
    .label { width: ${w}mm; height: ${h}mm; padding: 2.2mm; break-after: page; display: flex; flex-direction: column; justify-content: center; gap: 1mm; overflow: hidden; }
    .name { font-size: ${h <= 25 ? 7 : 9}px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .sub { font-size: ${h <= 25 ? 6 : 8}px; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .code { font-family: "Courier New", monospace; font-size: ${h <= 25 ? 7 : 9}px; font-weight: 700; text-align: center; letter-spacing: 0; }
    svg { width: 100%; height: ${Math.max(10, h - 15)}mm; display: block; }
  </style></head><body>
    ${validas.map(u => {
      const code = u.codigo_unidad;
      return `<div class="label">
        <div class="name">${escapeHtml(pieza?.nombre || u.pieza_nombre || "Pieza")}</div>
        <div class="sub">Unidad individual</div>
        ${code39Svg(code)}
        <div class="code">${escapeHtml(code)}</div>
      </div>`;
    }).join("")}
    <script>window.onload=function(){setTimeout(function(){window.print();},150);};</script>
  </body></html>`);
  win.document.close();
}

function piezaApiToLocal(p) {
  return {
    ...p,
    id: p.id,
    nombre: p.nombre,
    referencia: p.referencia || p.codigo_barras || "",
    codigo_barras: p.codigo_barras || p.referencia || "",
    categoria: p.categoria || "Otros",
    stock_actual: Number(p.stock_actual || 0),
    stock_minimo: Number(p.stock_minimo || 0),
    unidades_total: Number(p.unidades_total || 0),
    unidades_stock: Number(p.unidades_stock || 0),
    precio_unitario: Number(p.precio_compra || p.precio_unitario || 0),
    proveedor: p.proveedor || "",
    etiqueta_tamano: p.etiqueta_tamano || "50x25",
    notas: p.notas || "",
  };
}

function isDbId(id) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id || ""));
}

function intervencionApiToLocal(r) {
  return {
    ...r,
    id: r.id,
    piezas_usadas: Array.isArray(r.piezas) ? r.piezas.map(p => ({
      ...p,
      cantidad_usada: Number(p.cantidad || 0),
      precio_unitario: Number(p.precio_unitario || 0),
    })) : (r.piezas_usadas || []),
    coste_total: Number(r.coste_total || 0),
    coste_mano_obra: Number(r.coste_mano_obra || 0),
  };
}

function costeIntervencion(r) {
  const total = Number(r?.coste_total);
  if (Number.isFinite(total) && total > 0) return total;
  const manoObra = Number(r?.coste_mano_obra || 0);
  const piezas = (Array.isArray(r?.piezas_usadas) ? r.piezas_usadas : [])
    .reduce((sum, p) => {
      const cantidad = Number(p.cantidad_usada ?? p.cantidad ?? 0);
      const precio = Number(p.precio_unitario || 0);
      return sum + (cantidad * precio);
    }, 0);
  return manoObra + piezas;
}

function resumenGastoTaller(reparaciones = []) {
  const month = new Date().toISOString().slice(0, 7);
  return reparaciones.reduce((acc, r) => {
    const coste = costeIntervencion(r);
    acc.total += coste;
    if (String(r?.fecha || "").slice(0, 7) === month) acc.mes += coste;
    acc.manoObra += Number(r?.coste_mano_obra || 0);
    acc.piezas += Math.max(0, coste - Number(r?.coste_mano_obra || 0));
    return acc;
  }, { total:0, mes:0, manoObra:0, piezas:0 });
}

function TallerIcon({ name = "tool", color = "#0f766e", size = 24 }) {
  const common = { fill:"none", stroke:color, strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round" };
  const shapes = {
    tool: <path {...common} d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l2.6-2.6a6 6 0 0 1-7.9 7.9l-6.8 6.8a2 2 0 0 1-2.8-2.8l6.8-6.8a6 6 0 0 1 7.9-7.9l-2.8 2.8Z" />,
    money: (
      <>
        <rect {...common} x="3" y="6" width="18" height="12" rx="2" />
        <circle {...common} cx="12" cy="12" r="3" />
      </>
    ),
    cube: (
      <>
        <path {...common} d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" />
        <path {...common} d="M4 7.5 12 12l8-4.5" />
        <path {...common} d="M12 12v9" />
      </>
    ),
    layers: (
      <>
        <path {...common} d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path {...common} d="m3 13 9 5 9-5" />
      </>
    ),
    clock: (
      <>
        <circle {...common} cx="12" cy="12" r="8" />
        <path {...common} d="M12 8v5l3 2" />
      </>
    ),
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{shapes[name] || shapes.tool}</svg>;
}

const S = {
  page: {flex:1, padding:"30px 36px",fontFamily:"'DM Sans',sans-serif",background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)",minHeight:"100vh"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:32,fontWeight:900,color:"#0f172a",marginBottom:6,letterSpacing:"-.02em"},
  sub:  {fontSize:15,color:"#64748b",marginBottom:28},
  card: {background:"rgba(255,255,255,.95)",border:"1px solid #dbe5ec",borderRadius:12,overflow:"hidden",marginBottom:14,boxShadow:"0 14px 32px rgba(15,23,42,.05)"},
  th:   {textAlign:"left",padding:"13px 16px",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"#64748b",borderBottom:"1px solid #dbe5ec",background:"rgba(248,250,252,.9)",whiteSpace:"nowrap"},
  td:   {padding:"12px 16px",borderBottom:"1px solid #e5edf2",fontSize:13,color:"#334155",verticalAlign:"middle"},
  btn:  {padding:"10px 15px",borderRadius:8,border:"1px solid #cfdbe5",fontSize:13,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:7,boxShadow:"0 8px 18px rgba(15,23,42,.04)"},
  inp:  {background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"11px 13px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxShadow:"0 6px 14px rgba(15,23,42,.03)"},
  sel:  {background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"11px 13px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxShadow:"0 6px 14px rgba(15,23,42,.03)"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  mbox: {background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:14,padding:26,width:"min(660px,96vw)",maxHeight:"92vh",overflowY:"auto"},
  lbl:  {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
  tab:  {padding:"6px 14px",border:"none",borderBottom:"2px solid transparent",background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"},
};

function ModalPieza({editando, onClose, onSaved}) {
  const [form, setForm] = useState(editando || {nombre:"",referencia:"",codigo_barras:"",categoria:"Otros",stock_actual:0,stock_minimo:2,precio_unitario:0,proveedor:"",etiqueta_tamano:"50x25",notas:""});
  const [scannerOpen, setScannerOpen] = useState(false);
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const setCodigo = code => setForm(p=>({...p,codigo_barras:code,referencia:p.referencia || code}));
  async function guardar() {
    if (!form.nombre) { notify("Nombre obligatorio", "warning"); return; }
    const d = tallerLoad();
    const p = {...form,id:editando?.id||`p_${Date.now()}`,codigo_barras:form.codigo_barras||form.referencia||"",stock_actual:parseFloat(form.stock_actual)||0,stock_minimo:parseFloat(form.stock_minimo)||0,precio_unitario:parseFloat(form.precio_unitario)||0};
    if (editando) { const i=d.stock.findIndex(x=>x.id===editando.id); if(i>=0) d.stock[i]=p; else d.stock.push(p); }
    else d.stock.push(p);
    const payload = {
      nombre: form.nombre,
      referencia: form.referencia || "",
      codigo_barras: form.codigo_barras || form.referencia || "",
      categoria: form.categoria || "Otros",
      stock_actual: parseFloat(form.stock_actual) || 0,
      stock_minimo: parseFloat(form.stock_minimo) || 0,
      precio_compra: parseFloat(form.precio_unitario) || 0,
      proveedor: form.proveedor || "",
      etiqueta_tamano: form.etiqueta_tamano || "50x25",
      notas: form.notas || "",
    };
    if (!editando) {
      try {
        const saved = await crearTallerPieza(payload);
        d.stock = d.stock.map(x => x.id === p.id ? piezaApiToLocal(saved) : x);
      } catch (e) {
        notify("Pieza guardada localmente, pero no se sincronizo con la base de datos: " + e.message, "warning");
      }
    } else if (isDbId(editando.id)) {
      try {
        const saved = await editarTallerPieza(editando.id, payload);
        d.stock = d.stock.map(x => x.id === editando.id ? piezaApiToLocal(saved) : x);
      } catch (e) {
        notify("Pieza editada localmente, pero no se sincronizo con la base de datos: " + e.message, "warning");
      }
    }
    tallerSave(d); onSaved();
  }
  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{...S.mbox,width:"min(520px,96vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>{editando?"Editar pieza":"Nueva pieza al stock"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Nombre *</label><input style={S.inp} value={form.nombre} onChange={f("nombre")} placeholder="Ej: Filtro aceite Mann W713"/></div>
          <div><label style={S.lbl}>Referencia</label><input style={S.inp} value={form.referencia} onChange={f("referencia")}/></div>
          <div>
            <label style={S.lbl}>Codigo de barras</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:6}}>
              <input style={S.inp} value={form.codigo_barras||""} onChange={f("codigo_barras")} placeholder="Escanea o escribe el codigo"/>
              <button type="button" style={{...S.btn,background:"var(--bg3)",color:"var(--accent-xl)",border:"1px solid #1e2d45"}} onClick={()=>setScannerOpen(true)}>Escanear</button>
            </div>
          </div>
          <div><label style={S.lbl}>Categoría</label><select value={form.categoria} onChange={f("categoria")} style={S.sel}>{CATEGORIAS.map(c=><option key={c} value={c}>{c}</option>)}</select></div>
          <div><label style={S.lbl}>Stock actual</label><input type="number" min="0" step="0.5" style={S.inp} value={form.stock_actual} onChange={f("stock_actual")} onFocus={e=>e.target.select()}/></div>
          <div><label style={S.lbl}>Stock minimo (alerta)</label><input type="number" min="0" style={S.inp} value={form.stock_minimo} onChange={f("stock_minimo")} onFocus={e=>e.target.select()}/></div>
          <div><label style={S.lbl}>Precio unitario (EUR)</label><input type="number" step="0.01" style={S.inp} value={form.precio_unitario} onChange={f("precio_unitario")} onFocus={e=>e.target.select()}/></div>
          <div><label style={S.lbl}>Proveedor</label><input style={S.inp} value={form.proveedor} onChange={f("proveedor")}/></div>
          <div><label style={S.lbl}>Tamano etiqueta</label><select value={form.etiqueta_tamano||"50x25"} onChange={f("etiqueta_tamano")} style={S.sel}>{ETIQUETA_TAMANOS.map(t=><option key={t} value={t}>{t} mm</option>)}</select></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><input style={S.inp} value={form.notas} onChange={f("notas")}/></div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar}>{editando?"Guardar":"Añadir"}</button>
        </div>
        <BarcodeScanner open={scannerOpen} title="Escanear codigo de pieza" onDetected={setCodigo} onClose={()=>setScannerOpen(false)} />
      </div>
    </div>
  );
}

function StockUnidadesPanel({ vehiculos = [], onAssigned }) {
  const [matricula, setMatricula] = useState("");
  const [codigo, setCodigo] = useState("");
  const [scannerOpen, setScannerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [ultimo, setUltimo] = useState(null);

  async function asignar(codeArg = null) {
    const code = String(codeArg || codigo || "").trim();
    if (!matricula.trim()) { notify("Introduce la matricula del camion.", "warning"); return; }
    if (!code) { notify("Escanea o introduce el codigo de la unidad o pieza.", "warning"); return; }
    setSaving(true);
    try {
      const result = await asignarTallerPiezaUnidad({ matricula, codigo: code });
      setUltimo(result);
      setCodigo("");
      notify(`Pieza imputada a ${result?.vehiculo?.matricula || matricula} y registrada en taller.`, "success");
      onAssigned?.();
    } catch (e) {
      notify(e.message || "No se pudo imputar la pieza al vehiculo.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{...S.card,padding:14,marginBottom:14,borderColor:"rgba(34,211,160,.28)"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
        <div>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)"}}>Salida rapida de recambios</div>
          <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Introduce matricula y escanea la unidad. Si usas el codigo general del producto, TransGest toma una unidad disponible y la imputa al camion.</div>
        </div>
        {ultimo && (
          <div style={{fontSize:12,color:"var(--green)",fontWeight:800,background:"rgba(34,211,160,.1)",border:"1px solid rgba(34,211,160,.25)",borderRadius:8,padding:"7px 10px"}}>
            Ultima salida: {ultimo?.pieza?.nombre || "Pieza"} -> {ultimo?.vehiculo?.matricula || matricula}
          </div>
        )}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(160px,.7fr) minmax(220px,1fr) auto auto",gap:8,alignItems:"end"}}>
        <label>
          <span style={S.lbl}>Matricula</span>
          <input list="taller-matriculas" style={S.inp} value={matricula} onChange={e=>setMatricula(e.target.value.toUpperCase())} placeholder="1234-ABC" />
          <datalist id="taller-matriculas">
            {vehiculos.map(v=><option key={v.id} value={v.matricula}>{v.marca} {v.modelo}</option>)}
          </datalist>
        </label>
        <label>
          <span style={S.lbl}>Codigo unidad o producto</span>
          <input style={S.inp} value={codigo} onChange={e=>setCodigo(e.target.value)} onKeyDown={e=>{ if(e.key==="Enter") asignar(); }} placeholder="Escanea o escribe el codigo" />
        </label>
        <button type="button" disabled={saving} style={{...S.btn,background:"var(--bg3)",color:"var(--accent-xl)",border:"1px solid #1e2d45",height:36}} onClick={()=>setScannerOpen(true)}>Escanear</button>
        <button type="button" disabled={saving} style={{...S.btn,background:"var(--green)",color:"#04130f",height:36,opacity:saving?.7:1}} onClick={()=>asignar()}>{saving?"Imputando...":"Imputar"}</button>
      </div>
      <BarcodeScanner
        open={scannerOpen}
        title="Escanear unidad de recambio"
        onDetected={(code)=>{ setCodigo(code); setScannerOpen(false); asignar(code); }}
        onClose={()=>setScannerOpen(false)}
      />
    </div>
  );
}

function UnidadesPiezaModal({ pieza, onClose }) {
  const [unidades, setUnidades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [cantidad, setCantidad] = useState(Math.max(1, Math.floor(Number(pieza?.stock_actual || 1))));
  const [generando, setGenerando] = useState(false);

  const cargar = useCallback(async () => {
    if (!pieza?.id || !isDbId(pieza.id)) { setUnidades([]); setLoading(false); return; }
    setLoading(true);
    try {
      const data = await getTallerPiezaUnidades(pieza.id);
      setUnidades(Array.isArray(data) ? data : []);
    } catch (e) {
      notify(e.message || "No se pudieron cargar las unidades.", "error");
    } finally {
      setLoading(false);
    }
  }, [pieza?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  async function generar() {
    if (!pieza?.id || !isDbId(pieza.id)) { notify("Guarda primero la pieza para generar unidades.", "warning"); return; }
    setGenerando(true);
    try {
      const result = await generarTallerPiezaUnidades(pieza.id, { cantidad });
      const nuevas = result?.unidades || [];
      notify(`${nuevas.length} unidad(es) generadas.`, "success");
      await cargar();
      if (nuevas.length) printUnidadEtiquetas(pieza, nuevas);
    } catch (e) {
      notify(e.message || "No se pudieron generar unidades.", "error");
    } finally {
      setGenerando(false);
    }
  }

  async function devolverUnidad(unidad) {
    const ok = await confirmDialog({
      title: "Devolver unidad a stock",
      message: `Esto quitara ${unidad.codigo_unidad} del vehiculo ${unidad.vehiculo_matricula || unidad.matricula_snapshot || ""}, recuperara stock y ajustara el coste de taller. ¿Continuar?`,
      confirmText: "Devolver",
      tone: "warning",
    });
    if (!ok) return;
    try {
      await devolverTallerPiezaUnidad(unidad.id);
      notify("Unidad devuelta a stock.", "success");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo devolver la unidad.", "error");
    }
  }

  const stockUnits = unidades.filter(u => u.estado === "stock");
  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{...S.mbox,width:"min(820px,96vw)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:14}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:900,color:"var(--text)"}}>Unidades trazables</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>{pieza?.nombre} - Codigo producto {pieza?.codigo_barras || pieza?.referencia || "-"}</div>
          </div>
          <button style={{...S.btn,background:"var(--bg3)",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cerrar</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:8,alignItems:"end",marginBottom:12}}>
          <label>
            <span style={S.lbl}>Unidades nuevas a generar</span>
            <input type="number" min="1" max="500" style={S.inp} value={cantidad} onChange={e=>setCantidad(e.target.value)} />
          </label>
          <button disabled={generando} style={{...S.btn,background:"var(--accent)",color:"#fff",height:36,opacity:generando?.7:1}} onClick={generar}>{generando?"Generando...":"Generar e imprimir"}</button>
          <button disabled={!stockUnits.length} style={{...S.btn,background:"rgba(16,185,129,.1)",color:"var(--green)",height:36,border:"1px solid rgba(16,185,129,.25)",opacity:stockUnits.length?1:.45}} onClick={()=>printUnidadEtiquetas(pieza, stockUnits)}>Imprimir stock</button>
        </div>
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <caption style={{captionSide:"top",textAlign:"left",padding:"0 0 8px 0",fontSize:11,color:"var(--text5)"}}>
              Trazables: unidades individuales disponibles / unidades generadas
            </caption>
            <thead><tr>{["Codigo unidad","Estado","Vehiculo","Salida",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {loading ? <tr><td colSpan={5} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Cargando...</td></tr>
              : unidades.length===0 ? <tr><td colSpan={5} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin unidades generadas todavia.</td></tr>
              : unidades.map(u=>(
                <tr key={u.id}>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:800,color:"var(--text)"}}>{u.codigo_unidad}</td>
                  <td style={S.td}><span style={{fontSize:11,fontWeight:800,borderRadius:20,padding:"2px 8px",background:u.estado==="stock"?"rgba(34,211,160,.12)":"rgba(59,130,246,.12)",color:u.estado==="stock"?"var(--green)":"var(--accent-xl)"}}>{u.estado}</span></td>
                  <td style={{...S.td,fontSize:12,color:"var(--text3)"}}>{u.vehiculo_matricula || u.matricula_snapshot || "-"}</td>
                  <td style={{...S.td,fontSize:11,color:"var(--text5)"}}>{u.salida_at ? new Date(u.salida_at).toLocaleString("es-ES") : "-"}</td>
                  <td style={S.td}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",border:"1px solid #1e2d45",padding:"4px 9px",fontSize:11}} onClick={()=>printUnidadEtiquetas(pieza, [u])}>Etiqueta</button>
                      {u.estado !== "stock" && (
                        <button style={{...S.btn,background:"rgba(249,115,22,.1)",color:"#f59e0b",border:"1px solid rgba(249,115,22,.25)",padding:"4px 9px",fontSize:11}} onClick={()=>devolverUnidad(u)}>Devolver</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function HistorialPiezasVehiculoTab({ vehiculos = [], onReload }) {
  const [vehiculoId, setVehiculoId] = useState("");
  const [estado, setEstado] = useState("");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (vehiculoId) params.vehiculo_id = vehiculoId;
      if (estado) params.estado = estado;
      if (q.trim()) params.q = q.trim();
      const data = await getTallerUnidadesHistorial(params);
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      notify(e.message || "No se pudo cargar el historial trazable.", "error");
    } finally {
      setLoading(false);
    }
  }, [vehiculoId, estado, q]);

  useEffect(() => { cargar(); }, [cargar]);

  async function devolverUnidad(unidad) {
    if (!(await confirmDialog({
      title: "Devolver pieza a stock",
      message: `Esto quitara ${unidad.codigo_unidad} del vehiculo ${unidad.vehiculo_matricula || unidad.matricula_snapshot || ""} y ajustara la intervencion asociada. ¿Continuar?`,
      confirmText: "Devolver",
      tone: "warning",
    }))) return;
    try {
      await devolverTallerPiezaUnidad(unidad.id);
      notify("Unidad devuelta al stock.", "success");
      await cargar();
      onReload?.();
    } catch (e) {
      notify(e.message || "No se pudo devolver la unidad.", "error");
    }
  }

  return (
    <>
      <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        <select value={vehiculoId} onChange={e=>setVehiculoId(e.target.value)} style={{...S.sel,width:240}}>
          <option value="">Todos los vehiculos</option>
          {vehiculos.map(v=><option key={v.id} value={v.id}>{v.matricula} - {v.marca} {v.modelo}</option>)}
        </select>
        <select value={estado} onChange={e=>setEstado(e.target.value)} style={{...S.sel,width:160}}>
          <option value="">Todos los estados</option>
          <option value="montada">Montadas</option>
          <option value="stock">En stock</option>
          <option value="baja">Baja</option>
        </select>
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar pieza, codigo o matricula..." style={{...S.inp,width:260}}/>
        <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",border:"1px solid #1e2d45"}} onClick={cargar} disabled={loading}>
          {loading ? "Cargando..." : "Actualizar"}
        </button>
        <span style={{marginLeft:"auto",fontSize:12,color:"var(--text5)"}}>{rows.length} unidad{rows.length!==1?"es":""}</span>
      </div>
      <div style={S.card}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead><tr>{["Codigo unidad","Pieza","Vehiculo","Salida","Intervencion","Estado",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.length===0 ? (
              <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin unidades trazables con esos filtros</td></tr>
            ) : rows.map(u => (
              <tr key={u.id}>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--accent-xl)",fontWeight:800}}>{u.codigo_unidad}</td>
                <td style={S.td}>
                  <div style={{fontWeight:800,color:"var(--text)"}}>{u.pieza_nombre || "-"}</div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>{u.referencia || u.codigo_producto || "-"}</div>
                </td>
                <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{u.vehiculo_matricula || u.matricula_snapshot || "-"}</td>
                <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>
                  {u.salida_at ? new Date(u.salida_at).toLocaleString("es-ES") : "-"}
                </td>
                <td style={{...S.td,fontSize:12,color:"var(--text3)",maxWidth:230}}>
                  <div style={{fontWeight:700,color:"var(--text)"}}>{u.intervencion_tipo || "-"}</div>
                  <div style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.intervencion_descripcion || "-"}</div>
                </td>
                <td style={S.td}><span style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:u.estado==="stock"?"rgba(16,185,129,.10)":"rgba(59,130,246,.12)",color:u.estado==="stock"?"var(--green)":"var(--accent-xl)",fontWeight:800}}>{u.estado}</span></td>
                <td style={S.td}>
                  {u.estado !== "stock" ? (
                    <button style={{...S.btn,background:"rgba(245,158,11,.12)",color:"#f59e0b",padding:"3px 8px",fontSize:11,border:"1px solid rgba(245,158,11,.28)"}} onClick={()=>devolverUnidad(u)}>Devolver</button>
                  ) : <span style={{fontSize:11,color:"var(--text5)"}}>-</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ModalIntervencion({vehiculos, editando, onClose, onSaved}) {
  const [proveedores, setProveedores] = useState(() => provLoad());
  const [form, setForm] = useState(() => ({
    vehiculo_id: editando?.vehiculo_id || "",
    fecha: editando?.fecha || new Date().toISOString().slice(0,10),
    tipo: editando?.tipo || "Mantenimiento preventivo",
    descripcion: editando?.descripcion || "",
    km_en_intervencion: editando?.km_en_intervencion || "",
    origen_taller: editando?.origen_taller || ((editando?.taller_externo || editando?.factura_proveedor_nombre) ? "externo" : "propio"),
    proveedor_id: editando?.proveedor_id || "",
    taller_externo: editando?.taller_externo || editando?.factura_proveedor_nombre || "",
    coste_mano_obra: String(editando?.coste_mano_obra ?? "0"),
    notas: editando?.notas || "",
    piezas_usadas: Array.isArray(editando?.piezas_usadas) ? editando.piezas_usadas : [],
    factura_proveedor_num: editando?.factura_proveedor_num || "",
    factura_proveedor_nombre: editando?.factura_proveedor_nombre || "",
    factura_proveedor_importe: String(editando?.factura_proveedor_importe ?? ""),
  }));
  const [taller] = useState(tallerLoad());
  const [scannerOpen, setScannerOpen] = useState(false);
  const [codigoManual, setCodigoManual] = useState("");
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  const vh = vehiculos.find(v=>v.id===form.vehiculo_id);

  const talleresExternos = useMemo(() => (Array.isArray(proveedores) ? [...proveedores] : []).sort((a,b) =>
    String(a?.nombre || "").localeCompare(String(b?.nombre || ""), "es")
  ), [proveedores]);
  const proveedorActivo = useMemo(() =>
    talleresExternos.find(p => String(p.id) === String(form.proveedor_id)) || null,
  [talleresExternos, form.proveedor_id]);
  const nombreTallerExterno = proveedorActivo?.nombre || form.taller_externo || "";

  useEffect(() => {
    if (form.origen_taller !== "externo") return;
    if (proveedorActivo?.nombre && form.taller_externo !== proveedorActivo.nombre) {
      setForm(prev => ({ ...prev, taller_externo: proveedorActivo.nombre }));
    }
  }, [form.origen_taller, form.taller_externo, proveedorActivo]);

  function addPieza(p) {
    setForm(x=>{
      if (x.piezas_usadas.some(usada => usada.id === p.id || (p.codigo_barras && usada.codigo_barras === p.codigo_barras))) return x;
      return {...x,piezas_usadas:[...x.piezas_usadas,{...p,cantidad_usada:1}]};
    });
  }
  function remPieza(i) { setForm(x=>({...x,piezas_usadas:x.piezas_usadas.filter((_,j)=>j!==i)})); }
  function updCant(i,v){ setForm(x=>({...x,piezas_usadas:x.piezas_usadas.map((p,j)=>j===i?{...p,cantidad_usada:parseFloat(v)||1}:p)})); }

  async function buscarPiezaPorCodigo(code) {
    const clean = String(code || "").trim();
    if (!clean) return;
    const lower = clean.toLowerCase();
    const local = taller.stock.find(p =>
      String(p.codigo_barras || "").toLowerCase() === lower ||
      String(p.referencia || "").toLowerCase() === lower
    );
    if (local) {
      if ((local.stock_actual || 0) <= 0) {
        notify("La pieza existe, pero no tiene stock disponible.", "warning");
        return;
      }
      addPieza(local);
      notify("Pieza añadida a la intervencion.", "success");
      return;
    }
    try {
      const found = await getTallerPiezaPorCodigo(clean);
      const pieza = piezaApiToLocal(found);
      if ((pieza.stock_actual || 0) <= 0) {
        notify("La pieza existe, pero no tiene stock disponible.", "warning");
        return;
      }
      addPieza(pieza);
      notify("Pieza añadida a la intervencion.", "success");
    } catch {
      notify("No se encontró una pieza con ese código.", "warning");
    }
  }

  async function buscarCodigoManual() {
    const code = codigoManual.trim();
    if (!code) return;
    await buscarPiezaPorCodigo(code);
    setCodigoManual("");
  }

  async function ensureProveedorExterno() {
    if (form.origen_taller !== "externo") return { id: form.proveedor_id || "", nombre: "" };
    const typed = String(form.taller_externo || "").trim();
    if (!typed) {
      notify("Indica el taller externo.", "warning");
      return null;
    }
    let proveedor = proveedores.find(p => String(p.id) === String(form.proveedor_id));
    if (!proveedor) {
      proveedor = proveedores.find(p => String(p.nombre || "").trim().toLowerCase() === typed.toLowerCase());
    }
    if (!proveedor) {
      const crear = await confirmDialog({
        title: "Crear taller externo",
        message: `"${typed}" no está creado todavía. ¿Quieres añadirlo ahora?`,
        confirmText: "Crear taller",
      });
      if (!crear) return null;
      proveedor = {
        id: `prov_${Date.now()}` ,
        nombre: typed,
        contacto: "",
        telefono: "",
        email: "",
        direccion: "",
        especialidad: "General",
        activo: true,
        created_at: new Date().toISOString(),
      };
      const next = [proveedor, ...proveedores];
      provSave(next);
      setProveedores(next);
    }
    return { id: proveedor.id, nombre: proveedor.nombre };
  }

  const subtotalPiezas = form.piezas_usadas.reduce((s,p)=>s+Number(p.cantidad_usada||0)*Number(p.precio_unitario||0),0);
  const costeServicio = form.origen_taller === "externo"
    ? parseFloat(form.factura_proveedor_importe || 0)
    : parseFloat(form.coste_mano_obra || 0);
  const costoTotal = subtotalPiezas + costeServicio;

  async function guardar() {
    if (!form.vehiculo_id) { notify("Selecciona un vehículo", "warning"); return; }
    if (!form.descripcion)  { notify("La descripción es obligatoria", "warning"); return; }
    if (form.piezas_usadas.some(p => !(p.codigo_barras || p.referencia))) {
      notify("Todas las piezas deben estar vinculadas a un código escaneado o introducido.", "warning");
      return;
    }
    const proveedorExterno = await ensureProveedorExterno();
    if (form.origen_taller === "externo" && !proveedorExterno) return;

    const d = tallerLoad();
    const proveedorNombre = form.origen_taller === "externo"
      ? (proveedorExterno?.nombre || nombreTallerExterno)
      : (form.factura_proveedor_nombre || "");
    const rep = {
      ...form,
      id: editando?.id || `r_${Date.now()}` ,
      coste_total: costoTotal,
      vehiculo_matricula: vh?.matricula || "",
      origen_taller: form.origen_taller,
      proveedor_id: form.origen_taller === "externo" ? (proveedorExterno?.id || form.proveedor_id || "") : (form.proveedor_id || ""),
      taller_externo: form.origen_taller === "externo" ? (proveedorNombre || "") : "",
      factura_proveedor_nombre: proveedorNombre,
      factura_proveedor_importe: parseFloat(form.factura_proveedor_importe || 0) || 0,
      coste_mano_obra: form.origen_taller === "externo" ? 0 : (parseFloat(form.coste_mano_obra || 0) || 0),
    };

    const prevPieces = Array.isArray(editando?.piezas_usadas) ? editando.piezas_usadas : [];
    const prevMap = new Map(prevPieces.map(p => [String(p.id || p.codigo_barras || p.referencia || ""), Number(p.cantidad_usada || 1)]));
    const nextMap = new Map((form.piezas_usadas || []).map(p => [String(p.id || p.codigo_barras || p.referencia || ""), Number(p.cantidad_usada || 1)]));
    d.stock = (d.stock || []).map(item => {
      const key = String(item.id || item.codigo_barras || item.referencia || "");
      const delta = Number(nextMap.get(key) || 0) - Number(prevMap.get(key) || 0);
      if (!delta) return item;
      const nextStock = Math.max(0, Number(item.stock_actual || 0) - delta);
      return { ...item, stock_actual: nextStock };
    });

    if (form.tipo === "Cambio aceite" || form.tipo === "Cambio neumáticos") {
      if (!d.historial_vh) d.historial_vh = {};
      if (!d.historial_vh[form.vehiculo_id]) d.historial_vh[form.vehiculo_id] = [];
      d.historial_vh[form.vehiculo_id].unshift({
        fecha: form.fecha,
        tipo: form.tipo,
        km: form.km_en_intervencion,
        descripcion: form.descripcion,
      });
      if (form.km_en_intervencion && form.vehiculo_id) {
        actualizarKmVehiculo(form.vehiculo_id, Number(form.km_en_intervencion)).catch(()=>{});
      }
    }

    if (editando) {
      const i = d.reparaciones.findIndex(r => r.id === editando.id);
      if (i >= 0) d.reparaciones[i] = rep; else d.reparaciones.push(rep);
    } else {
      d.reparaciones.push(rep);
    }

    if (!editando) {
      try {
        const saved = await crearTallerIntervencion({
          vehiculo_id: form.vehiculo_id,
          fecha: form.fecha,
          tipo: form.tipo,
          descripcion: form.descripcion,
          km_en_intervencion: form.km_en_intervencion || null,
          taller_externo: rep.taller_externo || "",
          coste_mano_obra: Number(rep.coste_mano_obra || 0),
          notas: form.notas || "",
        });
        for (const pieza of form.piezas_usadas || []) {
          await addPiezaIntervencion(saved.id, {
            pieza_id: isDbId(pieza.id) ? pieza.id : null,
            codigo_barras: pieza.codigo_barras || pieza.referencia || "",
            cantidad: Number(pieza.cantidad_usada || 1),
            precio_unitario: Number(pieza.precio_unitario || 0),
          }).catch(() => {});
        }
        const idx = d.reparaciones.findIndex(r => r.id === rep.id);
        if (idx >= 0) d.reparaciones[idx] = intervencionApiToLocal({ ...saved, piezas: form.piezas_usadas, ...rep });
      } catch (e) {
        notify("Intervención guardada localmente, pero no se sincronizó con la base de datos: " + e.message, "warning");
      }
    }
    if (editando && isDbId(editando.id)) {
      try {
        const saved = await editarTallerIntervencion(editando.id, {
          vehiculo_id: form.vehiculo_id,
          fecha: form.fecha,
          tipo: form.tipo,
          descripcion: form.descripcion,
          km_en_intervencion: form.km_en_intervencion || null,
          taller_externo: rep.taller_externo || "",
          coste_mano_obra: Number(rep.coste_mano_obra || 0),
          estado: rep.estado || editando.estado || "abierta",
          notas: form.notas || "",
        });
        const idx = d.reparaciones.findIndex(r => r.id === editando.id);
        if (idx >= 0) d.reparaciones[idx] = intervencionApiToLocal({ ...saved, piezas: form.piezas_usadas, ...rep });
      } catch (e) {
        notify("Intervención editada localmente, pero no se sincronizó con la base de datos: " + e.message, "warning");
      }
    }
    tallerSave(d);
    onSaved();
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={S.mbox}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>
          {editando?"Editar intervencion":"Nueva intervencion"}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={S.lbl}>Vehiculo *</label>
            <select value={form.vehiculo_id} onChange={f("vehiculo_id")} style={S.sel}>
              <option value="">Seleccionar...</option>
              {vehiculos.map(v=><option key={v.id} value={v.id}>{v.matricula} - {v.marca} {v.modelo}</option>)}
            </select>
          </div>
          <div><label style={S.lbl}>Fecha</label><input type="date" style={S.inp} value={form.fecha} onChange={f("fecha")}/></div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Tipo de intervencion</label>
            <select value={form.tipo} onChange={f("tipo")} style={S.sel}>{TIPOS_INT.map(t=><option key={t} value={t}>{t}</option>)}</select>
          </div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Descripcion *</label>
            <textarea style={{...S.inp,height:70,resize:"vertical"}} value={form.descripcion} onChange={f("descripcion")} placeholder="Describe la intervencion..."/>
          </div>
          <div><label style={S.lbl}>Km en intervencion</label><input type="number" style={S.inp} value={form.km_en_intervencion} onChange={f("km_en_intervencion")} onFocus={e=>e.target.select()}/></div>
          <div><label style={S.lbl}>Dónde se hace</label>
            <select value={form.origen_taller} onChange={f("origen_taller")} style={S.sel}>
              <option value="propio">Taller propio</option>
              <option value="externo">Taller externo</option>
            </select>
          </div>
          {form.origen_taller === "propio" ? (
            <div><label style={S.lbl}>Coste mano de obra (EUR)</label><input type="number" step="0.01" style={S.inp} value={form.coste_mano_obra} onChange={f("coste_mano_obra")} onFocus={e=>e.target.select()}/></div>
          ) : (
            <div><label style={S.lbl}>Taller externo</label>
              <input
                list="talleres-externos-list"
                style={S.inp}
                value={form.taller_externo}
                onChange={e=>{
                  const value = e.target.value;
                  const found = talleresExternos.find(p => String(p.nombre || "").toLowerCase() === String(value || "").toLowerCase());
                  setForm(prev => ({ ...prev, taller_externo:value, proveedor_id: found?.id || "" }));
                }}
                placeholder="Escribe o selecciona un taller"
              />
              <datalist id="talleres-externos-list">
                {talleresExternos.map(p => <option key={p.id} value={p.nombre}>{p.especialidad || "Taller"}</option>)}
              </datalist>
            </div>
          )}
          <div style={{gridColumn:"1/-1",background:"rgba(59,130,246,.06)",border:"1px solid rgba(59,130,246,.2)",borderRadius:8,padding:"10px 12px"}}>
            <div style={{fontSize:11,fontWeight:700,color:"var(--accent)",textTransform:"uppercase",marginBottom:8}}>
              {form.origen_taller === "externo" ? "Factura del taller externo" : "Factura de compra / proveedor"}
            </div>
            <div style={{display:"grid",gridTemplateColumns:form.origen_taller === "externo" ? "1fr 1fr" : "1fr 1fr 1fr",gap:8}}>
              <div><label style={S.lbl}>No. factura</label><input style={S.inp} value={form.factura_proveedor_num||""} onChange={f("factura_proveedor_num")} placeholder="FAC-2026-001"/></div>
              {form.origen_taller === "externo" ? null : <div><label style={S.lbl}>Proveedor</label><input style={S.inp} value={form.factura_proveedor_nombre||""} onChange={f("factura_proveedor_nombre")} placeholder="Proveedor de recambios"/></div>}
              <div><label style={S.lbl}>{form.origen_taller === "externo" ? "Importe factura taller (EUR)" : "Importe factura (EUR)"}</label><input type="number" step="0.01" style={S.inp} value={form.factura_proveedor_importe||""} onChange={f("factura_proveedor_importe")} onFocus={e=>e.target.select()}/></div>
            </div>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:6}}>
              {form.origen_taller === "externo"
                ? "Si el taller no existe, al guardar te preguntaremos si quieres crearlo para reutilizarlo en futuras intervenciones."
                : "La factura del proveedor queda vinculada a esta orden de trabajo sin duplicar el coste del servicio."}
            </div>
          </div>
          <div style={{gridColumn:"1/-1"}}><label style={S.lbl}>Notas</label><input style={S.inp} value={form.notas} onChange={f("notas")} placeholder="Observaciones internas o trabajo realizado"/></div>
        </div>

        <div style={{marginTop:14}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Piezas utilizadas del stock</div>
            <button type="button" style={{...S.btn,background:"rgba(16,185,129,.1)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)",padding:"5px 10px",fontSize:11}} onClick={()=>setScannerOpen(true)}>
              Escanear pieza
            </button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr auto",gap:8,marginBottom:10}}>
            <input style={S.inp} value={codigoManual} onChange={e=>setCodigoManual(e.target.value)} onKeyDown={e=>e.key==="Enter"&&buscarCodigoManual()} placeholder="Escribe el código de barras si no puedes escanear" />
            <button type="button" style={{...S.btn,background:"var(--bg3)",color:"var(--accent-xl)",border:"1px solid #1e2d45"}} onClick={buscarCodigoManual}>Añadir por código</button>
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {taller.stock.length === 0 && <span style={{fontSize:12,color:"var(--text5)"}}>Sin piezas en catálogo. Añádelas en la pestaña Stock.</span>}
            {taller.stock.filter(s=>!form.piezas_usadas.find(p=>p.id===s.id)).map(s=>{
              const sinStock = (s.stock_actual||0) <= 0;
              return (
                <span key={s.id} title={sinStock ? "Sin stock disponible" : `${s.stock_actual} unidades disponibles`} style={{...S.btn,background: sinStock ? "rgba(239,68,68,.06)" : "var(--bg3)",color: sinStock ? "#ef4444" : "var(--accent-xl)",border: sinStock ? "1px dashed rgba(239,68,68,.3)" : "1px solid #1e2d45",padding:"4px 10px",fontSize:11,opacity: sinStock ? 0.75 : 1,cursor:"default"}}>
                  {sinStock ? <span>Sin stock  -  {s.nombre}</span> : <span>{s.nombre} <span style={{color:"var(--text4)",fontWeight:400}}>({s.stock_actual} uds)</span></span>}
                </span>
              );
            })}
          </div>
          {form.piezas_usadas.length>0 && (
            <table style={{width:"100%",borderCollapse:"collapse",marginBottom:10}}>
              <thead><tr>{["Pieza","Cant.","EUR/u","Subtotal",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
              <tbody>{form.piezas_usadas.map((p,i)=>(<tr key={`${p.id||p.codigo_barras||p.referencia||i}-${i}`}>
                <td style={{...S.td}}><div style={{fontWeight:700}}>{p.nombre}</div><div style={{fontSize:11,color:"var(--text5)"}}>{p.codigo_barras || p.referencia || "Sin código"}</div></td>
                <td style={S.td}><input type="number" min="1" step="1" value={p.cantidad_usada} onChange={e=>updCant(i,e.target.value)} style={{...S.inp,width:70,padding:"4px 6px"}}/></td>
                <td style={S.td}>{fmt2(p.precio_unitario || 0)} EUR</td>
                <td style={S.td}>{fmt2((p.cantidad_usada||0)*(p.precio_unitario||0))} EUR</td>
                <td style={S.td}><button type="button" style={{...S.btn,background:"transparent",color:"#ef4444",border:"1px solid rgba(239,68,68,.25)",padding:"4px 8px",fontSize:11}} onClick={()=>remPieza(i)}>Quitar</button></td>
              </tr>))}</tbody>
            </table>
          )}
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginTop:8,background:"var(--bg4)",border:"1px solid var(--border2)",borderRadius:10,padding:12}}>
          <div><div style={S.lbl}>Piezas</div><div style={{fontWeight:800,color:"var(--text)"}}>{fmt2(subtotalPiezas)} EUR</div></div>
          <div><div style={S.lbl}>{form.origen_taller === "externo" ? "Factura taller" : "Servicio"}</div><div style={{fontWeight:800,color:"var(--text)"}}>{fmt2(costeServicio)} EUR</div></div>
          <div><div style={S.lbl}>Coste total</div><div style={{fontWeight:900,color:"var(--accent-xl)"}}>{fmt2(costoTotal)} EUR</div></div>
        </div>

        <div style={{display:"flex",gap:10,marginTop:18,justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={guardar}>{editando?"Guardar":"Añadir"}</button>
        </div>
        <BarcodeScanner open={scannerOpen} title="Escanear código de pieza" onDetected={buscarPiezaPorCodigo} onClose={()=>setScannerOpen(false)} />
      </div>
    </div>
  );
}

function ModalProveedorForm({ editando, proveedores = [], onSaved, onClose }) {
  const ESPECIALIDADES = ["General","Motor / Mecánica","Carrocería","Neumaticos","Electricidad","Hidráulica","Frenos","Climatización","Tacógrafos","Grúas","Otro"];
  const [form, setForm] = useState(editando || {
    nombre:"",cif:"",razon_social:"",direccion:"",cp:"",poblacion:"",provincia:"",
    telefono:"",email:"",web:"",iban:"",especialidad:"General",notas:"",activo:true
  });
  const f = k => e => setForm(p=>({...p,[k]:e.target.value}));
  function guardar() {
    if (!form.nombre) { notify("El nombre es obligatorio", "warning"); return; }
    const d = Array.isArray(proveedores) ? [...proveedores] : provLoad();
    const p = {...form, id:editando?.id||`pv_${Date.now()}`};
    if (editando) { const i=d.findIndex(x=>x.id===editando.id); if(i>=0) d[i]=p; else d.push(p); }
    else d.push(p);
    if (typeof onSaved === "function") onSaved(d);
    else provSave(d);
    onClose();
  }
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10};
  const inp = {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"};
  const sel = {...inp};
  const grid2 = {display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"};
  return (
    <div>
      <div style={{fontSize:11,color:"var(--text4)",marginBottom:16,background:"rgba(99,102,241,.07)",border:"1px solid rgba(99,102,241,.15)",borderRadius:8,padding:"8px 12px"}}>
        Datos fiscales completos del taller / proveedor externo
      </div>
      <div style={grid2}>
        <div style={{gridColumn:"1/-1"}}><label style={lbl}>Nombre comercial *</label><input style={inp} value={form.nombre} onChange={f("nombre")} placeholder="Talleres García S.L."/></div>
        <div><label style={lbl}>CIF / NIF</label><input style={{...inp,fontFamily:"'JetBrains Mono',monospace"}} value={form.cif} onChange={f("cif")} placeholder="B-12345678"/></div>
        <div><label style={lbl}>Razón social</label><input style={inp} value={form.razon_social} onChange={f("razon_social")}/></div>
        <div style={{gridColumn:"1/-1"}}><label style={lbl}>Direccion (calle y no.)</label><input style={inp} value={form.direccion} onChange={f("direccion")}/></div>
        <div><label style={lbl}>Código postal</label><input style={inp} value={form.cp} onChange={f("cp")} placeholder="28001"/></div>
        <div><label style={lbl}>Población</label><input style={inp} value={form.poblacion} onChange={f("poblacion")}/></div>
        <div><label style={lbl}>Provincia</label><input style={inp} value={form.provincia} onChange={f("provincia")}/></div>
        <div><label style={lbl}>Especialidad</label>
          <select style={sel} value={form.especialidad} onChange={f("especialidad")}>
            {ESPECIALIDADES.map(e=><option key={e} value={e}>{e}</option>)}
          </select>
        </div>
        <div><label style={lbl}>Teléfono</label><input style={inp} value={form.telefono} onChange={f("telefono")}/></div>
        <div><label style={lbl}>Email</label><input type="email" style={inp} value={form.email} onChange={f("email")}/></div>
        <div><label style={lbl}>Web</label><input style={inp} value={form.web} onChange={f("web")} placeholder="https://..."/></div>
        <div><label style={lbl}>IBAN</label><input style={{...inp,fontFamily:"'JetBrains Mono',monospace"}} value={form.iban} onChange={f("iban")} placeholder="ES00 0000 0000 00 0000000000"/></div>
        <div style={{gridColumn:"1/-1"}}><label style={lbl}>Notas / condiciones</label>
          <textarea style={{...inp,height:60,resize:"vertical"}} value={form.notas} onChange={f("notas")}/>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <button style={{padding:"7px 14px",borderRadius:7,border:"1px solid #1e2d45",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={onClose}>Cancelar</button>
        <button style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={guardar}>Guardar</button>
      </div>
    </div>
  );
}

//  Modal Aviso de mantenimiento 
function ModalAvisoForm({ editando, tipos, avisosMant = [], onSaved, onClose }) {
  const [form, setForm] = useState(editando || {
    tipo_mantenimiento:"Cambio aceite", dias_aviso:180, km_aviso:50000,
    descripcion:"", activo:true
  });
  const f = k => e => setForm(p=>({...p,[k]:e.target.type==="checkbox"?e.target.checked:e.target.value}));
  function guardar() {
    if (!form.tipo_mantenimiento) { notify("El tipo es obligatorio", "warning"); return; }
    const d = Array.isArray(avisosMant) ? [...avisosMant] : avisosCfgLoad();
    const p = {...form, id:editando?.id||`am_${Date.now()}`, dias_aviso:parseInt(form.dias_aviso)||0, km_aviso:parseInt(form.km_aviso)||0};
    if (editando) { const i=d.findIndex(x=>x.id===editando.id); if(i>=0) d[i]=p; else d.push(p); }
    else d.push(p);
    if (typeof onSaved === "function") onSaved(d);
    else avisosCfgSave(d);
    onClose();
  }
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10};
  const inp = {background:"var(--bg4)",border:"1px solid #1e2d45",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"};
  const sel = {...inp};
  return (
    <div>
      <div style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"8px 12px",marginBottom:14,fontSize:12,color:"#f59e0b"}}>
        El aviso se activa cuando se cumple <strong>cualquiera</strong> de los dos intervalos (tiempo O kilómetros), lo que ocurra antes.
      </div>
      <label style={lbl}>Tipo de mantenimiento *</label>
      <select style={sel} value={form.tipo_mantenimiento} onChange={f("tipo_mantenimiento")}>
        {tipos.map(t=><option key={t} value={t}>{t}</option>)}
        <option value="Cambio aceite">Cambio aceite</option>
        <option value="Cambio correa distribución">Cambio correa distribución</option>
        <option value="Cambio neumáticos">Cambio neumáticos</option>
        <option value="Revisión tacógrafo">Revisión tacógrafo</option>
      </select>
      <label style={lbl}>Descripción / notas</label>
      <input style={inp} value={form.descripcion} onChange={f("descripcion")} placeholder="Ej: Aceite 15W-40 + filtro aceite + filtro aire"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
        <div>
          <label style={lbl}>Intervalo en días</label>
          <input type="number" min="0" style={inp} value={form.dias_aviso} onChange={f("dias_aviso")} placeholder="180 = 6 meses" onFocus={e=>e.target.select()}/>
          <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>
            {form.dias_aviso>0?`~ ${(form.dias_aviso/30).toFixed(1)} meses`:"Sin límite de tiempo"}
          </div>
        </div>
        <div>
          <label style={lbl}>Intervalo en KM</label>
          <input type="number" min="0" step="1000" style={inp} value={form.km_aviso} onChange={f("km_aviso")} placeholder="50000" onFocus={e=>e.target.select()}/>
          <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>
            {form.km_aviso>0?`${Number(form.km_aviso).toLocaleString("es-ES")} km`:"Sin límite de KM"}
          </div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:14}}>
        <input type="checkbox" id="av_activo" checked={form.activo!==false} onChange={f("activo")} style={{width:15,height:15,accentColor:"var(--green)"}}/>
        <label htmlFor="av_activo" style={{fontSize:13,color:"var(--text2)",cursor:"pointer"}}>Aviso activo</label>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <button style={{padding:"7px 14px",borderRadius:7,border:"1px solid #1e2d45",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={onClose}>Cancelar</button>
        <button style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}} onClick={guardar}>Guardar</button>
      </div>
    </div>
  );
}



//  AvisosTab: mantenimientos por km/tiempo + ITV + KM actuales -
const MANT_RECOMENDADO = {
  "Cambio aceite":           { km: 30000,  meses: 12 },
  "Cambio neumáticos":       { km: 120000, meses: 48 },
  "Cambio filtros":          { km: 40000,  meses: 12 },
  "Revisión ITV":            { km: null,   meses: 24 },
  "Mantenimiento preventivo":{ km: 50000,  meses: 12 },
  "Avería / Reparación":     { km: null,   meses: null },
  "Reparación carrocería":   { km: null,   meses: null },
};

function AvisosTab({ vehiculos, reparaciones, avisosMant, alertasDoc, neumaticosVehiculos = {}, onReloadAvisos, onEditAviso, onNuevoAviso, onDeleteAviso, onKmUpdate }) {
  const [tab2, setTab2] = useState("alertas");
  const [kmEdit, setKmEdit] = useState({}); // vid -> string
  const [savingKm, setSavingKm] = useState({});

  // Only tractoras (no remolques) for km display
  const tractoras = vehiculos.filter(v => {
    const cl = (v.clase||v.tipo||"").toLowerCase();
    return !cl.includes("remolque") && !cl.includes("semirremolque") && v.activo;
  });

  // Calculate maintenance alerts per vehicle per aviso type
  function calcAlertas() {
    const alerts = [];
    const hoy = new Date();

    tractoras.forEach(v => {
      const km = Number(v.km_actuales || 0);

      // ITV alerts from backend
      const docAlert = alertasDoc.find(a => a.id === v.id);
      if (docAlert?.alerta_itv) {
        const dias = docAlert.dias_itv;
        alerts.push({
          veh: v.matricula, vid: v.id, tipo: "ITV",
          nivel: docAlert.alerta_itv === "vencida" ? "rojo" : "naranja",
          msg: docAlert.alerta_itv === "vencida"
            ? `ITV VENCIDA hace ${Math.abs(dias)} días`
            : `ITV vence en ${dias} días (${new Date(v.fecha_itv).toLocaleDateString("es-ES")})`,
          fecha: v.fecha_itv,
        });
      }
      if (docAlert?.alerta_seguro) {
        const dias = docAlert.dias_seguro;
        alerts.push({
          veh: v.matricula, vid: v.id, tipo: "Seguro",
          nivel: docAlert.alerta_seguro === "vencido" ? "rojo" : "naranja",
          msg: docAlert.alerta_seguro === "vencido"
            ? `Seguro VENCIDO hace ${Math.abs(dias)} días`
            : `Seguro vence en ${dias} días (${new Date(v.fecha_seguro).toLocaleDateString("es-ES")})`,
          fecha: v.fecha_seguro,
        });
      }

      // Maintenance alerts from avisosMant config
      avisosMant.filter(a => a.activo).forEach(aviso => {
        // Find last intervention of this type for this vehicle
        const ultimaRep = reparaciones
          .filter(r => r.vehiculo_id === v.id && r.tipo === aviso.tipo_mantenimiento)
          .sort((a,b) => new Date(b.fecha) - new Date(a.fecha))[0];

        const ultimaFecha = ultimaRep ? new Date(ultimaRep.fecha) : null;
        const ultimaKm = ultimaRep ? Number(ultimaRep.km_en_intervencion || ultimaRep.km_vehiculo || 0) : 0;

        // Check by km
        if (aviso.km_aviso && km > 0 && ultimaKm > 0) {
          const proximoKm = ultimaKm + Number(aviso.km_aviso);
          const faltanKm = proximoKm - km;
          if (faltanKm <= 0) {
            alerts.push({
              veh: v.matricula, vid: v.id, tipo: aviso.tipo_mantenimiento,
              nivel: "rojo",
              msg: `${aviso.tipo_mantenimiento}: VENCIDO por km (pasado por ${Math.abs(Math.round(faltanKm)).toLocaleString("es-ES")} km)`,
              proxKm: proximoKm, kmActual: km,
            });
          } else if (faltanKm <= 5000) {
            alerts.push({
              veh: v.matricula, vid: v.id, tipo: aviso.tipo_mantenimiento,
              nivel: "naranja",
              msg: `${aviso.tipo_mantenimiento}: faltan ${Math.round(faltanKm).toLocaleString("es-ES")} km (próximo a ${proximoKm.toLocaleString("es-ES")} km)`,
              proxKm: proximoKm, kmActual: km,
            });
          }
        }

        // Check by time
        if (aviso.dias_aviso && ultimaFecha) {
          const diasPasados = Math.round((hoy - ultimaFecha) / (1000*3600*24));
          const faltanDias = Number(aviso.dias_aviso) - diasPasados;
          if (faltanDias <= 0) {
            alerts.push({
              veh: v.matricula, vid: v.id, tipo: aviso.tipo_mantenimiento,
              nivel: "rojo",
              msg: `${aviso.tipo_mantenimiento}: VENCIDO por tiempo (hace ${Math.round(diasPasados/30)} meses)`,
              diasDesde: diasPasados,
            });
          } else if (faltanDias <= 30) {
            alerts.push({
              veh: v.matricula, vid: v.id, tipo: aviso.tipo_mantenimiento,
              nivel: "naranja",
              msg: `${aviso.tipo_mantenimiento}: vence en ${faltanDias} días`,
              diasDesde: diasPasados,
            });
          }
        }
      });

      // Auto-alerts for neumáticos by km (even without aviso configured)
      const neumaticos = neumaticosVehiculos?.[v.id] && typeof neumaticosVehiculos[v.id] === "object"
        ? neumaticosVehiculos[v.id]
        : {};
      Object.entries(neumaticos).forEach(([pos, nd]) => {
        if (!nd.km || !km) return;
        const kmSinceCambio = km - Number(nd.km);
        if (kmSinceCambio > 120000) {
          alerts.push({
            veh: v.matricula, vid: v.id, tipo: "Neumaticos",
            nivel: "rojo",
            msg: `Neumático ${pos}: ${Math.round(kmSinceCambio).toLocaleString("es-ES")} km desde cambio (recomendado: 120.000 km)`,
          });
        } else if (kmSinceCambio > 100000) {
          alerts.push({
            veh: v.matricula, vid: v.id, tipo: "Neumaticos",
            nivel: "naranja",
            msg: `Neumático ${pos}: ${Math.round(kmSinceCambio).toLocaleString("es-ES")} km - revisar pronto`,
          });
        }
      });
    });

    return alerts.sort((a,b) => a.nivel === "rojo" ? -1 : 1);
  }

  const alertas = calcAlertas();
  const alertasRojas = alertas.filter(a => a.nivel === "rojo").length;
  const alertasNaranjas = alertas.filter(a => a.nivel === "naranja").length;

  async function guardarKm(vid) {
    const km = kmEdit[vid];
    if (!km || isNaN(km)) return;
    setSavingKm(p => ({...p, [vid]: true}));
    try {
      await onKmUpdate(vid, Number(km));
      setKmEdit(p => ({...p, [vid]: ""}));
    } finally {
      setSavingKm(p => ({...p, [vid]: false}));
    }
  }

  const clBadge = { rojo: { bg: "rgba(239,68,68,.12)", color: "#ef4444", border: "rgba(239,68,68,.3)" },
                    naranja: { bg: "rgba(245,158,11,.1)", color: "#f59e0b", border: "rgba(245,158,11,.3)" } };
  const inp2 = { background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"6px 10px", borderRadius:6, fontSize:12, outline:"none" };
  const btn2 = { padding:"5px 12px", borderRadius:6, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, fontFamily:"'DM Sans',sans-serif" };

  return (
    <div>
      {/* Tabs */}
      <div style={{display:"flex", gap:8, marginBottom:16, flexWrap:"wrap", alignItems:"center"}}>
        {[["alertas", `Alertas activas${alertasRojas>0?` (${alertasRojas} rojas)`:alertasNaranjas>0?` (${alertasNaranjas})`:""}` ],
          ["km", "Km actuales"],
          ["config", "Configurar intervalos"]].map(([id, label]) => (
          <button key={id} onClick={() => setTab2(id)}
            style={{...btn2, background: tab2===id ? "var(--accent)" : "var(--bg4)",
              color: tab2===id ? "#fff" : "var(--text3)", border: "1px solid var(--border2)"}}>
            {label}
          </button>
        ))}
        {tab2 === "config" && (
          <button onClick={onNuevoAviso}
            style={{...btn2, background:"var(--accent)", color:"#fff", marginLeft:"auto"}}>
            + Nuevo intervalo
          </button>
        )}
      </div>

      {/* ALERTAS TAB */}
      {tab2 === "alertas" && (
        <div>
          {alertas.length === 0 ? (
            <div style={{background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:12,
                         padding:32, textAlign:"center", color:"var(--text5)"}}>
              <div style={{fontSize:16, marginBottom:8, fontWeight:800, color:"var(--green)"}}>OK</div>
              <div style={{fontWeight:700, fontSize:14, color:"var(--text)"}}>Todo en orden</div>
              <div style={{fontSize:12, marginTop:4}}>No hay alertas de mantenimiento activas</div>
            </div>
          ) : (
            <div style={{display:"flex", flexDirection:"column", gap:8}}>
              {alertas.map((a, i) => {
                const st = clBadge[a.nivel];
                return (
                  <div key={i} style={{background:st.bg, border:`1px solid ${st.border}`,
                                       borderRadius:10, padding:"12px 16px",
                                       display:"flex", alignItems:"center", gap:12}}>
                    <span style={{fontSize:20}}>{a.nivel==="rojo"?"":""}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700, fontSize:13, color:st.color}}>{a.veh}</div>
                      <div style={{fontSize:12, color:"var(--text3)", marginTop:2}}>{a.msg}</div>
                    </div>
                    <span style={{fontSize:11, fontWeight:700, padding:"2px 8px", borderRadius:12,
                                  background:st.bg, color:st.color, border:`1px solid ${st.border}`,
                                  whiteSpace:"nowrap"}}>
                      {a.tipo}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* KM ACTUALES TAB */}
      {tab2 === "km" && (
        <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(280px,1fr))", gap:12}}>
          {tractoras.map(v => (
            <div key={v.id} style={{background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:12, padding:16}}>
              <div style={{display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10}}>
                <div>
                  <div style={{fontWeight:800, fontSize:14, color:"var(--text)"}}>{v.matricula}</div>
                  <div style={{fontSize:11, color:"var(--text5)"}}>{v.marca} {v.modelo}</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontFamily:"'JetBrains Mono',monospace", fontWeight:800, fontSize:18, color:"var(--accent)"}}>
                    {v.km_actuales ? Number(v.km_actuales).toLocaleString("es-ES") : "-"}
                  </div>
                  <div style={{fontSize:10, color:"var(--text5)"}}>km actuales</div>
                </div>
              </div>
              {/* ITV/Seguro badges */}
              {(() => {
                const doc = alertasDoc.find(a => a.id === v.id);
                return doc ? (
                  <div style={{display:"flex", gap:6, marginBottom:10, flexWrap:"wrap"}}>
                    {doc.alerta_itv && (
                      <span style={{fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:10,
                        background: doc.alerta_itv==="vencida"?"rgba(239,68,68,.15)":"rgba(245,158,11,.12)",
                        color: doc.alerta_itv==="vencida"?"#ef4444":"#f59e0b"}}>
                        ITV: {doc.alerta_itv==="vencida"?"VENCIDA":`${doc.dias_itv}d`}
                      </span>
                    )}
                    {doc.alerta_seguro && (
                      <span style={{fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:10,
                        background: doc.alerta_seguro==="vencido"?"rgba(239,68,68,.15)":"rgba(245,158,11,.12)",
                        color: doc.alerta_seguro==="vencido"?"#ef4444":"#f59e0b"}}>
                        Seguro: {doc.alerta_seguro==="vencido"?"VENCIDO":`${doc.dias_seguro}d`}
                      </span>
                    )}
                  </div>
                ) : null;
              })()}
              {/* Km update */}
              <div style={{display:"flex", gap:6}}>
                <input type="number" style={{...inp2, flex:1}}
                  placeholder="Nuevo km..."
                  value={kmEdit[v.id]||""}
                  onChange={e => setKmEdit(p=>({...p,[v.id]:e.target.value}))}
                  onKeyDown={e => e.key==="Enter" && guardarKm(v.id)}
                />
                <button onClick={() => guardarKm(v.id)}
                  disabled={savingKm[v.id] || !kmEdit[v.id]}
                  style={{...btn2, background:kmEdit[v.id]?"var(--accent)":"var(--bg4)",
                    color:kmEdit[v.id]?"#fff":"var(--text4)"}}>
                  {savingKm[v.id] ? "..." : "OK"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* CONFIG TAB */}
      {tab2 === "config" && (
        <div>
          <div style={{background:"rgba(59,130,246,.07)", border:"1px solid rgba(59,130,246,.2)",
                       borderRadius:8, padding:"10px 14px", marginBottom:14, fontSize:12, color:"var(--text3)"}}>
            Define los intervalos de mantenimiento. El sistema generará alertas cuando se acerque el vencimiento por tiempo O por kilómetros.
          </div>
          <div style={{display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))", gap:10, marginBottom:14}}>
            {Object.entries(MANT_RECOMENDADO).filter(([,v])=>v.km||v.meses).map(([tipo,rec])=>(
              <div key={tipo} style={{background:"rgba(59,130,246,.05)", border:"1px solid rgba(59,130,246,.15)", borderRadius:8, padding:"8px 12px", fontSize:11}}>
                <div style={{fontWeight:700, color:"var(--text)", marginBottom:2}}>{tipo}</div>
                <div style={{color:"var(--text5)"}}>
                  {rec.km ? `Cada ${rec.km.toLocaleString("es-ES")} km` : "Sin intervalo km"}
                  {rec.km && rec.meses ? "  -  " : ""}
                  {rec.meses ? `${rec.meses} meses recomendados` : ""}
                </div>
              </div>
            ))}
          </div>
          <div style={{background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:12, overflow:"hidden"}}>
            <table style={{width:"100%", borderCollapse:"collapse"}}>
              <thead><tr>{["Tipo","Intervalo tiempo","Intervalo km","Estado",""].map(h=>(
                <th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border2)",background:"var(--bg3)"}}>{h}</th>
              ))}</tr></thead>
              <tbody>
                {avisosMant.length === 0
                  ? <tr><td colSpan={5} style={{padding:20,textAlign:"center",color:"var(--text5)",fontSize:12}}>Sin intervalos configurados. Pulsa "+ Nuevo intervalo" para añadir.</td></tr>
                  : avisosMant.map(a => (
                    <tr key={a.id} style={{borderBottom:"1px solid var(--border2)"}}>
                      <td style={{padding:"8px 12px",fontWeight:700,color:"var(--text)",fontSize:13}}>{a.tipo_mantenimiento}</td>
                      <td style={{padding:"8px 12px",fontSize:12,color:"var(--text3)"}}>{a.dias_aviso?`${a.dias_aviso}d (${Math.round(a.dias_aviso/30)}m)`:"-"}</td>
                      <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:12,color:"var(--text3)"}}>{a.km_aviso?`${Number(a.km_aviso).toLocaleString("es-ES")} km`:"-"}</td>
                      <td style={{padding:"8px 12px"}}>
                        <span style={{padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,
                          background:a.activo?"rgba(16,185,129,.1)":"rgba(107,114,128,.1)",
                          color:a.activo?"var(--green)":"var(--text5)"}}>
                          {a.activo?"Activo":"Inactivo"}
                        </span>
                      </td>
                      <td style={{padding:"8px 12px"}}>
                        <div style={{display:"flex",gap:5}}>
                          <button onClick={()=>onEditAviso(a)}
                            style={{...btn2,background:"var(--bg3)",color:"var(--text2)",border:"1px solid var(--border2)",padding:"3px 8px",fontSize:11}}>Editar</button>
                          <button onClick={async()=>{if(await confirmDialog({title:"Eliminar aviso",message:"Eliminar este aviso?",confirmText:"Eliminar",tone:"danger"})){onDeleteAviso?.(a.id);onReloadAvisos?.();}}}
                            style={{...btn2,background:"transparent",color:"#ef4444",border:"none",padding:"3px 8px",fontSize:11}}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}



// ------------------------------------------------------------------
// NEUMÁTICOS: stock + cambio con selección + estadísticas
// ------------------------------------------------------------------

const TIPOS_NEUMAT = [
  { id:"tractora",      label:"Tractora",         medidas:["295/80 R22.5","315/80 R22.5","315/70 R22.5","385/65 R22.5"] },
  { id:"remolque",      label:"Remolque / Semi",   medidas:["385/65 R22.5","435/50 R19.5","245/70 R17.5","265/70 R19.5"] },
  { id:"directriz",     label:"-> Directriz",          medidas:["315/80 R22.5","295/80 R22.5","315/60 R22.5"] },
  { id:"traccion",      label:"Tracción",           medidas:["295/80 R22.5","315/80 R22.5","315/60 R22.5","385/65 R22.5"] },
];
const POSICIONES_TRACTOR = [
  {id:"del_iz",  label:"Delantera Izq",  x:112, y:78,  r:18, tipo:"directriz"},
  {id:"del_der", label:"Delantera Der",  x:112, y:210, r:18, tipo:"directriz"},
  {id:"tra_iz1", label:"Trasera Izq 1",  x:252, y:78,  r:18, tipo:"traccion"},
  {id:"tra_iz2", label:"Trasera Izq 2",  x:252, y:122, r:18, tipo:"traccion"},
  {id:"tra_der1",label:"Trasera Der 1",  x:252, y:166, r:18, tipo:"traccion"},
  {id:"tra_der2",label:"Trasera Der 2",  x:252, y:210, r:18, tipo:"traccion"},
];
const POSICIONES_REMOLQUE = [
  {id:"rem_iz1", label:"Rem Izq 1",  x:392, y:78,  r:18, tipo:"remolque"},
  {id:"rem_iz2", label:"Rem Izq 2",  x:392, y:122, r:18, tipo:"remolque"},
  {id:"rem_der1",label:"Rem Der 1",  x:392, y:166, r:18, tipo:"remolque"},
  {id:"rem_der2",label:"Rem Der 2",  x:392, y:210, r:18, tipo:"remolque"},
  {id:"rem_iz3", label:"Rem Izq 3",  x:462, y:78,  r:18, tipo:"remolque"},
  {id:"rem_iz4", label:"Rem Izq 4",  x:462, y:122, r:18, tipo:"remolque"},
  {id:"rem_der3",label:"Rem Der 3",  x:462, y:166, r:18, tipo:"remolque"},
  {id:"rem_der4",label:"Rem Der 4",  x:462, y:210, r:18, tipo:"remolque"},
];
function groupNeumaticosStock(rows = []) {
  const groups = new Map();
  rows.filter(n => n.estado === "stock").forEach(n => {
    const key = [n.tipo || "tractora", n.marca || "", n.medida || "", n.precio_compra || 0, n.notas || ""].join("|");
    const current = groups.get(key) || {
      id: `db_${key}`,
      tipo: n.tipo || "tractora",
      marca: n.marca || "",
      medida: n.medida || "",
      cantidad: 0,
      notas: n.notas || "",
      precio_compra: Number(n.precio_compra || 0),
      db_ids: [],
    };
    current.cantidad += 1;
    current.db_ids.push(n.id);
    groups.set(key, current);
  });
  return [...groups.values()];
}

function neumaticosMontadosToVehData(rows = []) {
  return rows.filter(n => n.estado === "montado" && n.posicion).reduce((acc, n) => {
    acc[n.posicion] = {
      id: n.id,
      marca: n.marca || "",
      medida: n.medida || "",
      fecha: n.fecha_montaje || "",
      km: Number(n.km_montaje || 0),
      instalado: n.updated_at || n.created_at || new Date().toISOString(),
      codigo_barras: n.codigo_barras || "",
    };
    return acc;
  }, {});
}

function NeumaticosTab({ vehiculos, reparaciones, neumaticosStock = [], neumaticosVehiculos = {}, onPersistNeumaticos }) {
  const tractoras = vehiculos.filter(v=>{
    const cl=(v.clase||v.tipo||"").toLowerCase();
    return !cl.includes("remolque")&&!cl.includes("semirremolque")&&v.activo;
  });
  const [tabN, setTabN] = useState("diagrama");
  const [vSel, setVSel] = useState(tractoras[0]?.id||"");
  const [vehData, setVehData] = useState({});
  const [sel, setSel] = useState(new Set());
  const [stock, setStock] = useState(Array.isArray(neumaticosStock) ? neumaticosStock : []);
  const [form, setForm] = useState({marca:"", medida:"", fecha:new Date().toISOString().slice(0,10), km:"", stockItemId:""});
  const [modalStock, setModalStock] = useState(false);
  const [stockForm, setStockForm] = useState({tipo:"tractora", marca:"", medida:"", cantidad:4, precio_compra:"", proveedor:"", dot:"", notas:""});

  const persistNeumaticos = useCallback(async (patch) => {
    if (typeof onPersistNeumaticos !== "function") return null;
    const current = {
      neumaticos_stock: Array.isArray(neumaticosStock) ? neumaticosStock : [],
      neumaticos_vehiculos: neumaticosVehiculos || {},
    };
    return onPersistNeumaticos(typeof patch === "function" ? patch(current) : patch);
  }, [onPersistNeumaticos, neumaticosStock, neumaticosVehiculos]);

  const cargarStockApi = useCallback(async () => {
    try {
      const rows = await getTallerNeumaticos({ estado:"stock" });
      if (Array.isArray(rows)) {
        const grouped = groupNeumaticosStock(rows);
        setStock(grouped);
        persistNeumaticos({ neumaticos_stock: grouped });
      }
    } catch {
      setStock(Array.isArray(neumaticosStock) ? neumaticosStock : []);
    }
  }, [persistNeumaticos, neumaticosStock]);

  const cargarVehiculoApi = useCallback(async (vehiculoId) => {
    if (!vehiculoId) return;
    try {
      const rows = await getTallerNeumaticos({ estado:"montado", vehiculo_id:vehiculoId });
      if (Array.isArray(rows)) {
        const next = neumaticosMontadosToVehData(rows);
        setVehData(next);
        persistNeumaticos(prev => ({
          ...prev,
          neumaticos_vehiculos: {
            ...(prev?.neumaticos_vehiculos || {}),
            [vehiculoId]: next,
          },
        }));
        return;
      }
    } catch {}
    setVehData(neumaticosVehiculos?.[vehiculoId] || {});
  }, [persistNeumaticos, neumaticosVehiculos]);

  useEffect(()=>{ cargarStockApi(); },[cargarStockApi]);
  useEffect(()=>{ if(vSel) cargarVehiculoApi(vSel); },[vSel, cargarVehiculoApi]);
  useEffect(()=>{ setStock(Array.isArray(neumaticosStock) ? neumaticosStock : []); }, [neumaticosStock]);
  useEffect(()=>{ if(vSel) setVehData(neumaticosVehiculos?.[vSel] || {}); }, [vSel, neumaticosVehiculos]);

  const posAll = [...POSICIONES_TRACTOR, ...POSICIONES_REMOLQUE];
  function togglePos(id){ setSel(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; }); }

  // Stock filtered by position tipo
  const posSelectedTipos = [...sel].map(pid => posAll.find(p=>p.id===pid)?.tipo).filter(Boolean);
  const tiposFiltro = [...new Set(posSelectedTipos)];
  const stockDisponible = stock.filter(s=>
    s.cantidad > 0 && (tiposFiltro.length===0 || tiposFiltro.some(t=>s.tipo===t || (s.tipo==="tractora"&&(t==="directriz"||t==="traccion"))))
  );
  const sinStock = sel.size > 0 && stockDisponible.length === 0;

  async function registrarCambio(){
    if(sel.size===0){ notify("Selecciona al menos una posicion", "warning"); return; }
    if(!form.stockItemId && !form.marca){ notify("Selecciona un neumatico del stock o introduce una marca", "warning"); return; }
    if(sinStock && !form.marca){ notify("No hay neumaticos en stock para estas posiciones. Anade stock primero.", "warning"); return; }

    const stockItem = stock.find(s=>s.id===form.stockItemId);
    const marca = stockItem?.marca || form.marca;
    const medida = stockItem?.medida || form.medida;

    const newData = {...vehData};
    const posiciones = [...sel];
    if (stockItem?.db_ids?.length && stockItem.db_ids.length < posiciones.length) {
      notify("No hay unidades suficientes en ese grupo de stock.", "warning");
      return;
    }
    posiciones.forEach(pos=>{
      newData[pos] = { marca, medida, fecha:form.fecha, km:Number(form.km)||0, instalado:new Date().toISOString() };
    });
    setVehData(newData);
    await persistNeumaticos(prev => ({
      ...prev,
      neumaticos_vehiculos: {
        ...(prev?.neumaticos_vehiculos || {}),
        [vSel]: newData,
      },
    }));
    if (stockItem?.db_ids?.length) {
      for (let i = 0; i < posiciones.length; i++) {
        await montarTallerNeumatico(stockItem.db_ids[i], {
          vehiculo_id: vSel,
          posicion: posiciones[i],
          fecha_montaje: form.fecha,
          km_montaje: form.km || null,
        }).catch(e => notify("No se pudo montar un neumatico en BD: " + e.message, "warning"));
      }
    }

    // Auto-update vehicle km when registering tyre change
    if (form.km && Number(form.km) > 0) {
      actualizarKmVehiculo(vSel, Number(form.km)).catch(()=>{});
    }

    // Decrease stock
    if(stockItem){
      const newStock = stock.map(s=>s.id===form.stockItemId ? {...s, cantidad: s.cantidad-sel.size} : s)
                           .filter(s=>s.cantidad>0);
      setStock(newStock);
      await persistNeumaticos({ neumaticos_stock: newStock });
    }
    await cargarStockApi();
    await cargarVehiculoApi(vSel);
    setSel(new Set());
    setForm(p=>({...p, marca:"", medida:"", km:"", stockItemId:""}));
    notify(`Cambio registrado en ${sel.size} posicion(es)`, "success");
  }

  async function addStock(){
    if(!stockForm.marca||!stockForm.medida||!stockForm.tipo){ notify("Completa tipo, marca y medida", "warning"); return; }
    const newItem = {...stockForm, id:`nst_${Date.now()}`, cantidad:Number(stockForm.cantidad)||1};
    const newStock = [...stock, newItem];
    setStock(newStock);
    await persistNeumaticos({ neumaticos_stock: newStock });
    try {
      await crearTallerNeumatico({
        tipo: stockForm.tipo,
        marca: stockForm.marca,
        medida: stockForm.medida === "otra" ? stockForm.medida_custom || stockForm.medida : stockForm.medida,
        cantidad: Number(stockForm.cantidad) || 1,
        precio_compra: Number(stockForm.precio_compra || 0),
        proveedor: stockForm.proveedor || "",
        dot: stockForm.dot || "",
        notas: stockForm.notas || "",
      });
      await cargarStockApi();
    } catch (e) {
      notify("Stock guardado localmente, pero no se sincronizo con la base de datos: " + e.message, "warning");
    }
    setStockForm({tipo:"tractora", marca:"", medida:"", cantidad:4, precio_compra:"", proveedor:"", dot:"", notas:""});
    setModalStock(false);
    notify(`${newItem.cantidad} neumaticos anadidos al stock`, "success");
  }

  async function removeStock(id){
    const ok = await confirmDialog({
      title: "Eliminar stock",
      message: "Eliminar del stock?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if(!ok) return;
    const item = stock.find(s => s.id === id);
    if (item?.db_ids?.length) {
      for (const nid of item.db_ids) {
        await bajaTallerNeumatico(nid, { motivo:"Eliminado desde stock" }).catch(() => {});
      }
    }
    const ns = stock.filter(s=>s.id!==id); setStock(ns);
    await persistNeumaticos({ neumaticos_stock: ns });
    await cargarStockApi();
  }

  // Stats - count ONLY from tractoras loop (single source, avoids double-count with vehData)
  const marcaCount = {};
  tractoras.forEach(v=>{ Object.values(neumaticosVehiculos?.[v.id] || {}).forEach(d=>{ if(d.marca) marcaCount[d.marca]=(marcaCount[d.marca]||0)+1; }); });
  const topMarcas = Object.entries(marcaCount).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const inp={background:"#fff",border:"1px solid #cfdbe5",color:"#0f172a",padding:"11px 13px",borderRadius:8,fontSize:13,outline:"none",boxShadow:"0 6px 14px rgba(15,23,42,.03)"};
  const btn={padding:"11px 16px",borderRadius:8,border:"1px solid #cfdbe5",cursor:"pointer",fontSize:13,fontWeight:800,fontFamily:"'DM Sans',sans-serif",boxShadow:"0 8px 18px rgba(15,23,42,.04)"};

  return (
    <div>
      {/* Header controls */}
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:22,flexWrap:"wrap"}}>
        <select value={vSel} onChange={e=>setVSel(e.target.value)} style={{...inp,minWidth:150,fontWeight:700}}>
          {tractoras.map(v=><option key={v.id} value={v.id}>{v.matricula}</option>)}
        </select>
        {["diagrama","stock","estadisticas"].map(t=>(
          <button key={t} onClick={()=>setTabN(t)}
            style={{...btn,background:tabN===t?"linear-gradient(135deg,#0f766e,#0d9488)":"#f1f5f9",color:tabN===t?"#fff":"#64748b",border:"1px solid #dbe5ec"}}>
            {t==="diagrama"?"Diagrama":t==="stock"?"Stock":"Estadisticas"}
          </button>
        ))}
        <button onClick={()=>setModalStock(true)} style={{...btn,background:"linear-gradient(135deg,#0f766e,#0d9488)",color:"#fff",border:"1px solid #0f766e",marginLeft:"auto"}}>
          + Añadir al stock
        </button>
        {/* Stock badge */}
        <div style={{fontSize:14,color:"#64748b"}}>
          Stock: <strong style={{color:stock.length>0?"#0f766e":"#ef4444"}}>{stock.reduce((s,x)=>s+x.cantidad,0)} ud.</strong>
        </div>
      </div>

      {/* DIAGRAMA TAB */}
      {tabN==="diagrama" && (
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) 360px",gap:18}}>
          {/* SVG */}
          <div style={{background:"rgba(255,255,255,.95)",border:"1px solid #dbe5ec",borderRadius:12,padding:22,boxShadow:"0 14px 32px rgba(15,23,42,.05)"}}>
            <div style={{fontSize:15,color:"#64748b",marginBottom:12}}>
              Haz clic en las ruedas para seleccionarlas -> selecciona un neumático del stock -> registrar cambio
            </div>
            <svg viewBox="0 0 580 280" style={{width:"100%",maxWidth:760,display:"block",margin:"22px auto 10px"}}>
              <rect x="60" y="110" width="240" height="60" rx="8" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5"/>
              <rect x="60" y="90" width="110" height="80" rx="6" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5"/>
              <rect x="68" y="96" width="48" height="32" rx="3" fill="rgba(96,165,250,.25)" stroke="rgba(96,165,250,.4)" strokeWidth="1"/>
              <rect x="305" y="105" width="210" height="70" rx="6" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1.5"/>
              <line x1="300" y1="140" x2="310" y2="140" stroke="#94a3b8" strokeWidth="3"/>
              <text x="115" y="148" textAnchor="middle" fill="#475569" fontSize="10" fontFamily="sans-serif">TRACTOR</text>
              <text x="410" y="148" textAnchor="middle" fill="#475569" fontSize="10" fontFamily="sans-serif">SEMIRREMOLQUE</text>
              {posAll.map(pos=>{
                const hasTyre = !!vehData[pos.id];
                const isSelected = sel.has(pos.id);
                const age = hasTyre && vehData[pos.id]?.fecha ?
                  Math.floor((new Date()-new Date(vehData[pos.id].fecha))/(1000*60*60*24*30)) : null;
                const fillColor = isSelected ? "#3b82f6" :
                  hasTyre ? (age>24?"#ef4444":age>18?"#f59e0b":"#22c55e") : "#f1f5f9";
                return (
                  <g key={pos.id} onClick={()=>togglePos(pos.id)} style={{cursor:"pointer"}}>
                    <circle cx={pos.x} cy={pos.y} r={pos.r} fill={fillColor} stroke={isSelected?"#3b82f6":"#94a3b8"} strokeWidth={isSelected?2.5:1.5} opacity={0.95}/>
                    <circle cx={pos.x} cy={pos.y} r={pos.r*0.45} fill="none" stroke={isSelected?"#fff":"#94a3b8"} strokeWidth="1"/>
                    {hasTyre && !isSelected && (
                      <text x={pos.x} y={pos.y+3} textAnchor="middle" fill="#fff" fontSize="7" fontFamily="sans-serif" fontWeight="bold">
                        {vehData[pos.id]?.marca?.slice(0,3)?.toUpperCase()}
                      </text>
                    )}
                    {isSelected && <text x={pos.x} y={pos.y+3} textAnchor="middle" fill="#fff" fontSize="9" fontFamily="sans-serif" fontWeight="bold">OK</text>}
                  </g>
                );
              })}
            </svg>
            {/* Legend */}
            <div style={{display:"flex",gap:18,fontSize:13,color:"#64748b",marginTop:14,flexWrap:"wrap"}}>
              {[["#22c55e","<18m"],["#f59e0b","18-24m"],["#ef4444",">24m"],["#3b82f6","Selec."],["var(--bg3)","Sin datos"]].map(([color,label])=>(
                <span key={label} style={{display:"flex",alignItems:"center",gap:4}}>
                  <span style={{width:10,height:10,borderRadius:"50%",background:color,display:"inline-block"}}/>
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Form cambio */}
          <div style={{background:"rgba(255,255,255,.95)",border:"1px solid #dbe5ec",borderRadius:12,padding:22,boxShadow:"0 14px 32px rgba(15,23,42,.05)"}}>
            <div style={{fontWeight:900,fontSize:18,color:"#0f172a",marginBottom:18}}>
              Registrar cambio {sel.size>0?`(${sel.size} rueda${sel.size>1?"s":""})`:""}
            </div>

            {sel.size > 0 && (
              <div style={{marginBottom:10,padding:"8px 10px",background:sinStock?"rgba(239,68,68,.08)":"rgba(16,185,129,.07)",border:`1px solid ${sinStock?"rgba(239,68,68,.3)":"rgba(16,185,129,.25)"}`,borderRadius:7,fontSize:11}}>
                {sinStock
                  ? <span style={{color:"var(--red)",fontWeight:700}}>! Sin stock para este tipo de posición. Añade neumáticos al stock primero.</span>
                  : <span style={{color:"var(--green)"}}>{stockDisponible.reduce((s,x)=>s+x.cantidad,0)} neumáticos disponibles en stock</span>
                }
              </div>
            )}

            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {/* Stock selector */}
              {stockDisponible.length > 0 && (
                <div>
                  <label style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",display:"block",marginBottom:3}}>Del stock *</label>
                  <select style={{...inp,width:"100%",boxSizing:"border-box"}}
                    value={form.stockItemId} onChange={e=>{ const s=stock.find(x=>x.id===e.target.value); setForm(p=>({...p,stockItemId:e.target.value,marca:s?.marca||"",medida:s?.medida||""})); }}>
                    <option value="">- Seleccionar del stock -</option>
                    {stockDisponible.map(s=>(
                      <option key={s.id} value={s.id}>{s.marca} {s.medida} ({TIPOS_NEUMAT.find(t=>t.id===s.tipo)?.label||s.tipo}) - {s.cantidad} ud.</option>
                    ))}
                  </select>
                </div>
              )}
              {/* Manual entry if no stock */}
              {stockDisponible.length === 0 && (
                <div>
                  <label style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",display:"block",marginBottom:3}}>Marca (sin stock)</label>
                  <input style={{...inp,width:"100%",boxSizing:"border-box"}}
                    value={form.marca} onChange={e=>setForm(p=>({...p,marca:e.target.value}))} placeholder="Michelin, Bridgestone..."/>
                </div>
              )}
              <div>
                <label style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",display:"block",marginBottom:3}}>Fecha cambio</label>
                <input type="date" style={{...inp,width:"100%",boxSizing:"border-box"}} value={form.fecha} onChange={e=>setForm(p=>({...p,fecha:e.target.value}))}/>
              </div>
              <div>
                <label style={{fontSize:11,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",display:"block",marginBottom:3}}>Km actuales del vehículo</label>
                <input type="number" style={{...inp,width:"100%",boxSizing:"border-box"}}
                  value={form.km} onChange={e=>setForm(p=>({...p,km:e.target.value}))}
                  onFocus={e=>e.target.select()}
                  onBlur={e=>{ if(vSel&&e.target.value) import("../services/api").then(m=>m.actualizarKmVehiculo(vSel,Number(e.target.value)).catch(()=>{})); }}
                  placeholder={tractoras.find(v=>v.id===vSel)?.km_actuales ? `Actuales: ${Number(tractoras.find(v=>v.id===vSel)?.km_actuales).toLocaleString("es-ES")} km`:"0"}/>
                {form.km && <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Próximo cambio: <strong style={{color:"var(--accent)"}}>{(Number(form.km)+120000).toLocaleString("es-ES")} km</strong></div>}
              </div>
              <button onClick={registrarCambio} disabled={sel.size===0||sinStock}
                style={{...btn,background:sel.size>0&&!sinStock?"var(--accent)":"var(--bg4)",color:sel.size>0&&!sinStock?"#fff":"var(--text4)",marginTop:4}}>
                Registrar cambio
              </button>
            </div>

            {/* Current state */}
            {Object.keys(vehData).length>0 && (
              <div style={{marginTop:14}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:6}}>Estado actual</div>
                {posAll.filter(p=>vehData[p.id]).map(pos=>{
                  const d=vehData[pos.id];
                  const age=Math.floor((new Date()-new Date(d.fecha||Date.now()))/(1000*60*60*24*30));
                  return (
                    <div key={pos.id} style={{display:"flex",justifyContent:"space-between",padding:"3px 0",borderBottom:"1px solid var(--border2)",fontSize:11}}>
                      <span style={{color:"var(--text4)"}}>{pos.label}</span>
                      <span style={{color:age>24?"var(--red)":age>18?"#f59e0b":"var(--green)",fontWeight:700}}>
                        {d.marca} {d.medida}  -  {age}m
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* STOCK TAB */}
      {tabN==="stock" && (
        <div>
          {stock.length===0
            ? <div style={{...{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:32,textAlign:"center"}}}>
                <div style={{fontSize:32,marginBottom:8}}></div>
                <div style={{fontWeight:700,fontSize:14,color:"var(--text)"}}>Sin stock de neumáticos</div>
                <div style={{fontSize:12,color:"var(--text5)",marginTop:4}}>Usa el botón "+ Añadir al stock" para registrar tus neumáticos</div>
              </div>
            : <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,overflow:"hidden"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead><tr>
                    {["Tipo","Marca","Medida","Cantidad","Notas",""].map(h=><th key={h} style={{textAlign:"left",padding:"8px 12px",fontSize:10,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border2)",background:"var(--bg3)"}}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {stock.map(s=>(
                      <tr key={s.id} style={{borderBottom:"1px solid var(--border2)"}}>
                        <td style={{padding:"8px 12px",fontSize:12}}>
                          <span style={{padding:"2px 8px",borderRadius:10,fontSize:11,fontWeight:700,background:"rgba(59,130,246,.1)",color:"var(--accent)"}}>
                            {TIPOS_NEUMAT.find(t=>t.id===s.tipo)?.label||s.tipo}
                          </span>
                        </td>
                        <td style={{padding:"8px 12px",fontWeight:700,color:"var(--text)",fontSize:13}}>{s.marca}</td>
                        <td style={{padding:"8px 12px",fontFamily:"monospace",fontSize:12,color:"var(--text3)"}}>{s.medida}</td>
                        <td style={{padding:"8px 12px"}}>
                          <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:s.cantidad>0?"var(--green)":"var(--red)"}}>{s.cantidad}</span>
                          <span style={{fontSize:11,color:"var(--text5)",marginLeft:4}}>ud.</span>
                        </td>
                        <td style={{padding:"8px 12px",fontSize:11,color:"var(--text5)"}}>{s.notas||"-"}</td>
                        <td style={{padding:"8px 12px"}}>
                          <button onClick={()=>removeStock(s.id)} style={{...btn,padding:"3px 8px",background:"transparent",color:"var(--red)",border:"none",fontSize:11}}>Eliminar</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
          }
        </div>
      )}

      {/* ESTADÍSTICAS TAB */}
      {tabN==="estadisticas" && (
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16}}>
            <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:12}}>Marcas más usadas</div>
            {topMarcas.length===0
              ? <div style={{color:"var(--text5)",fontSize:12}}>Registra cambios para ver estadísticas</div>
              : topMarcas.map(([marca,count],i)=>(
                <div key={marca} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:16,color:"var(--accent)",width:20}}>{i+1}</span>
                  <div style={{flex:1}}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>{marca}</span>
                      <span style={{fontSize:12,color:"var(--text4)"}}>{count} ud.</span>
                    </div>
                    <div style={{height:4,borderRadius:2,background:"var(--bg4)"}}>
                      <div style={{height:4,borderRadius:2,background:"var(--accent)",width:`${(count/topMarcas[0][1])*100}%`}}/>
                    </div>
                  </div>
                </div>
              ))
            }
          </div>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:16}}>
            <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:12}}>Stock por tipo</div>
            {TIPOS_NEUMAT.map(tipo=>{
              const items = stock.filter(s=>s.tipo===tipo.id);
              const total = items.reduce((s,x)=>s+x.cantidad,0);
              return (
                <div key={tipo.id} style={{display:"flex",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid var(--border2)",fontSize:12}}>
                  <span style={{color:"var(--text3)"}}>{tipo.label}</span>
                  <span style={{fontWeight:700,color:total>0?"var(--green)":"var(--text5)"}}>{total} ud.</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL AÑADIR STOCK */}
      {modalStock && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModalStock(false)}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(460px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:16}}>Añadir neumáticos al stock</div>
            {[
              ["Tipo de neumático *",
                <select style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.tipo} onChange={e=>setStockForm(p=>({...p,tipo:e.target.value,medida:""}))}>
                  {TIPOS_NEUMAT.map(t=><option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              ],
              ["Marca *",
                <input style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.marca} onChange={e=>setStockForm(p=>({...p,marca:e.target.value}))} placeholder="Michelin, Bridgestone, Continental, Goodyear..."/>
              ],
              ["Medida *",
                <select style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.medida} onChange={e=>setStockForm(p=>({...p,medida:e.target.value}))}>
                  <option value="">- Seleccionar medida -</option>
                  {(TIPOS_NEUMAT.find(t=>t.id===stockForm.tipo)?.medidas||[]).map(m=><option key={m} value={m}>{m}</option>)}
                  <option value="otra">Otra medida</option>
                </select>
              ],
              ...(stockForm.medida==="otra"?[["Medida personalizada",
                <input style={{...inp,width:"100%",boxSizing:"border-box"}} placeholder="Ej: 315/80 R22.5" value={stockForm.medida_custom||""} onChange={e=>setStockForm(p=>({...p,medida_custom:e.target.value}))}/>
              ]]:[]),
              ["Cantidad",
                <input type="number" min="1" style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.cantidad} onChange={e=>setStockForm(p=>({...p,cantidad:Number(e.target.value)}))} onFocus={e=>e.target.select()}/>
              ],
              ["Precio compra",
                <input type="number" min="0" step="0.01" style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.precio_compra||""} onChange={e=>setStockForm(p=>({...p,precio_compra:e.target.value}))} placeholder="0,00" onFocus={e=>e.target.select()}/>
              ],
              ["Proveedor",
                <input style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.proveedor||""} onChange={e=>setStockForm(p=>({...p,proveedor:e.target.value}))} placeholder="Proveedor"/>
              ],
              ["DOT / lote",
                <input style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.dot||""} onChange={e=>setStockForm(p=>({...p,dot:e.target.value}))} placeholder="DOT, lote o serie"/>
              ],
              ["Notas (opcional)",
                <input style={{...inp,width:"100%",boxSizing:"border-box"}} value={stockForm.notas} onChange={e=>setStockForm(p=>({...p,notas:e.target.value}))} placeholder="Proveedor, lote, etc."/>
              ],
            ].map(([label,input])=>(
              <div key={String(label)} style={{marginBottom:10}}>
                <div style={{fontSize:11,fontWeight:700,color:"var(--text5)",textTransform:"uppercase",marginBottom:3}}>{label}</div>
                {input}
              </div>
            ))}
            <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
              <button onClick={()=>setModalStock(false)} style={{...btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid var(--border2)"}}>Cancelar</button>
              <button onClick={addStock} style={{...btn,background:"var(--accent)",color:"#fff"}}>Añadir al stock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


//  Solicitudes de choferes al mecánico -
// eslint-disable-next-line no-unused-vars
function SolicitudesChoferesTab({ vehiculos = [] }) {
  const [solicitudes, setSolicitudes] = useState([]);
  function cargar() {
    getTallerSolicitudes().then(remotas => {
      const rows = Array.isArray(remotas) ? remotas : [];
      setSolicitudes(rows);
    }).catch(() => {});
  }
  useEffect(()=>{ cargar(); }, []);
  async function marcarEstado(id, estado) {
    const updated = solicitudes.map(s => s.id===id ? {...s, estado} : s);
    setSolicitudes(updated);
    try {
      const saved = await actualizarTallerSolicitud(id, { estado });
      setSolicitudes(prev => prev.map(s => s.id === id ? saved : s));
    } catch(e) {
      notify("No se pudo actualizar la solicitud en servidor: " + e.message, "error");
    }
  }
  const UC = {normal:"#3b82f6", urgente:"#f59e0b", critica:"#ef4444"};
  const pendientes = solicitudes.filter(s=>s.estado==="pendiente");
  return (
    <div style={{padding:"4px 0"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
        <div style={{fontSize:13,color:"var(--text4)"}}>
          {pendientes.length>0
            ? <span style={{fontWeight:700,color:"#f59e0b"}}>{pendientes.length} pendiente{pendientes.length>1?"s":""}</span>
            : <span style={{color:"var(--green)"}}>Sin solicitudes pendientes</span>}
        </div>
        <button onClick={cargar} style={{padding:"4px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text4)",fontSize:11,cursor:"pointer"}}>Actualizar</button>
      </div>
      {solicitudes.length===0 && (
        <div style={{textAlign:"center",padding:32,color:"var(--text5)"}}>
          <div style={{fontSize:32,marginBottom:8}}></div>
          <div>Sin solicitudes de choferes</div>
          <div style={{fontSize:12,marginTop:4,color:"var(--text5)"}}>Las solicitudes desde la app del chófer aparecerán aquí</div>
        </div>
      )}
      {[...pendientes,...solicitudes.filter(s=>s.estado!=="pendiente")].map(s=>(
        <div key={s.id} style={{background:"var(--bg3)",border:`1px solid ${s.urgencia==="critica"?"rgba(239,68,68,.4)":s.urgencia==="urgente"?"rgba(245,158,11,.3)":"var(--border2)"}`,borderLeft:`4px solid ${UC[s.urgencia||"normal"]}`,borderRadius:8,padding:"10px 14px",marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontWeight:800,fontSize:13,color:"var(--text)"}}>{s.motivo_label||s.motivo}</span>
            <span style={{fontSize:10,color:"var(--text5)"}}>{new Date(s.fecha).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
          </div>
          <div style={{fontSize:12,color:"var(--text4)",marginBottom:4}}>
            {s.chofer_nombre}{s.vehiculo&&`  -  ${s.vehiculo}`}{s.ubicacion&&`  -  ${s.ubicacion}`}
          </div>
          {s.observaciones&&<div style={{fontSize:12,color:"var(--text3)",fontStyle:"italic",marginBottom:6}}>"{s.observaciones}"</div>}
          {s.estado==="pendiente"
            ? <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                <button onClick={()=>marcarEstado(s.id,"en_proceso")} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(245,158,11,.15)",color:"#f59e0b",fontSize:11,fontWeight:700,cursor:"pointer"}}>En proceso</button>
                <button onClick={()=>marcarEstado(s.id,"resuelto")} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(16,185,129,.15)",color:"var(--green)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Resuelto OK</button>
                <button onClick={()=>{
                  const d=tallerLoad();
                  const vehiculoSolicitud = vehiculos.find(v =>
                    (s.vehiculo_id && v.id === s.vehiculo_id) ||
                    (s.vehiculo && String(v.matricula || "").trim().toUpperCase() === String(s.vehiculo || "").trim().toUpperCase())
                  );
                  const ot={id:`r_${Date.now()}`,fecha:new Date().toISOString().slice(0,10),tipo:s.motivo_label||"Reparación",descripcion:`[CHÓFER] ${s.motivo_label}${s.observaciones?": "+s.observaciones:""}`,vehiculo_id:"",vehiculo_matricula:s.vehiculo||"",km_en_intervencion:"",coste_mano_obra:"0",taller_externo:"",notas:`Urgencia: ${s.urgencia} | Chófer: ${s.chofer_nombre}`,piezas_usadas:[],coste_total:0};
                  ot.vehiculo_id = vehiculoSolicitud?.id || s.vehiculo_id || ot.vehiculo_id || "";
                  ot.vehiculo_matricula = vehiculoSolicitud?.matricula || s.vehiculo || ot.vehiculo_matricula || "";
                  ot.solicitud_id = s.id;
                  d.reparaciones=[ot,...(d.reparaciones||[])];
                  tallerSave(d);
                  marcarEstado(s.id,"en_proceso");
                  notify("OT creada en Intervenciones", "success");
                }} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(59,130,246,.15)",color:"var(--accent)",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Crear OT</button>
              </div>
            : <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,fontWeight:700,background:s.estado==="resuelto"?"rgba(16,185,129,.15)":"rgba(59,130,246,.15)",color:s.estado==="resuelto"?"var(--green)":"var(--accent)"}}>{s.estado}</span>
          }
        </div>
      ))}
    </div>
  );
}


function SolicitudesChoferesProfesionalTab({ vehiculos = [], focus = null, solicitudes = [], onSolicitudesChange = null }) {
  const [filtroEstado, setFiltroEstado] = useState("abiertas");
  const [filtroUrgencia, setFiltroUrgencia] = useState("todas");
  const [historialAbierto, setHistorialAbierto] = useState({});
  const coloresUrgencia = { normal:"#3b82f6", urgente:"#f59e0b", critica:"#ef4444" };

  const cargar = useCallback(() => {
    getTallerSolicitudes().then(remotas => {
      const rows = Array.isArray(remotas) ? remotas : [];
      onSolicitudesChange?.(rows);
    }).catch(() => {});
  }, [onSolicitudesChange]);

  useEffect(()=>{ cargar(); }, [cargar]);

  useEffect(() => {
    const onFocus = () => cargar();
    const onSync = () => cargar();
    const pollId = window.setInterval(cargar, 15000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("taller:solicitudes-sync", onSync);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("taller:solicitudes-sync", onSync);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cargar]);

  useEffect(() => {
    if (!focus?.solicitud_id || !solicitudes.length) return;
    const found = solicitudes.find(s => String(s.id) === String(focus.solicitud_id));
    if (!found) return;
    const t = window.setTimeout(() => {
      document.getElementById(`solicitud-taller-${focus.solicitud_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_taller_focus");
    }, 180);
    return () => window.clearTimeout(t);
  }, [focus, solicitudes]);

  async function marcarEstado(id, estado, extra = {}) {
    const optimistic = solicitudes.map(s => s.id===id ? {...s, ...extra, estado, updated_at:new Date().toISOString()} : s);
    onSolicitudesChange?.(optimistic);
    try {
      const saved = await actualizarTallerSolicitud(id, { estado, ...extra });
      const next = optimistic.map(s => s.id === id ? saved : s);
      onSolicitudesChange?.(next);
    } catch(e) {
      notify("No se pudo actualizar la solicitud en servidor: " + e.message, "error");
    }
  }

  async function resolverSolicitud(s) {
    const respuesta = await promptDialog({
      title: "Respuesta para el chofer",
      message: "Escribe la resolucion o indicacion que vera el chofer en su app.",
      placeholder: "Ej: Revisado. Puedes continuar y pasar por taller al volver.",
      defaultValue: s.respuesta_taller || "",
      confirmText: "Marcar resuelto",
      cancelText: "Cancelar",
    });
    if (respuesta === null) return;
    await marcarEstado(s.id, "resuelto", { respuesta_taller: respuesta });
    notify("Solicitud marcada como resuelta", "success");
  }

  const abiertas = solicitudes.filter(s=>!["resuelto","cerrado","cancelado"].includes(String(s.estado||"pendiente")));
  const pendientes = solicitudes.filter(s=>String(s.estado||"pendiente")==="pendiente");
  const criticas = abiertas.filter(s=>s.urgencia==="critica");
  const ordenadas = [...solicitudes].sort((a,b)=>{
    const estadoA = String(a.estado||"pendiente")==="pendiente" ? 0 : String(a.estado)==="en_proceso" ? 1 : 2;
    const estadoB = String(b.estado||"pendiente")==="pendiente" ? 0 : String(b.estado)==="en_proceso" ? 1 : 2;
    if (estadoA !== estadoB) return estadoA - estadoB;
    if ((b.prioridad||0) !== (a.prioridad||0)) return (b.prioridad||0) - (a.prioridad||0);
    return new Date(b.fecha||b.updated_at||0) - new Date(a.fecha||a.updated_at||0);
  }).filter(s=>{
    const estado = String(s.estado||"pendiente");
    if (filtroEstado==="abiertas" && ["resuelto","cerrado","cancelado"].includes(estado)) return false;
    if (filtroEstado!=="todas" && filtroEstado!=="abiertas" && estado!==filtroEstado) return false;
    if (filtroUrgencia!=="todas" && s.urgencia!==filtroUrgencia) return false;
    return true;
  });

  return (
    <div style={{padding:"4px 0"}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:12,marginBottom:12,alignItems:"flex-start",flexWrap:"wrap"}}>
        <div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",fontSize:13}}>
            <span style={{fontWeight:800,color:pendientes.length?"#f59e0b":"var(--green)"}}>{pendientes.length} pendientes</span>
            <span style={{fontWeight:800,color:abiertas.length?"var(--accent)":"var(--text5)"}}>{abiertas.length} abiertas</span>
            {criticas.length>0 && <span style={{fontWeight:900,color:"#ef4444"}}>{criticas.length} criticas</span>}
          </div>
          <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>Las respuestas de taller se sincronizan con la app del chofer.</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <select value={filtroEstado} onChange={e=>setFiltroEstado(e.target.value)} style={{padding:"7px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontSize:12}}>
            <option value="abiertas">Abiertas</option>
            <option value="pendiente">Pendientes</option>
            <option value="en_proceso">En proceso</option>
            <option value="resuelto">Resueltas</option>
            <option value="todas">Todas</option>
          </select>
          <select value={filtroUrgencia} onChange={e=>setFiltroUrgencia(e.target.value)} style={{padding:"7px 10px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text3)",fontSize:12}}>
            <option value="todas">Todas las urgencias</option>
            <option value="critica">Critica</option>
            <option value="urgente">Urgente</option>
            <option value="normal">Normal</option>
          </select>
          <button onClick={cargar} style={{padding:"7px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text4)",fontSize:11,cursor:"pointer"}}>Actualizar</button>
        </div>
      </div>
      {solicitudes.length===0 && (
        <div style={{textAlign:"center",padding:32,color:"var(--text5)"}}>
          <div style={{fontSize:24,marginBottom:8}}>Taller</div>
          <div>Sin solicitudes de choferes</div>
          <div style={{fontSize:12,marginTop:4,color:"var(--text5)"}}>Las solicitudes desde la app del chofer apareceran aqui</div>
        </div>
      )}
      {ordenadas.map(s=>(
        <div key={s.id} id={`solicitud-taller-${s.id}`} style={{
          background:String(focus?.solicitud_id || "") === String(s.id) ? "rgba(34,211,160,.10)" : "var(--bg3)",
          border:`1px solid ${String(focus?.solicitud_id || "") === String(s.id) ? "rgba(34,211,160,.55)" : s.urgencia==="critica"?"rgba(239,68,68,.4)":s.urgencia==="urgente"?"rgba(245,158,11,.3)":"var(--border2)"}`,
          borderLeft:`4px solid ${String(focus?.solicitud_id || "") === String(s.id) ? "var(--green)" : coloresUrgencia[s.urgencia||"normal"]}`,
          borderRadius:8,
          padding:"10px 14px",
          marginBottom:8
        }}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,marginBottom:4}}>
            <span style={{fontWeight:800,fontSize:13,color:"var(--text)"}}>{s.motivo_label||s.motivo}</span>
            <span style={{fontSize:10,color:"var(--text5)"}}>{new Date(s.fecha).toLocaleDateString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}</span>
          </div>
          <div style={{fontSize:12,color:"var(--text4)",marginBottom:4}}>
            {s.chofer_nombre}{s.vehiculo&&` - ${s.vehiculo}`}{s.ubicacion&&` - ${s.ubicacion}`}
          </div>
          {s.observaciones&&<div style={{fontSize:12,color:"var(--text3)",fontStyle:"italic",marginBottom:6}}>"{s.observaciones}"</div>}
          {s.respuesta_taller&&<div style={{fontSize:12,color:"var(--green)",background:"rgba(16,185,129,.08)",border:"1px solid rgba(16,185,129,.18)",borderRadius:7,padding:"7px 9px",margin:"6px 0"}}>Respuesta taller: {s.respuesta_taller}</div>}
          {s.orden_trabajo_numero&&<div style={{fontSize:11,color:"var(--text5)",marginBottom:6}}>OT vinculada: {s.orden_trabajo_numero}</div>}
          {!["resuelto","cerrado","cancelado"].includes(String(s.estado||"pendiente"))
            ? <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
                {String(s.estado||"pendiente")==="pendiente" && <button onClick={()=>marcarEstado(s.id,"en_proceso")} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(245,158,11,.15)",color:"#f59e0b",fontSize:11,fontWeight:700,cursor:"pointer"}}>En proceso</button>}
                <button onClick={()=>resolverSolicitud(s)} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(16,185,129,.15)",color:"var(--green)",fontSize:11,fontWeight:700,cursor:"pointer"}}>Resolver</button>
                <button onClick={async ()=>{
                  const d=tallerLoad();
                  const vehiculoSolicitud = vehiculos.find(v =>
                    (s.vehiculo_id && v.id === s.vehiculo_id) ||
                    (s.vehiculo && String(v.matricula || "").trim().toUpperCase() === String(s.vehiculo || "").trim().toUpperCase())
                  );
                  const ot={id:`r_${Date.now()}`,fecha:new Date().toISOString().slice(0,10),tipo:s.motivo_label||"Reparacion",descripcion:`[CHOFER] ${s.motivo_label}${s.observaciones?": "+s.observaciones:""}`,vehiculo_id:"",vehiculo_matricula:s.vehiculo||"",km_en_intervencion:"",coste_mano_obra:"0",taller_externo:"",notas:`Urgencia: ${s.urgencia} | Chofer: ${s.chofer_nombre}`,piezas_usadas:[],coste_total:0};
                  ot.vehiculo_id = vehiculoSolicitud?.id || s.vehiculo_id || ot.vehiculo_id || "";
                  ot.vehiculo_matricula = vehiculoSolicitud?.matricula || s.vehiculo || ot.vehiculo_matricula || "";
                  ot.solicitud_id = s.id;
                  d.reparaciones=[ot,...(d.reparaciones||[])];
                  tallerSave(d);
                  await marcarEstado(s.id,"en_proceso", { orden_trabajo_id: ot.id, orden_trabajo_numero: ot.id, taller_notas: "OT creada desde solicitud de chofer" });
                  notify("OT creada en Intervenciones", "success");
                }} style={{padding:"3px 10px",borderRadius:6,border:"none",background:"rgba(59,130,246,.15)",color:"var(--accent)",fontSize:11,fontWeight:700,cursor:"pointer"}}>+ Crear OT</button>
              </div>
            : <span style={{fontSize:11,padding:"2px 8px",borderRadius:10,fontWeight:700,background:s.estado==="resuelto"?"rgba(16,185,129,.15)":"rgba(59,130,246,.15)",color:s.estado==="resuelto"?"var(--green)":"var(--accent)"}}>{s.estado}</span>
          }
          {Array.isArray(s.eventos) && s.eventos.length > 0 && (
            <div style={{marginTop:8}}>
              <button onClick={()=>setHistorialAbierto(prev=>({...prev,[s.id]:!prev[s.id]}))} style={{border:"none",background:"transparent",color:"var(--text5)",fontSize:11,fontWeight:800,cursor:"pointer",padding:0}}>
                {historialAbierto[s.id] ? "Ocultar historial" : `Ver historial (${s.eventos.length})`}
              </button>
              {historialAbierto[s.id] && (
                <div style={{marginTop:6,borderTop:"1px solid var(--border)",paddingTop:6}}>
                  {s.eventos.slice(-5).reverse().map((ev,idx)=>(
                    <div key={`${s.id}_ev_${idx}`} style={{fontSize:11,color:"var(--text5)",marginBottom:3}}>
                      {new Date(ev.fecha).toLocaleString("es-ES",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})} - {ev.tipo} - {ev.actor_nombre || "Sistema"}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


function LucroCesanteBanner({ vehiculos, lucroData, lucroTotal, onUpdate }) {
  const [expanded, setExpanded] = useState(false);
  const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2});
  const hoy = new Date().toISOString().slice(0,10);

  function setEntrada(vid, fecha) {
    const updated = { ...lucroData, [vid]: { ...(lucroData[vid]||{}), fecha_entrada: fecha }};
    onUpdate(updated);
  }
  function setMedia(vid, val) {
    const updated = { ...lucroData, [vid]: { ...(lucroData[vid]||{}), media_diaria: Number(val)||0 }};
    onUpdate(updated);
  }

  return (
    <div style={{background:"rgba(239,68,68,.07)",border:"1px solid rgba(239,68,68,.25)",borderRadius:10,padding:"10px 14px",marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>setExpanded(p=>!p)}>
        <span style={{fontSize:18}}></span>
        <div style={{flex:1}}>
          <span style={{fontWeight:800,color:"#ef4444",fontSize:13}}>{vehiculos.length} vehículo{vehiculos.length>1?"s":""} en taller</span>
          <span style={{fontSize:12,color:"var(--text3)",marginLeft:10}}>Lucro cesante estimado: <strong style={{color:"#ef4444"}}>{fmt2(lucroTotal)} EUR</strong></span>
        </div>
        <span style={{fontSize:11,color:"var(--text5)"}}>{expanded?"Ocultar Ocultar":"Ver Ver detalle"}</span>
      </div>
      {expanded && (
        <div style={{marginTop:12,display:"flex",flexDirection:"column",gap:8}}>
          {vehiculos.map(v=>{
            const d = lucroData[v.id]||{};
            const dias = d.fecha_entrada ? Math.max(0,Math.floor((new Date()-new Date(d.fecha_entrada))/(1000*3600*24))) : 0;
            const perdida = dias * (d.media_diaria||0);
            return (
              <div key={v.id} style={{background:"var(--bg2)",border:"1px solid rgba(239,68,68,.15)",borderRadius:8,padding:"10px 12px"}}>
                <div style={{fontWeight:800,fontSize:13,color:"var(--text)",marginBottom:8}}>{v.matricula} <span style={{fontSize:11,color:"var(--text5)",fontWeight:400}}>{v.marca} {v.modelo}</span></div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
                  <div>
                    <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Entrada taller</div>
                    <input type="date" value={d.fecha_entrada||hoy}
                      onChange={e=>setEntrada(v.id,e.target.value)}
                      style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"5px 8px",borderRadius:5,fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Media diaria (EUR/día)</div>
                    <input type="number" step="10" defaultValue={d.media_diaria||""}
                      key={v.id+"_media"}
                      onBlur={e=>setMedia(v.id,e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&setMedia(v.id,e.target.value)}
                      placeholder="Ej: 450"
                      style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"5px 8px",borderRadius:5,fontSize:12,outline:"none",width:"100%",boxSizing:"border-box"}}/>
                  </div>
                  <div>
                    <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",marginBottom:3}}>Lucro cesante</div>
                    <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color:"#ef4444",padding:"4px 0"}}>
                      {fmt2(perdida)} EUR
                      <div style={{fontSize:10,color:"var(--text5)",fontWeight:400}}>{dias} día{dias!==1?"s":""} en taller</div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <div style={{fontSize:11,color:"var(--text5)",padding:"4px 0"}}>
            La media diaria se calcula automáticamente si añades el historial de facturación del vehículo. Si no, introdúcela manualmente.
          </div>
        </div>
      )}
    </div>
  );
}

function readTallerFocus() {
  return readRuntimeFocus("tms_taller_focus");
}

export default function Taller() {
  const [focusTaller] = useState(() => readTallerFocus());
  const [tab,       setTab]       = useState(() => {
    const focus = readTallerFocus();
    if (focus?.pieza_id || focus?.type === "stock_bajo") return "stock";
    if (focus?.solicitud_id || focus?.type === "solicitud_taller") return "solicitudes";
    return "reparaciones";
  });
  const [vehiculos, setVehiculos] = useState([]);
  const [pedidos, setPedidos] = useState([]);
  const [taller,    setTaller]    = useState(tallerLoad);
  const [modalRep,  setModalRep]  = useState(false);
  const [modalPieza,setModalPieza]= useState(false);
  const [editRep,   setEditRep]   = useState(null);
  const [editPieza, setEditPieza] = useState(null);
  const [unidadesPieza, setUnidadesPieza] = useState(null);
  const [filtroVh,  setFiltroVh]  = useState("");
  const [q,         setQ]         = useState("");
  const [stockQ,    setStockQ]    = useState("");
  const [proveedores, setProveedores] = useState([]);
  const [avisosMant,  setAvisosMant]  = useState([]);
  const [tareasMecanicos, setTareasMecanicos] = useState([]);
  const [solicitudesTaller, setSolicitudesTaller] = useState([]);
  const [modalProv,   setModalProv]   = useState(false);
  const [editProv,    setEditProv]    = useState(null);
  const [modalAviso,  setModalAviso]  = useState(false);
  const [editAviso,   setEditAviso]   = useState(null);

  const [alertasDoc, setAlertasDoc] = useState([]);
  const [solicitudesPendientes, setSolicitudesPendientes] = useState(0);
  const [lucroData,    setLucroData]    = useState({});
  const [lucroArchivo, setLucroArchivo] = useState([]);
  const [neumaticosStockShared, setNeumaticosStockShared] = useState([]);
  const [neumaticosVehiculosShared, setNeumaticosVehiculosShared] = useState({});
  const sincronizarSolicitudesTaller = useCallback((rows = []) => {
    const solicitudes = Array.isArray(rows) ? rows : [];
    setSolicitudesTaller(solicitudes);
    setSolicitudesPendientes(solicitudes.filter(s => String(s.estado || "pendiente") === "pendiente").length);
  }, []);
  const persistirEstadoCompartidoTaller = useCallback(async (patch) => {
    const current = {
      stock: taller.stock || [],
      reparaciones: taller.reparaciones || [],
      historial_vh: taller.historial_vh && typeof taller.historial_vh === "object" ? taller.historial_vh : {},
      proveedores,
      avisos_mant: avisosMant,
      tareas_mecanicos: tareasMecanicos,
      neumaticos_stock: neumaticosStockShared,
      neumaticos_vehiculos: neumaticosVehiculosShared,
      lucro_cesante: lucroData,
      lucro_cesante_archivo: lucroArchivo,
      solicitudes_mecanico: solicitudesTaller,
      entregas_equipos_choferes: tallerSnapshot(taller).entregas_equipos_choferes || {},
    };
    const next = {
      ...current,
      ...(typeof patch === "function" ? patch(current) : (patch || {})),
    };
    applyTallerEstado(next);
    setTaller(tallerLoad());
    setProveedores(Array.isArray(next.proveedores) ? next.proveedores : []);
    setAvisosMant(Array.isArray(next.avisos_mant) ? next.avisos_mant : []);
    setTareasMecanicos(Array.isArray(next.tareas_mecanicos) ? next.tareas_mecanicos : []);
    setNeumaticosStockShared(Array.isArray(next.neumaticos_stock) ? next.neumaticos_stock : []);
    setNeumaticosVehiculosShared(next.neumaticos_vehiculos && typeof next.neumaticos_vehiculos === "object" ? next.neumaticos_vehiculos : {});
    setLucroData(next.lucro_cesante || {});
    setLucroArchivo(Array.isArray(next.lucro_cesante_archivo) ? next.lucro_cesante_archivo : []);
    sincronizarSolicitudesTaller(next.solicitudes_mecanico || []);
    try {
      await guardarTallerEstado(next);
      clearLegacyTallerStorage();
    } catch (e) {
      notify("Se ha guardado localmente, pero no se pudo sincronizar con la base de datos: " + e.message, "warning");
    }
    return next;
  }, [taller, proveedores, avisosMant, tareasMecanicos, neumaticosStockShared, neumaticosVehiculosShared, lucroData, lucroArchivo, solicitudesTaller, sincronizarSolicitudesTaller]);
  const cargarNormalizadoTaller = useCallback(async function cargarNormalizadoTaller() {
    try {
      const [piezas, intervenciones] = await Promise.all([
        getTallerPiezas().catch(() => []),
        getTallerIntervenciones().catch(() => []),
      ]);
      const d = tallerLoad();
      let changed = false;
      if (Array.isArray(piezas)) {
        d.stock = piezas.map(piezaApiToLocal);
        changed = true;
      }
      if (Array.isArray(intervenciones)) {
        d.reparaciones = intervenciones.map(intervencionApiToLocal);
        changed = true;
      }
      if (changed) {
        setTallerLegacyMirror(d);
        setTaller(d);
      }
    } catch {}
  }, []);

  const cargarSolicitudesTaller = useCallback(async (silencioso = true) => {
    try {
      const rows = await getTallerSolicitudes();
      sincronizarSolicitudesTaller(rows);
      return Array.isArray(rows) ? rows : [];
    } catch (e) {
      if (!silencioso) notify("No se pudieron cargar las solicitudes de taller", "warning");
      return [];
    }
  }, [sincronizarSolicitudesTaller]);

  const cargarEstadoCompartidoTaller = useCallback(async () => {
    try {
      const data = await getTallerEstado();
      if (data && typeof data === "object") {
        applyTallerEstado(data);
        setTaller({
          stock: data.stock || [],
          reparaciones: data.reparaciones || [],
          historial_vh: data.historial_vh && typeof data.historial_vh === "object" ? data.historial_vh : {},
        });
        setProveedores(Array.isArray(data?.proveedores) ? data.proveedores : []);
        setAvisosMant(Array.isArray(data?.avisos_mant) ? data.avisos_mant : []);
        setTareasMecanicos(Array.isArray(data?.tareas_mecanicos) ? data.tareas_mecanicos : []);
        setNeumaticosStockShared(Array.isArray(data?.neumaticos_stock) ? data.neumaticos_stock : []);
        setNeumaticosVehiculosShared(data?.neumaticos_vehiculos && typeof data.neumaticos_vehiculos === "object" ? data.neumaticos_vehiculos : {});
        setLucroData(data?.lucro_cesante || {});
        setLucroArchivo(Array.isArray(data?.lucro_cesante_archivo) ? data.lucro_cesante_archivo : []);
        sincronizarSolicitudesTaller(Array.isArray(data?.solicitudes_mecanico) ? data.solicitudes_mecanico : []);
      } else if (hasTallerData(tallerSnapshot())) {
        pushTallerEstado();
      }
    } catch {}
  }, [sincronizarSolicitudesTaller]);

  const guardarProveedores = useCallback((rows) => {
    const next = Array.isArray(rows) ? rows : [];
    persistirEstadoCompartidoTaller({ proveedores: next });
  }, [persistirEstadoCompartidoTaller]);

  const guardarTareasMecanicos = useCallback((rows) => {
    const next = Array.isArray(rows) ? rows : [];
    persistirEstadoCompartidoTaller({ tareas_mecanicos: next });
  }, [persistirEstadoCompartidoTaller]);

  const guardarAvisosMantenimiento = useCallback((rows) => {
    const next = Array.isArray(rows) ? rows : [];
    persistirEstadoCompartidoTaller({ avisos_mant: next });
  }, [persistirEstadoCompartidoTaller]);

  const borrarAvisoMantenimiento = useCallback((id) => {
    guardarAvisosMantenimiento(avisosMant.filter(x => x.id !== id));
  }, [avisosMant, guardarAvisosMantenimiento]);

  useEffect(() => {
    getVehiculos().then(v=>{ setVehiculos(Array.isArray(v)?v:[]); }).catch(()=>{});
    getPedidos().then(p=>{ setPedidos(Array.isArray(p)?p:[]); }).catch(()=>{});
    getAlertasDocVehiculos().then(a=>setAlertasDoc(Array.isArray(a)?a:[])).catch(()=>{});
    cargarSolicitudesTaller();
    cargarEstadoCompartidoTaller();
    cargarNormalizadoTaller();
  }, [cargarEstadoCompartidoTaller, cargarNormalizadoTaller, cargarSolicitudesTaller]);

  useEffect(() => {
    const onFocus = () => { cargarSolicitudesTaller(); cargarEstadoCompartidoTaller(); };
    const onSync = () => cargarSolicitudesTaller();
    const pollId = window.setInterval(() => cargarSolicitudesTaller(), 15000);
    const sharedStatePollId = window.setInterval(() => cargarEstadoCompartidoTaller(), 45000);
    window.addEventListener("focus", onFocus);
    window.addEventListener("taller:solicitudes-sync", onSync);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.clearInterval(pollId);
      window.clearInterval(sharedStatePollId);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("taller:solicitudes-sync", onSync);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [cargarEstadoCompartidoTaller, cargarSolicitudesTaller]);

  function recargar() {
    setModalRep(false);
    setModalPieza(false);
    setEditRep(null);
    setEditPieza(null);
    cargarNormalizadoTaller();
  }
  function recargarProv() { setModalProv(false); setEditProv(null); }
  function recargarAvisos() { setModalAviso(false); setEditAviso(null); }

  async function cerrarIntervencion(r) {
    const ok = await confirmDialog({
      title: "Cerrar intervencion",
      message: "Cerrar esta intervencion de forma definitiva?",
      confirmText: "Cerrar",
    });
    if (!ok) return;
    const d = tallerLoad();
    d.reparaciones = (d.reparaciones || []).map(x => x.id === r.id ? {...x, estado:"cerrada", cierre_definitivo_at:new Date().toISOString()} : x);
    tallerSave(d);
    setTaller(d);
    if (!String(r.id).startsWith("r_")) {
      try {
        await cerrarTallerIntervencion(r.id);
        await cargarNormalizadoTaller();
      } catch (e) {
        notify(e.message, "error");
      }
    }
  }

  const reps = useMemo(() => taller.reparaciones.filter(r=>{
    if (filtroVh && r.vehiculo_id!==filtroVh) return false;
    if (q && !`${r.tipo} ${r.descripcion} ${r.vehiculo_matricula}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha)), [taller.reparaciones, filtroVh, q]);

  const stockBajo  = useMemo(() => taller.stock.filter(s=>(s.stock_actual||0)<=(s.stock_minimo||0)), [taller.stock]);
  const stockTotalUnidades = useMemo(() => (taller.stock || []).reduce((s,p)=>s+Number(p.stock_actual || 0),0), [taller.stock]);
  const stockFiltrado = useMemo(() => {
    const term = stockQ.trim().toLowerCase();
    if (!term) return taller.stock || [];
    return (taller.stock || []).filter(p => `${p.nombre || ""} ${p.referencia || ""} ${p.codigo_barras || ""} ${p.categoria || ""} ${p.proveedor || ""}`.toLowerCase().includes(term));
  }, [taller.stock, stockQ]);
  const gastoTaller = useMemo(() => resumenGastoTaller(taller.reparaciones || []), [taller.reparaciones]);
  const costoMes   = gastoTaller.mes;
  const costoTotal = gastoTaller.total;

  useEffect(() => {
    if (!focusTaller?.pieza_id || tab !== "stock" || !taller.stock.length) return;
    const found = taller.stock.find(p => String(p.id) === String(focusTaller.pieza_id));
    if (!found) return;
    const t = window.setTimeout(() => {
      document.getElementById(`pieza-stock-${focusTaller.pieza_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_taller_focus");
    }, 180);
    return () => window.clearTimeout(t);
  }, [focusTaller, tab, taller.stock]);

  //  Lucro cesante 
  const vehiculosEnTaller = vehiculos.filter(v=>v.estado==="taller"||v.estado==="averia"||v.estado==="en_taller");
  function autoMediaDiaria(vid) {
    const pedVeh=pedidos.filter(p=>p.vehiculo_id===vid&&p.estado!=="cancelado");
    if(!pedVeh.length) return 0;
    return Math.round(pedVeh.reduce((s,p)=>s+Number(p.importe||0),0)/90*10)/10;
  }
  function updateLucro(d) {
    const salidos=Object.entries(d).filter(([vid])=>!vehiculosEnTaller.find(v=>v.id===vid));
    if(salidos.length>0){
      const today=new Date().toISOString().slice(0,10);
      const newArch=salidos.map(([vid,data])=>{
        const veh=vehiculos.find(v=>v.id===vid);
        const dias=data.fecha_entrada?Math.max(0,Math.floor((new Date()-new Date(data.fecha_entrada))/(1000*3600*24))):0;
        const media=data.media_diaria||autoMediaDiaria(vid);
        return{vid,matricula:veh?.matricula||vid,fecha_entrada:data.fecha_entrada,fecha_salida:today,dias,media_diaria:media,total:dias*media};
      });
      const updArch=[...lucroArchivo.filter(a=>!salidos.find(([vid])=>vid===a.vid)),...newArch];
      d=Object.fromEntries(Object.entries(d).filter(([vid])=>vehiculosEnTaller.find(v=>v.id===vid)));
      persistirEstadoCompartidoTaller({
        lucro_cesante: d,
        lucro_cesante_archivo: updArch,
      });
      return;
    }
    persistirEstadoCompartidoTaller({
      lucro_cesante: d,
      lucro_cesante_archivo: lucroArchivo,
    });
  }
  const lucroTotal = vehiculosEnTaller.reduce((sum, v) => {
    const entrada=lucroData[v.id]?.fecha_entrada; if(!entrada) return sum;
    const dias=Math.max(0,Math.floor((new Date()-new Date(entrada))/(1000*3600*24)));
    const media=lucroData[v.id]?.media_diaria||autoMediaDiaria(v.id);
    return sum+(dias*media);
  }, 0);

  return (
    <div style={S.page}>
      <div style={S.title}>Taller</div>
      <div style={S.sub}>Intervenciones, reparaciones y stock de piezas y repuestos</div>

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:18,marginBottom:28}}>
        {[
          {l:"Total intervenciones",  v:taller.reparaciones.length, c:"#0f2a6b", icon:"tool", bg:"#dcfce7"},
          {l:"Coste este mes",        v:`${fmt2(costoMes)} EUR`,       c:"#0f766e", icon:"money", bg:"#d1fae5", title:`Mano de obra: ${fmt2(gastoTaller.manoObra)} EUR - Piezas: ${fmt2(gastoTaller.piezas)} EUR`},
          ...(vehiculosEnTaller.length>0?[{l:`Lucro cesante (${vehiculosEnTaller.length} veh.)`,v:`${fmt2(lucroTotal)} EUR`,c:"#ef4444",title:"Ingresos perdidos por vehículos en taller"}]:[]),
          {l:"Piezas en stock",       v:stockTotalUnidades,          c:"#7c3aed", icon:"cube", bg:"#ede9fe"},
          {l:"Stock bajo minimo",     v:stockBajo.length,             c:stockBajo.length>0?"#2563eb":"#0f766e", icon:"layers", bg:"#dbeafe"},
          ...(()=>{
            const cnt = {};
            taller.reparaciones.forEach(r=>{ if(r.vehiculo_matricula) cnt[r.vehiculo_matricula]=(cnt[r.vehiculo_matricula]||0)+1; });
            const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
            return top ? [{l:"Más intervenciones", v:`${top[0]} (${top[1]}x)`, c:"#f59e0b"}] : [];
          })(),
        ].map((k,i)=>(
          <div key={i} title={k.title || ""} style={{background:"rgba(255,255,255,.95)",border:"1px solid #dbe5ec",borderRadius:12,padding:"26px 28px",display:"flex",alignItems:"center",gap:20,minHeight:102,boxShadow:"0 16px 34px rgba(15,23,42,.06)"}}>
            <div style={{width:54,height:54,borderRadius:"50%",display:"grid",placeItems:"center",background:k.bg || `${k.c}14`,color:k.c,flexShrink:0}}>
              <TallerIcon name={k.icon || "tool"} color={k.c} size={27} />
            </div>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:28,fontWeight:900,color:k.c,lineHeight:1}}>{k.v}</div>
              <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"#64748b",marginTop:10}}>{k.l}</div>
            </div>
          </div>
        ))}
      </div>

      {solicitudesPendientes > 0 && (
        <div style={{background:"rgba(245,158,11,.12)",border:"1px solid rgba(245,158,11,.25)",borderRadius:10,padding:"10px 14px",marginBottom:14,color:"#f59e0b",fontSize:13,fontWeight:800}}>
          {solicitudesPendientes} solicitud{solicitudesPendientes>1?"es":""} de chofer pendiente{solicitudesPendientes>1?"s":""} de revisar
        </div>
      )}

      {/* Tabs */}
      <div style={{display:"flex",gap:20,borderBottom:"1px solid #dbe5ec",marginBottom:16,overflowX:"auto"}}>
        {[["reparaciones","Intervenciones"],[`stock`,`Stock${stockBajo.length>0?` (${stockBajo.length} bajo minimo)`:""}`],["trazabilidad","Trazabilidad piezas"],["neumaticos","Neumaticos"],["proveedores","Talleres / Proveedores"],["avisos_mant","Avisos mantenimiento"],["solicitudes","Solicitudes choferes"],["tareas","Tareas mecanicos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)} style={{...S.tab,borderBottomColor:tab===id?"#0f766e":"transparent",color:tab===id?"#0f766e":"#64748b",padding:"12px 0",fontSize:14,fontWeight:900,whiteSpace:"nowrap"}}>{l}</button>
        ))}
      </div>

      {/*  Intervenciones  */}
      {tab==="reparaciones" && <>
        {vehiculosEnTaller.length>0&&<LucroCesanteBanner vehiculos={vehiculosEnTaller} lucroData={lucroData} lucroTotal={lucroTotal} onUpdate={(d)=>{
          updateLucro(d);
        }}/>}
        <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>{setEditRep(null);setModalRep(true);}}>+ Nueva intervencion</button>
          <select value={filtroVh} onChange={e=>setFiltroVh(e.target.value)} style={{...S.sel,width:200}}>
            <option value="">Todos los vehículos</option>
            {vehiculos.map(v=><option key={v.id} value={v.id}>{v.matricula} - {v.marca} {v.modelo}</option>)}
          </select>
          <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar..." style={{...S.inp,width:180}}/>
          <span style={{marginLeft:"auto",fontSize:12,color:"var(--text5)"}}>Coste total: <strong style={{color:"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(costoTotal)} EUR</strong></span>
        </div>
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Fecha","Vehículo","Tipo","Descripción","Km","Piezas","Coste",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {reps.length===0 ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin intervenciones registradas</td></tr>
              : reps.map(r=>(
                <tr key={r.id}>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{new Date(r.fecha).toLocaleDateString("es-ES")}</td>
                  <td style={{...S.td,fontWeight:600,color:"var(--text)"}}>{r.vehiculo_matricula||"-"}</td>
                  <td style={S.td}><span style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:"rgba(59,130,246,.12)",color:"var(--accent-xl)",fontWeight:600}}>{r.tipo}</span></td>
                  <td style={{...S.td,maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontSize:12}}>{r.descripcion}</td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{r.km_en_intervencion?`${Number(r.km_en_intervencion).toLocaleString("es-ES")}km`:"-"}</td>
                  <td style={{...S.td,fontSize:11,color:"var(--text3)",minWidth:120}}>
                    <div style={{fontWeight:800,color:"var(--text)"}}>{r.piezas_usadas?.length||0} uds</div>
                    {(r.piezas_usadas || []).slice(0,2).map((p,i)=>(
                      <div key={`${p.unidad_id || p.codigo_unidad || p.codigo_barras || i}`} style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:"var(--text5)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:150}}>
                        {p.codigo_unidad || p.codigo_barras || p.referencia || p.pieza_id}
                      </div>
                    ))}
                    {(r.piezas_usadas || []).length > 2 && <div style={{fontSize:10,color:"var(--text5)"}}>+{(r.piezas_usadas || []).length - 2} mas</div>}
                  </td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--green)"}}>{fmt2(r.coste_total)} EUR</td>
                  <td style={{...S.td,fontSize:11}}>
                    {r.factura_proveedor_num
                      ? <div>
                          <div style={{fontWeight:700,color:"var(--accent)",fontFamily:"monospace"}}>{r.factura_proveedor_num}</div>
                          <div style={{color:"var(--text5)"}}>{r.factura_proveedor_nombre}</div>
                          {r.factura_proveedor_importe&&<div style={{color:"var(--green)",fontWeight:700}}>{fmt2(r.factura_proveedor_importe)} EUR</div>}
                        </div>
                      : <span style={{color:"var(--text5)"}}>-</span>}
                  </td>
                  <td style={S.td}>
                    <div style={{display:"flex",gap:5}}>
                      {r.estado !== "cerrada" && (
                        <button style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",padding:"3px 8px",fontSize:11,border:"1px solid rgba(16,185,129,.25)"}} onClick={()=>cerrarIntervencion(r)}>Cerrar</button>
                      )}
                      <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",padding:"3px 8px",fontSize:11,border:"1px solid #1e2d45"}} onClick={()=>{setEditRep(r);setModalRep(true);}}>Editar</button>
                      <button
                        style={{...S.btn,background:"transparent",color:"#ef4444",border:"none",padding:"3px 8px",fontSize:11}}
                        onClick={async()=>{
                          if (!(await confirmDialog({title:"Eliminar reparacion",message:"Eliminar esta reparacion?",confirmText:"Eliminar",tone:"danger"}))) return;
                          const d = tallerLoad();
                          d.reparaciones = d.reparaciones.filter(x => x.id !== r.id);
                          tallerSave(d);
                          setTaller({ ...d });
                          try {
                            if (!String(r.id || "").startsWith("r_")) {
                              await borrarTallerIntervencion(r.id);
                            }
                            await cargarNormalizadoTaller();
                            notify("Intervencion eliminada.", "success");
                          } catch (e) {
                            notify(e.message || "La intervencion se ha quitado en local, pero no se pudo sincronizar el borrado.", "warning");
                          } finally {
                            recargar();
                          }
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {/*  Stock  */}
      {tab==="stock" && <>
        <StockUnidadesPanel vehiculos={vehiculos} onAssigned={recargar} />
        <div style={{fontSize:11,color:"var(--text5)",marginBottom:8}}>
          En stock, la cifra trazable indica unidades individuales disponibles / unidades generadas.
        </div>
        <div style={{display:"flex",gap:10,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>{setEditPieza(null);setModalPieza(true);}}>+ Añadir pieza</button>
          <input value={stockQ} onChange={e=>setStockQ(e.target.value)} placeholder="Buscar pieza, referencia, proveedor..." style={{...S.inp,width:280}}/>
          {stockBajo.length>0 && <div style={{padding:"6px 12px",background:"rgba(249,115,22,.1)",border:"1px solid rgba(249,115,22,.25)",borderRadius:7,fontSize:12,color:"#f97316",fontWeight:600}}>! {stockBajo.length} pieza{stockBajo.length!==1?"s":""} bajo minimo</div>}
          <span style={{marginLeft:"auto",fontSize:12,color:"var(--text5)"}}>{stockFiltrado.length} de {(taller.stock || []).length} referencias</span>
        </div>
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Nombre","Ref.","Categoría","Stock","Mínimo","EUR/u","Proveedor",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {stockFiltrado.length===0 ? <tr><td colSpan={8} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin piezas en stock</td></tr>
              : stockFiltrado.map(p=>{
                const bajo=(p.stock_actual||0)<=(p.stock_minimo||0);
                return (
                  <tr key={p.id} id={`pieza-stock-${p.id}`} style={{
                    background:String(focusTaller?.pieza_id || "") === String(p.id) ? "rgba(34,211,160,.10)" : bajo?"rgba(249,115,22,.04)":undefined,
                    boxShadow:String(focusTaller?.pieza_id || "") === String(p.id) ? "inset 3px 0 0 var(--green)" : undefined,
                  }}>
                    <td style={{...S.td,fontWeight:600,color:"var(--text)"}}>{p.nombre}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text5)"}}>{p.referencia||"-"}</td>
                    <td style={{...S.td,fontSize:11,color:"var(--text3)"}}>{p.categoria}</td>
                    <td style={S.td}>
                      <div><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:bajo?"#f97316":"var(--green)"}}>{p.stock_actual}</span>{bajo&&<span style={{fontSize:10,color:"#f97316",marginLeft:4}}>!</span>}</div>
                      <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                        Trazables <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:p.unidades_stock?"var(--green)":"#f59e0b"}}>{p.unidades_stock || 0}</span> / {p.unidades_total || 0}
                      </div>
                    </td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{p.stock_minimo}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",color:"var(--text)"}}>{fmt2(p.precio_unitario)} EUR</td>
                    <td style={{...S.td,fontSize:12,color:"var(--text3)"}}>{p.proveedor||"-"}</td>
                    <td style={S.td}>
                      <div style={{display:"flex",gap:5}}>
                        <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",padding:"3px 8px",fontSize:11,border:"1px solid #1e2d45"}} onClick={()=>{setEditPieza(p);setModalPieza(true);}}>Editar</button>
                        <button style={{...S.btn,background:"rgba(16,185,129,.1)",color:"var(--green)",padding:"3px 8px",fontSize:11,border:"1px solid rgba(16,185,129,.25)"}} onClick={()=>printPiezaEtiqueta(p)}>Etiqueta</button>
                        <button style={{...S.btn,background:"rgba(59,130,246,.1)",color:"var(--accent-xl)",padding:"3px 8px",fontSize:11,border:"1px solid rgba(59,130,246,.25)"}} onClick={()=>setUnidadesPieza(p)}>Unidades</button>
                        <button
                          style={{...S.btn,background:"transparent",color:"#ef4444",border:"none",padding:"3px 8px",fontSize:11}}
                          onClick={async()=>{
                            if (!(await confirmDialog({title:"Eliminar pieza",message:"Eliminar esta pieza?",confirmText:"Eliminar",tone:"danger"}))) return;
                            const d = tallerLoad();
                            d.stock = d.stock.filter(x => x.id !== p.id);
                            tallerSave(d);
                            setTaller({ ...d });
                            try {
                              if (isDbId(p.id)) {
                                await borrarTallerPieza(p.id);
                              }
                              await cargarNormalizadoTaller();
                              notify("Pieza eliminada del stock.", "success");
                            } catch (e) {
                              notify(e.message || "La pieza se ha quitado en local, pero no se pudo sincronizar el borrado.", "warning");
                            } finally {
                              recargar();
                            }
                          }}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </>}

      {tab==="trazabilidad" && (
        <HistorialPiezasVehiculoTab vehiculos={vehiculos} onReload={recargar} />
      )}

      {/*  Talleres / Proveedores  */}
      
      {/*  Neumaticos  */}
      {tab==="neumaticos" && (
        <NeumaticosTab
          vehiculos={vehiculos}
          reparaciones={taller.reparaciones||[]}
          neumaticosStock={neumaticosStockShared}
          neumaticosVehiculos={neumaticosVehiculosShared}
          onPersistNeumaticos={(patch) => persistirEstadoCompartidoTaller(patch)}
        />
      )}


      {tab==="proveedores" && <>
        <div style={{display:"flex",gap:10,marginBottom:14}}>
          <button style={{...S.btn,background:"var(--accent)",color:"#fff"}} onClick={()=>{setEditProv(null);setModalProv(true);}}>+ Nuevo proveedor / taller</button>
        </div>
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>{["Nombre","CIF","Direccion","Teléfono","Email","Especialidad",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
            <tbody>
              {proveedores.length===0 ? <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Sin proveedores / talleres registrados</td></tr>
              : proveedores.map(p=>(
                <tr key={p.id}>
                  <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{p.nombre}</td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11}}>{p.cif||"-"}</td>
                  <td style={{...S.td,fontSize:11,color:"var(--text3)"}}>{p.direccion||"-"}{p.cp?"  -  "+p.cp:""}{p.poblacion?" "+p.poblacion:""}</td>
                  <td style={{...S.td,fontSize:12}}>{p.telefono||"-"}</td>
                  <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{p.email||"-"}</td>
                  <td style={{...S.td,fontSize:11}}><span style={{background:"rgba(99,102,241,.1)",color:"#818cf8",padding:"2px 8px",borderRadius:4,fontWeight:600}}>{p.especialidad||"General"}</span></td>
                  <td style={S.td}>
                    <div style={{display:"flex",gap:5}}>
                      <button style={{...S.btn,background:"var(--bg3)",color:"var(--text2)",padding:"3px 8px",fontSize:11,border:"1px solid #1e2d45"}} onClick={()=>{setEditProv(p);setModalProv(true);}}>Editar</button>
                      <button style={{...S.btn,background:"transparent",color:"#ef4444",border:"none",padding:"3px 8px",fontSize:11}} onClick={async()=>{if(await confirmDialog({title:"Eliminar proveedor",message:"Eliminar este proveedor?",confirmText:"Eliminar",tone:"danger"})){ const d=proveedores.filter(x=>x.id!==p.id);guardarProveedores(d);recargarProv();}}}>Eliminar</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {/*  Avisos de mantenimiento  */}
      {tab==="solicitudes" && <SolicitudesChoferesProfesionalTab vehiculos={vehiculos} focus={focusTaller} solicitudes={solicitudesTaller} onSolicitudesChange={sincronizarSolicitudesTaller}/>}
      {tab==="tareas" && <TareasMecanicos vehiculos={vehiculos} tareas={tareasMecanicos} onChange={guardarTareasMecanicos}/>}
      {tab==="avisos_mant" && <AvisosTab vehiculos={vehiculos} reparaciones={taller.reparaciones} avisosMant={avisosMant} alertasDoc={alertasDoc} neumaticosVehiculos={neumaticosVehiculosShared} onReloadAvisos={recargarAvisos} onEditAviso={(a)=>{setEditAviso(a);setModalAviso(true);}} onNuevoAviso={()=>{setEditAviso(null);setModalAviso(true);}} onDeleteAviso={borrarAvisoMantenimiento} onKmUpdate={(vid,km)=>actualizarKmVehiculo(vid,km).then(()=>getVehiculos().then(v=>setVehiculos(Array.isArray(v)?v:[]))).catch(e=>notify(e.message, "error"))}/>}

      {modalRep   && <ModalIntervencion vehiculos={vehiculos} editando={editRep}   onClose={()=>{setModalRep(false);setEditRep(null);}}   onSaved={recargar}/>}
      {modalPieza && <ModalPieza                              editando={editPieza} onClose={()=>{setModalPieza(false);setEditPieza(null);}} onSaved={recargar}/>}
      {unidadesPieza && <UnidadesPiezaModal pieza={unidadesPieza} onClose={()=>setUnidadesPieza(null)} />}

      {/* Modal Proveedor */}
      {modalProv && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&recargarProv()}>
          <div style={{...S.mbox,width:"min(600px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>{editProv?"Editar proveedor/taller":"Nuevo proveedor / taller"}</div>
            <ModalProveedorForm editando={editProv} proveedores={proveedores} onSaved={guardarProveedores} onClose={recargarProv}/>
          </div>
        </div>
      )}

      {/* Modal Aviso mantenimiento */}
      {modalAviso && (
        <div style={S.modal} onClick={e=>e.target===e.currentTarget&&recargarAvisos()}>
          <div style={{...S.mbox,width:"min(520px,96vw)"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:18}}>{editAviso?"Editar aviso":"Nuevo aviso de mantenimiento"}</div>
            <ModalAvisoForm editando={editAviso} tipos={TIPOS_INT} avisosMant={avisosMant} onSaved={guardarAvisosMantenimiento} onClose={recargarAvisos}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------
// TAREAS MECÁNICOS con cronómetro
// ------------------------------------------------------------------

function saveTareas(d){ tareasSave(d); }

function TareasMecanicos({ vehiculos, tareas = [], onChange }) {
  const [modal,     setModal]    = useState(false);
  const [form,      setForm]     = useState({});
  const [ahora,     setAhora]    = useState(Date.now());
  const [filtroEstado, setFiltroEstado] = useState("activas");
  const [busqueda, setBusqueda] = useState("");

  // Tick each second to update cronómetros
  useEffect(()=>{
    const t = setInterval(()=>setAhora(Date.now()), 1000);
    return ()=>clearInterval(t);
  },[]);

  const MECANICOS = ["Juan Garcia","Pedro Lopez","Carlos Martin","Alberto Ruiz","Otro"];
  const TIPOS_TAREA = ["Mantenimiento preventivo","Cambio neumaticos","Reparacion frenos","Reparacion motor","Revision electrica","Revision hidraulica","ITV / Documentacion","Otro"];
  const PRIORIDAD_C = {alta:"#ef4444", media:"#f59e0b", baja:"#10b981"};

  function fmtTiempo(ms) {
    const s = Math.floor(ms/1000);
    const h = Math.floor(s/3600);
    const m = Math.floor((s%3600)/60);
    const sec = s%60;
    return h>0 ? `${h}h ${m.toString().padStart(2,'0')}m` : `${m}:${sec.toString().padStart(2,'0')}`;
  }

  function crearTarea() {
    if (!form.descripcion||!form.mecanico||!form.vehiculo_id) { notify("Descripcion, mecanico y vehiculo son obligatorios", "warning"); return; }
    const t = { id:`tarea_${Date.now()}`, ...form, estado:"pendiente", ts_creada:Date.now(), ts_inicio:null, ts_fin:null, duracion_ms:0 };
    const updated = [t, ...tareas];
    if (typeof onChange === "function") onChange(updated);
    else saveTareas(updated);
    setModal(false); setForm({prioridad:"media"});
  }

  function iniciar(id) {
    const updated = tareas.map(t => t.id===id ? {...t, estado:"en_curso", ts_inicio:Date.now()} : t);
    if (typeof onChange === "function") onChange(updated);
    else saveTareas(updated);
  }

  function pausar(id) {
    const updated = tareas.map(t => {
      if (t.id!==id) return t;
      const elapsed = t.ts_inicio ? Date.now()-t.ts_inicio : 0;
      return {...t, estado:"pausada", ts_inicio:null, duracion_ms:(t.duracion_ms||0)+elapsed};
    });
    if (typeof onChange === "function") onChange(updated);
    else saveTareas(updated);
  }

  function finalizar(id) {
    const updated = tareas.map(t => {
      if (t.id!==id) return t;
      const elapsed = t.ts_inicio ? Date.now()-t.ts_inicio : 0;
      const total = (t.duracion_ms||0)+elapsed;
      return {...t, estado:"completada", ts_fin:Date.now(), ts_inicio:null, duracion_ms:total};
    });
    if (typeof onChange === "function") onChange(updated);
    else saveTareas(updated);
  }

  async function eliminar(id) {
    const ok = await confirmDialog({
      title: "Eliminar tarea",
      message: "Eliminar tarea?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    const updated = tareas.filter(t=>t.id!==id);
    if (typeof onChange === "function") onChange(updated);
    else saveTareas(updated);
  }

  function getTiempoActual(t) {
    if (t.estado==="en_curso" && t.ts_inicio) return (t.duracion_ms||0)+(ahora-t.ts_inicio);
    return t.duracion_ms||0;
  }

  const activas = tareas.filter(t=>t.estado!=="completada");
  const completadas = tareas.filter(t=>t.estado==="completada");
  const tareasAtascadas = activas.filter(t => {
    const tiempo = getTiempoActual(t);
    const edad = Date.now() - Number(t.ts_creada || Date.now());
    return tiempo > 2 * 60 * 60 * 1000 || (t.prioridad === "alta" && edad > 24 * 60 * 60 * 1000);
  });
  const textoFiltro = busqueda.trim().toLowerCase();
  const tareasVisibles = (filtroEstado === "completadas" ? completadas : filtroEstado === "atascadas" ? tareasAtascadas : activas)
    .filter(t => {
      if (!textoFiltro) return true;
      const veh = vehiculos?.find(v=>v.id===t.vehiculo_id);
      return [t.descripcion, t.mecanico, t.tipo_tarea, t.notas, veh?.matricula, veh?.marca]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(textoFiltro);
    });

  // KPIs
  const tiempoTotalHoy = completadas
    .filter(t=>t.ts_fin&&new Date(t.ts_fin).toDateString()===new Date().toDateString())
    .reduce((s,t)=>s+(t.duracion_ms||0),0);

  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",marginBottom:3,marginTop:8};

  return (
    <div>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[
          ["Tareas activas", activas.filter(t=>t.estado==="en_curso").length, "var(--accent)"],
          ["Pendientes", activas.filter(t=>t.estado==="pendiente").length, "#f59e0b"],
          ["Completadas hoy", completadas.filter(t=>t.ts_fin&&new Date(t.ts_fin).toDateString()===new Date().toDateString()).length, "var(--green)"],
          ["Tiempo hoy", fmtTiempo(tiempoTotalHoy), "var(--text)"],
        ].map(([l,v,col])=>(
          <div key={l} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,padding:"10px 14px",textAlign:"center"}}>
            <div style={{fontWeight:800,fontSize:18,color:col}}>{v}</div>
            <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase",marginTop:2}}>{l}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:13,color:"var(--text)"}}>Tareas activas ({activas.length})</div>
        <button onClick={()=>{setModal(true);setForm({prioridad:"media",fecha:new Date().toISOString().slice(0,10)});}}
          style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
          + Nueva tarea
        </button>
      </div>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:12}}>
        {[
          ["activas", `Activas ${activas.length}`],
          ["atascadas", `Atascadas ${tareasAtascadas.length}`],
          ["completadas", `Completadas ${completadas.length}`],
        ].map(([id,label]) => (
          <button key={id} onClick={()=>setFiltroEstado(id)} style={{
            padding:"6px 10px",
            borderRadius:7,
            border:`1px solid ${filtroEstado===id ? "var(--accent)" : "var(--border2)"}`,
            background:filtroEstado===id ? "var(--accent)" : "var(--bg2)",
            color:filtroEstado===id ? "#fff" : "var(--text3)",
            fontSize:12,
            fontWeight:800,
            cursor:"pointer",
          }}>{label}</button>
        ))}
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar tarea, mecanico o matricula..." style={{...inp,flex:"1 1 240px",maxWidth:360}}/>
      </div>
      {tareasAtascadas.length > 0 && filtroEstado !== "atascadas" && (
        <div style={{marginBottom:12,padding:"10px 12px",borderRadius:8,border:"1px solid rgba(239,68,68,.25)",background:"rgba(239,68,68,.08)",display:"flex",justifyContent:"space-between",gap:10,alignItems:"center"}}>
          <div>
            <div style={{fontWeight:800,color:"#ef4444",fontSize:13}}>Hay tareas atascadas</div>
            <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>Trabajos en curso de mas de 2 horas o prioridad alta pendientes de mas de 24 horas.</div>
          </div>
          <button onClick={()=>setFiltroEstado("atascadas")} style={{padding:"6px 10px",borderRadius:7,border:"1px solid rgba(239,68,68,.35)",background:"rgba(239,68,68,.12)",color:"#ef4444",fontSize:12,fontWeight:800,cursor:"pointer"}}>Ver atascadas</button>
        </div>
      )}

      {/* Tareas activas */}
      {tareasVisibles.length===0 && (
        <div style={{textAlign:"center",padding:32,color:"var(--text5)",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:10,marginBottom:12}}>
          <div style={{fontSize:28,marginBottom:6}}></div>
          <div>Sin tareas para este filtro</div>
        </div>
      )}
      {tareasVisibles.map(t=>{
        const veh = vehiculos?.find(v=>v.id===t.vehiculo_id);
        const tiempo = getTiempoActual(t);
        const atascada = tareasAtascadas.some(x => x.id === t.id);
        return (
          <div key={t.id} style={{background:"var(--bg2)",border:`1px solid ${t.estado==="en_curso"?"rgba(59,130,246,.4)":"var(--border2)"}`,borderLeft:`4px solid ${PRIORIDAD_C[t.prioridad||"media"]}`,borderRadius:8,padding:"12px 14px",marginBottom:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"start",marginBottom:6}}>
              <div>
                <div style={{fontWeight:800,fontSize:14,color:"var(--text)"}}>{t.descripcion}</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:2}}>
                  {t.mecanico} - {veh?.matricula||t.vehiculo_id}
                  {t.tipo_tarea&&<span style={{marginLeft:8}}>- {t.tipo_tarea}</span>}
                  {atascada&&<span style={{marginLeft:8,color:"#ef4444",fontWeight:800}}>Atascada</span>}
                </div>
              </div>
              <div style={{textAlign:"right",flexShrink:0,marginLeft:8}}>
                <div style={{fontFamily:"monospace",fontSize:20,fontWeight:900,
                  color:t.estado==="en_curso"?"var(--accent)":"var(--text4)"}}>
                  {fmtTiempo(tiempo)}
                </div>
                <div style={{fontSize:10,color:"var(--text5)",textTransform:"uppercase"}}>
                  {t.estado==="en_curso"?"En curso":t.estado==="pausada"?"Pausada":"Pendiente"}
                </div>
              </div>
            </div>
            {t.notas&&<div style={{fontSize:12,color:"var(--text4)",fontStyle:"italic",marginBottom:8}}>"{t.notas}"</div>}
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              {t.estado==="pendiente"&&(
                <button onClick={()=>iniciar(t.id)} style={{padding:"4px 12px",borderRadius:6,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Iniciar</button>
              )}
              {t.estado==="en_curso"&&(
                <button onClick={()=>pausar(t.id)} style={{padding:"4px 12px",borderRadius:6,border:"none",background:"rgba(245,158,11,.15)",color:"#f59e0b",fontSize:12,fontWeight:700,cursor:"pointer"}}>Pausar</button>
              )}
              {t.estado==="pausada"&&(
                <button onClick={()=>iniciar(t.id)} style={{padding:"4px 12px",borderRadius:6,border:"none",background:"var(--accent)",color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>Reanudar</button>
              )}
              {(t.estado==="en_curso"||t.estado==="pausada")&&(
                <button onClick={()=>finalizar(t.id)} style={{padding:"4px 12px",borderRadius:6,border:"none",background:"rgba(16,185,129,.15)",color:"var(--green)",fontSize:12,fontWeight:700,cursor:"pointer"}}>Finalizar</button>
              )}
              <button onClick={()=>eliminar(t.id)} style={{padding:"4px 10px",borderRadius:6,border:"none",background:"transparent",color:"var(--text5)",fontSize:12,cursor:"pointer"}}>Eliminar</button>
            </div>
          </div>
        );
      })}

      {/* KPIs por mecánico */}
      {completadas.length>0&&(
        <div style={{marginTop:16,marginBottom:16}}>
          <div style={{fontWeight:700,fontSize:12,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Rendimiento por mecanico</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:8}}>
            {(() => {
              const mecanicos = {};
              [...activas,...completadas].forEach(t=>{
                if(!t.mecanico) return;
                if(!mecanicos[t.mecanico]) mecanicos[t.mecanico]={nombre:t.mecanico,completadas:0,activas:0,tiempoTotal:0,tiempos:[]};
                if(t.estado==="completada"){ mecanicos[t.mecanico].completadas++; mecanicos[t.mecanico].tiempoTotal+=(t.duracion_ms||0); mecanicos[t.mecanico].tiempos.push(t.duracion_ms||0); }
                else mecanicos[t.mecanico].activas++;
              });
              return Object.values(mecanicos).sort((a,b)=>b.completadas-a.completadas).map(m=>{
                const promedio = m.tiempos.length ? m.tiempoTotal/m.tiempos.length : 0;
                return (
                  <div key={m.nombre} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,padding:"10px 12px"}}>
                    <div style={{fontWeight:700,fontSize:13,color:"var(--text)",marginBottom:6}}>Mecanico · {m.nombre}</div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:4,fontSize:11}}>
                      <div style={{color:"var(--text5)"}}>Completadas</div><div style={{fontWeight:700,color:"var(--green)"}}>{m.completadas}</div>
                      <div style={{color:"var(--text5)"}}>En curso</div><div style={{fontWeight:700,color:"var(--accent)"}}>{m.activas}</div>
                      <div style={{color:"var(--text5)"}}>T. total</div><div style={{fontWeight:700,color:"var(--text)"}}>{fmtTiempo(m.tiempoTotal)}</div>
                      <div style={{color:"var(--text5)"}}>T. medio</div><div style={{fontWeight:700,color:promedio>7200000?"#ef4444":promedio>3600000?"#f59e0b":"var(--green)"}}>{fmtTiempo(promedio)}</div>
                    </div>
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {/* Historial completadas */}
      {completadas.length>0&&(
        <div style={{marginTop:16}}>
          <div style={{fontWeight:700,fontSize:12,color:"var(--text5)",textTransform:"uppercase",marginBottom:8}}>Completadas ({completadas.length})</div>
          {completadas.slice(0,5).map(t=>{
            const veh = vehiculos?.find(v=>v.id===t.vehiculo_id);
            return (
              <div key={t.id} style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:8,padding:"8px 12px",marginBottom:6,opacity:0.75,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontWeight:600,fontSize:13,color:"var(--text)"}}>{t.descripcion}</div>
                  <div style={{fontSize:11,color:"var(--text5)"}}>{t.mecanico} · {veh?.matricula||"-"} · {t.ts_fin?new Date(t.ts_fin).toLocaleDateString("es-ES"):""}</div>
                </div>
                <div style={{fontFamily:"monospace",fontWeight:700,color:"var(--green)",fontSize:14}}>{fmtTiempo(t.duracion_ms||0)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal nueva tarea */}
      {modal&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setModal(false)}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,padding:22,width:"min(480px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:14}}>Nueva tarea de mecanico</div>

            <div><label style={lbl}>Descripcion *</label>
              <input style={inp} value={form.descripcion||""} onChange={e=>setForm(p=>({...p,descripcion:e.target.value}))} placeholder="Ej: Cambio de neumaticos delanteros"/></div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div><label style={lbl}>Mecanico asignado *</label>
                <select style={inp} value={form.mecanico||""} onChange={e=>setForm(p=>({...p,mecanico:e.target.value}))}>
                  <option value="">Seleccionar...</option>
                  {MECANICOS.map(m=><option key={m} value={m}>{m}</option>)}
                </select></div>

              <div><label style={lbl}>Vehiculo *</label>
                <select style={inp} value={form.vehiculo_id||""} onChange={e=>setForm(p=>({...p,vehiculo_id:e.target.value}))}>
                  <option value="">Seleccionar...</option>
                  {vehiculos?.filter(v=>v.activo).map(v=><option key={v.id} value={v.id}>{v.matricula} - {v.marca}</option>)}
                </select></div>

              <div><label style={lbl}>Tipo de tarea</label>
                <select style={inp} value={form.tipo_tarea||""} onChange={e=>setForm(p=>({...p,tipo_tarea:e.target.value}))}>
                  <option value="">Seleccionar...</option>
                  {TIPOS_TAREA.map(t=><option key={t} value={t}>{t}</option>)}
                </select></div>

              <div><label style={lbl}>Prioridad</label>
                <select style={inp} value={form.prioridad||"media"} onChange={e=>setForm(p=>({...p,prioridad:e.target.value}))}>
                  <option value="alta">Alta</option>
                  <option value="media">Media</option>
                  <option value="baja">Baja</option>
                </select></div>
            </div>

            <div><label style={lbl}>Notas / instrucciones</label>
              <textarea style={{...inp,resize:"none"}} rows={2} value={form.notas||""} onChange={e=>setForm(p=>({...p,notas:e.target.value}))} placeholder="Instrucciones adicionales para el mecanico..."/></div>

            <div style={{display:"flex",gap:8,marginTop:14,justifyContent:"flex-end"}}>
              <button onClick={()=>setModal(false)} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontSize:13,cursor:"pointer"}}>Cancelar</button>
              <button onClick={crearTarea} style={{padding:"7px 16px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>Crear tarea</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


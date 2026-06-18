import { useState, useEffect, useCallback, useMemo } from "react";
import { getVehiculos, crearVehiculo, editarVehiculo, eliminarVehiculo, reactivarVehiculo, cambiarEstadoVehiculo, getPedidos, asignarRemolque, getChoferes, actualizarKmVehiculo, getGpsProviders, getGpsStatus, vincularGpsVehiculo, vincularGpsVehiculosBulk, actualizarPosicionVehiculo, sincronizarGpsVehiculos, getPosicionesVehiculo, getVehiculoEventos, getDocsVehiculo, crearDocVehiculo, borrarDocVehiculo } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { confirmDialog, notify } from "../services/notify";
import { clearRuntimeFocus, readRuntimeFocus } from "../services/runtimeFocus";

// Compatibilidad legacy: si un navegador aun conserva campos extendidos viejos en local,
// se leen como fallback visual, pero ya no se escriben ahi.
// Compute daily average invoiced (last 90 days)
function mediaFacturacionDiaria(vehiculoId, facturas, pedidos){
  const hace90 = new Date(); hace90.setDate(hace90.getDate()-90);
  const pedVeh = pedidos.filter(p=>p.vehiculo_id===vehiculoId&&new Date(p.fecha_carga||p.fecha_pedido||0)>=hace90&&p.estado!=="cancelado");
  const total  = pedVeh.reduce((s,p)=>s+Number(p.importe||0),0);
  return total / 90;
}
const EC = { disponible:"var(--green)", en_ruta:"var(--accent-l)", taller:"#f97316", baja:"var(--red)", inactivo:"var(--text4)" };

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = ev => resolve(String(ev.target?.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer el archivo."));
    reader.readAsDataURL(file);
  });
}

function inferVehiculoDocTipo(nombre = "") {
  const n = String(nombre || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (n.includes("itv")) return "itv";
  if (n.includes("seguro") || n.includes("poliza")) return "seguro";
  if (n.includes("tacografo")) return "tacografo";
  if (n.includes("transporte")) return "tarjeta_transporte";
  if (n.includes("circulacion") || n.includes("permiso")) return "permiso_circulacion";
  return "otro";
}

const S = {
  page:  { flex:1, padding:"30px 36px", fontFamily:"'DM Sans',sans-serif", background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)", minHeight:"100vh" },
  title: { fontFamily:"'Syne',sans-serif", fontSize:30, fontWeight:900, color:"#0f172a", marginBottom:6, letterSpacing:"-.02em" },
  btn:   { padding:"10px 15px", borderRadius:8, border:"1px solid var(--border2)", fontSize:13, fontWeight:800, cursor:"pointer", fontFamily:"'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:7, boxShadow:"0 8px 18px rgba(15,23,42,.04)" },
  inp:   { background:"#fff", border:"1px solid #cfdbe5", color:"#0f172a", padding:"11px 13px", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box", boxShadow:"0 6px 14px rgba(15,23,42,.03)" },
  sel:   { background:"#fff", border:"1px solid #cfdbe5", color:"#0f172a", padding:"11px 13px", borderRadius:8, fontFamily:"'DM Sans',sans-serif", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box", boxShadow:"0 6px 14px rgba(15,23,42,.03)" },
  lbl:   { display:"block", fontSize:10, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text4)", marginBottom:4, marginTop:10 },
  modal: { position:"fixed", inset:0, background:"rgba(0,0,0,.8)", zIndex:100, display:"flex", alignItems:"center", justifyContent:"center", padding:12 },
  sec:   { fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:12, color:"var(--text3)", marginTop:20, marginBottom:8, paddingBottom:6, borderBottom:"1px solid var(--border)" },
  grid2: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:"0px 12px" },
  grid3: { display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"0px 12px" },
  badge: { display:"inline-flex", alignItems:"center", padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:800 },
};

function UiIcon({ name = "truck", color = "currentColor", size = 22 }) {
  const common = { fill:"none", stroke:color, strokeWidth:2, strokeLinecap:"round", strokeLinejoin:"round" };
  const icons = {
    pin: (
      <>
        <path {...common} d="M12 21s7-6.1 7-12a7 7 0 1 0-14 0c0 5.9 7 12 7 12Z" />
        <circle {...common} cx="12" cy="9" r="2.5" />
      </>
    ),
    truck: (
      <>
        <path {...common} d="M3 7h11v9H3z" />
        <path {...common} d="M14 10h4l3 3v3h-7z" />
        <circle {...common} cx="7" cy="18" r="2" />
        <circle {...common} cx="17" cy="18" r="2" />
      </>
    ),
    link: (
      <>
        <path {...common} d="M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1.1 1.1" />
        <path {...common} d="M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1.1-1.1" />
      </>
    ),
    clock: (
      <>
        <circle {...common} cx="12" cy="12" r="8" />
        <path {...common} d="M12 8v5l3 2" />
      </>
    ),
    signal: (
      <>
        <path {...common} d="M4 14a8 8 0 0 1 16 0" />
        <path {...common} d="M8 14a4 4 0 0 1 8 0" />
        <circle {...common} cx="12" cy="17" r="1" />
      </>
    ),
    signalOff: (
      <>
        <path {...common} d="M4 4l16 16" />
        <path {...common} d="M4 14a8 8 0 0 1 8-8" />
        <path {...common} d="M17 11a8 8 0 0 1 3 3" />
        <path {...common} d="M8 14a4 4 0 0 1 4-4" />
      </>
    ),
    database: (
      <>
        <ellipse {...common} cx="12" cy="5" rx="7" ry="3" />
        <path {...common} d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
        <path {...common} d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
      </>
    ),
    warning: (
      <>
        <path {...common} d="M12 3 2.8 19h18.4L12 3Z" />
        <path {...common} d="M12 9v4" />
        <path {...common} d="M12 17h.01" />
      </>
    ),
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">{icons[name] || icons.truck}</svg>;
}

const CLASES_VEHICULO = [
  "Tractora", "Camion rigido", "Furgon", "Furgoneta",
  "Remolque - Tautliner (lona)", "Remolque - Banera (volcador)", "Remolque - Cisterna",
  "Remolque - Lateral bajo (lowboy)", "Remolque - Frigorifico", "Remolque - Portacoches",
  "Semirremolque", "Dolly / Balleston", "Otro",
];

const TIPO_COMBUSTIBLE = ["Diesel","AdBlue/Diesel","GNL (Gas Natural)","GNC","Electrico","Hibrido","Gasolina"];

const GPS_PROVIDER_LABELS = {
  locatel: "Locatel",
  tacogest: "Tacogest",
  movildata: "Movildata",
  gps_generic: "GPS generico",
  manual: "Manual",
  ultima_descarga: "Ultima descarga",
  app_chofer: "App chofer",
};

function esVehiculoConGpsHabitual(v, todos = []) {
  const clase = String(v?.clase || v?.tipo || "").toLowerCase();
  const mat = String(v?.matricula || "").toUpperCase();
  const remolquesAsignados = new Set((todos || []).map(x => x?.remolque_id).filter(Boolean).map(String));
  return !clase.includes("remolque") &&
    !clase.includes("semirremolque") &&
    !clase.includes("dolly") &&
    !mat.startsWith("R-") &&
    !mat.endsWith("-R") &&
    !remolquesAsignados.has(String(v?.id || ""));
}

function fmt2(n) { return Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2}); }

function readGpsFocus() {
  return readRuntimeFocus("tms_vehiculos_gps_focus");
}

function readVehiculosFocus() {
  return readRuntimeFocus("tms_vehiculos_focus");
}

function mergeVehiculoState(rows = [], updated) {
  if (!updated?.id) return Array.isArray(rows) ? rows : [];
  const current = Array.isArray(rows) ? rows : [];
  return current.map(v => String(v.id) === String(updated.id) ? { ...v, ...updated } : v);
}

function GpsMappingPanel({ vehiculos, providers, status, canEdit, syncing, syncProvider, onSync, onReload }) {
  const [focusGps, setFocusGps] = useState(() => readGpsFocus());
  const [open, setOpen] = useState(() => Boolean(readGpsFocus()));
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [drafts, setDrafts] = useState({});
  const [savingId, setSavingId] = useState("");
  const [savingBulk, setSavingBulk] = useState(false);
  const gpsProviders = (providers || []).filter(p => p.id !== "manual");
  const vehiculosGps = useMemo(() => (vehiculos || []).filter(v => esVehiculoConGpsHabitual(v, vehiculos)), [vehiculos]);
  const activeProvider = syncProvider || status?.active_provider || gpsProviders.find(p => p.active)?.id || gpsProviders.find(p => p.configured)?.id || "";
  const mapped = vehiculosGps.filter(v => v.gps_provider && v.gps_provider !== "manual" && v.gps_external_id).length;
  const pendientes = vehiculosGps.filter(v => v.activo !== false && (!v.gps_provider || v.gps_provider === "manual" || !v.gps_external_id)).length;
  const dirtyLinks = vehiculosGps
    .map(v => ({ v, draft: drafts[v.id] || {} }))
    .filter(({ v, draft }) => {
      const currentProvider = v.gps_provider && v.gps_provider !== "manual" ? v.gps_provider : "";
      const nextProvider = activeProvider || "";
      const currentExternal = String(v.gps_external_id || "").trim();
      const nextExternal = String(draft.external_id || "").trim();
      return nextProvider && (currentProvider !== nextProvider || currentExternal !== nextExternal);
    });

  useEffect(() => {
      const defaultProvider = activeProvider || "gps_generic";
    const next = {};
    vehiculosGps.forEach(v => {
      next[v.id] = {
        provider: v.gps_provider && v.gps_provider !== "manual" ? v.gps_provider : defaultProvider,
        external_id: v.gps_external_id || "",
      };
    });
    setDrafts(next);
  }, [vehiculosGps, activeProvider]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const focus = readGpsFocus();
    if (!focus?.vehiculo_id) return;
    setFocusGps(focus);
    setOpen(true);
    const t = setTimeout(() => {
      document.getElementById(`gps-link-${focus.vehiculo_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_vehiculos_gps_focus");
    }, 220);
    return () => clearTimeout(t);
  }, [vehiculos.length]);

  async function guardar(v) {
    const draft = drafts[v.id] || {};
    const provider = activeProvider || "";
    if (!provider) {
      notify("Configura primero un proveedor GPS activo en SuperAdmin.", "error");
      return;
    }
    const externalId = String(draft.external_id || "").trim();
    if (!externalId) {
      notify("Introduce el IMEI/ID GPS antes de intentar localizar senal.", "warning");
      return;
    }
    setSavingId(v.id);
    try {
      await vincularGpsVehiculo(v.id, {
        provider,
        external_id: externalId,
      });
      notify(`GPS enlazado para ${v.matricula}.`, "success");
      onReload();
    } catch (e) {
      notify(e.message || "No se pudo guardar el enlace GPS.", "error");
    } finally {
      setSavingId("");
    }
  }

  async function guardarCambios() {
    if (!dirtyLinks.length) {
      notify("No hay cambios GPS pendientes.", "info");
      return;
    }
    const duplicated = new Set();
    const seen = new Map();
    dirtyLinks.forEach(({ draft }) => {
      const key = `${activeProvider}:${String(draft.external_id || "").trim().toUpperCase()}`;
      if (!String(draft.external_id || "").trim()) return;
      if (seen.has(key)) duplicated.add(draft.external_id);
      seen.set(key, true);
    });
    if (duplicated.size) {
      notify(`Hay IDs GPS repetidos: ${Array.from(duplicated).join(", ")}`, "error");
      return;
    }
    setSavingBulk(true);
    try {
      const linksWithId = dirtyLinks.filter(({ draft }) => String(draft.external_id || "").trim());
      if (!linksWithId.length) {
        notify("Introduce al menos un IMEI/ID GPS antes de guardar.", "warning");
        return;
      }
      const payload = linksWithId.map(({ v, draft }) => ({
        vehiculo_id: v.id,
        provider: activeProvider,
        external_id: String(draft.external_id || "").trim(),
      }));
      const res = await vincularGpsVehiculosBulk(payload);
      notify(`${res.updated || payload.length} enlace(s) GPS guardados.`, "success");
      onReload();
    } catch (e) {
      notify(e.message || "No se pudieron guardar los enlaces GPS.", "error");
    } finally {
      setSavingBulk(false);
    }
  }

  function usarMatriculasComoId() {
    const provider = activeProvider || "gps_generic";
    setDrafts(prev => {
      const next = { ...prev };
      vehiculosGps.forEach(v => {
        next[v.id] = { ...(next[v.id] || {}), provider, external_id: v.matricula || "" };
      });
      return next;
    });
    notify("Matriculas preparadas como ID GPS. Revisa y pulsa Guardar cambios.", "success");
  }

  function aplicarImportacion() {
    const byMat = new Map(vehiculosGps.map(v => [String(v.matricula || "").trim().toUpperCase(), v]));
    const provider = activeProvider || "gps_generic";
    let applied = 0;
    let ignored = 0;
    const next = { ...drafts };
    importText.split(/\r?\n/).forEach(line => {
      const clean = line.trim();
      if (!clean) return;
      const parts = clean.split(/[;\t,]/).map(p => p.trim()).filter(Boolean);
      if (parts.length < 2) { ignored += 1; return; }
      const veh = byMat.get(parts[0].toUpperCase());
      if (!veh) { ignored += 1; return; }
      next[veh.id] = { ...(next[veh.id] || {}), provider, external_id: parts[1] };
      applied += 1;
    });
    setDrafts(next);
    setImportOpen(false);
    notify(`Importacion aplicada: ${applied} enlace(s). Ignorados: ${ignored}.`, applied ? "success" : "warning");
  }

  const chip = (label, value, tone, icon) => (
    <div style={{background:"rgba(255,255,255,.94)",border:"1px solid #dbe5ec",borderRadius:9,padding:"15px 18px",display:"flex",alignItems:"center",gap:14,minHeight:62,boxShadow:"0 12px 26px rgba(15,23,42,.04)"}}>
      <div style={{width:42,height:42,borderRadius:10,display:"grid",placeItems:"center",background:`${tone || "#0f766e"}14`,color:tone || "#0f766e",flexShrink:0}}>
        <UiIcon name={icon} color={tone || "#0f766e"} size={23} />
      </div>
      <div>
        <div style={{fontSize:10,color:"#64748b",fontWeight:900,textTransform:"uppercase",letterSpacing:".07em"}}>{label}</div>
        <div style={{fontSize:21,color:tone||"#0f172a",fontWeight:900,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.1}}>{value}</div>
      </div>
    </div>
  );

  return (
    <div style={{background:"rgba(255,255,255,.96)",border:"1px solid #dbe5ec",borderRadius:12,padding:"24px 26px",marginBottom:18,boxShadow:"0 18px 42px rgba(15,23,42,.06)"}}>
      <div style={{display:"flex",gap:18,alignItems:"flex-start",justifyContent:"space-between",flexWrap:"wrap",marginBottom:18}}>
        <div style={{display:"flex",gap:16,alignItems:"flex-start"}}>
          <div style={{width:50,height:50,borderRadius:12,display:"grid",placeItems:"center",background:"linear-gradient(135deg,#0f766e,#0d9488)",color:"#fff",boxShadow:"0 14px 28px rgba(15,118,110,.22)"}}>
            <UiIcon name="pin" color="#fff" size={26} />
          </div>
          <div>
            <div style={{fontSize:30,fontWeight:900,color:"#0f172a",fontFamily:"'Syne',sans-serif",letterSpacing:"-.02em"}}>GPS y matrículas</div>
            <div style={{fontSize:14,color:"#64748b",marginTop:5,maxWidth:880,lineHeight:1.45}}>
              Asocia cada vehículo con el ID que usa el proveedor GPS activo. Normalmente será la matrícula, pero algunos proveedores usan un código interno.
            </div>
          </div>
        </div>
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <div style={{...S.sel,width:250,display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"default",fontWeight:800}}>
              <span>{GPS_PROVIDER_LABELS[activeProvider] || activeProvider || "Sin proveedor activo"}</span>
            </div>
            {canEdit && (
              <button onClick={onSync} disabled={syncing || !activeProvider} style={{...S.btn,background:"#fff",color:"#334155",border:"1px solid #cfdbe5"}}>
              {syncing ? "Sincronizando..." : "Sincronizar GPS"}
              </button>
            )}
          {canEdit && (
            <button onClick={guardarCambios} disabled={savingBulk || !dirtyLinks.length} style={{...S.btn,background:dirtyLinks.length?"rgba(16,185,129,.14)":"rgba(15,118,110,.08)",color:dirtyLinks.length?"#059669":"#8bb8b1",border:"1px solid rgba(15,118,110,.18)"}}>
              {savingBulk ? "Guardando..." : `Guardar cambios${dirtyLinks.length ? ` (${dirtyLinks.length})` : ""}`}
            </button>
          )}
          {canEdit && (
            <button onClick={usarMatriculasComoId} style={{...S.btn,background:"#fff",color:"#0f172a",border:"1px solid #cfdbe5"}}>
              Usar matriculas
            </button>
          )}
          {canEdit && (
            <button onClick={()=>setImportOpen(o=>!o)} style={{...S.btn,background:"#fff",color:"#0f172a",border:"1px solid #cfdbe5"}}>
              Pegar listado
            </button>
          )}
          <button onClick={()=>setOpen(o=>!o)} style={{...S.btn,background:"linear-gradient(135deg,#0f766e,#0d9488)",color:"#fff",border:"1px solid #0f766e"}}>
            {open ? "Cerrar enlaces" : "Gestionar enlaces"}
          </button>
        </div>
      </div>

      {importOpen && (
        <div style={{marginTop:12,background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:12}}>
          <div style={{fontSize:12,fontWeight:800,color:"var(--text)",marginBottom:5}}>Pegar listado de enlaces GPS</div>
          <div style={{fontSize:11,color:"var(--text4)",lineHeight:1.5,marginBottom:8}}>
            Formato por linea: <strong>matricula;ID GPS</strong>. Tambien acepta coma o tabulador.
          </div>
          <textarea
            value={importText}
            onChange={e=>setImportText(e.target.value)}
            placeholder={"1234ABC;LOC-99881\n5678DEF;LOC-99882"}
            style={{...S.inp,minHeight:110,resize:"vertical",fontFamily:"'JetBrains Mono',monospace"}}
          />
          <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
            <button onClick={()=>setImportOpen(false)} style={{...S.btn,background:"transparent",color:"var(--text4)",border:"1px solid var(--border2)"}}>Cancelar</button>
            <button onClick={aplicarImportacion} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Aplicar listado</button>
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(185px,1fr))",gap:12,marginTop:12}}>
        {chip("Vehiculos", status?.counts?.activos ?? vehiculos.length, "#475569", "truck")}
        {chip("Enlazados", status?.counts?.enlazados ?? mapped, "#10b981", "link")}
        {chip("Pendientes", status?.counts?.pendientes ?? pendientes, (status?.counts?.pendientes ?? pendientes) ? "#0f766e" : "#10b981", "clock")}
        {chip("Senal reciente", status?.counts?.senal_reciente ?? 0, (status?.counts?.senal_reciente ?? 0) ? "#0f766e" : "#64748b", "signal")}
        {chip("Sin senal", status?.counts?.sin_senal_reciente ?? 0, (status?.counts?.sin_senal_reciente ?? 0) ? "#ef4444" : "#10b981", "signalOff")}
        {chip("Nunca recibida", status?.counts?.nunca_senal ?? 0, (status?.counts?.nunca_senal ?? 0) ? "#f97316" : "#10b981", "signalOff")}
        {chip("Proveedor activo", GPS_PROVIDER_LABELS[activeProvider] || activeProvider || "Sin elegir", "#0f766e", "database")}
      </div>

      {(status?.last_position || status?.webhook) && (
        <div style={{marginTop:10,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
          {status?.last_position && (
            <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 11px"}}>
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Ultima posicion recibida</div>
              <div style={{fontSize:12,color:"var(--text)",fontWeight:800,marginTop:4}}>
                {status.last_position.matricula || status.last_position.vehiculo_id} - {status.last_position.ubicacion || "Sin texto"}
              </div>
              <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                {status.last_position.recorded_at ? new Date(status.last_position.recorded_at).toLocaleString("es-ES") : "Sin fecha"} - {GPS_PROVIDER_LABELS[status.last_position.provider] || status.last_position.provider}
              </div>
            </div>
          )}
          {status?.webhook && (
            <div style={{background:"rgba(20,184,166,.08)",border:"1px solid rgba(20,184,166,.24)",borderRadius:8,padding:"9px 11px"}}>
              <div style={{fontSize:10,color:"#34d399",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Webhook GPS</div>
              <div style={{fontSize:12,color:"var(--text)",fontWeight:800,marginTop:4}}>
                {status.webhook.activo ? "Activo" : "Inactivo"} - {status.webhook.token_mask || "sin token"}
              </div>
              <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                Ultimo uso: {status.webhook.last_used_at ? new Date(status.webhook.last_used_at).toLocaleString("es-ES") : "todavia sin uso"}
              </div>
            </div>
          )}
        </div>
      )}

      {status?.warnings?.length > 0 && (
        <div style={{marginTop:16,background:"linear-gradient(90deg,rgba(251,146,60,.10),rgba(255,247,237,.72))",border:"1px solid rgba(251,146,60,.35)",borderRadius:10,padding:"18px 20px",display:"grid",gridTemplateColumns:"minmax(260px,.65fr) minmax(320px,1fr)",gap:22,alignItems:"start"}}>
          <div style={{display:"flex",gap:14,alignItems:"flex-start"}}>
            <div style={{width:42,height:42,borderRadius:10,display:"grid",placeItems:"center",background:"rgba(251,146,60,.12)",color:"#f97316",flexShrink:0}}>
              <UiIcon name="warning" color="#f97316" size={24} />
            </div>
            <div>
              <div style={{fontSize:14,fontWeight:900,color:"#ea580c",marginBottom:8}}>Diagnostico GPS</div>
              {status.warnings.map((w, i) => <div key={i} style={{fontSize:13,color:"#475569",lineHeight:1.5}}>{w}</div>)}
            </div>
          </div>
          {status?.signal_help && (
            <div style={{borderLeft:"1px solid rgba(251,146,60,.28)",paddingLeft:20}}>
              <div style={{fontSize:13,color:"#1e293b",fontWeight:900,lineHeight:1.45,marginBottom:7}}>
                {status.signal_help.meaning}
              </div>
              {(status.signal_help.likely_causes || []).slice(0, 4).map((cause, i) => (
                <div key={i} style={{fontSize:13,color:"#475569",lineHeight:1.5}}>
                  - {cause}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {status?.stale_vehicles?.length > 0 && (
        <div style={{marginTop:12,background:"linear-gradient(90deg,rgba(239,68,68,.08),rgba(254,242,242,.80))",border:"1px solid rgba(239,68,68,.24)",borderRadius:10,padding:"18px 20px",display:"grid",gridTemplateColumns:"auto 1fr auto",gap:16,alignItems:"center"}}>
          <div style={{width:42,height:42,borderRadius:10,display:"grid",placeItems:"center",background:"rgba(239,68,68,.10)",color:"#ef4444"}}>
            <UiIcon name="signalOff" color="#ef4444" size={24} />
          </div>
          <div>
            <div style={{fontSize:14,fontWeight:900,color:"#dc2626",marginBottom:8}}>Vehículos sin señal reciente</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"2px 26px"}}>
              {status.stale_vehicles.slice(0, 6).map(v => (
                <div key={v.id} style={{fontSize:12,color:"#475569",lineHeight:1.5}}>
                  - {v.matricula} - {GPS_PROVIDER_LABELS[v.gps_provider] || v.gps_provider} / {v.gps_external_id}
                  {v.ubicacion_ts ? ` - ultima senal ${new Date(v.ubicacion_ts).toLocaleString("es-ES")}` : " - sin senal recibida"}
                </div>
              ))}
            </div>
          </div>
          <button type="button" onClick={()=>setOpen(true)} style={{...S.btn,background:"#fff",color:"#334155",border:"1px solid #cfdbe5",boxShadow:"none",whiteSpace:"nowrap"}}>
            Ver todos ({status.stale_vehicles.length})
          </button>
        </div>
      )}

      {status?.duplicates?.length > 0 && (
        <div style={{marginTop:10,background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.28)",borderRadius:8,padding:"9px 11px"}}>
          <div style={{fontSize:11,fontWeight:900,color:"var(--red)",marginBottom:4}}>IDs GPS duplicados</div>
          {status.duplicates.slice(0, 4).map((d, i) => (
            <div key={i} style={{fontSize:11,color:"var(--text3)",lineHeight:1.45}}>
              {GPS_PROVIDER_LABELS[d.gps_provider] || d.gps_provider}: {d.gps_external_id} en {Array.isArray(d.matriculas) ? d.matriculas.join(", ") : d.total + " vehiculos"}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div style={{marginTop:14,borderTop:"1px solid var(--border)",paddingTop:12,display:"flex",flexDirection:"column",gap:8}}>
          {vehiculosGps.map(v => {
            const draft = drafts[v.id] || {};
            const linked = v.gps_provider && v.gps_provider !== "manual" && v.gps_external_id;
            const dirty = dirtyLinks.some(x => x.v.id === v.id);
            const focused = String(focusGps?.vehiculo_id || "") === String(v.id);
            return (
              <div id={`gps-link-${v.id}`} key={v.id} style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:8,alignItems:"center",background:focused?"rgba(20,184,166,.10)":"var(--bg3)",border:`1px solid ${focused ? "rgba(20,184,166,.60)" : dirty ? "rgba(16,185,129,.35)" : "var(--border)"}`,boxShadow:focused?"0 0 0 2px rgba(20,184,166,.14)":undefined,borderRadius:8,padding:10}}>
                <div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"var(--accent-xl)",fontSize:13}}>{v.matricula}</div>
                  <div style={{fontSize:11,color:"var(--text4)"}}>
                    {linked ? `Enlazado: ${GPS_PROVIDER_LABELS[v.gps_provider] || v.gps_provider} / ${v.gps_external_id}` : "Pendiente de enlazar"}
                    {dirty ? " - cambiado" : ""}
                  </div>
                  {v.ubicacion_actual && <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>Ultima: {v.ubicacion_actual}</div>}
                </div>
                  <div style={{...S.sel,display:"flex",alignItems:"center",background:"var(--bg2)",cursor:"default"}}>
                    {GPS_PROVIDER_LABELS[draft.provider || activeProvider] || draft.provider || activeProvider || "Sin proveedor activo"}
                  </div>
                <input disabled={!canEdit} value={draft.external_id || ""} onChange={e=>setDrafts(p=>({...p,[v.id]:{...(p[v.id]||{}),external_id:e.target.value}}))} style={S.inp} placeholder="IMEI / ID GPS del dispositivo"/>
                {canEdit && (
                  <button onClick={()=>guardar(v)} disabled={savingId===v.id} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.28)",justifyContent:"center"}}>
                    {savingId===v.id ? "Guardando..." : "Guardar"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TabGpsHistorial({ vehiculo }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    if (!vehiculo?.id) return;
    setLoading(true);
    setError("");
    getPosicionesVehiculo(vehiculo.id)
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message || "No se pudo cargar el historial GPS"))
      .finally(() => setLoading(false));
  }, [vehiculo?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  const currentLat = vehiculo?.gps_lat;
  const currentLng = vehiculo?.gps_lng;
  const hasCurrentCoords = currentLat !== null && currentLat !== undefined && currentLng !== null && currentLng !== undefined;

  return (
    <div>
      <div style={S.sec}>GPS del vehiculo</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10,marginBottom:14}}>
        <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
          <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>Proveedor</div>
          <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{GPS_PROVIDER_LABELS[vehiculo?.gps_provider] || vehiculo?.gps_provider || "Sin enlazar"}</div>
        </div>
        <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
          <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>ID externo</div>
          <div style={{fontSize:13,fontWeight:800,color:"var(--text)",fontFamily:"'JetBrains Mono',monospace"}}>{vehiculo?.gps_external_id || "Pendiente"}</div>
        </div>
        <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
          <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>Ultima fuente</div>
          <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{GPS_PROVIDER_LABELS[vehiculo?.ubicacion_fuente] || vehiculo?.ubicacion_fuente || "Sin fuente"}</div>
        </div>
        <div style={{background:"var(--bg4)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
          <div style={{fontSize:9,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em"}}>Actualizado</div>
          <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{vehiculo?.ubicacion_ts ? new Date(vehiculo.ubicacion_ts).toLocaleString("es-ES") : "Sin fecha"}</div>
        </div>
      </div>

      <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:12,marginBottom:14}}>
        <div style={{fontSize:12,fontWeight:800,color:"var(--text)",marginBottom:5}}>Ubicacion actual</div>
        <div style={{fontSize:13,color:vehiculo?.ubicacion_actual ? "var(--text)" : "var(--text4)",fontWeight:700}}>
          {vehiculo?.ubicacion_actual || "Sin ubicacion registrada"}
        </div>
        {hasCurrentCoords && (
          <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:8}}>
            <span style={{fontSize:11,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace"}}>{currentLat}, {currentLng}</span>
            <a href={`https://www.google.com/maps?q=${currentLat},${currentLng}`} target="_blank" rel="noreferrer"
              style={{fontSize:12,color:"var(--accent-xl)",fontWeight:800,textDecoration:"none"}}>
              Abrir mapa
            </a>
          </div>
        )}
      </div>

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{fontSize:12,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".06em"}}>Historial de posiciones</div>
        <button type="button" onClick={cargar} disabled={loading} style={{...S.btn,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"}}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>

      {error && <div style={{fontSize:12,color:"var(--red)",marginBottom:8}}>{error}</div>}
      {loading ? (
        <div style={{color:"var(--text4)",fontSize:13,padding:16}}>Cargando historial GPS...</div>
      ) : items.length === 0 ? (
        <div style={{background:"var(--bg3)",border:"1px dashed var(--border2)",borderRadius:8,padding:18,textAlign:"center",color:"var(--text4)",fontSize:13}}>
          Aun no hay posiciones guardadas para este vehiculo. Cuando se sincronice un proveedor GPS o la app del chofer envie posicion, apareceran aqui.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.map(pos => {
            const hasCoords = pos.lat !== null && pos.lat !== undefined && pos.lng !== null && pos.lng !== undefined;
            return (
              <div key={pos.id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
                <div>
                  <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{pos.ubicacion || "Posicion sin direccion"}</div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                    {GPS_PROVIDER_LABELS[pos.provider] || pos.provider || "GPS"} - {pos.recorded_at ? new Date(pos.recorded_at).toLocaleString("es-ES") : "Sin fecha"}
                    {pos.velocidad_kmh ? ` - ${pos.velocidad_kmh} km/h` : ""}
                    {pos.odometro_km ? ` - ${Number(pos.odometro_km).toLocaleString("es-ES")} km` : ""}
                  </div>
                  {hasCoords && <div style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{pos.lat}, {pos.lng}</div>}
                </div>
                {hasCoords && (
                  <a href={`https://www.google.com/maps?q=${pos.lat},${pos.lng}`} target="_blank" rel="noreferrer"
                    style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--accent-xl)",textDecoration:"none",justifyContent:"center"}}>
                    Mapa
                  </a>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function labelEventoVehiculo(tipo) {
  switch (tipo) {
    case "vehiculo.creado": return "Vehiculo creado";
    case "vehiculo.editado": return "Ficha actualizada";
    case "vehiculo.estado": return "Cambio de estado";
    case "vehiculo.gps_link": return "Enlace GPS";
    case "vehiculo.posicion_manual": return "Posicion manual";
    default: return tipo || "Evento";
  }
}

function detalleEventoVehiculo(item) {
  const data = item?.detalle || item?.payload || {};
  switch (item?.tipo) {
    case "vehiculo.estado":
      return `${data.estado_anterior || "sin estado"} -> ${data.estado_nuevo || "sin estado"}`;
    case "vehiculo.gps_link":
      return `${GPS_PROVIDER_LABELS[data.provider] || data.provider || "GPS"} / ${data.external_id || "sin ID"}`;
    case "vehiculo.posicion_manual":
      return data.ubicacion || "Ubicacion manual actualizada";
    case "vehiculo.editado": {
      const keys = Array.isArray(data.campos) ? data.campos.filter(Boolean) : [];
      return keys.length ? `Campos: ${keys.slice(0, 6).join(", ")}${keys.length > 6 ? "..." : ""}` : "Datos del vehiculo actualizados";
    }
    default:
      return data?.message || "";
  }
}

function TabVehiculoEventos({ vehiculo }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const cargar = useCallback(() => {
    if (!vehiculo?.id) return;
    setLoading(true);
    setError("");
    getVehiculoEventos(vehiculo.id)
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(e => setError(e.message || "No se pudo cargar el historial del vehiculo"))
      .finally(() => setLoading(false));
  }, [vehiculo?.id]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div>
      <div style={S.sec}>Historial del vehiculo</div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
        <div style={{fontSize:12,color:"var(--text4)"}}>
          Trazabilidad real del vehiculo: cambios de estado, enlace GPS, ediciones y posiciones manuales.
        </div>
        <button type="button" onClick={cargar} disabled={loading} style={{...S.btn,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"}}>
          {loading ? "Actualizando..." : "Actualizar"}
        </button>
      </div>
      {error && <div style={{fontSize:12,color:"var(--red)",marginBottom:8}}>{error}</div>}
      {loading ? (
        <div style={{color:"var(--text4)",fontSize:13,padding:16}}>Cargando historial...</div>
      ) : items.length === 0 ? (
        <div style={{background:"var(--bg3)",border:"1px dashed var(--border2)",borderRadius:8,padding:18,textAlign:"center",color:"var(--text4)",fontSize:13}}>
          Todavia no hay eventos registrados para este vehiculo.
        </div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {items.map(item => (
            <div key={item.id} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:10}}>
              <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                <div style={{fontSize:13,fontWeight:800,color:"var(--text)"}}>{labelEventoVehiculo(item.tipo)}</div>
                <div style={{fontSize:11,color:"var(--text5)"}}>
                  {item.created_at ? new Date(item.created_at).toLocaleString("es-ES") : "Sin fecha"}
                </div>
              </div>
              {detalleEventoVehiculo(item) && (
                <div style={{fontSize:12,color:"var(--text3)",marginTop:4,lineHeight:1.45}}>
                  {detalleEventoVehiculo(item)}
                </div>
              )}
              {(item.usuario_nombre || item.ip || item.actor_id) && (
                <div style={{fontSize:10,color:"var(--text5)",marginTop:6}}>
                  {item.usuario_nombre ? `Usuario: ${item.usuario_nombre}` : item.actor_id ? `Actor: ${item.actor_id}` : "Usuario del sistema"}
                  {item.ip ? ` · IP ${item.ip}` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModalChoferPicker({ vehiculoId, matricula, estado, choferes, onConfirm, onClose }) {
  const [busqueda,    setBusqueda]    = useState("");
  const [seleccionado,setSeleccionado]= useState("");
  const [mostrarCrear,setMostrarCrear]= useState(false);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoApell,  setNuevoApell]  = useState("");
  const [saving,      setSaving]      = useState(false);

  const filtrados = choferes.filter(ch =>
    ch.activo && (
      !busqueda ||
      (ch.nombre+" "+(ch.apellidos||"")).toLowerCase().includes(busqueda.toLowerCase())
    )
  );
  const sinResultados = busqueda.length > 1 && filtrados.length === 0;

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.75)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:13,padding:22,width:"min(400px,95vw)"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:"var(--text)",marginBottom:4}}>
          Cambiar a En Ruta
        </div>
        <div style={{fontSize:12,color:"var(--text4)",marginBottom:16}}>
          Vehiculo <strong style={{color:"var(--accent-xl)",fontFamily:"'JetBrains Mono',monospace"}}>{matricula}</strong> - Quien lo lleva?
        </div>

        {/* Buscador */}
        <input
          autoFocus
          value={busqueda}
          onChange={e=>{ setBusqueda(e.target.value); setSeleccionado(""); setMostrarCrear(false); }}
          placeholder="Buscar chofer por nombre..."
          style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"9px 12px",borderRadius:8,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",marginBottom:8}}
        />

        {/* Lista de choferes */}
        {!mostrarCrear && (
          <div style={{maxHeight:200,overflowY:"auto",marginBottom:10}}>
            {/* Opcion sin chofer */}
            <div
              onClick={()=>setSeleccionado("ninguno")}
              style={{padding:"8px 12px",borderRadius:7,cursor:"pointer",fontSize:13,
                background:seleccionado==="ninguno"?"rgba(139,92,246,.1)":"transparent",
                color:"var(--text4)",fontStyle:"italic",
                border:seleccionado==="ninguno"?"1px solid rgba(139,92,246,.3)":"1px solid transparent",
                marginBottom:3}}>
              Sin chofer asignado
            </div>
            {filtrados.map(ch=>(
              <div key={ch.id}
                onClick={()=>setSeleccionado(ch.id)}
                style={{padding:"8px 12px",borderRadius:7,cursor:"pointer",fontSize:13,
                  background:seleccionado===ch.id?"rgba(59,130,246,.1)":"transparent",
                  border:seleccionado===ch.id?"1px solid rgba(59,130,246,.3)":"1px solid transparent",
                  color:"var(--text)",marginBottom:3,display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:28,height:28,borderRadius:"50%",background:"var(--accent)",color:"#fff",display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,flexShrink:0}}>
                  {ch.nombre[0]}{ch.apellidos?ch.apellidos[0]:""}
                </span>
                <span>{ch.nombre} {ch.apellidos||""}</span>
              </div>
            ))}
            {sinResultados && (
              <div style={{padding:"10px 12px",fontSize:12,color:"var(--text4)",textAlign:"center"}}>
                No hay chofer con ese nombre.
                <button onClick={()=>{ setMostrarCrear(true); setNuevoNombre(busqueda); }}
                  style={{marginLeft:8,background:"none",border:"none",color:"var(--accent)",cursor:"pointer",fontWeight:700,fontSize:12,textDecoration:"underline"}}>
                  Crear nuevo?
                </button>
              </div>
            )}
          </div>
        )}

        {/* Formulario crear chofer */}
        {mostrarCrear && (
          <div style={{background:"var(--bg3)",borderRadius:9,padding:"12px 14px",marginBottom:10,border:"1px solid var(--border)"}}>
            <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:10}}>Crear nuevo chofer</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <div>
                <div style={{fontSize:10,color:"var(--text5)",marginBottom:3,textTransform:"uppercase",letterSpacing:".06em"}}>Nombre *</div>
                <input value={nuevoNombre} onChange={e=>setNuevoNombre(e.target.value)}
                  placeholder="Nombre" autoFocus
                  style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
              <div>
                <div style={{fontSize:10,color:"var(--text5)",marginBottom:3,textTransform:"uppercase",letterSpacing:".06em"}}>Apellidos</div>
                <input value={nuevoApell} onChange={e=>setNuevoApell(e.target.value)}
                  placeholder="Apellidos"
                  style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,width:"100%",boxSizing:"border-box",fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none"}}/>
              </div>
            </div>
            <button onClick={()=>setMostrarCrear(false)}
              style={{marginTop:8,background:"none",border:"none",color:"var(--text5)",cursor:"pointer",fontSize:11}}>
              Volver a la lista
            </button>
          </div>
        )}

        {/* Botones */}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose}
            style={{padding:"8px 16px",borderRadius:8,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:13,cursor:"pointer"}}>
            Cancelar
          </button>
          <button
            disabled={saving || (mostrarCrear && !nuevoNombre.trim())}
            onClick={async()=>{
              setSaving(true);
              if(mostrarCrear) {
                await onConfirm(null, {nombre:nuevoNombre.trim(), apellidos:nuevoApell.trim()});
              } else {
                await onConfirm(seleccionado==="ninguno"?null:seleccionado||null, null);
              }
              setSaving(false);
            }}
            style={{padding:"8px 20px",borderRadius:8,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:saving?"not-allowed":"pointer",opacity:saving?0.7:1}}>
            {saving?"Aplicando...":"Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ModalVehiculo({ editando, onClose, onSaved, choferes=[], vehiculos=[], onVehiculoActualizado = null, onGpsRefresh = null }) {
  const { puedeEditar } = useAuth();
  const canEdit = puedeEditar("vehiculos");
  const [tab,    setTab]    = useState("identificacion");
  const [form,   setForm]   = useState(editando ? { ...editando } : {
    // Identificacion
    matricula:"", clase:"Tractora", marca:"", modelo:"", anio:"",
    color:"", numero_bastidor:"", numero_motor:"",
    // Estado
    estado:"disponible", km_actuales:0, ubicacion_actual:"", ubicacion_fuente:"manual", gps_provider:"manual", gps_external_id:"",
    // Tecnicos (ficha tecnica)
    carga_max_kg:"", tara_kg:"", masa_total_kg:"", plazas:"",
    potencia_cv:"", cilindrada:"", combustible:"Diesel",
    longitud_mm:"", anchura_mm:"", altura_mm:"", ejes:"",
    velocidad_max_kmh:"", homologacion_co2:"",
    // Compra / Venta
    fecha_compra:"", valor_compra:"", financiacion:"",
    concesionario:"", numero_pedido_compra:"",
    fecha_venta:"", valor_venta:"", comprador:"",
    // Documentacion
    fecha_matriculacion:"", fecha_itv:"", fecha_seguro:"",
    compania_seguro:"", numero_poliza:"",
    // Notas
    notas:"",
    // Conjunto
    chofer_id: editando?.chofer_id || "",
    remolque_id: editando?.remolque_id || "",
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");
  const [gpsProviders, setGpsProviders] = useState([]);
  const [docsVehiculo, setDocsVehiculo] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const gpsProviderActivo = gpsProviders.find(p => p.active)?.id || gpsProviders.find(p => p.configured)?.id || "";

  useEffect(() => {
    let alive = true;
    getGpsProviders()
      .then(r => { if (alive) setGpsProviders(Array.isArray(r?.providers) ? r.providers : []); })
      .catch(() => { if (alive) setGpsProviders([]); });
    return () => { alive = false; };
  }, []);

  const cargarDocsVehiculo = useCallback(() => {
    if (!editando?.id) return;
    setDocsLoading(true);
    getDocsVehiculo(editando.id)
      .then(d => setDocsVehiculo(Array.isArray(d) ? d : []))
      .catch(() => setDocsVehiculo([]))
      .finally(() => setDocsLoading(false));
  }, [editando?.id]);

  useEffect(() => {
    if (tab === "docs") cargarDocsVehiculo();
  }, [tab, cargarDocsVehiculo]);

  async function subirDocumentoVehiculo(file) {
    if (!editando?.id || !file) return;
    if (file.size > 3 * 1024 * 1024) {
      notify("Archivo demasiado grande. Usa archivos de hasta 3 MB.", "warning");
      return;
    }
    setDocUploading(true);
    try {
      const fileUrl = await fileToDataUrl(file);
      const tipo = inferVehiculoDocTipo(file.name);
      await crearDocVehiculo(editando.id, {
        tipo,
        descripcion: `Archivado desde ficha de vehiculo. Tipo detectado: ${tipo}.`,
        file_url: fileUrl,
        file_nombre: file.name,
        file_size_kb: Math.ceil(file.size / 1024),
      });
      notify("Documento archivado en la ficha del vehiculo", "success");
      cargarDocsVehiculo();
    } catch (e) {
      notify(e.message || "No se pudo archivar el documento", "error");
    } finally {
      setDocUploading(false);
    }
  }

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.type==="checkbox" ? e.target.checked : e.target.value }));

  async function guardar() {
    if (!form.matricula?.trim()) { setError("La matricula es obligatoria"); return; }
    setError("");
    setSaving(true);
    const confirmarReasignacion = async (e, fallbackTitle) => {
      if (e.status !== 409 || !e.data?.requiere_confirmacion) return false;
      return confirmDialog({
        title: fallbackTitle,
        message: e.message || e.data?.error || "Ya existe una asignacion con esos datos. Quieres moverla a este conjunto?",
        confirmText: "Mover al conjunto",
        cancelText: "Cancelar",
        tone: "warning",
      });
    };
    try {
      let savedId = editando?.id;
      let savedVehiculo = null;
      const formToSave = {...form};
      if (editando?.id) {
        try {
          savedVehiculo = await editarVehiculo(editando.id, formToSave);
        } catch (e) {
          const ok = await confirmarReasignacion(e, "Mover chofer");
          if (!ok) throw e;
          savedVehiculo = await editarVehiculo(editando.id, {
            ...formToSave,
            confirmar_reasignacion_chofer: true,
            force_reassign_chofer: true,
          });
        }
      } else {
        const created = await crearVehiculo(form);
        savedVehiculo = created;
        savedId = created?.id || created?.data?.id;
      }
      if (savedId && form.remolque_id !== undefined) {
        try {
          await asignarRemolque(savedId, form.remolque_id || null);
        } catch(e) {
          const ok = await confirmarReasignacion(e, "Mover remolque");
          if (!ok) throw e;
          await asignarRemolque(savedId, form.remolque_id || null, {
            confirmar_reasignacion_remolque: true,
            force_reassign_remolque: true,
          });
        }
      }
      if (savedVehiculo?.id) onVehiculoActualizado?.(savedVehiculo);
      onSaved();
    } catch(e) {
      setError(e.message || "Error al guardar el vehiculo");
    } finally { setSaving(false); }
  }

  const esRemolque = form.clase?.includes("Remolque") || form.clase?.includes("Semi") || form.clase?.includes("Dolly");

  const TABS = [
    { id:"identificacion", l:"Identificacion" },
    { id:"tecnica",        l:"Ficha tecnica" },
    { id:"economico",      l:"Compra / Venta" },
    { id:"docs",           l:"Documentacion" },
    { id:"gps",            l:"GPS" },
    { id:"conjunto",       l:"Conjunto / Chofer" },
    ...(editando ? [{ id:"historial", l:"Historial" }] : []),
  ];

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{ background:"var(--bg2)", border:"1px solid var(--border2)", borderRadius:14,
                    width:"min(820px,98vw)", maxHeight:"97vh", display:"flex", flexDirection:"column" }}>

        {/* Header */}
        <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)", display:"flex", alignItems:"center", gap:12, flexShrink:0 }}>
          <div style={{ flex:1 }}>
            <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:15, color:"var(--text)" }}>
              {editando ? form.matricula : "Nuevo vehiculo"}
            </div>
            {form.marca && <div style={{ fontSize:11, color:"var(--text4)", fontFamily:"'DM Sans',sans-serif" }}>
              {form.clase} - {form.marca} {form.modelo} {form.anio ? `(${form.anio})` : ""}
            </div>}
          </div>
          {canEdit && (
            <button style={{ ...S.btn, background:"var(--accent)", color:"#fff" }} onClick={guardar} disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </button>
          )}
          <button onClick={onClose} style={{ background:"none", border:"none", color:"var(--text4)", fontSize:18, cursor:"pointer" }}>Cerrar</button>
        </div>

        {/* Error banner */}
        {error && (
          <div style={{
            margin:"8px 0 0", padding:"10px 14px",
            background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.3)",
            borderRadius:9, fontSize:13, color:"#ef4444",
            display:"flex", alignItems:"flex-start", gap:10,
          }}>
            <span style={{flexShrink:0}}>Aviso</span>
            <div style={{flex:1,lineHeight:1.5}}>{error}</div>
            <button onClick={()=>setError("")}
              style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:16,padding:"0 2px",flexShrink:0}}>Cerrar</button>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display:"flex", gap:0, borderBottom:"1px solid var(--border)", flexShrink:0 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding:"8px 14px", border:"none", borderBottom:`2px solid ${tab===t.id?"var(--accent-l)":"transparent"}`,
                       background:"none", fontFamily:"'DM Sans',sans-serif", fontSize:12, fontWeight:600,
                       cursor:"pointer", color: tab===t.id?"var(--accent-xl)":"var(--text4)" }}>
              {t.l}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex:1, overflowY:"auto", padding:"16px 20px" }}>

          {/*  Identificacion */}
          {tab === "identificacion" && (
            <div>
              <div style={S.sec}>Datos de identificacion</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Matricula *</label>
                  <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace", fontWeight:700, textTransform:"uppercase" }}
                    value={form.matricula||""} onChange={f("matricula")} placeholder="1234 ABC"/>
                </div>
                <div>
                  <label style={S.lbl}>Clase de vehiculo *</label>
                  <select value={form.clase||""} onChange={f("clase")} style={S.sel}>
                    {CLASES_VEHICULO.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Marca</label>
                  <input style={S.inp} value={form.marca||""} onChange={f("marca")} placeholder="Volvo, DAF, Schmitz..."/>
                </div>
                <div>
                  <label style={S.lbl}>Modelo</label>
                  <input style={S.inp} value={form.modelo||""} onChange={f("modelo")} placeholder="FH 460, XF 480..."/>
                </div>
                <div>
                  <label style={S.lbl}>Ano de fabricacion</label>
                  <input type="number" min="1990" max="2035" style={S.inp} value={form.anio||""} onChange={f("anio")} placeholder="2023"/>
                </div>
                <div>
                  <label style={S.lbl}>Color</label>
                  <input style={S.inp} value={form.color||""} onChange={f("color")} placeholder="Blanco"/>
                </div>
                <div>
                  <label style={S.lbl}>No. de bastidor (VIN)</label>
                  <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={form.numero_bastidor||""} onChange={f("numero_bastidor")} placeholder="WDB9634032L123456"/>
                </div>
                <div>
                  <label style={S.lbl}>No. de motor</label>
                  <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={form.numero_motor||""} onChange={f("numero_motor")}/>
                </div>
              </div>

              <div style={S.sec}>Estado operativo</div>
              <div style={S.grid3}>
                <div>
                  <label style={S.lbl}>Estado actual</label>
                  <select value={form.estado||"disponible"} onChange={f("estado")} style={S.sel}>
                    {Object.keys(EC).map(e=><option key={e} value={e}>{e.replace("_"," ")}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>KM actuales</label>
                  <input type="number" min="0" style={S.inp} value={form.km_actuales||""} onChange={f("km_actuales")} onBlur={e=>{ const id=editando?.id||form?.id; if(id&&e.target.value) actualizarKmVehiculo(id, Number(e.target.value)).catch(()=>{}); }} onFocus={e=>e.target.select()}/>
                </div>
                <div>
                  <label style={S.lbl}>Ubicacion actual</label>
                  <input style={S.inp} value={form.ubicacion_actual||""} onChange={f("ubicacion_actual")} placeholder="GPS pendiente / ultimo destino"/>
                </div>
                  <div>
                    <label style={S.lbl}>Proveedor GPS activo</label>
                    <div style={{...S.sel,display:"flex",alignItems:"center",background:"var(--bg2)",cursor:"default"}}>
                      {GPS_PROVIDER_LABELS[gpsProviderActivo] || gpsProviderActivo || "Sin proveedor activo en SuperAdmin"}
                    </div>
                  </div>
                <div>
                  <label style={S.lbl}>IMEI / ID GPS del dispositivo</label>
                  <input style={S.inp} value={form.gps_external_id||""} onChange={f("gps_external_id")} placeholder="IMEI o ID exacto del proveedor GPS"/>
                </div>
                <div>
                  <label style={S.lbl}>Fecha matriculacion</label>
                  <input type="date" style={S.inp} value={form.fecha_matriculacion||""} onChange={f("fecha_matriculacion")}/>
                </div>
              </div>

              <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:10}}>
                {editando?.id && (
                  <button type="button" style={{...S.btn,background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"}}
                    onClick={async e => {
                        e.stopPropagation();
                        try {
                          const externalId = String(form.gps_external_id || "").trim();
                          if (!externalId) {
                            notify("Introduce el IMEI/ID GPS antes de intentar localizar senal.", "warning");
                            return;
                          }
                          const updated = await vincularGpsVehiculo(editando.id, {
                            provider: gpsProviderActivo || form.gps_provider || "manual",
                            external_id: externalId,
                          });
                        setForm(p => ({...p, ...updated}));
                        onVehiculoActualizado?.(updated);
                        onGpsRefresh?.();
                        notify("Enlace GPS guardado", "success");
                      } catch (err) {
                        notify(err.message || "No se pudo guardar el enlace GPS", "error");
                      }
                    }}>
                    Guardar IMEI / enlace GPS
                  </button>
                )}
                {editando?.id && form.ubicacion_actual?.trim() && (
                  <button type="button" style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.28)"}}
                    onClick={async e => {
                      e.stopPropagation();
                      try {
                        const updated = await actualizarPosicionVehiculo(editando.id, {
                          provider: "manual",
                          ubicacion: form.ubicacion_actual,
                          km_actuales: form.km_actuales || null,
                        });
                        setForm(p => ({...p, ...updated}));
                        onVehiculoActualizado?.(updated);
                        onGpsRefresh?.();
                        notify("Ubicacion actualizada", "success");
                      } catch (err) {
                        notify(err.message || "No se pudo actualizar la ubicacion", "error");
                      }
                    }}>
                    Fijar ubicacion manual
                  </button>
                )}
                {form.ubicacion_fuente && (
                  <span style={{fontSize:11,color:"var(--text4)",alignSelf:"center"}}>
                    Fuente: {GPS_PROVIDER_LABELS[form.ubicacion_fuente] || form.ubicacion_fuente}
                    {form.ubicacion_ts ? ` - ${new Date(form.ubicacion_ts).toLocaleString("es-ES")}` : ""}
                  </span>
                )}
              </div>

              <div style={S.sec}>Notas</div>
              <textarea style={{ ...S.inp, height:70, resize:"vertical" }}
                value={form.notas||""} onChange={f("notas")} placeholder="Observaciones generales del vehiculo..."/>

              <div style={S.sec}>Aviso Avisos operacionales</div>
              <div style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.3)",borderRadius:8,padding:"10px 12px",marginBottom:6,fontSize:12,color:"var(--text4)"}}>
                Escribe aqui limitaciones o avisos importantes que deben mostrarse cada vez que se asigne este vehiculo a un pedido.
                Por ejemplo: <i>"No eleva techo"</i>, <i>"Max 20.000 kg"</i>, <i>"Sin lona lateral"</i>, <i>"Precaucion: frenos revisados 15/03"</i>
              </div>
              <textarea style={{ ...S.inp, height:80, resize:"vertical",
                background:"rgba(245,158,11,.06)", border:"1px solid rgba(245,158,11,.3)",
                color:"var(--text)" }}
                value={form.notas_operacion||""} onChange={f("notas_operacion")}
                placeholder="Ej: No eleva techo&#10;Ej: Frigorifico - comprobar temperatura antes de cargar&#10;Ej: Lona rota lado izquierdo"/>
            </div>
          )}

          {/*  Ficha tecnica  */}
          {tab === "tecnica" && (
            <div>
              <div style={{ background:"rgba(59,130,246,.07)", border:"1px solid rgba(59,130,246,.15)", borderRadius:8, padding:"9px 14px", marginBottom:16, fontSize:12, color:"var(--text3)" }}>
                Datos conforme a la ficha tecnica oficial del vehiculo (Permiso de Circulacion / Ficha Reducida)
              </div>

              <div style={S.sec}>Masas (kg)</div>
              <div style={S.grid3}>
                <div>
                  <label style={S.lbl}>Tara (kg)</label>
                  <input type="number" style={S.inp} value={form.tara_kg||""} onChange={f("tara_kg")} placeholder="8500"/>
                </div>
                <div>
                  <label style={S.lbl}>Carga maxima (kg)</label>
                  <input type="number" style={S.inp} value={form.carga_max_kg||""} onChange={f("carga_max_kg")} placeholder="24000"/>
                </div>
                <div>
                  <label style={S.lbl}>MMA - Masa maxima (kg)</label>
                  <input type="number" style={S.inp} value={form.masa_total_kg||""} onChange={f("masa_total_kg")} placeholder="40000"/>
                </div>
              </div>

              <div style={S.sec}>Motor y mecanica</div>
              <div style={S.grid3}>
                <div>
                  <label style={S.lbl}>Combustible</label>
                  <select value={form.combustible||"Diesel"} onChange={f("combustible")} style={S.sel}>
                    {TIPO_COMBUSTIBLE.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.lbl}>Potencia (CV)</label>
                  <input type="number" style={S.inp} value={form.potencia_cv||""} onChange={f("potencia_cv")} placeholder="460"/>
                </div>
                <div>
                  <label style={S.lbl}>Cilindrada (cm3)</label>
                  <input type="number" style={S.inp} value={form.cilindrada||""} onChange={f("cilindrada")} placeholder="12900"/>
                </div>
                <div>
                  <label style={S.lbl}>Velocidad max (km/h)</label>
                  <input type="number" style={S.inp} value={form.velocidad_max_kmh||""} onChange={f("velocidad_max_kmh")} placeholder="90"/>
                </div>
                <div>
                  <label style={S.lbl}>No. de ejes</label>
                  <input type="number" min="1" max="10" style={S.inp} value={form.ejes||""} onChange={f("ejes")} placeholder="2"/>
                </div>
                {!esRemolque && (
                  <div>
                    <label style={S.lbl}>Plazas (incluido conductor)</label>
                    <input type="number" min="1" style={S.inp} value={form.plazas||""} onChange={f("plazas")} placeholder="1"/>
                  </div>
                )}
              </div>

              <div style={S.sec}>Dimensiones</div>
              <div style={S.grid3}>
                <div>
                  <label style={S.lbl}>Longitud (mm)</label>
                  <input type="number" style={S.inp} value={form.longitud_mm||""} onChange={f("longitud_mm")} placeholder="16500"/>
                </div>
                <div>
                  <label style={S.lbl}>Anchura (mm)</label>
                  <input type="number" style={S.inp} value={form.anchura_mm||""} onChange={f("anchura_mm")} placeholder="2550"/>
                </div>
                <div>
                  <label style={S.lbl}>Altura (mm)</label>
                  <input type="number" style={S.inp} value={form.altura_mm||""} onChange={f("altura_mm")} placeholder="4000"/>
                </div>
              </div>

              <div style={S.sec}>Emisiones</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Homologacion CO2 / Euro</label>
                  <input style={S.inp} value={form.homologacion_co2||""} onChange={f("homologacion_co2")} placeholder="Euro 6, Euro 5..."/>
                </div>
              </div>
            </div>
          )}

          {/*  Compra / Venta  */}
          {tab === "economico" && (
            <div>
              <div style={S.sec}>Adquisicion</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Fecha de compra</label>
                  <input type="date" style={S.inp} value={form.fecha_compra||""} onChange={f("fecha_compra")}/>
                </div>
                <div>
                  <label style={S.lbl}>Valor de compra (EUR)</label>
                  <input type="number" step="0.01" style={S.inp} value={form.valor_compra||""} onChange={f("valor_compra")} placeholder="85000"/>
                </div>
                <div>
                  <label style={S.lbl}>Concesionario / Vendedor</label>
                  <input style={S.inp} value={form.concesionario||""} onChange={f("concesionario")} placeholder="Volvo Trucks Madrid"/>
                </div>
                <div>
                  <label style={S.lbl}>No. pedido / contrato compra</label>
                  <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={form.numero_pedido_compra||""} onChange={f("numero_pedido_compra")}/>
                </div>
                <div style={{ gridColumn:"1/-1" }}>
                  <label style={S.lbl}>Forma de pago / financiacion</label>
                  <input style={S.inp} value={form.financiacion||""} onChange={f("financiacion")} placeholder="Leasing 5 anos, compra directa, renting..."/>
                </div>
              </div>

              <div style={S.sec}>Venta (si procede)</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Fecha de venta</label>
                  <input type="date" style={S.inp} value={form.fecha_venta||""} onChange={f("fecha_venta")}/>
                </div>
                <div>
                  <label style={S.lbl}>Valor de venta (EUR)</label>
                  <input type="number" step="0.01" style={S.inp} value={form.valor_venta||""} onChange={f("valor_venta")} placeholder="0"/>
                </div>
                <div>
                  <label style={S.lbl}>Comprador</label>
                  <input style={S.inp} value={form.comprador||""} onChange={f("comprador")}/>
                </div>
              </div>

              {/* Resumen valoracion */}
              {(form.valor_compra || form.valor_venta) && (
                <div style={{ background:"var(--bg4)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 16px", marginTop:16 }}>
                  <div style={{ fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:".07em", color:"var(--text5)", marginBottom:10 }}>Resumen</div>
                  <div style={{ display:"flex", gap:24 }}>
                    {form.valor_compra && <div><div style={{ fontSize:12, color:"var(--text4)" }}>Compra</div><div style={{ fontSize:17, fontWeight:800, color:"var(--red)", fontFamily:"'JetBrains Mono',monospace" }}>-{fmt2(form.valor_compra)} EUR</div></div>}
                    {form.valor_venta  && <div><div style={{ fontSize:12, color:"var(--text4)" }}>Venta</div><div style={{ fontSize:17, fontWeight:800, color:"var(--green)", fontFamily:"'JetBrains Mono',monospace" }}>+{fmt2(form.valor_venta)} EUR</div></div>}
                    {form.valor_compra && form.valor_venta && (
                      <div>
                        <div style={{ fontSize:12, color:"var(--text4)" }}>Resultado</div>
                        <div style={{ fontSize:17, fontWeight:800, fontFamily:"'JetBrains Mono',monospace",
                          color: form.valor_venta >= form.valor_compra ? "var(--green)" : "var(--red)" }}>
                          {form.valor_venta >= form.valor_compra ? "+" : ""}{fmt2(form.valor_venta - form.valor_compra)} EUR
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/*  Documentacion  */}
          {tab === "docs" && (
            <div>
              <div style={S.sec}>ITV y documentacion</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Proxima ITV</label>
                  <input type="date" style={S.inp} value={form.fecha_itv||""} onChange={f("fecha_itv")}/>
                </div>
              </div>

              <div style={S.sec}>Seguro</div>
              <div style={S.grid2}>
                <div>
                  <label style={S.lbl}>Vencimiento poliza</label>
                  <input type="date" style={S.inp} value={form.fecha_seguro||""} onChange={f("fecha_seguro")}/>
                </div>
                <div>
                  <label style={S.lbl}>Compania aseguradora</label>
                  <input style={S.inp} value={form.compania_seguro||""} onChange={f("compania_seguro")} placeholder="Mapfre, AXA, Generali..."/>
                </div>
                <div>
                  <label style={S.lbl}>Numero de poliza</label>
                  <input style={{ ...S.inp, fontFamily:"'JetBrains Mono',monospace" }} value={form.numero_poliza||""} onChange={f("numero_poliza")}/>
                </div>
              </div>

              <div style={S.sec}>Archivo documental</div>
              {editando?.id ? (
                <div style={{display:"grid",gap:10}}>
                  {canEdit && (
                    <label style={{border:"1px dashed var(--border2)",borderRadius:8,padding:"12px 14px",background:"var(--bg3)",cursor:docUploading?"wait":"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                      <span>
                        <span style={{display:"block",fontWeight:800,color:"var(--text)",fontSize:13}}>Subir documento del vehiculo</span>
                        <span style={{display:"block",color:"var(--text5)",fontSize:11,marginTop:2}}>PDF o imagen. Se archiva en la ficha y se clasifica por nombre: ITV, seguro, tacografo, tarjeta de transporte o permiso.</span>
                      </span>
                      <span style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}>
                        {docUploading ? "Subiendo..." : "Seleccionar"}
                      </span>
                      <input type="file" accept="application/pdf,image/*" style={{display:"none"}} disabled={docUploading} onChange={e=>subirDocumentoVehiculo(e.target.files?.[0])}/>
                    </label>
                  )}
                  {docsLoading ? (
                    <div style={{color:"var(--text5)",fontSize:12}}>Cargando documentos...</div>
                  ) : docsVehiculo.length === 0 ? (
                    <div style={{color:"var(--text5)",fontSize:12,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:12}}>Sin documentos archivados todavia.</div>
                  ) : (
                    <div style={{display:"grid",gap:8}}>
                      {docsVehiculo.map(doc => (
                        <div key={doc.id} style={{display:"grid",gridTemplateColumns:"1fr auto",gap:10,alignItems:"center",border:"1px solid var(--border2)",borderRadius:8,padding:"9px 11px",background:"var(--bg3)"}}>
                          <div>
                            <div style={{fontWeight:800,color:"var(--text)",fontSize:13}}>{doc.file_nombre || doc.descripcion || doc.tipo_doc || "Documento"}</div>
                            <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                              {(doc.tipo_doc || doc.tipo || "otro")} {doc.fecha_vencimiento ? `- vence ${new Date(doc.fecha_vencimiento).toLocaleDateString("es-ES")}` : ""} {doc.file_size_kb ? `- ${doc.file_size_kb} KB` : ""}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:6,alignItems:"center"}}>
                            {doc.file_url && (
                              <a href={doc.file_url} target="_blank" rel="noreferrer" style={{...S.btn,textDecoration:"none",background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)"}}>Abrir</a>
                            )}
                            {canEdit && (
                              <button type="button" style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.22)"}} onClick={async()=>{
                                if (!await confirmDialog({title:"Eliminar documento",message:"Eliminar este documento archivado?",confirmText:"Eliminar",tone:"danger"})) return;
                                try { await borrarDocVehiculo(editando.id, doc.id); cargarDocsVehiculo(); } catch(e) { notify(e.message || "No se pudo eliminar", "error"); }
                              }}>Eliminar</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div style={{color:"var(--text5)",fontSize:12,background:"var(--bg3)",border:"1px solid var(--border2)",borderRadius:8,padding:12}}>Guarda primero el vehiculo para adjuntar documentos.</div>
              )}
            </div>
          )}

          {tab === "gps" && editando && (
            <TabGpsHistorial vehiculo={form} />
          )}

          {tab === "gps" && !editando && (
            <div style={{background:"var(--bg3)",border:"1px dashed var(--border2)",borderRadius:8,padding:18,textAlign:"center",color:"var(--text4)",fontSize:13}}>
              Guarda primero el vehiculo para activar el historial GPS.
            </div>
          )}

        {tab === "conjunto" && (
          <div>
            {/* Chofer asignado */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>Chofer asignado</div>
              <select value={form.chofer_id||""} onChange={e=>setForm(p=>({...p,chofer_id:e.target.value}))}
                style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 10px",borderRadius:7,width:"100%",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
                <option value="">Sin chofer asignado</option>
                {choferes.filter(ch=>ch.activo).map(ch=>(
                  <option key={ch.id} value={ch.id}>{ch.nombre} {ch.apellidos||""}</option>
                ))}
              </select>
            </div>

            {/* Remolque del conjunto */}
            {(form.clase?.toLowerCase().includes("tractora")||form.clase?.toLowerCase().includes("camion")||form.clase?.toLowerCase().includes("furgon")) && (
              <div style={{marginBottom:16}}>
                <div style={{fontSize:12,fontWeight:700,color:"var(--text3)",marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>Remolque del conjunto</div>
                <select value={form.remolque_id||""} onChange={e=>setForm(p=>({...p,remolque_id:e.target.value}))}
                  style={{background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"8px 10px",borderRadius:7,width:"100%",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
                  <option value="">Sin remolque</option>
                  {vehiculos.filter(v=>(v.clase?.toLowerCase().includes("remolque")||v.clase?.toLowerCase().includes("semirremolque"))&&v.activo).map(v=>(
                    <option key={v.id} value={v.id}>{v.matricula} {v.marca?" - "+v.marca:""} {v.modelo||""}</option>
                  ))}
                </select>
                {form.remolque_id && (
                  <div style={{marginTop:6,fontSize:11,color:"#a78bfa"}}>
                    Conjunto activo: <strong>{form.matricula||"esta tractora"}</strong> + <strong>{vehiculos.find(v=>v.id===form.remolque_id)?.matricula||"-"}</strong>
                  </div>
                )}
              </div>
            )}

            {/* Resumen conjunto actual */}
            {(form.chofer_id||form.remolque_id) && (
              <div style={{padding:"12px 14px",background:"rgba(139,92,246,.07)",border:"1px solid rgba(139,92,246,.2)",borderRadius:9,fontSize:12}}>
                <div style={{fontWeight:700,color:"#a78bfa",marginBottom:8}}>Resumen del conjunto</div>
                <div style={{display:"grid",gridTemplateColumns:"auto 1fr",gap:"4px 12px",fontSize:12,color:"var(--text3)"}}>
                  <span style={{color:"var(--text5)"}}>Tractora:</span><span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{form.matricula||"-"}</span>
                  <span style={{color:"var(--text5)"}}>Remolque:</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{vehiculos.find(v=>v.id===form.remolque_id)?.matricula||"-"}</span>
                  <span style={{color:"var(--text5)"}}>Chofer:</span><span>{choferes.find(c=>c.id===form.chofer_id)?.nombre||"-"} {choferes.find(c=>c.id===form.chofer_id)?.apellidos||""}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === "historial" && editando && (
          <TabVehiculoEventos vehiculo={form} />
        )}
        </div>
      </div>
    </div>
  );
}

export default function Vehiculos() {
  const { puedeEditar, user } = useAuth();
  const canEdit  = puedeEditar("vehiculos");
  // Dar de baja: gerente y contable
  const canBaja    = user?.rol === "gerente" || user?.rol === "contable";
  // Eliminar permanente: solo gerente
  const canEliminar = user?.rol === "gerente";
  const [vehiculos, setVehiculos] = useState([]);
  const [focusVehiculo] = useState(() => readVehiculosFocus());
  const [pedidos,   setPedidos]   = useState([]);
  const [choferes,  setChoferes]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [modal,     setModal]     = useState(false);
  const [editando,  setEditando]  = useState(null);
  const [filtroTipo,   setFiltroTipo]   = useState("todos");
  const [filtroEstado, setFiltroEstado] = useState("todos");
  const [gpsSyncing, setGpsSyncing] = useState(false);
  const [gpsProviders, setGpsProviders] = useState([]);
  const [gpsStatus, setGpsStatus] = useState(null);
  const [gpsSyncProvider, setGpsSyncProvider] = useState("gps_generic");
  const recargarResumenGps = useCallback(async () => {
    try {
      const [r, status] = await Promise.all([
        getGpsProviders().catch(() => ({ providers: [] })),
        getGpsStatus().catch(() => null),
      ]);
        const list = Array.isArray(r?.providers) ? r.providers : [];
        setGpsProviders(list);
        setGpsStatus(status);
        const preferred = status?.active_provider || r?.active_provider || list.find(p => p.id !== "manual" && p.active)?.id || list.find(p => p.id !== "manual" && p.configured)?.id || list.find(p => p.id !== "manual")?.id || "gps_generic";
        setGpsSyncProvider(preferred);
      } catch {}
    }, []);
  const [choferPicker, setChoferPicker] = useState(null); // {vehiculoId, estado} - para asignar chofer al cambiar estado

  const cargar = useCallback(async (soloVehiculos=false) => {
    setLoading(true);
    try {
      const _t = (p,ms=8000)=>Promise.race([p, new Promise(r=>setTimeout(()=>r([]),ms))]);
      if (soloVehiculos) {
        // Quick reload: only vehicles (used after estado change)
        const d = await getVehiculos();
        setVehiculos(Array.isArray(d) ? d : []);
      } else {
        // Full load: vehicles + pedidos + choferes desde backend
        const [d, p, ch] = await Promise.all([
          getVehiculos(),
          _t(getPedidos({estado:'en_curso,confirmado,pendiente',limit:200}).catch(()=>[])),
          getChoferes().catch(()=>[]),
        ]);
        const pArr  = Array.isArray(p)?p:(Array.isArray(p?.data)?p.data:[]);
        const chArr = Array.isArray(ch)?ch:[];
        // Don't cache choferes - always fresh so new ones appear immediately
      // sessionStorage.setItem('_veh_choferes', JSON.stringify(chArr)); // DISABLED
        setVehiculos(Array.isArray(d) ? d : []);
        setPedidos(pArr);
        setChoferes(chArr);
      }
    }
    catch(e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    if (!focusVehiculo?.vehiculo_id || loading) return;
    const found = vehiculos.find(v => String(v.id) === String(focusVehiculo.vehiculo_id));
    if (!found) return;
    const t = window.setTimeout(() => {
      document.getElementById(`vehiculo-card-${focusVehiculo.vehiculo_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_vehiculos_focus");
    }, 180);
    return () => window.clearTimeout(t);
  }, [focusVehiculo, loading, vehiculos]);
  useEffect(() => { recargarResumenGps(); }, [recargarResumenGps]);

  useEffect(() => {
    const refrescarLigero = () => {
      if (document.visibilityState === "hidden") return;
      cargar(true);
      recargarResumenGps();
    };
    const pollId = window.setInterval(refrescarLigero, 45000);
    window.addEventListener("focus", refrescarLigero);
    document.addEventListener("visibilitychange", refrescarLigero);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("focus", refrescarLigero);
      document.removeEventListener("visibilitychange", refrescarLigero);
    };
  }, [cargar, recargarResumenGps]);

  async function cambiarEst(id, estado) {
    const previous = vehiculos.find(v => v.id === id) || null;
    setVehiculos(prev => prev.map(v => {
      if (v.id !== id) return v;
      return {
        ...v,
        estado,
        taller_entrada_at: estado === "taller" ? (v.taller_entrada_at || new Date().toISOString()) : null,
      };
    }));
    try {
      const updated = await cambiarEstadoVehiculo(id, estado);
      setVehiculos(prev => mergeVehiculoState(prev, updated));
      recargarResumenGps();
    }
    catch(e) {
      if (previous?.id) setVehiculos(prev => mergeVehiculoState(prev, previous));
      else cargar();
      notify(e.message, "error");
    }
  }

  // Separar activos de baja - memoized to avoid recomputing on every render
  const filtrados = useMemo(() => vehiculos.filter(v => {
    // Filtro "Dados de baja" - vista especial
    if (filtroTipo === "baja") return !v.activo || v.estado === "baja";
    // En cualquier otra vista, ocultar los de baja
    if (!v.activo || v.estado === "baja") return false;
    // Filtro por tipo de vehiculo
    if (filtroTipo === "tractoras") {
      const mat = (v.matricula||"").toUpperCase();
      const clase = (v.clase||v.tipo||"").toLowerCase();
      const isRemolque = clase.includes("remolque")||clase.includes("semirremolque")||
                         clase.includes("dolly")||vehiculos.some(t=>t.remolque_id===v.id)||
                         mat.startsWith("R-")||mat.endsWith("-R");
      if (isRemolque) return false;
    }
    else if (filtroTipo === "remolques") {
      const mat = (v.matricula||"").toUpperCase();
      const clase = (v.clase||v.tipo||"").toLowerCase();
      const isRemolque = clase.includes("remolque")||clase.includes("semirremolque")||
                         clase.includes("dolly")||vehiculos.some(t=>t.remolque_id===v.id)||
                         mat.startsWith("R-")||mat.endsWith("-R");
      if (!isRemolque) return false;
    }
    // Subfiltro por estado (solo cuando no es "baja")
    if (filtroEstado !== "todos" && v.estado !== filtroEstado) return false;
    return true;
  }), [vehiculos, filtroTipo, filtroEstado]);

  // Clase legible corta
  const claseCorta = c => c?.replace("Remolque - ","").replace("Semirremolque","Semi") || "-";
  const vehiculosActivos = vehiculos.filter(v => v.activo !== false && v.estado !== "baja");

  return (
    <div style={S.page}>
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:18, flexWrap:"wrap" }}>
        <div style={S.title}>Vehículos</div>

        {/* Filtros tipo - separador visual */}
        <div style={{ display:"flex", gap:4, marginLeft:8, background:"#fff", padding:"4px", borderRadius:9, border:"1px solid #dbe5ec", boxShadow:"0 8px 18px rgba(15,23,42,.04)" }}>
          {[
            ["todos",     "Todos"],
            ["tractoras", "Tractoras"],
            ["remolques", "Remolques"],
            ["baja",      "Bajas"],
          ].map(([id, label]) => (
            <button key={id}
              onClick={() => { setFiltroTipo(id); setFiltroEstado("todos"); }}
              style={{ ...S.btn,
                background: filtroTipo===id ? "linear-gradient(135deg,#0f766e,#0d9488)" : "transparent",
                color:      filtroTipo===id ? "#fff" : "var(--text3)",
                border:     "none",
                padding: "7px 13px", fontSize:12, borderRadius:7, boxShadow:"none",
              }}>
              {label}
            </button>
          ))}
        </div>

        {/* Subfiltro estado - separador visual, solo si no es "baja" */}
        {filtroTipo !== "baja" && (
          <div style={{ display:"flex", gap:4, background:"#fff", padding:"4px", borderRadius:9, border:"1px solid #dbe5ec", boxShadow:"0 8px 18px rgba(15,23,42,.04)" }}>
            {[
              ["todos",      "Todos"],
              ["disponible", "Disponible"],
              ["en_ruta",    "En ruta"],
              ["taller",     "Taller"],
            ].map(([id, label]) => (
              <button key={id}
                onClick={() => setFiltroEstado(id)}
                style={{ ...S.btn,
                  background: filtroEstado===id ? "var(--bg2)" : "transparent",
                  color:      filtroEstado===id ? "var(--text)" : "var(--text4)",
                  border:     "none",
                  padding: "7px 12px", fontSize:12, borderRadius:7, boxShadow:"none",
                  display:"flex", alignItems:"center", gap:5,
                }}>
                {id !== "todos" && (
                  <span style={{ width:6, height:6, borderRadius:"50%", flexShrink:0,
                    background: id==="disponible"?"var(--green)":id==="en_ruta"?"var(--accent-l)":"#f97316",
                    display:"inline-block",
                  }}/>
                )}
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Boton nuevo - al final */}
        {canEdit && (
          <button style={{ ...S.btn, background:"linear-gradient(135deg,#0f766e,#0d9488)", color:"#fff", border:"1px solid #0f766e", marginLeft:"auto" }}
            onClick={() => { setEditando(null); setModal(true); }}>
            + Nuevo vehiculo
          </button>
        )}
      </div>

        <GpsMappingPanel
          vehiculos={vehiculosActivos}
          providers={gpsProviders}
          status={gpsStatus}
          canEdit={canEdit}
          syncing={gpsSyncing}
          syncProvider={gpsSyncProvider}
          onReload={() => { cargar(true); recargarResumenGps(); }}
          onSync={async () => {
            setGpsSyncing(true);
            try {
              const r = await sincronizarGpsVehiculos(gpsSyncProvider || gpsStatus?.active_provider || "");
              const tone = r.no_signal || r.positions_error || r.auth_error ? "warning" : "success";
              notify(r.message || "Sincronizacion GPS preparada", tone);
              recargarResumenGps();
              cargar(true);
            } catch (e) {
              notify(e.message || "No se pudo sincronizar GPS", "error");
            } finally {
              setGpsSyncing(false);
            }
          }}
      />

      {loading
        ? <div style={{ color:"var(--text4)", padding:20 }}>Cargando...</div>
        : filtrados.length === 0
        ? <div style={{ color:"var(--text4)", padding:20 }}>Sin vehiculos en este filtro.</div>
        : (
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(286px,1fr))", gap:14 }}>
            {filtrados.map(v => {
              const esRemolque = v.clase?.includes("Remolque") || v.clase?.includes("Semi");
              return (
                <div key={v.id} id={`vehiculo-card-${v.id}`} style={{
                                          background:String(focusVehiculo?.vehiculo_id || "") === String(v.id) ? "rgba(20,184,166,.10)" : "rgba(255,255,255,.96)",
                                          border:`1px solid ${String(focusVehiculo?.vehiculo_id || "") === String(v.id) ? "rgba(20,184,166,.65)" : "#dbe5ec"}`,
                                          borderRadius:12, padding:16,
                                          cursor:"pointer", transition:"border-color .15s, box-shadow .15s", boxShadow:"0 12px 26px rgba(15,23,42,.05)" }}
                  onClick={() => { setEditando(v); setModal(true); }}
                  onMouseEnter={e => e.currentTarget.style.borderColor="var(--accent-l)"}
                  onMouseLeave={e => e.currentTarget.style.borderColor=String(focusVehiculo?.vehiculo_id || "") === String(v.id) ? "rgba(20,184,166,.65)" : "#dbe5ec"}>

                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:10 }}>
                    <div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:900, fontSize:18, color:"#134e4a" }}>{v.matricula}</div>
                      <div style={{ fontSize:12, color:"var(--text2)", marginTop:2 }}>
                        {v.marca||""} {v.modelo||""} {v.anio?`(${v.anio})`:""}
                      </div>
                    </div>
                    <span style={{ ...S.badge, background:"transparent", color:EC[v.estado]||"var(--text4)", padding:0, gap:6 }}>
                      <span style={{width:7,height:7,borderRadius:"50%",background:EC[v.estado]||"var(--text4)",display:"inline-block"}} />
                      {v.estado?.replace("_"," ")||"-"}
                    </span>
                  </div>

                  {/* Clase */}
                  <div style={{ fontSize:11, color:"var(--text4)", marginBottom:8, display:"flex", gap:8, flexWrap:"wrap" }}>
                    <span style={{ background:"#f1f5f9", padding:"3px 9px", borderRadius:10, border:"1px solid #e2e8f0" }}>
                      {claseCorta(v.clase)}
                    </span>
                    {v.combustible && <span style={{ color:"var(--text5)" }}>{v.combustible}</span>}
                    {v.potencia_cv && <span style={{ color:"var(--text5)" }}>{v.potencia_cv} CV</span>}
                  </div>

                  <div style={{marginBottom:8,background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:7,padding:"8px 10px"}}>
                    <div style={{fontSize:9,color:"var(--text5)",textTransform:"uppercase",letterSpacing:".06em"}}>Ubicacion</div>
                    <div style={{fontSize:12,fontWeight:700,color:v.ubicacion_actual?"var(--text)":"var(--text5)"}}>
                      {v.ubicacion_actual || "Sin datos GPS"}
                    </div>
                    <div style={{fontSize:10,color:"var(--text5)",marginTop:2}}>
                      {GPS_PROVIDER_LABELS[v.ubicacion_fuente] || GPS_PROVIDER_LABELS[v.gps_provider] || v.ubicacion_fuente || v.gps_provider || "Sin fuente"}
                      {v.ubicacion_ts ? ` - ${new Date(v.ubicacion_ts).toLocaleString("es-ES")}` : ""}
                    </div>
                    {(v.gps_lat || v.gps_lng) && (
                      <div style={{fontSize:10,color:"var(--text5)",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>
                        {v.gps_lat}, {v.gps_lng}
                      </div>
                    )}
                  </div>

                  {/* Masa/KM */}
                  <div style={{ display:"flex", gap:0, marginBottom:10 }}>
                    {(v.tara_kg||v.masa_total_kg) && (
                      <div style={{ flex:1, background:"#f8fafc", borderRadius:"7px 0 0 7px", padding:"8px 10px", borderRight:"1px solid #e2e8f0" }}>
                        <div style={{ fontSize:9, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em" }}>TARA / MMA</div>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>
                          {v.tara_kg?.toLocaleString("es-ES")||"-"} / {v.masa_total_kg?.toLocaleString("es-ES")||"-"} kg
                        </div>
                      </div>
                    )}
                    {!esRemolque && (
                      <div style={{ flex:1, background:"#f8fafc", borderRadius: (v.tara_kg||v.masa_total_kg)?"0 7px 7px 0":"7px", padding:"8px 10px" }}>
                        <div style={{ fontSize:9, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em" }}>KILOMETROS</div>
                        <div style={{ fontSize:13, fontWeight:700, color:"var(--text)", fontFamily:"'JetBrains Mono',monospace" }}>
                          {v.km_actuales?.toLocaleString("es-ES")||"-"} km
                        </div>
                      </div>
                    )}
                  {v.estado==="taller" && (()=>{
                    const entrada = v.taller_entrada_at || null;
                    if (!entrada) return null;
                    const dias = Math.ceil((new Date()-new Date(entrada))/86400000);
                    const media = mediaFacturacionDiaria(v.id,[],pedidos||[]);
                    const perdidas = dias*media;
                    return (
                      <div style={{ gridColumn:"1/-1", marginTop:6, padding:"6px 10px", background:"rgba(239,68,68,.08)", border:"1px solid rgba(239,68,68,.2)", borderRadius:6 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:"var(--red)" }}>EN TALLER - {dias} dia{dias!==1?"s":""}  -  Perdidas est.: {Number(perdidas).toLocaleString("es-ES",{minimumFractionDigits:2})} EUR</div>
                      </div>
                    );
                  })()}
                  {/* Aviso Aviso operacional */}
                  {v.notas_operacion?.trim() && (
                    <div style={{gridColumn:"1/-1",marginTop:6,padding:"5px 10px",
                      background:"rgba(245,158,11,.1)",border:"1px solid rgba(245,158,11,.3)",
                      borderRadius:6,display:"flex",gap:6,alignItems:"flex-start"}}>
                      <span style={{fontSize:14,flexShrink:0}}>Aviso</span>
                      <div style={{fontSize:11,color:"#f59e0b",fontWeight:700,lineHeight:1.5}}>
                        {(v.notas_operacion||"").split("\n").map((l,i)=><div key={i}>{l}</div>)}
                      </div>
                    </div>
                  )}
                  </div>
                  {/* Documentacion semaforo */}
                  {(v.fecha_itv||v.fecha_seguro||v.fecha_matriculacion) && (
                    <div style={{ marginBottom:10 }}>
                      {[
                        { label:"ITV",      fecha:v.fecha_itv },
                        { label:"Seguro",   fecha:v.fecha_seguro },
                      ].filter(d=>d.fecha).map(d => {
                        const dias = Math.ceil((new Date(d.fecha) - new Date()) / 86400000);
                        const color = dias > 30 ? "var(--green)" : dias > 7 ? "#f59e0b" : dias > 0 ? "var(--orange)" : "var(--red)";
                        const label = dias > 0 ? `Vence en ${dias}d ${dias<=30?"Aviso":"OK"}` : `VENCIDO hace ${Math.abs(dias)}d`;
                        return (
                          <div key={d.label} style={{ display:"flex", justifyContent:"space-between", padding:"3px 0", borderBottom:"1px solid var(--border)", fontSize:12 }}>
                            <span style={{ color:"var(--text3)" }}>{d.label}</span>
                            <span style={{ color, fontWeight:600 }}>{label}</span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Valor compra/venta */}
                  {(v.valor_compra || v.fecha_compra) && (
                    <div style={{ fontSize:11, color:"var(--text5)", marginBottom: canEdit?10:0 }}>
                      {v.fecha_compra ? `Alta: ${new Date(v.fecha_compra).toLocaleDateString("es-ES")}` : ""}
                      {v.valor_compra ? ` - ${fmt2(v.valor_compra)} EUR` : ""}
                      {v.fecha_venta  ? ` - Vendido: ${new Date(v.fecha_venta).toLocaleDateString("es-ES")}` : ""}
                    </div>
                  )}

                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }} onClick={e=>e.stopPropagation()}>
                    {(!v.activo || v.estado === "baja") ? (
                                            <>
                        {canBaja && (
                          <button
                            style={{ ...S.btn, background:"rgba(16,185,129,.1)", color:"#10b981", border:"1px solid rgba(16,185,129,.3)", padding:"3px 8px", fontSize:11 }}
                            onClick={async()=>{
                              if(await confirmDialog({title:"Reactivar vehiculo",message:`Reactivar ${v.matricula}? Volvera a aparecer en el sistema como disponible.`,confirmText:"Reactivar"})){
                                await reactivarVehiculo(v.id); cargar();
                              }
                            }}>
                            Reactivar
                          </button>
                        )}
                        {canEliminar && (
                          <button
                            style={{ ...S.btn, background:"rgba(239,68,68,.1)", color:"#ef4444", border:"1px solid rgba(239,68,68,.3)", padding:"3px 8px", fontSize:11, fontWeight:700 }}
                            onClick={async(e)=>{
                              e.stopPropagation();
                              const confirmar = await confirmDialog({
                                title: "Eliminar definitivamente",
                                message: `ELIMINAR DEFINITIVAMENTE "${v.matricula}"\n\nEsta accion eliminara el vehiculo del sistema de forma permanente.\nNO SE PUEDE DESHACER.\n\nEstas seguro?`,
                                confirmText: "Eliminar definitivo",
                                tone: "danger",
                              });
                              if (!confirmar) return;
                              try {
                                await eliminarVehiculo(v.id, { forzar: true });
                                cargar();
                              } catch(err){ notify("Error: " + err.message, "error"); }
                            }}>
                            Eliminar definitivo
                          </button>
                        )}
                      </>
                    ) : (
                                            <>
                        {canEdit && ["disponible","en_ruta","taller"].filter(e=>e!==v.estado).map(e=>(
                          <button key={e}
                            style={{ ...S.btn, background:"transparent", color:EC[e], border:`1px solid ${EC[e]}40`, padding:"3px 8px", fontSize:11 }}
                            onClick={e2=>{
                              e2.stopPropagation();
                              // "en ruta" asks for chofer, others change directly
                              if(e==="en_ruta") setChoferPicker({vehiculoId:v.id, estado:e, matricula:v.matricula});
                              else cambiarEst(v.id, e);
                            }}>
                            {e.replace("_"," ")}
                          </button>
                        ))}
                        {canBaja && (
                          <button
                            style={{ ...S.btn, background:"rgba(245,158,11,.08)", color:"#f59e0b", border:"1px solid rgba(245,158,11,.3)", padding:"3px 8px", fontSize:11, fontWeight:700 }}
                            onClick={async(e)=>{
                              e.stopPropagation();
                              const ok = await confirmDialog({
                                title: "Dar de baja vehiculo",
                                message: `Dar de baja ${v.matricula}?\n\nEl vehiculo quedara archivado. Podras verlo en el filtro "Dados de baja" y reactivarlo cuando quieras.`,
                                confirmText: "Dar de baja",
                                tone: "warning",
                              });
                              if(!ok) return;
                              try { await eliminarVehiculo(v.id); cargar(); }
                              catch(err){ notify(err.message, "error"); }
                            }}>
                            Dar de baja
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      }

      {/*  Picker chofer al cambiar a En Ruta  */}
      {choferPicker && (
        <ModalChoferPicker
          vehiculoId={choferPicker.vehiculoId}
          matricula={choferPicker.matricula}
          estado={choferPicker.estado}
          choferes={choferes}
          onConfirm={async(choferId, nuevoChofer)=>{
            // Si hay un nuevo chofer a crear
            if(nuevoChofer) {
              try {
                const { crearChofer } = await import("../services/api");
                await crearChofer({nombre: nuevoChofer.nombre, apellidos: nuevoChofer.apellidos||""});
                await cargar(); // reload to get new chofer
              } catch(e) { notify("Error creando chofer: "+e.message, "error"); return; }
            }
            await cambiarEst(choferPicker.vehiculoId, choferPicker.estado);
            setChoferPicker(null);
          }}
          onClose={()=>setChoferPicker(null)}
        />
      )}

      {modal && (
        <ModalVehiculo
          editando={editando}
          choferes={choferes}
          vehiculos={vehiculos}
          onClose={() => { setModal(false); setEditando(null); }}
          onSaved={() => { setModal(false); setEditando(null); cargar(); }}
          onVehiculoActualizado={(updated) => setVehiculos(prev => mergeVehiculoState(prev, updated))}
          onGpsRefresh={recargarResumenGps}
        />
      )}
    </div>
  );
}

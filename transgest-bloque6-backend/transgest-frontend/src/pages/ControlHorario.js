import "./personnel/personnel.css";
import OfficeLeaveRequests from "./personnel/OfficeLeaveRequests";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getControlHorario, getControlHorarioResumen, getMiControlHorario, ficharControlHorario, editarControlHorario, controlHorarioCsvUrl, getControlHorarioConfig, saveControlHorarioConfig, getJornadaConfig, saveJornadaConfig } from "../services/api";
import { notify } from "../services/notify";
import { useAuth } from "../context/AuthContext";

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title:{ fontFamily:"'DM Sans',sans-serif", fontSize:22, fontWeight:900, color:"var(--text)", marginBottom:4 },
  sub:{ fontSize:12, color:"var(--text4)", marginBottom:18 },
  card:{ background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:10, padding:14, marginBottom:14 },
  btn:{ border:"none", borderRadius:8, padding:"8px 12px", fontWeight:900, fontSize:12, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  inp:{ background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", padding:"8px 10px", borderRadius:8, outline:"none", fontFamily:"'DM Sans',sans-serif", fontSize:13 },
  lbl:{ display:"block", fontSize:12, fontWeight:900, textTransform:"uppercase", letterSpacing:".06em", color:"var(--text5)", marginBottom:4 },
  th:{ textAlign:"left", padding:"8px 10px", fontSize:12, textTransform:"uppercase", letterSpacing:".06em", color:"var(--text5)", borderBottom:"1px solid var(--border)" },
  td:{ padding:"9px 10px", borderBottom:"1px solid var(--border)", fontSize:12, color:"var(--text2)", verticalAlign:"top" },
};

function minToClock(min) {
  const n = Math.max(0, Math.round(Number(min || 0)));
  const h = Math.floor(n / 60);
  const m = n % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtDt(v) {
  if (!v) return "-";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "-" : d.toLocaleString("es-ES", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit" });
}

function formatLocalIso(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return formatLocalIso(new Date());
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso() {
  return formatLocalIso(new Date());
}

function minutesBetweenLocal(start, endMs = Date.now()) {
  if (!start) return 0;
  const a = new Date(start).getTime();
  const b = typeof endMs === "number" ? endMs : new Date(endMs).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.floor((b - a) / 60000);
}

function withLiveJornada(row, nowMs = Date.now()) {
  if (!row) return null;
  const salidaMs = row.salida_at ? new Date(row.salida_at).getTime() : nowMs;
  const pausaActivaMin = row.pausa_inicio_at && !row.salida_at ? minutesBetweenLocal(row.pausa_inicio_at, nowMs) : 0;
  const pausaTotal = Math.max(0, Number(row.pausa_total_min || 0) + pausaActivaMin);
  const bruto = row.entrada_at ? minutesBetweenLocal(row.entrada_at, salidaMs) : 0;
  return {
    ...row,
    pausa_activa_min: pausaActivaMin,
    pausa_total_live_min: pausaTotal,
    bruto_min: bruto,
    trabajado_min: Math.max(0, bruto - pausaTotal),
    abierto: !row.salida_at && row.estado !== "cerrado",
    en_pausa: Boolean(row.pausa_inicio_at && !row.salida_at),
  };
}

function useIsMobile(maxWidth = 760) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${maxWidth}px)`).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const media = window.matchMedia(`(max-width: ${maxWidth}px)`);
    const onChange = () => setIsMobile(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, [maxWidth]);
  return isMobile;
}

function monthStartIso() {
  const d = new Date();
  return formatLocalIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

function pedirUbicacion() {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Este navegador no permite obtener ubicación."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
      }),
      err => reject(new Error(err?.message || "No se pudo obtener la ubicación.")),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  });
}

export default function ControlHorario() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const canManage = user?.rol === "gerente";
  const isGerente = user?.rol === "gerente";
  const showOwnClock = !isGerente;
  const [miJornada, setMiJornada] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [items, setItems] = useState([]);
  const [desde, setDesde] = useState(monthStartIso());
  const [hasta, setHasta] = useState(todayIso());
  const [modalidad, setModalidad] = useState("oficina");
  const [ubicacion, setUbicacion] = useState("");
  const [notas, setNotas] = useState("");
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);
  const [gpsStatus, setGpsStatus] = useState("");
  const [fichando, setFichando] = useState(false);
  const [nowTick, setNowTick] = useState(Date.now());
  const [controlCfg, setControlCfg] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const loadSequence = useRef(0);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleError, setScheduleError] = useState("");
  const [jornadaCfg, setJornadaCfg] = useState({ hora_entrada:"08:00", hora_salida:"17:00", pausa_min:60, extras_requieren_aprobacion:true });

  const cargar = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true); setLoadError("");
    try {
      const [m, r, l, cfg, jornada] = await Promise.all([
        showOwnClock ? getMiControlHorario() : Promise.resolve(null),
        getControlHorarioResumen({ desde, hasta }), getControlHorario({ desde, hasta }),
        getControlHorarioConfig(), showOwnClock ? getJornadaConfig() : Promise.resolve(null),
      ]);
      if (sequence !== loadSequence.current) return;
      setMiJornada(m); setResumen(r); setItems(l); setControlCfg(cfg);
      if (jornada) setJornadaCfg(jornada);
      if (canManage) setEmployeeId(id => r.por_usuario?.some(u => u.usuario_id === id) ? id : (r.por_usuario?.find(u => u.rol !== "gerente")?.usuario_id || ""));
    } catch (e) {
      if (sequence === loadSequence.current) setLoadError(e.message || "No se pudo cargar el control horario. Reintenta antes de fichar.");
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [desde, hasta, showOwnClock, canManage]);

  useEffect(() => { const requests = loadSequence; cargar(); return () => { requests.current++; }; }, [cargar, user?.id, user?.empresa_id]);
  useEffect(() => {
    if (!canManage || !employeeId) return undefined;
    let current = true; setScheduleLoading(true); setScheduleError("");
    getJornadaConfig({ usuario_id: employeeId }).then(data => { if (current) setJornadaCfg(data); })
      .catch(e => { if (current) setScheduleError(e.message || "No se pudo cargar la jornada prevista."); })
      .finally(() => { if (current) setScheduleLoading(false); });
    return () => { current = false; };
  }, [canManage, employeeId]);
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 30000);
    return () => clearInterval(id);
  }, []);

  const miJornadaLive = useMemo(() => withLiveJornada(miJornada, nowTick), [miJornada, nowTick]);
  const resumenBase = resumen?.resumen || {};
  const abiertos = Array.isArray(resumen?.abiertas) ? resumen.abiertas : [];
  const estadoTexto = miJornadaLive?.en_pausa ? "En descanso" : miJornadaLive?.abierto ? "Jornada abierta" : miJornadaLive ? "Jornada cerrada" : "Sin fichar";
  const descansoExcedido = Boolean(miJornadaLive?.en_pausa && Number(miJornadaLive.pausa_total_live_min || 0) > Number(jornadaCfg.pausa_min || 0));
  const revision = useMemo(() => {
    const rows = Array.isArray(items) ? items : [];
    const fueraBase = rows.filter(r => r.ubicacion_estado === "fuera_radio");
    const tele = rows.filter(r => String(r.modalidad || "").toLowerCase() === "teletrabajo");
    const abiertosPeriodo = rows.filter(r => !r.salida_at && r.estado !== "cerrado");
    const descansosExcedidos = rows.filter(r => Number(r.pausa_total_live_min || r.pausa_total_min || 0) > Number(jornadaCfg.pausa_min || 0));
    const pendientesJustificar = fueraBase.filter(r => !String(r.notas || r.motivo_ajuste || "").trim());
    return { fueraBase:fueraBase.length, tele:tele.length, abiertos:abiertosPeriodo.length, descansos:descansosExcedidos.length, pendientesJustificar:pendientesJustificar.length };
  }, [items, jornadaCfg.pausa_min]);
  const acciones = useMemo(() => {
    if (!miJornadaLive) return [["entrada", "Fichar entrada", "var(--accent)"]];
    if (miJornadaLive.salida_at) return [["entrada", "Jornada cerrada", "#64748b"]];
    if (miJornadaLive.en_pausa) return [["reanudar", "Terminar descanso", "var(--accent)"], ["salida", "Fichar salida", "#ef4444"]];
    return [["pausa", "Marcar descanso", "#f59e0b"], ["salida", "Fichar salida", "#ef4444"]];
  }, [miJornadaLive]);

  async function fichar(accion) {
    if (loading || loadError || fichando || (accion === "entrada" && miJornadaLive?.salida_at)) return;
    setFichando(true);
    try {
      let ubicacion_gps = null;
      if (["entrada", "salida"].includes(accion)) {
        setGpsStatus("Solicitando ubicación...");
        ubicacion_gps = await pedirUbicacion().catch(gpsErr => {
          setGpsStatus(`${gpsErr.message || "No se pudo obtener la ubicacion."} Se registrara sin GPS.`);
          return { accuracy: 0, missing: true };
        });
        if (ubicacion_gps?.missing) {
          ubicacion_gps = null;
        } else {
          setGpsStatus(`Ubicación capturada (${Math.round(Number(ubicacion_gps.accuracy || 0))} m).`);
        }
      }
      await ficharControlHorario({ accion, modalidad, ubicacion, notas, ubicacion_gps });
      notify("Fichaje registrado.", "success");
      setNotas("");
      await cargar();
    } catch (e) {
      setGpsStatus(e.message || "No se pudo obtener la ubicación.");
      notify(e.message || "No se pudo registrar el fichaje.", "error");
    } finally {
      setFichando(false);
    }
  }

  async function fijarBaseEmpresa() {
    if (!canManage) return;
    try {
      setGpsStatus("Solicitando ubicación para fijar base...");
      const gps = await pedirUbicacion();
      const saved = await saveControlHorarioConfig({
        lat: gps.lat,
        lng: gps.lng,
        accuracy: gps.accuracy,
        radio_m: controlCfg?.radio_m || 250,
        nombre_base: controlCfg?.nombre_base || "Base empresa",
      });
      setControlCfg(saved);
      setGpsStatus("Base de control horario actualizada.");
      notify("Ubicación base guardada.", "success");
    } catch (e) {
      setGpsStatus(e.message || "No se pudo fijar la base.");
      notify(e.message || "No se pudo fijar la ubicación base.", "error");
    }
  }

  function exportCsv() {
    const token = localStorage.getItem("tms_token") || "";
    fetch(controlHorarioCsvUrl({ desde, hasta }), { headers:{ Authorization:`Bearer ${token}` } })
      .then(async res => {
        if (!res.ok) throw new Error("No se pudo exportar el control horario.");
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `control-horario-${desde}-${hasta}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(e => notify(e.message, "error"));
  }

  async function guardarAjuste() {
    if (!canManage) return;
    try {
      await editarControlHorario(edit.id, edit);
      notify("Fichaje ajustado.", "success");
      setEdit(null);
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo ajustar el fichaje.", "error");
    }
  }

  async function guardarJornadaConfig() {
    if (!canManage || !employeeId || scheduleLoading || scheduleError) return;
    try {
      await saveJornadaConfig({ ...jornadaCfg, usuario_id: employeeId });
      notify("Jornada tipo guardada.", "success");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo guardar la jornada tipo.", "error");
    }
  }

  function setPeriodoRapido(tipo) {
    const now = new Date();
    if (tipo === "hoy") {
      const d = todayIso();
      setDesde(d);
      setHasta(d);
      return;
    }
    if (tipo === "mes") {
      setDesde(formatLocalIso(new Date(now.getFullYear(), now.getMonth(), 1)));
      setHasta(todayIso());
      return;
    }
    if (tipo === "anterior") {
      const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const last = new Date(now.getFullYear(), now.getMonth(), 0);
      setDesde(formatLocalIso(first));
      setHasta(formatLocalIso(last));
    }
  }

  return (
    <div className="personnel-page" style={{...S.page,padding:isMobile ? "14px 12px 96px" : S.page.padding,overflowX:"hidden"}}>
      <div className="personnel-breadcrumb">Gestión <span>›</span> <b>Control horario</b></div>
      <h1 style={S.title}>Control horario</h1>
      <div style={S.sub}>Fichaje de empleados, pausas y solicitudes de teletrabajo y vacaciones. Solo Gerencia puede ajustar los registros y la jornada prevista.</div>
      {loadError && <div className="personnel-card" role="alert">{loadError} <button onClick={cargar}>Reintentar</button></div>}
      <div className="personnel-card" style={{...S.card,display:"grid",gap:6,borderColor:"var(--accent-border)",background:"linear-gradient(135deg,var(--accent-soft),var(--bg2))"}}>
        <div style={{fontSize:12,fontWeight:900,color:"var(--accent-xl)",textTransform:"uppercase",letterSpacing:".06em"}}>Registro y privacidad</div>
        <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.55}}>
          El fichaje registra entrada, salida y pausas con eventos trazables. La ubicación se solicita solo en el momento exacto de entrada/salida, sin seguimiento continuo. Los ajustes de Gerencia requieren motivo y conservan los valores anteriores en el historial de auditoría.
        </div>
      </div>

      {canManage && (
        <div className="personnel-card personnel-responsive-flex" style={{...S.card,display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
          <button style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}} onClick={()=>setPeriodoRapido("hoy")}>Hoy</button>
          <button style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}} onClick={()=>setPeriodoRapido("mes")}>Este mes</button>
          <button style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}} onClick={()=>setPeriodoRapido("anterior")}>Mes anterior</button>
          <div style={{fontSize:12,color:"var(--text5)",fontWeight:800,marginLeft:"auto"}}>Revisión de fichajes, incidencias y teletrabajo</div>
        </div>
      )}

      <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:isMobile || !showOwnClock ? "1fr" : "minmax(280px,1.1fr) minmax(280px,1fr)",gap:14,alignItems:"stretch"}}>
        {showOwnClock && <div className="personnel-card" style={S.card}>
          <div className="personnel-responsive-flex" style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"flex-start",marginBottom:10}}>
            <div>
              <div style={{fontSize:12,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Mi jornada</div>
              <div style={{fontSize:18,fontWeight:900,color:"var(--text)",marginTop:2}}>{loading ? "Cargando jornada…" : loadError ? "Jornada no disponible" : estadoTexto}</div>
            </div>
            <div style={{textAlign:"right",fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"var(--accent-xl)"}}>
              {loading || loadError ? "—" : minToClock(miJornadaLive?.trabajado_min)}
              <div style={{fontSize:12,color:"var(--text5)",fontFamily:"'DM Sans',sans-serif"}}>trabajado</div>
            </div>
          </div>
          <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:isMobile ? "1fr" : "repeat(3,1fr)",gap:8,marginBottom:12}}>
            <Mini label="Entrada" value={fmtDt(miJornadaLive?.entrada_at)} />
            <Mini label="Salida" value={fmtDt(miJornadaLive?.salida_at)} />
            <Mini label="Descanso" value={minToClock(miJornadaLive?.pausa_total_live_min)} tone={descansoExcedido ? "#ef4444" : "var(--text)"} />
          </div>
          {miJornadaLive?.abierto && (
            <div className="personnel-responsive-grid" style={{border:`1px solid ${descansoExcedido ? "rgba(239,68,68,.28)" : "var(--accent-a22)"}`,background:descansoExcedido ? "rgba(239,68,68,.08)" : "var(--accent-dim)",borderRadius:10,padding:"10px 12px",marginBottom:10,display:"grid",gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr 1fr",gap:8}}>
              <Mini label="Tiempo fichado" value={minToClock(miJornadaLive.bruto_min)} tone="var(--accent-xl)" />
              <Mini label={miJornadaLive.en_pausa ? "Descanso actual" : "Trabajando ahora"} value={miJornadaLive.en_pausa ? minToClock(miJornadaLive.pausa_activa_min) : minToClock(miJornadaLive.trabajado_min)} tone={descansoExcedido ? "#ef4444" : "var(--green)"} />
              <Mini label="Descanso permitido" value={minToClock(jornadaCfg.pausa_min)} tone="var(--text3)" />
              {descansoExcedido && (
                <div style={{gridColumn:"1/-1",fontSize:12,color:"#ef4444",fontWeight:900}}>
                  Descanso excedido. Al terminar el descanso o cerrar la jornada se avisará a gerencia.
                </div>
              )}
            </div>
          )}
          <div className="personnel-responsive-flex" style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"9px 10px",marginBottom:10,display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",flexWrap:"wrap"}}>
            <div>
              <div style={{fontSize:12,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Ubicación de fichaje</div>
              <div style={{fontSize:12,color:controlCfg?.configurada ? "var(--text3)" : "#f59e0b",fontWeight:800,marginTop:2}}>
                {controlCfg?.configurada
                  ? `${controlCfg.nombre_base || "Base empresa"} · radio ${controlCfg.radio_m || 250} m`
                  : "Base GPS de empresa sin configurar"}
              </div>
              {gpsStatus && <div style={{fontSize:12,color:"var(--text5)",marginTop:3}}>{gpsStatus}</div>}
              {miJornadaLive?.ubicacion_estado && (
                <div style={{fontSize:12,color:miJornadaLive.ubicacion_estado==="fuera_radio" ? "#ef4444" : "var(--green)",fontWeight:800,marginTop:3}}>
                  Último control: {miJornadaLive.ubicacion_estado}{miJornadaLive.ubicacion_distancia_m != null ? ` · ${miJornadaLive.ubicacion_distancia_m} m` : ""}
                </div>
              )}
            </div>
            {canManage && (
              <button onClick={fijarBaseEmpresa} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}}>
                Usar mi ubicación como base
              </button>
            )}
          </div>
          {!miJornadaLive?.salida_at && <>
          <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:8,marginBottom:10}}>
            <div><label style={S.lbl}>Modalidad</label><select disabled={Boolean(miJornadaLive?.entrada_at)} aria-label="Modalidad" style={{...S.inp,width:"100%"}} value={modalidad} onChange={e=>setModalidad(e.target.value)}><option value="oficina">Oficina</option><option value="teletrabajo">Teletrabajo aprobado</option><option value="visita">Visita</option><option value="otro">Otro</option></select></div>
            <div><label style={S.lbl}>Ubicación</label><input disabled={Boolean(miJornadaLive?.entrada_at)} aria-label="Ubicación" style={{...S.inp,width:"100%"}} value={ubicacion} onChange={e=>setUbicacion(e.target.value)} placeholder="Oficina, casa, cliente..." /></div>
          </div>
          <textarea aria-label="Notas de jornada, incidencia o disponibilidad..." style={{...S.inp,width:"100%",minHeight:68,boxSizing:"border-box"}} value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Notas de jornada, incidencia o disponibilidad..." />
          </>}
          <div className="personnel-responsive-flex" style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
            {acciones.map(([accion,label,color]) => (
              <button key={accion} onClick={()=>fichar(accion)} disabled={loading || Boolean(loadError) || fichando || (accion==="entrada" && miJornadaLive?.salida_at)} style={{...S.btn,background:color,color:"#fff",opacity:(fichando || (accion==="entrada" && miJornadaLive?.salida_at)) ? .55 : 1}}>
                {label}
              </button>
            ))}
          </div>
        </div>}

        <div className="personnel-card" style={S.card}>
          <div className="personnel-responsive-flex" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10,marginBottom:10}}>
            <div>
              <div style={{fontSize:12,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em"}}>Resumen periodo</div>
              <div style={{fontSize:18,fontWeight:900,color:"var(--text)"}}>{loading || loadError ? "—" : minToClock(resumenBase.trabajado_min)}</div>
            </div>
            {canManage && <button onClick={exportCsv} style={{...S.btn,background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)"}}>Exportar CSV</button>}
          </div>
          <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:isMobile ? "repeat(2,minmax(0,1fr))" : "repeat(4,1fr)",gap:8,marginBottom:12}}>
            <Mini label="Jornadas" value={loading || loadError ? "—" : resumenBase.jornadas || 0} />
            <Mini label="Abiertas" value={loading || loadError ? "—" : resumenBase.abiertas || 0} tone={Number(resumenBase.abiertas) ? "#f59e0b" : "var(--green)"} />
            <Mini label="Pausas" value={loading || loadError ? "—" : minToClock(resumenBase.pausa_min)} />
            <Mini label="Personas abiertas" value={loading || loadError ? "—" : abiertos.length} />
            {canManage && <Mini label="Fuera de base" value={revision.fueraBase} tone={revision.fueraBase ? "#ef4444" : "var(--green)"} />}
            {canManage && <Mini label="Teletrabajo" value={revision.tele} tone="var(--accent-xl)" />}
            {canManage && <Mini label="Justificantes" value={revision.pendientesJustificar} tone={revision.pendientesJustificar ? "#f59e0b" : "var(--green)"} />}
            {canManage && <Mini label="Descansos" value={revision.descansos} tone={revision.descansos ? "#f97316" : "var(--green)"} />}
          </div>
          <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr",gap:8}}>
            <div><label style={S.lbl}>Desde</label><input aria-label="Desde" type="date" style={{...S.inp,width:"100%"}} value={desde} onChange={e=>setDesde(e.target.value)} /></div>
            <div><label style={S.lbl}>Hasta</label><input aria-label="Hasta" type="date" style={{...S.inp,width:"100%"}} value={hasta} onChange={e=>setHasta(e.target.value)} /></div>
          </div>
          {abiertos.length > 0 && (
            <div style={{marginTop:12,display:"grid",gap:6}}>
              {abiertos.slice(0,4).map(a => (
                <div className="personnel-responsive-flex" key={a.id} style={{fontSize:12,color:"var(--text3)",display:"flex",justifyContent:"space-between",gap:8}}>
                  <span>{a.usuario_nombre} · {a.en_pausa ? "pausa" : "activo"}</span>
                  <b>{minToClock(a.trabajado_min)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <OfficeLeaveRequests key={`${user?.empresa_id}:${user?.id}`} canManage={canManage} today={todayIso()}/>
      <section className="personnel-card" style={S.card} aria-label="Jornada prevista">
        <h2 style={{fontSize:16, marginTop:0}}>Jornada prevista</h2>
        <p style={{fontSize:13,color:"var(--text4)"}}>Horario de referencia configurado por Gerencia. Los fichajes registran la hora real; no generan entradas o salidas automáticas.</p>
        {canManage ? <>
          <label style={S.lbl}>Empleado<select aria-label="Empleado para jornada prevista" style={{...S.inp,display:"block",width:"100%",marginTop:6,marginBottom:12}} value={employeeId} onChange={e=>setEmployeeId(e.target.value)}>
            <option value="">Seleccionar empleado</option>
            {(resumen?.por_usuario || []).filter(u=>u.rol!=="gerente").map(u=><option key={u.usuario_id} value={u.usuario_id}>{u.nombre} · {u.rol}</option>)}
          </select></label>
          {scheduleError && <p role="alert">{scheduleError}</p>}
          {employeeId && !scheduleError && <fieldset disabled={scheduleLoading} style={{border:0,padding:0,margin:0}}>
            <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,alignItems:"end"}}>
              <Field label="Entrada prevista" type="time" value={jornadaCfg.hora_entrada} onChange={v=>setJornadaCfg(p=>({...p,hora_entrada:v}))}/>
              <Field label="Salida prevista" type="time" value={jornadaCfg.hora_salida} onChange={v=>setJornadaCfg(p=>({...p,hora_salida:v}))}/>
              <Field label="Pausa prevista (min)" type="number" value={jornadaCfg.pausa_min} onChange={v=>setJornadaCfg(p=>({...p,pausa_min:v}))}/>
              <button onClick={guardarJornadaConfig}>Guardar jornada prevista</button>
            </div>
          </fieldset>}
          <button onClick={fijarBaseEmpresa} style={{marginTop:12}}>Usar mi ubicación como base</button>
          {gpsStatus && <p role="status">{gpsStatus}</p>}
        </> : <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:10}}>
          <Mini label="Entrada prevista" value={loadError || loading ? "—" : jornadaCfg.hora_entrada}/>
          <Mini label="Salida prevista" value={loadError || loading ? "—" : jornadaCfg.hora_salida}/>
          <Mini label="Pausa prevista" value={loadError || loading ? "—" : minToClock(jornadaCfg.pausa_min)}/>
        </div>}
      </section>

      <div className="personnel-card" style={S.card}>
        <div style={{fontSize:14,fontWeight:900,color:"var(--text)",marginBottom:10}}>Jornadas registradas</div>
        {loading ? <div role="status">Cargando…</div> : loadError ? <p>No se han podido consultar los fichajes.</p> : (
          <div style={{overflowX:"auto"}}>
            <div className="personnel-table"><table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}>
              <thead><tr><th style={S.th}>Fecha</th><th style={S.th}>Usuario</th><th style={S.th}>Entrada</th><th style={S.th}>Salida</th><th style={S.th}>Pausa</th><th style={S.th}>Trabajado</th><th style={S.th}>Estado</th><th style={S.th}>Modalidad</th><th style={S.th}>Ubicación</th>{canManage && <th style={S.th}>Acciones</th>}</tr></thead>
              <tbody>
                {items.map(row => (
                  <tr key={row.id}>
                    <td style={S.td}>{row.fecha ? new Date(row.fecha).toLocaleDateString("es-ES") : "-"}</td>
                    <td style={S.td}><b>{row.usuario_nombre}</b><div style={{color:"var(--text5)",fontSize:12}}>{row.usuario_rol}</div></td>
                    <td style={S.td}>{fmtDt(row.entrada_at)}</td>
                    <td style={S.td}>{fmtDt(row.salida_at)}</td>
                    <td style={S.td}>{minToClock(row.pausa_total_live_min)}</td>
                    <td style={S.td}><b>{minToClock(row.trabajado_min)}</b></td>
                    <td style={S.td}><span style={{color:row.estado==="cerrado"?"var(--green)":"#f59e0b",fontWeight:900}}>{row.en_pausa ? "pausa" : row.estado}</span></td>
                    <td style={S.td}>{row.modalidad || "-"}</td>
                    <td style={S.td}>
                      <span style={{color:row.ubicacion_estado==="fuera_radio"?"#ef4444":"var(--text3)",fontWeight:800}}>{row.ubicacion_estado || "-"}</span>
                      {row.ubicacion_distancia_m != null && <div style={{color:"var(--text5)",fontSize:12}}>{row.ubicacion_distancia_m} m</div>}
                      {row.ubicacion && <div style={{color:"var(--text5)",fontSize:12}}>{row.ubicacion}</div>}
                    </td>
                    {canManage && <td style={S.td}><button onClick={()=>setEdit({...row, motivo:""})} style={{...S.btn,padding:"5px 8px",background:"var(--bg4)",color:"var(--text)",border:"1px solid var(--border2)"}}>Editar</button></td>}
                  </tr>
                ))}
                {!items.length && <tr><td colSpan={canManage ? 10 : 9} style={{...S.td,textAlign:"center",color:"var(--text4)"}}>Sin fichajes en el periodo.</td></tr>}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      {edit && canManage && (
        <div className="personnel-overlay personnel-responsive-flex" role="dialog" aria-modal="true" aria-label="Detalle y edición" style={{position:"fixed",inset:0,zIndex:300,background:"rgba(0,0,0,.72)",display:"flex",alignItems:"center",justifyContent:"center",padding:18}}>
          <div className="personnel-card" style={{...S.card,width:"100%",maxWidth:560,boxSizing:"border-box",margin:0}}>
            <div style={{fontSize:18,fontWeight:900,color:"var(--text)",marginBottom:4}}>Ajustar fichaje</div>
            <div style={{fontSize:12,color:"var(--text4)",marginBottom:12}}>{edit.usuario_nombre} · {edit.fecha ? new Date(edit.fecha).toLocaleDateString("es-ES") : ""}</div>
            <div className="personnel-responsive-grid" style={{display:"grid",gridTemplateColumns:isMobile ? "1fr" : "1fr 1fr",gap:10}}>
              <Field label="Entrada" type="datetime-local" value={toLocalInput(edit.entrada_at)} onChange={v=>setEdit(p=>({...p,entrada_at:v ? new Date(v).toISOString() : null}))} />
              <Field label="Salida" type="datetime-local" value={toLocalInput(edit.salida_at)} onChange={v=>setEdit(p=>({...p,salida_at:v ? new Date(v).toISOString() : null}))} />
              <Field label="Pausa total min" type="number" value={edit.pausa_total_min || 0} onChange={v=>setEdit(p=>({...p,pausa_total_min:v}))} />
              <Field label="Modalidad" value={edit.modalidad || ""} onChange={v=>setEdit(p=>({...p,modalidad:v}))} />
            </div>
            <label style={S.lbl}>Motivo obligatorio</label>
            <textarea aria-label="Motivo obligatorio" style={{...S.inp,width:"100%",minHeight:70,boxSizing:"border-box"}} value={edit.motivo || ""} onChange={e=>setEdit(p=>({...p,motivo:e.target.value}))} />
            <div className="personnel-responsive-flex" style={{display:"flex",justifyContent:"flex-end",gap:8,marginTop:14}}>
              <button onClick={()=>setEdit(null)} style={{...S.btn,background:"transparent",border:"1px solid var(--border2)",color:"var(--text3)"}}>Cancelar</button>
              <button onClick={guardarAjuste} style={{...S.btn,background:"var(--accent)",color:"#fff"}}>Guardar ajuste</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Mini({ label, value, tone = "var(--text)" }) {
  return <div style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:8,padding:"8px 9px"}}>
    <div style={{fontSize:12,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".05em"}}>{label}</div>
    <div style={{fontSize:13,color:tone,fontWeight:900,marginTop:3}}>{value ?? "-"}</div>
  </div>;
}

function Field({ label, value, onChange, type = "text" }) {
  return <div><label style={S.lbl}>{label}</label><input aria-label={label} type={type} style={{...S.inp,width:"100%",boxSizing:"border-box"}} value={value ?? ""} onChange={e=>onChange(e.target.value)} /></div>;
}

function toLocalInput(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const pad = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

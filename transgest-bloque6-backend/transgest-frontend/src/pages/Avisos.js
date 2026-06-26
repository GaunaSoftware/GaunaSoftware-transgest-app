import { useState, useEffect, useMemo } from "react";
import { getTodosLosDocs, getVehiculos, getNotificaciones, marcarNotificacionLeida, marcarTodasNotificacionesLeidas, getTallerEstado, getEmpresaConfig, setConfigAlertas } from "../services/api";
import { confirmDialog } from "../services/notify";
import { setRuntimeFocus } from "../services/runtimeFocus";

// ── Semáforo ─────────────────────────────────────────────────────────────
function semaforo(fecha) {
  if (!fecha) return { color:"var(--text4)", label:"Sin fecha", dias:null, nivel:6, bg:"rgba(61,79,114,.1)" };
  const dias = Math.ceil((new Date(fecha) - new Date()) / 86400000);
  if (dias > 216) return { color:"var(--green)", label:`${dias} días`, dias, nivel:6, bg:"rgba(34,211,160,.10)", texto:"En plazo" };
  if (dias > 90)  return { color:"var(--green)", label:`${dias} días`, dias, nivel:5, bg:"rgba(34,211,160,.10)", texto:"En plazo" };
  if (dias > 60)  return { color:"#84cc16", label:`${dias} días`, dias, nivel:4, bg:"rgba(132,204,22,.10)", texto:"Atención próxima" };
  if (dias > 30)  return { color:"#fbbf24", label:`${dias} días`, dias, nivel:3, bg:"rgba(251,191,36,.12)", texto:"Renovar pronto" };
  if (dias > 7)   return { color:"#fb8c3a", label:`${dias} días`, dias, nivel:2, bg:"rgba(251,140,58,.14)", texto:"Renovar urgente" };
  if (dias > 0)   return { color:"#f05252", label:`${dias} días`, dias, nivel:1, bg:"rgba(240,82,82,.16)", texto:"Crítico" };
  return { color:"#f05252", label:"CADUCADO", dias, nivel:0, bg:"rgba(240,82,82,.20)", texto:"Caducado", caducado:true };
}

const LEYENDA = [
  { color:"var(--green)", rango:">216 días",  texto:"En plazo" },
  { color:"#84cc16", rango:"61–216 días", texto:"Atención próxima" },
  { color:"#fbbf24", rango:"31–60 días", texto:"Renovar pronto" },
  { color:"#fb8c3a", rango:"8–30 días",  texto:"Renovar urgente" },
  { color:"#f05252", rango:"1–7 días",   texto:"Crítico" },
  { color:"#f05252", rango:"Caducado",   texto:"Caducado", bold:true },
];

const S = {
  page: {flex:1, padding:"24px 28px"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:22,fontWeight:800,marginBottom:4,color:"var(--text)"},
  card: {background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border)",borderRadius:8,overflow:"hidden"},
  th:   {textAlign:"left",padding:"9px 14px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)",borderBottom:"1px solid var(--border)",background:"var(--bg3)",whiteSpace:"nowrap"},
  td:   {padding:"10px 14px",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text)",verticalAlign:"middle"},
  btn:  {padding:"6px 14px",borderRadius:7,border:"1px solid",fontSize:12,fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"},
};

function Pastilla({ s }) {
  return (
    <span style={{display:"inline-flex",alignItems:"center",padding:"3px 11px",borderRadius:20,
                  fontSize:12,fontWeight:700,background:s.bg,color:s.color,
                  minWidth:80,justifyContent:"center",
                  boxShadow:s.nivel<=1?`0 0 8px ${s.color}40`:undefined}}>
      {s.label}
    </span>
  );
}

function cleanKey(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dateMs(value) {
  if (!value) return 0;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function entidadLabel(doc = {}) {
  return doc.vehiculo_matricula || doc.chofer_nombre || doc.entidad_nombre || "-";
}

function entidadTipo(doc = {}) {
  return doc.entidad_tipo || (doc.vehiculo_matricula ? "vehiculo" : doc.chofer_nombre ? "chofer" : "otros");
}

function entidadId(doc = {}) {
  return doc.entidad_id || doc.vehiculo_id || doc.chofer_id || entidadLabel(doc);
}

function docGroupKey(doc = {}) {
  return [
    entidadTipo(doc),
    cleanKey(entidadId(doc)),
    cleanKey(doc.tipo_doc || doc.tipo || "otros"),
  ].join(":");
}

function docFreshnessScore(doc = {}) {
  return Math.max(dateMs(doc.fecha_vencimiento), dateMs(doc.fecha_emision), dateMs(doc.created_at));
}

function dedupeDocumentos(rows = []) {
  const groups = new Map();
  rows.forEach(doc => {
    const key = docGroupKey(doc);
    const list = groups.get(key) || [];
    list.push(doc);
    groups.set(key, list);
  });
  const vigentes = [];
  const duplicados = [];
  groups.forEach(list => {
    const sorted = [...list].sort((a, b) => docFreshnessScore(b) - docFreshnessScore(a));
    const current = { ...sorted[0], historial_count: sorted.length, historial_oculto: Math.max(0, sorted.length - 1) };
    vigentes.push(current);
    if (sorted.length > 1) duplicados.push({ key: docGroupKey(current), actual: current, historico: sorted.slice(1), total: sorted.length });
  });
  return { vigentes, duplicados };
}

function dedupeNotificaciones(rows = []) {
  const seen = new Set();
  return rows.filter(n => {
    const key = n?.data?.dedupe_key
      || `${n?.tipo || ""}:${n?.data?.pedido_id || ""}:${n?.data?.colaborador_id || ""}:${n?.data?.exception_key || ""}:${n?.titulo || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export default function Avisos() {
  const [docs,      setDocs]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [filtro,    setFiltro]    = useState("todos");
  const [q,         setQ]         = useState("");
  const [tab,       setTab]       = useState("documentos");
  const [vehiculos, setVehiculos] = useState([]);
  const [avisosCfg, setAvisosCfg] = useState([]);
  const [tallerEstado, setTallerEstado] = useState({ reparaciones: [] });
  const [modalAv,   setModalAv]   = useState(false);
  const [editAv,    setEditAv]    = useState(null);
  const [notificaciones, setNotificaciones] = useState([]);
  const [noLeidas, setNoLeidas] = useState(0);

  const TIPOS_MANT = ["Cambio aceite","Cambio filtros","Cambio neumáticos","Revisión frenos","Cambio correa distribución","Revisión tacógrafo","Mantenimiento preventivo","Revisión ITV","Otro"];

  useEffect(() => {
    Promise.all([
      getTodosLosDocs().catch(()=>[]),
      getVehiculos().catch(()=>[]),
      getTallerEstado().catch(()=>null),
      getEmpresaConfig().catch(()=>null),
      cargarNotificaciones(),
    ])
      .then(([docsData, vehiculosData, tallerData, empresaCfg]) => {
        setDocs(Array.isArray(docsData) ? docsData : []);
        setVehiculos(Array.isArray(vehiculosData) ? vehiculosData : []);
        setTallerEstado(tallerData && typeof tallerData === "object" ? tallerData : { reparaciones: [] });
        setAvisosCfg(Array.isArray(empresaCfg?.cfg_alertas) ? empresaCfg.cfg_alertas : []);
      })
      .finally(()=>setLoading(false));
  }, []);

  function cargarNotificaciones() {
    return getNotificaciones(80)
      .then(d => {
        const pendientes = dedupeNotificaciones(Array.isArray(d?.data) ? d.data.filter(n => !n?.leida) : []);
        setNotificaciones(pendientes);
        setNoLeidas(Number(d?.no_leidas || 0));
      })
      .catch(() => {
        setNotificaciones([]);
        setNoLeidas(0);
      });
  }

  async function marcarLeida(id) {
    await marcarNotificacionLeida(id);
    setNotificaciones(prev => prev.filter(n => n.id !== id));
    setNoLeidas(prev => Math.max(0, Number(prev || 0) - 1));
    window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
  }

  async function marcarTodas() {
    await marcarTodasNotificacionesLeidas();
    setNotificaciones([]);
    setNoLeidas(0);
    window.dispatchEvent(new CustomEvent("tms:notificaciones-refresh"));
  }

  function abrirDestino(n) {
    if (n?.data?.colaborador_id && (n?.data?.view === "colaboradores" || String(n?.tipo || "").startsWith("colaborador_"))) {
      setRuntimeFocus("tms_colaborador_focus", {
        source: "avisos",
        colaborador_id: n.data.colaborador_id,
        title: n.titulo,
        description: n.mensaje,
        type: n.tipo,
      });
      window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"colaboradores" }));
      return;
    }
    if (n?.data?.pedido_id) {
      setRuntimeFocus("tms_trafico_focus", {
        source: "avisos",
        pedido_id: n.data.pedido_id,
        title: n.titulo,
        description: n.mensaje,
        type: n.tipo,
      });
      window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"gestion_trafico" }));
      return;
    }
    const key = n?.data?.exception_key;
    if (key) {
      setRuntimeFocus("tms_excepcion_focus", key);
      window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"excepciones" }));
    }
  }

  function abrirDocumento(d) {
    const tipo = entidadTipo(d);
    const id = entidadId(d);
    if (tipo === "vehiculo" && id) {
      setRuntimeFocus("tms_vehiculos_focus", {
        source: "avisos_documentos",
        vehiculo_id: id,
        title: d.tipo_doc,
        description: `Documento ${d.tipo_doc || ""} ${d.s?.texto || ""}`.trim(),
      });
      window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"vehiculos" }));
      return;
    }
    if (tipo === "chofer" && id) {
      setRuntimeFocus("tms_choferes_focus", {
        source: "avisos_documentos",
        chofer_id: id,
        title: d.tipo_doc,
        description: `Documento ${d.tipo_doc || ""} ${d.s?.texto || ""}`.trim(),
      });
      window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"choferes" }));
      return;
    }
    window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"documentos" }));
  }

  async function guardarAvisosCfg(next) {
    const lista = Array.isArray(next) ? next : [];
    await setConfigAlertas(lista);
    setAvisosCfg(lista);
  }

  // ── Maintenance alerts calc ──
  const avisosMant = useMemo(() => {
    const reps = Array.isArray(tallerEstado?.reparaciones) ? tallerEstado.reparaciones : [];
    const map = new Map();
    vehiculos.forEach(v => {
    const vMerged = { ...v };
    avisosCfg.forEach(cfg => {
      if (!cfg.activo) return;
      const ultimas = reps.filter(r=>r.vehiculo_id===v.id&&(r.tipo===cfg.tipo_mantenimiento||r.tipo?.includes(cfg.tipo_mantenimiento))).sort((a,b)=>new Date(b.fecha)-new Date(a.fecha));
      const ult = ultimas[0];
      if (!ult) return;
      const diasDesde = Math.ceil((new Date() - new Date(ult.fecha)) / 86400000);
      const kmDesde   = (vMerged.km_actuales||0) - (ult.km_en_intervencion||0);
      const pctDias   = cfg.dias_aviso > 0 ? diasDesde/cfg.dias_aviso : 0;
      const pctKm     = cfg.km_aviso   > 0 ? kmDesde/cfg.km_aviso    : 0;
      const pct = Math.max(pctDias, pctKm);
      if (pct >= 0.75) {
        const nivel = pct >= 1 ? 0 : pct >= 0.9 ? 1 : 2;
        const item = {
          key: `${v.id}:${cleanKey(cfg.tipo_mantenimiento)}`,
          vehiculo_id: v.id,
          vehiculo_matricula: v.matricula,
          tipo: cfg.tipo_mantenimiento,
          diasDesde, kmDesde,
          diasLimite: cfg.dias_aviso, kmLimite: cfg.km_aviso,
          pct, nivel,
          ultimaFecha: ult.fecha,
          descripcion: cfg.descripcion,
        };
        const prev = map.get(item.key);
        if (!prev || item.pct > prev.pct) map.set(item.key, item);
      }
    });
    });
    return [...map.values()].sort((a,b) => a.nivel - b.nivel || b.pct - a.pct);
  }, [avisosCfg, tallerEstado, vehiculos]);

  const { vigentes: docsVigentes, duplicados: docsDuplicados } = useMemo(() => dedupeDocumentos(docs), [docs]);
  const todosConSemaforo = docsVigentes.map(d => ({ ...d, s: semaforo(d.fecha_vencimiento) }));

  const filtrados = todosConSemaforo
    .filter(d => {
      if (filtro==="criticos") return d.s.nivel <= 2;
      if (filtro==="incompletos") return !d.fecha_vencimiento;
      if (filtro==="duplicados") return Number(d.historial_oculto || 0) > 0;
      if (filtro==="vehiculos") return !!d.vehiculo_matricula;
      if (filtro==="choferes") return !!d.chofer_nombre;
      return true;
    })
    .filter(d => {
      if (!q) return true;
      const txt = `${d.tipo_doc} ${d.vehiculo_matricula||""} ${d.chofer_nombre||""} ${d.entidad_nombre||""} ${d.organismo||""}`.toLowerCase();
      return txt.includes(q.toLowerCase());
    })
    .sort((a,b) => (a.s.dias??99999) - (b.s.dias??99999));

  // Contadores para los KPIs
  const caducados = todosConSemaforo.filter(d=>d.s.nivel===0).length;
  const criticos  = todosConSemaforo.filter(d=>d.s.nivel<=2).length;
  const atencion  = todosConSemaforo.filter(d=>d.s.nivel===3||d.s.nivel===4).length;
  const sinFecha  = todosConSemaforo.filter(d=>!d.fecha_vencimiento).length;
  const enPlazo   = todosConSemaforo.filter(d=>d.fecha_vencimiento && d.s.nivel>=5).length;
  const filtrosDocumentos = [["todos","Todos"],["criticos","Criticos y caducados"],["incompletos","Incompletos"],["duplicados","Con historial"],["vehiculos","Vehiculos"],["choferes","Choferes"]];

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
        <div style={S.title}>Avisos y vencimientos</div>
      </div>
      {/* Main tabs */}
      <div style={{display:"flex",gap:0,borderBottom:"1px solid var(--border)",marginBottom:18}}>
        {[["internos",`Internos${noLeidas>0?` (${noLeidas})`:""}`],["documentos","Documentación"],["mantenimiento",`Mantenimiento${avisosMant.length>0?` (${avisosMant.length})`:""}`],["config","Configurar avisos"]].map(([id,l])=>(
          <button key={id} onClick={()=>setTab(id)}
            style={{padding:"7px 16px",border:"none",borderBottom:`2px solid ${tab===id?"var(--accent-l)":"transparent"}`,
                    background:"none",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer",
                    color:tab===id?"var(--accent-xl)":"var(--text4)"}}>
            {l}
          </button>
        ))}
      </div>

      {tab==="internos" && (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,marginBottom:12}}>
            <div style={{fontSize:12,color:"var(--text4)"}}>
              Avisos internos asignados por el sistema o por otros usuarios.
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={cargarNotificaciones} style={{...S.btn,borderColor:"var(--border2)",background:"var(--bg4)",color:"var(--text2)"}}>Actualizar</button>
              <button onClick={marcarTodas} disabled={noLeidas===0}
                style={{...S.btn,borderColor:"rgba(34,211,160,.35)",background:noLeidas>0?"rgba(34,211,160,.12)":"transparent",color:noLeidas>0?"var(--green)":"var(--text5)",opacity:noLeidas>0?1:.6}}>
                Marcar todo como leido
              </button>
            </div>
          </div>
          {notificaciones.length===0 ? (
            <div style={{textAlign:"center",padding:50,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:800,color:"var(--text)",marginBottom:6}}>Sin avisos internos</div>
              <div style={{color:"var(--text4)",fontSize:12}}>Cuando se te asigne una excepcion o tarea critica aparecera aqui.</div>
            </div>
          ) : (
            <div style={{display:"grid",gap:10}}>
              {notificaciones.map(n => (
                <div key={n.id} style={{background:n.leida?"var(--bg2)":"rgba(34,211,160,.08)",border:`1px solid ${n.leida?"var(--border)":"rgba(34,211,160,.28)"}`,borderRadius:10,padding:"13px 14px",display:"grid",gridTemplateColumns:"1fr auto",gap:12,alignItems:"start"}}>
                  <div>
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                      {!n.leida && <span style={{width:8,height:8,borderRadius:"50%",background:"var(--green)",boxShadow:"0 0 8px rgba(34,211,160,.45)"}} />}
                      <strong style={{fontSize:14,color:"var(--text)"}}>{n.titulo}</strong>
                      <span style={{fontSize:10,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>
                        {n.created_at ? new Date(n.created_at).toLocaleString("es-ES") : ""}
                      </span>
                    </div>
                    <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.45}}>{n.mensaje}</div>
                    {(n.data?.exception_key || n.data?.pedido_id || n.data?.colaborador_id) && (
                      <div style={{fontSize:11,color:"var(--text5)",marginTop:6,fontFamily:"'JetBrains Mono',monospace"}}>
                        {n.data.exception_key || n.data.pedido_numero || n.data.pedido_id || n.data.colaborador_nombre || n.data.colaborador_id}
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",gap:6}}>
                    {(n.data?.exception_key || n.data?.pedido_id || n.data?.colaborador_id) && (
                      <button onClick={()=>abrirDestino(n)} style={{...S.btn,borderColor:"rgba(59,130,246,.35)",background:"rgba(59,130,246,.10)",color:"var(--accent-xl)"}}>
                        Abrir
                      </button>
                    )}
                    {!n.leida && (
                      <button onClick={()=>marcarLeida(n.id)} style={{...S.btn,borderColor:"rgba(34,211,160,.35)",background:"rgba(34,211,160,.12)",color:"var(--green)"}}>
                        Leido
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab==="documentos" && <>
      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:12}}>
        {[
          {l:"Caducados",    v:caducados, c:"#f05252", bg:"rgba(240,82,82,.12)"},
          {l:"Críticos",     v:criticos,  c:"#fb8c3a", bg:"rgba(251,140,58,.10)"},
          {l:"Requieren atención",v:atencion,c:"#fbbf24",bg:"rgba(251,191,36,.10)"},
          {l:"Incompletos",  v:sinFecha,  c:"#94a3b8", bg:"rgba(148,163,184,.10)"},
          {l:"En plazo",     v:enPlazo,   c:"var(--green)", bg:"rgba(34,211,160,.10)"},
        ].map((k,i)=>(
          <div key={i} style={{background:k.bg,border:`1px solid ${k.c}30`,borderRadius:12,padding:"14px 16px",cursor:"pointer"}}
            onClick={()=>setFiltro(i===0||i===1?"criticos":i===3?"incompletos":"todos")}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:26,fontWeight:800,color:k.c,lineHeight:1}}>{k.v}</div>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:k.c,opacity:.7,marginTop:4}}>{k.l}</div>
          </div>
        ))}
      </div>

      {/* Leyenda semáforo */}
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:16}}>
        <span style={{fontSize:11,color:"var(--text4)"}}>
          Mostrando documento vigente por entidad y tipo. Historicos ocultos: {docs.length - docsVigentes.length}.
        </span>
        {docsDuplicados.length > 0 && (
          <button onClick={()=>setFiltro("duplicados")} style={{...S.btn,borderColor:"rgba(245,158,11,.35)",background:"rgba(245,158,11,.10)",color:"#f59e0b"}}>
            Revisar {docsDuplicados.length} grupo{docsDuplicados.length!==1?"s":""} con historial
          </button>
        )}
      </div>

      <div style={{display:"flex",gap:16,marginBottom:16,flexWrap:"wrap",background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border)",borderRadius:8,padding:"12px 16px",alignItems:"center"}}>
        <span style={{fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text4)",letterSpacing:".08em",marginRight:4}}>Semáforo:</span>
        {LEYENDA.map((s,i)=>(
          <div key={i} style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:10,height:10,borderRadius:"50%",background:s.color,flexShrink:0,
                          boxShadow:s.bold?`0 0 5px ${s.color}`:undefined}}></span>
            <span style={{fontSize:11,color:"var(--text2)"}}>{s.rango}</span>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div style={{display:"flex",gap:8,marginBottom:14,alignItems:"center",flexWrap:"wrap"}}>
        {[["todos","Todos"],["criticos","Solo críticos y caducados"],["vehiculos","Vehículos"],["choferes","Choferes"]].map(([v,l])=>(
          <button key={v} onClick={()=>setFiltro(v)}
            style={{...S.btn,
                    borderColor:filtro===v?"var(--accent)":"var(--border2)",
                    background:filtro===v?"var(--accent)":"var(--bg3)",
                    color:filtro===v?"#fff":"var(--text3)"}}>
            {l}
          </button>
        ))}
        <span style={{width:1,height:24,background:"var(--border)",margin:"0 2px"}} />
        {filtrosDocumentos.filter(([v])=>["incompletos","duplicados"].includes(v)).map(([v,l])=>(
          <button key={`pro-${v}`} onClick={()=>setFiltro(v)}
            style={{...S.btn,
                    borderColor:filtro===v?"var(--accent)":"var(--border2)",
                    background:filtro===v?"var(--accent)":"var(--bg3)",
                    color:filtro===v?"#fff":"var(--text3)"}}>
            {l}
          </button>
        ))}
        <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Buscar..."
          style={{marginLeft:"auto",background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",
                  padding:"6px 12px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:200}}/>
      </div>

      {/* Tabla */}
      {loading ? (
        <div style={{textAlign:"center",color:"var(--text4)",padding:60}}>Cargando avisos...</div>
      ) : filtrados.length===0 ? (
        <div style={{textAlign:"center",padding:60,background:"var(--card-bg, var(--bg2))",border:"1px solid var(--border)",borderRadius:8}}>
          <div style={{color:"var(--green)",fontWeight:700,fontSize:15}}>Sin avisos para este filtro</div>
          <div style={{color:"var(--text4)",fontSize:12,marginTop:6}}>Toda la documentación está en plazo</div>
        </div>
      ) : (
        <div style={S.card}>
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr>
              {["Entidad","Tipo documento","Estado","Días restantes","Vencimiento","Organismo","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtrados.map((d,i)=>(
                <tr key={`${docGroupKey(d)}:${d.id || i}`} style={{background:d.s.nivel<=1?d.s.bg:undefined}}>
                  <td style={{...S.td,fontWeight:600,fontSize:12}}>
                    {d.vehiculo_matricula
                      ? <span>{d.vehiculo_matricula}</span>
                      : <span>{d.chofer_nombre}</span>}
                  </td>
                  <td style={{...S.td,fontSize:12}}>
                    {d.tipo_doc}
                    {Number(d.historial_oculto || 0) > 0 && (
                      <div style={{fontSize:10,color:"#f59e0b",fontWeight:800,marginTop:3}}>
                        {d.historial_oculto} historico{Number(d.historial_oculto) !== 1 ? "s" : ""} oculto{Number(d.historial_oculto) !== 1 ? "s" : ""}
                      </div>
                    )}
                  </td>
                  <td style={S.td}>
                    <span style={{fontSize:11,color:d.s.color,fontWeight:700}}>{d.s.texto}</span>
                  </td>
                  <td style={S.td}><Pastilla s={d.s}/></td>
                  <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:d.s.nivel<=2?d.s.color:"var(--text4)"}}>
                    {d.fecha_vencimiento ? new Date(d.fecha_vencimiento).toLocaleDateString("es-ES") : "—"}
                  </td>
                  <td style={{...S.td,fontSize:12,color:"var(--text2)"}}>{d.organismo||"—"}</td>
                  <td style={S.td}>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      <button onClick={()=>abrirDocumento(d)} style={{...S.btn,borderColor:"rgba(59,130,246,.35)",background:"rgba(59,130,246,.10)",color:"var(--accent-xl)",padding:"4px 9px"}}>
                        Abrir ficha
                      </button>
                      {d.s.nivel<=2&&(
                        <button onClick={()=>window.dispatchEvent(new CustomEvent("tms:navegar", { detail:"documentos" }))} style={{...S.btn,borderColor:"rgba(251,140,58,.35)",background:"rgba(251,140,58,.10)",color:"#fb8c3a",padding:"4px 9px"}}>
                          Renovar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{padding:"10px 16px",borderTop:"1px solid var(--border)",fontSize:11,color:"var(--text4)"}}>
            {filtrados.length} documento{filtrados.length!==1?"s":""}
          </div>
        </div>
      )}
      </>
      }

      {/* ── Mantenimiento Tab ── */}
      {tab==="mantenimiento" && (
        <div>
          {avisosMant.length === 0 ? (
            <div style={{textAlign:"center",padding:50,background:"var(--bg2)",border:"1px solid var(--border)",borderRadius:12}}>
              <div style={{color:"var(--green)",fontWeight:700,fontSize:15}}>Sin alertas de mantenimiento</div>
              <div style={{color:"var(--text4)",fontSize:12,marginTop:6}}>
                {avisosCfg.length===0?"Configura avisos en la pestaña Configurar avisos":"Todos los vehículos están al día"}
              </div>
            </div>
          ) : (
            <div style={S.card}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>{["Vehículo","Tipo","Desde último","KM desde último","Estado","Última vez"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {avisosMant.sort((a,b)=>a.nivel-b.nivel).map((a,i)=>{
                    const color = a.nivel===0?"var(--red)":a.nivel===1?"#fb8c3a":"#fbbf24";
                    const bg    = a.nivel===0?"rgba(240,82,82,.08)":a.nivel===1?"rgba(251,140,58,.06)":"rgba(251,191,36,.06)";
                    return (
                      <tr key={i} style={{background:bg}}>
                        <td style={{...S.td,fontWeight:700,color:"var(--text)"}}>{a.vehiculo_matricula}</td>
                        <td style={S.td}><span style={{fontSize:11,padding:"2px 8px",borderRadius:4,background:"rgba(99,102,241,.1)",color:"#818cf8",fontWeight:600}}>{a.tipo}</span></td>
                        <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color}}>{a.diasDesde} días {a.diasLimite>0?`/ ${a.diasLimite}`:""}</td>
                        <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color}}>{Number(a.kmDesde||0).toLocaleString("es-ES")} km {a.kmLimite>0?`/ ${Number(a.kmLimite).toLocaleString("es-ES")}`:""}</td>
                        <td style={S.td}>
                          <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,background:`${color}15`,color}}>
                            {a.nivel===0?"VENCIDO":a.nivel===1?"Urgente":"Próximo"}
                          </span>
                        </td>
                        <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>
                          {a.ultimaFecha?new Date(a.ultimaFecha).toLocaleDateString("es-ES"):"—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Config avisos ── */}
      {tab==="config" && (
        <div>
          <div style={{background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,padding:"9px 14px",marginBottom:14,fontSize:12,color:"var(--text3)"}}>
            Define aquí los intervalos de mantenimiento periódico. Cuando un vehículo supere el 75% del intervalo desde la última intervención, aparecerá un aviso.
          </div>
          <div style={{marginBottom:14}}>
            <button style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}
              onClick={()=>{setEditAv(null);setModalAv(true);}}>+ Nuevo aviso de mantenimiento</button>
          </div>
          {avisosCfg.length===0 ? (
            <div style={{textAlign:"center",padding:40,color:"var(--text5)",fontSize:12}}>
              Sin avisos configurados. Añade el primero para empezar a monitorizar el mantenimiento.
            </div>
          ) : (
            <div style={S.card}>
              <table style={{width:"100%",borderCollapse:"collapse"}}>
                <thead><tr>{["Tipo","Descripción","Cada (días)","Cada (km)","Activo",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>
                  {avisosCfg.map((a,i)=>(
                    <tr key={a.id}>
                      <td style={{...S.td,fontWeight:700}}>{a.tipo_mantenimiento}</td>
                      <td style={{...S.td,fontSize:11,color:"var(--text4)"}}>{a.descripcion||"—"}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{a.dias_aviso>0?`${a.dias_aviso}d (${(a.dias_aviso/30).toFixed(1)}m)`:"—"}</td>
                      <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{a.km_aviso>0?`${Number(a.km_aviso).toLocaleString("es-ES")} km`:"—"}</td>
                      <td style={S.td}>
                        <span style={{padding:"2px 10px",borderRadius:20,fontSize:11,fontWeight:700,
                          background:a.activo?"rgba(16,185,129,.1)":"rgba(107,114,128,.1)",
                          color:a.activo?"var(--green)":"var(--text5)"}}>
                          {a.activo?"Activo":"Inactivo"}
                        </span>
                      </td>
                      <td style={S.td}>
                        <div style={{display:"flex",gap:5}}>
                          <button onClick={()=>{setEditAv(a);setModalAv(true);}}
                            style={{padding:"3px 8px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text2)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>Editar</button>
                          <button onClick={async()=>{if(await confirmDialog({title:"Eliminar aviso",message:"Eliminar este aviso?",confirmText:"Eliminar",tone:"danger"})){const d=avisosCfg.filter(x=>x.id!==a.id);await guardarAvisosCfg(d);}}}
                            style={{padding:"3px 8px",borderRadius:6,border:"none",background:"rgba(239,68,68,.1)",color:"var(--red)",fontSize:11,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Eliminar</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Modal aviso config */}
      {modalAv && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.8)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
          <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:24,width:"min(480px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"var(--text)",marginBottom:16}}>{editAv?"Editar aviso":"Nuevo aviso de mantenimiento"}</div>
            <AvisoMantForm
              editando={editAv}
              tipos={TIPOS_MANT}
              listaActual={avisosCfg}
              onSave={guardarAvisosCfg}
              onClose={()=>{setModalAv(false);setEditAv(null);}}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function AvisoMantForm({ editando, tipos, listaActual, onSave, onClose }) {
  const [form, setForm] = useState(editando || {tipo_mantenimiento:"Cambio aceite",dias_aviso:180,km_aviso:50000,descripcion:"",activo:true});
  const f = k => e => setForm(p=>({...p,[k]:e.target.type==="checkbox"?e.target.checked:e.target.value}));
  async function guardar() {
    const d = Array.isArray(listaActual) ? [...listaActual] : [];
    const p = {...form,id:editando?.id||`am_${Date.now()}`,dias_aviso:parseInt(form.dias_aviso)||0,km_aviso:parseInt(form.km_aviso)||0};
    if (editando) { const i=d.findIndex(x=>x.id===editando.id); if(i>=0)d[i]=p; else d.push(p); }
    else d.push(p);
    await onSave(d);
    onClose();
  }
  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 11px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10};
  return (
    <div>
      <div style={{background:"rgba(245,158,11,.08)",border:"1px solid rgba(245,158,11,.2)",borderRadius:8,padding:"8px 12px",marginBottom:12,fontSize:12,color:"#f59e0b"}}>
        El sistema avisa cuando se supera el 75% del intervalo configurado (tiempo O km, lo que ocurra antes).
      </div>
      <label style={lbl}>Tipo de mantenimiento *</label>
      <select style={inp} value={form.tipo_mantenimiento} onChange={f("tipo_mantenimiento")}>
        {tipos.map(t=><option key={t}>{t}</option>)}
      </select>
      <label style={lbl}>Descripción / aceite o piezas usadas</label>
      <input style={inp} value={form.descripcion} onChange={f("descripcion")} placeholder="Ej: Aceite 15W-40 + filtro aceite"/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
        <div>
          <label style={lbl}>Intervalo en días</label>
          <input type="number" min="0" style={inp} value={form.dias_aviso} onChange={f("dias_aviso")}/>
          <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>{form.dias_aviso>0?`≈ ${(form.dias_aviso/30).toFixed(1)} meses`:""}</div>
        </div>
        <div>
          <label style={lbl}>Intervalo en KM</label>
          <input type="number" min="0" step="1000" style={inp} value={form.km_aviso} onChange={f("km_aviso")}/>
          <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>{form.km_aviso>0?`${Number(form.km_aviso).toLocaleString("es-ES")} km`:""}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:12}}>
        <input type="checkbox" id="av2_activo" checked={form.activo!==false} onChange={f("activo")} style={{width:15,height:15,accentColor:"var(--green)"}}/>
        <label htmlFor="av2_activo" style={{fontSize:13,color:"var(--text2)",cursor:"pointer"}}>Aviso activo</label>
      </div>
      <div style={{display:"flex",gap:8,marginTop:16,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"7px 14px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Cancelar</button>
        <button onClick={guardar} style={{padding:"7px 14px",borderRadius:7,border:"none",background:"var(--accent)",color:"#fff",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,cursor:"pointer"}}>Guardar</button>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { getExcepcionesOperativas, actualizarExcepcionOperativa } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { notify } from "../services/notify";
import { clearRuntimeFocus, readRuntimeFocus, setRuntimeFocus } from "../services/runtimeFocus";

const fmtN = n => Number(n || 0).toLocaleString("es-ES");
const fmtH = n => {
  const h = Number(n || 0);
  if (h < 24) return `${fmtN(h)} h`;
  return `${fmtN(Math.round(h / 24))} d`;
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function descargarHtml(nombre, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function buildInformeExcepcionesHtml({ items = [], resumen = {}, filtros = {} }) {
  const generated = new Date().toLocaleString("es-ES");
  const rows = items.map(item => `
    <tr>
      <td>${escapeHtml(item.severity || "")}</td>
      <td>${escapeHtml(item.area || "")}</td>
      <td><strong>${escapeHtml(item.title || "")}</strong><br><span>${escapeHtml(item.description || "")}</span></td>
      <td>${escapeHtml(item.action || "")}</td>
      <td>${escapeHtml(item.workflow?.estado || "")}${item.workflow?.nota ? `<br><span>${escapeHtml(item.workflow.nota)}</span>` : ""}</td>
      <td>${escapeHtml(item.workflow?.asignado_nombre || "Sin asignar")}</td>
      <td class="${item.sla?.vencida ? "bad" : "ok"}">${escapeHtml(fmtH(item.sla?.horas_abierta))} / ${escapeHtml(fmtH(item.sla?.horas_objetivo))}</td>
      <td>${escapeHtml(item.sla?.first_seen_at ? new Date(item.sla.first_seen_at).toLocaleString("es-ES") : "-")}<br><span>${escapeHtml(item.sla?.last_seen_at ? new Date(item.sla.last_seen_at).toLocaleString("es-ES") : "-")}</span></td>
    </tr>
  `).join("");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Informe de excepciones operativas</title>
  <style>
    body{font-family:Arial,sans-serif;margin:28px;color:#172033}
    h1{margin:0 0 6px;font-size:24px}
    .sub{color:#667085;margin-bottom:18px}
    .grid{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin:18px 0}
    .box{border:1px solid #d0d5dd;border-radius:8px;padding:10px}
    .metric{font-size:22px;font-weight:800}
    .muted{font-size:11px;color:#667085;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border-bottom:1px solid #eaecf0;padding:9px;text-align:left;font-size:12px;vertical-align:top}
    th{background:#f8fafc;text-transform:uppercase;font-size:10px;color:#475467}
    span{color:#667085}
    .bad{color:#b42318;font-weight:800}
    .ok{color:#027a48;font-weight:800}
  </style>
</head>
<body>
  <h1>Informe de excepciones operativas</h1>
  <div class="sub">Generado el ${escapeHtml(generated)}. Filtros: área ${escapeHtml(filtros.area)}, prioridad ${escapeHtml(filtros.severity)}, estado ${escapeHtml(filtros.estado)}.</div>
  <div class="grid">
    <div class="box"><div class="metric">${escapeHtml(resumen.total || 0)}</div><div class="muted">Abiertas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.critica || 0)}</div><div class="muted">Críticas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.alta || 0)}</div><div class="muted">Altas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.sla_vencidas || 0)}</div><div class="muted">Fuera SLA</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.asignadas_a_mi || 0)}</div><div class="muted">Mis tareas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.resueltas_7d || 0)}</div><div class="muted">Resueltas 7d</div></div>
    <div class="box"><div class="metric">${escapeHtml(items.length)}</div><div class="muted">En informe</div></div>
  </div>
  <table>
    <thead><tr><th>Prioridad</th><th>Área</th><th>Excepción</th><th>Acción</th><th>Estado</th><th>Responsable</th><th>SLA</th><th>Detectada / ultima</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='8'>Sin excepciones para estos filtros.</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

const S = {
  page: { flex:1, padding:"22px 26px", fontFamily:"'DM Sans',sans-serif" },
  title:{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:"var(--text)", marginBottom:4 },
  sub:  { fontSize:12, color:"var(--text4)", marginBottom:18 },
  card: { background:"var(--bg2)", border:"1px solid #141a28", borderRadius:10, padding:"13px 15px" },
  btn:  { padding:"7px 12px", borderRadius:7, border:"1px solid #1e2d45", background:"var(--bg4)", color:"var(--text)", fontSize:12, fontWeight:700, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  sel:  { background:"var(--bg4)", border:"1px solid #1e2d45", color:"var(--text)", padding:"7px 10px", borderRadius:7, fontFamily:"'DM Sans',sans-serif", fontSize:12, outline:"none" },
};

const SEVERITY = {
  critica: { label:"Critica", color:"#ef4444" },
  alta:    { label:"Alta", color:"#f97316" },
  media:   { label:"Media", color:"#f59e0b" },
  baja:    { label:"Baja", color:"#3b82f6" },
  info:    { label:"Info", color:"var(--accent-l)" },
};

function navegar(item) {
  const view = item?.view || item;
  const type = String(item?.type || "");
  const focus = {
    id: item?.entity_id || item?.data?.id || "",
    type,
    title: item?.title || "",
    numero: item?.data?.numero || "",
    estado: item?.data?.estado || "",
  };
  if (view === "pedidos") {
    setRuntimeFocus("tms_pedidos_focus", {
      ...focus,
      pedido_id: focus.id,
      cliente_nombre: item?.data?.cliente_nombre || "",
    });
  }
  if (view === "facturacion") {
    setRuntimeFocus("tms_facturacion_focus", {
      ...focus,
      factura_id: focus.id,
      cliente_nombre: item?.data?.cliente_nombre || "",
    });
  }
  if (view === "taller") {
    setRuntimeFocus("tms_taller_focus", {
      ...focus,
      solicitud_id: type === "solicitud_taller" ? focus.id : "",
      pieza_id: type === "stock_bajo" ? focus.id : "",
    });
  }
  if (view === "choferes") {
    setRuntimeFocus("tms_choferes_focus", {
      ...focus,
      chofer_id: item?.data?.chofer_id || focus.id,
    });
  }
  if (view === "vehiculos") {
    setRuntimeFocus("tms_vehiculos_focus", {
      ...focus,
      vehiculo_id: item?.data?.vehiculo_id || focus.id,
      matricula: item?.data?.matricula || "",
    });
  }
  if (view === "vehiculos" && String(item?.type || "").startsWith("gps_")) {
    setRuntimeFocus("tms_vehiculos_gps_focus", {
      vehiculo_id: item.entity_id || item.data?.id || "",
      type: item.type,
      matricula: item.data?.matricula || "",
    });
  }
  window.dispatchEvent(new CustomEvent("tms:navegar", { detail: view }));
}

export default function Excepciones() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [responsables, setResponsables] = useState([]);
  const [resumen, setResumen] = useState({});
  const [area, setArea] = useState("todas");
  const [severity, setSeverity] = useState("todas");
  const [estado, setEstado] = useState("abiertas");
  const [focusId] = useState(() => readRuntimeFocus("tms_excepcion_focus", { mode: "raw" }) || "");

  const cargar = async () => {
    setLoading(true);
    try {
      const data = await getExcepcionesOperativas();
      setItems(Array.isArray(data?.data) ? data.data : []);
      setResponsables(Array.isArray(data?.responsables) ? data.responsables : []);
      setResumen(data?.resumen || {});
    } catch(e) {
      notify(e.message || "No se pudo cargar la bandeja de excepciones", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, []);

  useEffect(() => {
    if (!focusId || !items.length) return;
    const found = items.find(i => i.id === focusId);
    if (!found) return;
    setArea(found.area || "todas");
    setSeverity(found.severity || "todas");
    setEstado("todas");
    window.setTimeout(() => {
      document.getElementById(`excepcion-${focusId}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_excepcion_focus");
    }, 150);
  }, [focusId, items]);

  const areas = useMemo(() => {
    return ["todas", ...Array.from(new Set(items.map(i => i.area).filter(Boolean))).sort()];
  }, [items]);

  const filtrados = useMemo(() => items.filter(i => {
    if (area !== "todas" && i.area !== area) return false;
    if (severity !== "todas" && i.severity !== severity) return false;
    if (estado === "abiertas" && !i.workflow?.activa) return false;
    if (estado === "mias" && (!i.workflow?.activa || String(i.workflow?.asignado_a || "") !== String(user?.id || ""))) return false;
    if (estado === "revisadas" && i.workflow?.estado !== "revisada") return false;
    if (estado === "pospuestas" && i.workflow?.estado !== "pospuesta") return false;
    if (estado === "resueltas" && i.workflow?.estado !== "resuelta") return false;
    return true;
  }), [items, area, severity, estado, user?.id]);

  const gestion = useMemo(() => {
    const abiertas = items.filter(i => i.workflow?.activa);
    const countBy = (rows, pick) => rows.reduce((acc, item) => {
      const key = pick(item) || "Sin clasificar";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const byArea = Object.entries(countBy(abiertas, i=>i.area)).sort(([,a],[,b])=>b-a).slice(0,5);
    const bySeverity = Object.entries(countBy(abiertas, i=>i.severity)).sort(([,a],[,b])=>b-a);
    const vencidas = abiertas.filter(i=>i.sla?.vencida);
    const sinResponsable = abiertas.filter(i=>!i.workflow?.asignado_a);
    const criticas = abiertas.filter(i=>i.severity === "critica");
    return {
      abiertas,
      byArea,
      bySeverity,
      vencidas,
      sinResponsable,
      criticas,
      slaPct: abiertas.length ? Math.round(((abiertas.length - vencidas.length) / abiertas.length) * 100) : 100,
    };
  }, [items]);

  const actualizar = async (item, nextEstado) => {
    try {
      let payload = { estado: nextEstado };
      if (nextEstado === "revisada") {
        const nota = window.prompt("Nota interna opcional:", item.workflow?.nota || "");
        payload.nota = nota || "";
      }
      if (nextEstado === "resuelta") {
        const nota = window.prompt("Nota de resolucion:", item.workflow?.nota || "");
        if (nota === null) return;
        payload.nota = nota || "Resuelta manualmente desde la bandeja de excepciones";
      }
      if (nextEstado === "pospuesta") {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        const defaultDate = d.toISOString().slice(0, 10);
        const posponer = window.prompt("Posponer hasta fecha AAAA-MM-DD:", defaultDate);
        if (!posponer) return;
        payload.posponer_hasta = posponer;
        const nota = window.prompt("Motivo opcional:", item.workflow?.nota || "");
        payload.nota = nota || "";
      }
      await actualizarExcepcionOperativa(item.id, payload);
      notify(nextEstado === "abierta" ? "Excepcion reabierta" : "Excepcion actualizada", "success");
      cargar();
    } catch(e) {
      notify(e.message || "No se pudo actualizar la excepcion", "error");
    }
  };

  const asignar = async (item, asignado_a) => {
    try {
      await actualizarExcepcionOperativa(item.id, {
        estado: item.workflow?.estado || "abierta",
        asignado_a: asignado_a || null,
      });
      notify(asignado_a ? "Excepcion asignada" : "Asignacion eliminada", "success");
      cargar();
    } catch(e) {
      notify(e.message || "No se pudo asignar la excepcion", "error");
    }
  };

  const descargarInforme = () => {
    const html = buildInformeExcepcionesHtml({
      items: filtrados,
      resumen,
      filtros: { area, severity, estado },
    });
    const stamp = new Date().toISOString().slice(0, 10);
    descargarHtml(`informe_excepciones_${stamp}.html`, html);
  };

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,marginBottom:16}}>
        <div>
          <div style={S.title}>Bandeja de Excepciones</div>
          <div style={S.sub}>Trabajo pendiente priorizado para que nada importante se quede escondido.</div>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"rgba(20,184,166,.12)",color:"var(--accent-xl)",borderColor:"rgba(20,184,166,.25)"}} onClick={descargarInforme}>
            Descargar informe
          </button>
          <button style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",borderColor:"rgba(16,185,129,.25)"}} onClick={cargar}>
            Actualizar
          </button>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
        {[
          ["Total", resumen.total, "var(--text)"],
          ["Criticas", resumen.critica, "#ef4444"],
          ["Altas", resumen.alta, "#f97316"],
          ["Medias", resumen.media, "#f59e0b"],
          ["Fuera SLA", resumen.sla_vencidas, resumen.sla_vencidas ? "#ef4444" : "var(--green)"],
          ["Mis tareas", resumen.asignadas_a_mi, "var(--green)"],
          ["Resueltas 7d", resumen.resueltas_7d, "var(--accent-xl)"],
        ].map(([label,value,color])=>(
          <div key={label} style={S.card}>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:20,fontWeight:800,color}}>{fmtN(value)}</div>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginTop:3}}>{label}</div>
          </div>
        ))}
      </div>

      <div style={{...S.card,marginBottom:14,borderColor:"rgba(20,184,166,.24)",background:"linear-gradient(135deg, rgba(20,184,166,.07), var(--card-bg))"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>Gestion operativa de excepciones</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Prioriza por impacto, SLA vencido, responsable asignado y area que acumula mas carga.</div>
          </div>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:18,fontWeight:900,color:gestion.slaPct >= 85 ? "var(--green)" : "#ef4444"}}>
            {gestion.slaPct}% SLA
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(220px,1fr) minmax(220px,1fr) minmax(220px,1fr)",gap:12}}>
          <div>
            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",marginBottom:7}}>Foco inmediato</div>
            {[
              ["Criticas abiertas", gestion.criticas.length, "#ef4444"],
              ["Fuera SLA", gestion.vencidas.length, gestion.vencidas.length ? "#ef4444" : "var(--green)"],
              ["Sin responsable", gestion.sinResponsable.length, gestion.sinResponsable.length ? "#f59e0b" : "var(--green)"],
            ].map(([label,value,color])=>(
              <div key={label} style={{display:"flex",justifyContent:"space-between",gap:10,borderBottom:"1px solid var(--border)",padding:"6px 0",fontSize:12}}>
                <span style={{color:"var(--text4)"}}>{label}</span>
                <strong style={{color,fontFamily:"'JetBrains Mono',monospace"}}>{fmtN(value)}</strong>
              </div>
            ))}
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",marginBottom:7}}>Areas con mas carga</div>
            {gestion.byArea.length ? gestion.byArea.map(([label,value])=>(
              <div key={label} style={{display:"grid",gridTemplateColumns:"1fr 44px",gap:8,alignItems:"center",marginBottom:7}}>
                <span style={{fontSize:12,color:"var(--text3)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{label}</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:"var(--accent-xl)",textAlign:"right"}}>{fmtN(value)}</span>
              </div>
            )) : <div style={{fontSize:12,color:"var(--green)",fontWeight:800}}>Sin carga abierta.</div>}
          </div>
          <div>
            <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",color:"var(--text5)",marginBottom:7}}>Prioridad</div>
            {gestion.bySeverity.map(([label,value])=>{
              const sev = SEVERITY[label] || SEVERITY.info;
              const pct = gestion.abiertas.length ? Math.min(100, Math.round((value / gestion.abiertas.length) * 100)) : 0;
              return (
                <div key={label} style={{marginBottom:8}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:"var(--text4)",marginBottom:3}}>
                    <span>{sev.label}</span><span>{fmtN(value)}</span>
                  </div>
                  <div style={{height:6,borderRadius:999,background:"var(--bg4)",overflow:"hidden"}}>
                    <div style={{height:"100%",width:`${pct}%`,background:sev.color,borderRadius:999}}/>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{display:"flex",gap:10,alignItems:"center",flexWrap:"wrap",marginBottom:14}}>
        <select value={area} onChange={e=>setArea(e.target.value)} style={S.sel}>
          {areas.map(a=><option key={a} value={a}>{a === "todas" ? "Todas las areas" : a}</option>)}
        </select>
        <select value={severity} onChange={e=>setSeverity(e.target.value)} style={S.sel}>
          <option value="todas">Todas las prioridades</option>
          {Object.entries(SEVERITY).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={estado} onChange={e=>setEstado(e.target.value)} style={S.sel}>
          <option value="abiertas">Solo abiertas</option>
          <option value="mias">Mis tareas</option>
          <option value="pospuestas">Pospuestas</option>
          <option value="revisadas">Revisadas</option>
          <option value="resueltas">Resueltas</option>
          <option value="todas">Todas</option>
        </select>
        <span style={{fontSize:12,color:"var(--text5)"}}>{fmtN(filtrados.length)} resultado(s)</span>
      </div>

      <div style={{display:"grid",gap:10}}>
        {loading ? (
          <div style={{...S.card,textAlign:"center",color:"var(--text5)",padding:28}}>Cargando excepciones...</div>
        ) : filtrados.length === 0 ? (
          <div style={{...S.card,textAlign:"center",color:"var(--green)",padding:28,fontWeight:800}}>
            Todo limpio. No hay excepciones para estos filtros.
          </div>
        ) : filtrados.map(item => {
          const sev = SEVERITY[item.severity] || SEVERITY.info;
          const muted = !item.workflow?.activa;
          return (
            <div id={`excepcion-${item.id}`} key={item.id} style={{...S.card,display:"grid",gridTemplateColumns:"120px 1fr auto",gap:14,alignItems:"center",borderColor:focusId===item.id?"var(--green)":`${sev.color}55`,boxShadow:focusId===item.id?"0 0 0 2px rgba(34,211,160,.18)":undefined,opacity:muted?0.72:1}}>
              <div>
                <div style={{display:"inline-flex",padding:"3px 9px",borderRadius:20,background:`${sev.color}18`,color:sev.color,fontSize:11,fontWeight:800}}>
                  {sev.label}
                </div>
                <div style={{fontSize:11,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",marginTop:7}}>{item.area}</div>
              </div>
              <div>
                <div style={{fontSize:14,fontWeight:800,color:"var(--text)",marginBottom:3}}>{item.title}</div>
                <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.45}}>{item.description}</div>
                {item.workflow?.estado !== "abierta" && (
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:5}}>
                    Estado: {item.workflow.estado}
                    {item.workflow.posponer_hasta ? ` hasta ${item.workflow.posponer_hasta}` : ""}
                    {item.workflow.nota ? ` - ${item.workflow.nota}` : ""}
                  </div>
                )}
                <div style={{display:"flex",gap:8,alignItems:"center",marginTop:6,flexWrap:"wrap"}}>
                  <span style={{fontSize:10,color:"var(--text5)"}}>
                    Se cierra sola cuando el dato que la genera queda corregido.
                  </span>
                  {item.sla && (
                    <span style={{
                      fontSize:10,
                      fontWeight:800,
                      color:item.sla.vencida ? "#ef4444" : "var(--green)",
                      background:item.sla.vencida ? "rgba(239,68,68,.10)" : "rgba(16,185,129,.10)",
                      border:`1px solid ${item.sla.vencida ? "rgba(239,68,68,.25)" : "rgba(16,185,129,.25)"}`,
                      borderRadius:20,
                      padding:"2px 8px",
                    }}>
                      SLA {fmtH(item.sla.horas_objetivo)} - abierta {fmtH(item.sla.horas_abierta)}
                    </span>
                  )}
                </div>
                <div style={{display:"flex",gap:8,alignItems:"center",marginTop:8,flexWrap:"wrap"}}>
                  <span style={{fontSize:11,color:"var(--text5)",fontWeight:800,textTransform:"uppercase",letterSpacing:".05em"}}>Responsable</span>
                  <select
                    value={item.workflow?.asignado_a || ""}
                    onChange={e=>asignar(item, e.target.value)}
                    style={{...S.sel,padding:"5px 8px",fontSize:11,minWidth:180}}
                  >
                    <option value="">Sin asignar</option>
                    {responsables.map(u=>(
                      <option key={u.id} value={u.id}>{u.nombre} - {u.rol}</option>
                    ))}
                  </select>
                  {item.workflow?.asignado_nombre && (
                    <span style={{fontSize:11,color:"var(--text4)"}}>Asignada a {item.workflow.asignado_nombre}</span>
                  )}
                </div>
              </div>
              <div style={{display:"flex",gap:7,justifyContent:"flex-end",flexWrap:"wrap"}}>
                <button style={S.btn} onClick={()=>navegar(item)}>
                  {item.action || "Abrir"}
                </button>
                {item.workflow?.estado === "abierta" || item.workflow?.activa ? (
                  <>
                    <button style={{...S.btn,color:"var(--green)",borderColor:"rgba(16,185,129,.35)",background:"rgba(16,185,129,.1)"}} onClick={()=>actualizar(item, "revisada")}>
                      Revisada
                    </button>
                    <button style={{...S.btn,color:"#22c55e",borderColor:"rgba(34,197,94,.35)",background:"rgba(34,197,94,.1)"}} onClick={()=>actualizar(item, "resuelta")}>
                      Resolver
                    </button>
                    <button style={{...S.btn,color:"#f59e0b",borderColor:"rgba(245,158,11,.35)",background:"rgba(245,158,11,.1)"}} onClick={()=>actualizar(item, "pospuesta")}>
                      Posponer
                    </button>
                  </>
                ) : (
                  <button style={{...S.btn,color:"var(--accent-xl)",borderColor:"rgba(20,184,166,.35)",background:"rgba(20,184,166,.1)"}} onClick={()=>actualizar(item, "abierta")}>
                    Reabrir
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

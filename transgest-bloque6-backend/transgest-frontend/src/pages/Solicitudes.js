import { useCallback, useEffect, useMemo, useState } from "react";
import { actualizarPortalSolicitudAdmin, convertirPortalSolicitudAdmin, getPortalSolicitudesAdmin, getPortalSolicitudEventosAdmin } from "../services/api";
import { notify, promptDialog } from "../services/notify";

const ESTADO = {
  pendiente: { l: "Pendiente", c: "#f97316" },
  revisada: { l: "Revisada", c: "#3b82f6" },
  convertida: { l: "Convertida", c: "#10b981" },
  descartada: { l: "Descartada", c: "#ef4444" },
};

function refreshSolicitudBadges() {
  window.dispatchEvent(new CustomEvent("tms:solicitudes-refresh"));
}

function dateEs(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("es-ES");
}

function ageHours(v) {
  if (!v) return 0;
  const t = new Date(v).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 3600000));
}

function ageLabel(v) {
  const h = ageHours(v);
  if (h < 1) return "Hace menos de 1 h";
  if (h < 24) return `Hace ${h} h`;
  const d = Math.floor(h / 24);
  return `Hace ${d} dia${d === 1 ? "" : "s"}`;
}

function isOpen(sol) {
  return ["pendiente", "revisada"].includes(sol.estado);
}

function isAged(sol) {
  return isOpen(sol) && ageHours(sol.created_at) >= 24;
}

function csvValue(v) {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function descargarArchivo(nombre, contenido, type) {
  const blob = new Blob([contenido], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  a.click();
  URL.revokeObjectURL(a.href);
}

function resumenSolicitud(sol) {
  return [
    `Cliente: ${sol.cliente_nombre || "-"}`,
    `Ruta: ${sol.origen || "-"} -> ${sol.destino || "-"}`,
    `Carga: ${dateEs(sol.fecha_carga)} ${sol.hora_carga || ""}`.trim(),
    sol.fecha_descarga ? `Descarga: ${dateEs(sol.fecha_descarga)} ${sol.hora_descarga || ""}`.trim() : "",
    sol.referencia_cliente ? `Referencia cliente: ${sol.referencia_cliente}` : "",
    sol.mercancia ? `Mercancia: ${sol.mercancia}` : "",
    sol.peso_kg ? `Peso: ${Number(sol.peso_kg).toLocaleString("es-ES")} kg` : "",
    sol.bultos ? `Bultos: ${sol.bultos}` : "",
    sol.notas ? `Notas: ${sol.notas}` : "",
    sol.pedido_numero ? `Pedido: ${sol.pedido_numero}` : "",
  ].filter(Boolean).join("\n");
}

function buildSolicitudesAdminReportHtml({ solicitudes = [], resumen = {}, filtros = {} }) {
  const generated = new Date().toLocaleString("es-ES");
  const rows = solicitudes.map(sol => {
    const estadoMeta = ESTADO[sol.estado] || ESTADO.pendiente;
    const aged = isAged(sol);
    return `<tr>
      <td><span class="pill" style="color:${estadoMeta.c};background:${estadoMeta.c}18">${escapeHtml(estadoMeta.l)}</span></td>
      <td>${escapeHtml(sol.cliente_nombre || "-")}<br><span>${escapeHtml(sol.cliente_email || "")}</span></td>
      <td><strong>${escapeHtml(sol.origen || "-")} - ${escapeHtml(sol.destino || "-")}</strong><br><span>${escapeHtml(sol.referencia_cliente || "")}</span></td>
      <td>${escapeHtml(dateEs(sol.fecha_carga))} ${escapeHtml(sol.hora_carga || "")}</td>
      <td class="${aged ? "bad" : "ok"}">${escapeHtml(ageLabel(sol.created_at))}</td>
      <td>${escapeHtml(sol.pedido_numero || "-")}</td>
      <td>${escapeHtml(sol.eventos_count || 0)}<br><span>${escapeHtml(sol.ultimo_evento_at ? new Date(sol.ultimo_evento_at).toLocaleString("es-ES") : "-")}</span></td>
      <td>${escapeHtml(sol.respuesta || sol.notas || "-")}</td>
    </tr>`;
  }).join("");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8"/>
  <title>Informe de Peticiones de viaje</title>
  <style>
    body{font-family:Arial,sans-serif;margin:28px;color:#172033}
    h1{margin:0 0 6px;font-size:24px}
    .sub{color:#667085;margin-bottom:18px}
    .grid{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin:18px 0}
    .box{border:1px solid #d0d5dd;border-radius:8px;padding:10px}
    .metric{font-size:22px;font-weight:800}
    .muted{font-size:11px;color:#667085;text-transform:uppercase}
    table{width:100%;border-collapse:collapse;margin-top:16px}
    th,td{border-bottom:1px solid #eaecf0;padding:9px;text-align:left;font-size:12px;vertical-align:top}
    th{background:#f8fafc;text-transform:uppercase;font-size:10px;color:#475467}
    span{color:#667085}
    .pill{display:inline-block;border-radius:20px;padding:3px 8px;font-weight:800}
    .bad{color:#b42318;font-weight:800}
    .ok{color:#027a48;font-weight:800}
  </style>
</head>
<body>
  <h1>Informe de Peticiones de viaje</h1>
  <div class="sub">Generado el ${escapeHtml(generated)}. Filtros: estado ${escapeHtml(filtros.estado || "todos")}, busqueda ${escapeHtml(filtros.q || "-")}, orden ${escapeHtml(filtros.orden || "-")}.</div>
  <div class="grid">
    <div class="box"><div class="metric">${escapeHtml(solicitudes.length)}</div><div class="muted">En informe</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.pendientes || 0)}</div><div class="muted">Pendientes</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.revisadas || 0)}</div><div class="muted">Revisadas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.convertidas || 0)}</div><div class="muted">Convertidas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.vencidas || 0)}</div><div class="muted">Sin atender >24h</div></div>
  </div>
  <table>
    <thead><tr><th>Estado</th><th>Cliente</th><th>Ruta</th><th>Carga</th><th>Antiguedad</th><th>Pedido</th><th>Movimientos</th><th>Respuesta / notas</th></tr></thead>
    <tbody>${rows || "<tr><td colspan='8'>No hay solicitudes con estos filtros.</td></tr>"}</tbody>
  </table>
</body>
</html>`;
}

export default function Solicitudes() {
  const [sols, setSols] = useState([]);
  const [loading, setLoading] = useState(true);
  const [estado, setEstado] = useState("");
  const [vista, setVista] = useState("activas");
  const [q, setQ] = useState("");
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [orden, setOrden] = useState("prioridad");
  const [trabajando, setTrabajando] = useState(null);
  const [eventos, setEventos] = useState({});
  const [eventosAbiertos, setEventosAbiertos] = useState({});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const d = await getPortalSolicitudesAdmin();
      setSols(Array.isArray(d) ? d : []);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);

  const resumen = useMemo(() => ({
    pendientes: sols.filter(s => s.estado === "pendiente").length,
    revisadas: sols.filter(s => s.estado === "revisada").length,
    convertidas: sols.filter(s => s.estado === "convertida").length,
    descartadas: sols.filter(s => s.estado === "descartada").length,
    vencidas: sols.filter(isAged).length,
  }), [sols]);

  const pendientes = resumen.pendientes + resumen.revisadas;
  const enPapelera = vista === "papelera";

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = sols.filter(s => {
      if (enPapelera && s.estado !== "descartada") return false;
      if (!enPapelera && s.estado === "descartada") return false;
      if (estado && s.estado !== estado) return false;
      if (soloVencidas && !isAged(s)) return false;
      if (!term) return true;
      return [
        s.cliente_nombre,
        s.cliente_email,
        s.origen,
        s.destino,
        s.referencia_cliente,
        s.mercancia,
        s.pedido_numero,
        s.notas,
        s.respuesta,
      ].some(v => String(v || "").toLowerCase().includes(term));
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (orden === "fecha_asc") return new Date(a.created_at || 0) - new Date(b.created_at || 0);
      if (orden === "carga") return new Date(a.fecha_carga || "9999-12-31") - new Date(b.fecha_carga || "9999-12-31");
      if (orden === "cliente") return String(a.cliente_nombre || "").localeCompare(String(b.cliente_nombre || ""), "es");
      if (orden === "fecha_desc") return new Date(b.created_at || 0) - new Date(a.created_at || 0);
      const score = s => (isAged(s) ? 100 : 0) + (s.estado === "pendiente" ? 20 : s.estado === "revisada" ? 10 : 0) + Math.min(ageHours(s.created_at), 96) / 100;
      return score(b) - score(a);
    });
    return sorted;
  }, [sols, estado, q, soloVencidas, orden, enPapelera]);

  async function descartar(sol) {
    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, { estado: "descartada", respuesta: "Solicitud descartada por trafico." });
      notify("Solicitud movida a papelera", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function restaurar(sol) {
    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, {
        estado: "revisada",
        respuesta: sol.respuesta || "Solicitud restaurada desde papelera. Pendiente de revision.",
      });
      notify("Solicitud restaurada", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function marcarRevisada(sol) {
    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, { estado: "revisada", respuesta: "Solicitud revisada. Pendiente de planificacion." });
      notify("Solicitud marcada como revisada", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function responder(sol) {
    const texto = await promptDialog({
      title: "Respuesta / nota de seguimiento",
      message: `Cliente: ${sol.cliente_nombre || "-"}\nRuta: ${sol.origen || "-"} -> ${sol.destino || "-"}`,
      placeholder: "Ej: Pendiente confirmar disponibilidad para la carga...",
      defaultValue: sol.respuesta || "",
      confirmText: "Guardar respuesta",
    });
    if (texto === null) return;
    const respuesta = String(texto || "").trim();
    if (!respuesta) {
      notify("La respuesta no puede estar vacia", "warning");
      return;
    }
    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, {
        respuesta,
        estado: sol.estado === "pendiente" ? "revisada" : sol.estado,
      });
      notify("Respuesta guardada", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function reprogramar(sol) {
    const fecha = await promptDialog({
      title: "Proponer nueva fecha de carga",
      message: `Cliente: ${sol.cliente_nombre || "-"}\nRuta: ${sol.origen || "-"} -> ${sol.destino || "-"}`,
      defaultValue: sol.fecha_propuesta || sol.fecha_carga || "",
      confirmText: "Continuar",
      inputType: "date",
    });
    if (fecha === null) return;
    if (!String(fecha || "").trim()) {
      notify("La fecha propuesta es obligatoria", "warning");
      return;
    }
    const hora = await promptDialog({
      title: "Hora propuesta",
      message: "Puedes dejarla vacia si todavia no esta cerrada.",
      defaultValue: sol.hora_propuesta || sol.hora_carga || "",
      confirmText: "Continuar",
      inputType: "time",
    });
    if (hora === null) return;
    const nota = await promptDialog({
      title: "Nota para el cliente",
      message: "Este texto se mostrara en el portal del cliente.",
      defaultValue: "",
      placeholder: "Ej: Podemos cargar realmente al dia siguiente por disponibilidad.",
      confirmText: "Guardar propuesta",
    });
    if (nota === null) return;

    const respuesta = [
      String(nota || "").trim(),
      `Propuesta de reprogramacion: ${dateEs(fecha)}${hora ? ` ${hora}` : ""}. Pendiente de aceptacion por el cliente.`,
    ].filter(Boolean).join(" ");

    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, {
        estado: "revisada",
        fecha_propuesta: fecha,
        hora_propuesta: String(hora || "").trim() || null,
        decision_cliente: "pendiente",
        respuesta,
      });
      notify("Propuesta de reprogramacion enviada", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function convertir(sol) {
    setTrabajando(sol.id);
    try {
      const r = await convertirPortalSolicitudAdmin(sol.id);
      notify(r?.ya_convertida ? "La solicitud ya estaba convertida" : `Solicitud convertida en pedido ${r?.pedido?.numero || ""}`.trim(), "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function toggleEventos(sol) {
    const open = !eventosAbiertos[sol.id];
    setEventosAbiertos(prev => ({ ...prev, [sol.id]: open }));
    if (!open || eventos[sol.id]) return;
    try {
      const rows = await getPortalSolicitudEventosAdmin(sol.id);
      setEventos(prev => ({ ...prev, [sol.id]: Array.isArray(rows) ? rows : [] }));
    } catch (e) {
      notify(e.message, "error");
    }
  }

  function irAPedidos() {
    window.dispatchEvent(new CustomEvent("tms:navegar", { detail: "pedidos" }));
  }

  async function copiarResumen(sol) {
    const text = resumenSolicitud(sol);
    try {
      await navigator.clipboard.writeText(text);
      notify("Resumen copiado", "success");
    } catch {
      notify(text, "info", 9000);
    }
  }

  function exportarCsv() {
    if (!visibles.length) {
      notify("No hay solicitudes para exportar", "warning");
      return;
    }
    const headers = ["estado","cliente","referencia","origen","destino","fecha_carga","hora_carga","mercancia","peso_kg","bultos","pedido","recibida","antiguedad_horas","notas","respuesta"];
    const rows = visibles.map(s => [
      s.estado,
      s.cliente_nombre,
      s.referencia_cliente,
      s.origen,
      s.destino,
      s.fecha_carga,
      s.hora_carga,
      s.mercancia,
      s.peso_kg,
      s.bultos,
      s.pedido_numero,
      s.created_at,
      ageHours(s.created_at),
      s.notas,
      s.respuesta,
    ]);
    const csv = [headers, ...rows].map(r => r.map(csvValue).join(";")).join("\r\n");
    descargarArchivo(`solicitudes-clientes-${new Date().toISOString().slice(0,10)}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportarInformeHtml() {
    if (!visibles.length) {
      notify("No hay solicitudes para exportar", "warning");
      return;
    }
    const html = buildSolicitudesAdminReportHtml({
      solicitudes: visibles,
      resumen,
      filtros: { estado: enPapelera ? "papelera" : estado, q, orden, soloVencidas },
    });
    descargarArchivo(`informe-solicitudes-clientes-${new Date().toISOString().slice(0,10)}.html`, html, "text/html;charset=utf-8");
  }

  const S = {
    page: { padding: "30px 36px", fontFamily: "'DM Sans',sans-serif", minHeight: "100vh", background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)" },
    card: { background: "rgba(255,255,255,.94)", border: "1px solid #dbe5ec", borderRadius: 12, padding: "16px 18px", marginBottom: 14, boxShadow:"0 14px 32px rgba(15,23,42,.05)" },
    btn: { padding: "10px 15px", borderRadius: 8, border: "1px solid #cfdbe5", background: "#fff", color: "#0f172a", fontSize: 13, fontWeight: 800, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", gap:7, boxShadow:"0 8px 18px rgba(15,23,42,.04)" },
    input: { background: "#fff", border: "1px solid #cfdbe5", color: "#0f172a", padding: "12px 14px", borderRadius: 8, fontSize: 13, outline: "none", boxShadow:"0 6px 14px rgba(15,23,42,.03)" },
    kpi: { background: "rgba(255,255,255,.95)", border: "1px solid #dbe5ec", borderRadius: 12, padding: "18px 20px", minHeight: 112, boxShadow:"0 16px 34px rgba(15,23,42,.06)" },
  };

  return (
    <div className="tg-responsive-page" style={S.page}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 28 }}>
        <div>
          <div style={{ fontFamily: "'Syne',sans-serif", fontSize: 32, fontWeight: 900, color: "#0f172a", letterSpacing:"-.02em" }}>
            Peticiones de viaje
            {pendientes > 0 && <span style={{ marginLeft: 10, padding: "3px 10px", borderRadius: 20, background: "rgba(249,115,22,.15)", color: "#f97316", fontSize: 14 }}>{pendientes}</span>}
          </div>
          <div style={{ fontSize: 14, color: "#64748b", marginTop: 8 }}>
            Bandeja de peticiones de clientes y proveedores asociadas a viajes.
          </div>
        </div>
        <button onClick={cargar} style={{...S.btn,color:"#0f766e"}}>Actualizar</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))", gap:16, marginBottom:28 }}>
        {[
          ["Pendientes", "pendiente", resumen.pendientes, "#f97316"],
          ["Revisadas", "revisada", resumen.revisadas, "#3b82f6"],
          ["Convertidas", "convertida", resumen.convertidas, "#10b981"],
          ["Papelera", "papelera", resumen.descartadas, "#ef4444"],
          ["Sin atender >24h", "vencidas", resumen.vencidas, "#ef4444"],
        ].map(([label, valueEstado, value, color]) => (
          <button key={label} onClick={() => {
              if (valueEstado === "papelera") { setVista("papelera"); setEstado(""); setSoloVencidas(false); return; }
              setVista("activas");
              if (valueEstado === "vencidas") { setSoloVencidas(v => !v); setEstado(""); }
              else { setEstado(valueEstado); setSoloVencidas(false); }
            }}
            style={{ ...S.kpi, textAlign:"left", cursor:"pointer", borderColor: (valueEstado === "papelera" ? enPapelera : valueEstado === "vencidas" ? soloVencidas : !enPapelera && estado === valueEstado) ? color : "#dbe5ec", display:"grid", gridTemplateColumns:"54px 1fr", alignItems:"center", gap:14 }}>
            <div style={{width:46,height:46,borderRadius:14,display:"grid",placeItems:"center",background:`${color}12`,color,fontSize:20,fontWeight:900}}>!</div>
            <div style={{minWidth:0}}>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:900, color, lineHeight:1 }}>{value}</div>
              <div style={{ fontSize:11, color:"#64748b", textTransform:"uppercase", letterSpacing:".07em", fontWeight:900, marginTop:9, lineHeight:1.25, overflowWrap:"anywhere" }}>{label}</div>
            </div>
          </button>
        ))}
      </div>

      <div style={{ ...S.card, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:12, alignItems:"center", padding:"22px 26px" }}>
        <div style={{ display:"flex", gap:6, background:"#f8fafc", padding:4, borderRadius:9, border:"1px solid #dbe5ec", flexWrap:"wrap" }}>
          {[
            ["activas", "Activas"],
            ["papelera", `Papelera (${resumen.descartadas})`],
          ].map(([key, label]) => (
            <button key={key} onClick={() => { setVista(key); setEstado(""); setSoloVencidas(false); }}
              style={{ ...S.btn, border:"none", background:vista===key ? "linear-gradient(135deg,#0f766e,#0d9488)" : "transparent", color:vista===key ? "#fff" : "#64748b", padding:"10px 16px", boxShadow:"none" }}>
              {label}
            </button>
          ))}
        </div>
        <input value={q} onChange={e=>setQ(e.target.value)} style={{ ...S.input, width:"100%" }}
          placeholder="Buscar por cliente, ruta, referencia, mercancia o pedido..." />
        <select value={estado} onChange={e => setEstado(e.target.value)} style={{ ...S.input, width:"100%" }}>
          <option value="">{enPapelera ? "Todas en papelera" : "Todos los estados activos"}</option>
          {!enPapelera && <option value="pendiente">Pendientes</option>}
          {!enPapelera && <option value="revisada">Revisadas</option>}
          {!enPapelera && <option value="convertida">Convertidas</option>}
          {enPapelera && <option value="descartada">Descartadas</option>}
        </select>
        <select value={orden} onChange={e => setOrden(e.target.value)} style={{ ...S.input, width:"100%" }}>
          <option value="prioridad">Orden: prioridad</option>
          <option value="fecha_desc">Orden: mas recientes</option>
          <option value="fecha_asc">Orden: mas antiguas</option>
          <option value="carga">Orden: fecha carga</option>
          <option value="cliente">Orden: cliente</option>
        </select>
        <button onClick={exportarCsv} style={{...S.btn,color:"#0f766e"}}>Exportar CSV</button>
        <button onClick={exportarInformeHtml} style={{...S.btn,color:"#0f766e"}}>Informe HTML</button>
        {(q || estado || soloVencidas || enPapelera) && (
          <button onClick={()=>{setQ("");setEstado("");setSoloVencidas(false);setVista("activas");}} style={S.btn}>Limpiar</button>
        )}
      </div>
      {!loading && sols.length > 0 && (
        <div style={{ margin:"0 0 16px", fontSize:14, color:"#64748b" }}>
          {enPapelera ? "Papelera: " : "Activas: "}
          Mostrando <strong style={{color:"#0f766e"}}>{visibles.length}</strong> de {enPapelera ? resumen.descartadas : sols.length - resumen.descartadas} solicitudes
          {soloVencidas ? " · solo sin atender mas de 24 h" : ""}
        </div>
      )}

      {loading && <div style={{ ...S.card, textAlign: "center", color: "var(--text4)", padding: 28 }}>Cargando solicitudes...</div>}
      {!loading && (sols.length === 0 || visibles.length === 0) && (
        <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: "58px 24px", minHeight: 250, display:"grid", placeItems:"center" }}>
          <div>
            <div style={{width:128,height:128,borderRadius:"50%",background:"rgba(15,118,110,.10)",margin:"0 auto 18px",display:"grid",placeItems:"center",color:"#0f766e",fontSize:64}}>▱</div>
            <div style={{fontSize:22,fontWeight:900,color:"#0f172a",marginBottom:8}}>
              {enPapelera && sols.length > 0 ? "La papelera de solicitudes esta vacia." : "No hay solicitudes con esos filtros."}
            </div>
            <div style={{fontSize:14,color:"#94a3b8"}}>Prueba a cambiar los filtros o el criterio de busqueda.</div>
          </div>
        </div>
      )}

      {!loading && visibles.map(sol => {
        const e = ESTADO[sol.estado] || ESTADO.pendiente;
        const discarded = sol.estado === "descartada";
        const disabled = trabajando === sol.id || ["convertida", "descartada"].includes(sol.estado);
        const aged = isAged(sol);
        return (
          <div key={sol.id} style={{ ...S.card, borderColor: aged ? "rgba(239,68,68,.55)" : sol.estado === "pendiente" ? "rgba(249,115,22,.35)" : "var(--border)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontWeight: 900, fontSize: 15, color: "var(--text)" }}>{sol.origen} -> {sol.destino}</div>
                <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 4 }}>
                  Cliente: <strong>{sol.cliente_nombre || "-"}</strong>
                  {" · "}Carga: <strong>{dateEs(sol.fecha_carga)} {sol.hora_carga || ""}</strong>
                  {" · "}Recibida: {dateEs(sol.created_at)}
                </div>
                <div style={{ fontSize: 11, color: aged ? "#ef4444" : "var(--text5)", marginTop: 3, fontWeight: aged ? 900 : 700 }}>
                  Antiguedad: {ageLabel(sol.created_at)}
                </div>
                <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 3 }}>
                  Movimientos: {Number(sol.eventos_count || 0)}
                  {sol.ultimo_evento_at ? ` - ultimo ${new Date(sol.ultimo_evento_at).toLocaleString("es-ES")}` : ""}
                </div>
                {sol.referencia_cliente && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>Referencia: {sol.referencia_cliente}</div>}
                {sol.fecha_propuesta && (
                  <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(59,130,246,.2)", background: "rgba(59,130,246,.08)", fontSize: 12, color: "var(--text3)" }}>
                    Reprogramacion propuesta: <strong style={{ color: "var(--text)" }}>{dateEs(sol.fecha_propuesta)}{sol.hora_propuesta ? ` ${sol.hora_propuesta}` : ""}</strong>
                    {sol.decision_cliente === "aceptada" && " · Cliente: aceptada"}
                    {sol.decision_cliente === "rechazada" && " · Cliente: rechazada"}
                    {(!sol.decision_cliente || sol.decision_cliente === "pendiente") && " · Cliente pendiente de respuesta"}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", justifyContent:"flex-end" }}>
                {aged && <span style={{ padding:"3px 9px", borderRadius:20, color:"#ef4444", background:"rgba(239,68,68,.14)", fontSize:11, fontWeight:900 }}>+24 h</span>}
                <span style={{ padding: "3px 10px", borderRadius: 20, color: e.c, background: `${e.c}18`, fontSize: 11, fontWeight: 900 }}>{e.l}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--text3)", marginTop: 12 }}>
              {sol.mercancia && <span>Mercancia: {sol.mercancia}</span>}
              {sol.peso_kg && <span>Peso: {Number(sol.peso_kg).toLocaleString("es-ES")} kg</span>}
              {sol.bultos && <span>Bultos: {sol.bultos}</span>}
              {sol.fecha_descarga && <span>Descarga: {dateEs(sol.fecha_descarga)} {sol.hora_descarga || ""}</span>}
              {sol.pedido_numero && <span>Pedido: {sol.pedido_numero}</span>}
            </div>
            {sol.notas && <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bg3)", color: "var(--text3)", fontSize: 12 }}>{sol.notas}</div>}
            {sol.respuesta && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(59,130,246,.07)", border: "1px solid rgba(59,130,246,.18)", color: "var(--text3)", fontSize: 12 }}>
                <b style={{ color: "var(--accent)" }}>Respuesta / seguimiento:</b> {sol.respuesta}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {!discarded && (
                <button onClick={() => convertir(sol)} disabled={disabled} style={{ ...S.btn, background: "#10b981", color: "#fff", borderColor: "#10b981", opacity: disabled ? .55 : 1 }}>
                  {trabajando === sol.id ? "Procesando..." : "Convertir en pedido"}
                </button>
              )}
              {!discarded && (
                <button onClick={() => reprogramar(sol)} disabled={disabled} style={{ ...S.btn, opacity: disabled ? .55 : 1 }}>
                  Reprogramar
                </button>
              )}
              {!discarded && (
                <button onClick={() => responder(sol)} disabled={trabajando === sol.id || ["convertida","descartada"].includes(sol.estado)} style={{ ...S.btn, opacity: trabajando === sol.id || ["convertida","descartada"].includes(sol.estado) ? .55 : 1 }}>
                  Responder / nota
                </button>
              )}
              {!discarded && (
                <button onClick={() => marcarRevisada(sol)} disabled={disabled || sol.estado === "revisada"} style={{ ...S.btn, opacity: disabled || sol.estado === "revisada" ? .55 : 1 }}>
                  Marcar revisada
                </button>
              )}
              <button onClick={() => copiarResumen(sol)} style={S.btn}>
                Copiar resumen
              </button>
              <button onClick={() => toggleEventos(sol)} style={S.btn}>
                {eventosAbiertos[sol.id] ? "Ocultar historial" : "Ver historial"}
              </button>
              {discarded ? (
                <button onClick={() => restaurar(sol)} disabled={trabajando === sol.id} style={{ ...S.btn, color: "#10b981", borderColor: "rgba(16,185,129,.25)", opacity: trabajando === sol.id ? .55 : 1 }}>
                  Restaurar
                </button>
              ) : (
                <button onClick={() => descartar(sol)} disabled={disabled} style={{ ...S.btn, color: "#ef4444", borderColor: "rgba(239,68,68,.25)", opacity: disabled ? .55 : 1 }}>
                  Mover a papelera
                </button>
              )}
              {sol.pedido_numero && (
                <button onClick={irAPedidos} style={{ ...S.btn, color: "var(--accent)" }}>
                  Ir a pedidos
                </button>
              )}
            </div>
            {eventosAbiertos[sol.id] && (
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: "var(--bg3)", border: "1px solid var(--border2)" }}>
                {(eventos[sol.id] || []).length === 0 ? (
                  <div style={{ fontSize: 12, color: "var(--text5)" }}>Sin movimientos registrados.</div>
                ) : eventos[sol.id].map(ev => (
                  <div key={ev.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--border2)" }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{ev.tipo}</div>
                      {ev.detalle?.pedido_numero && <div style={{ fontSize: 11, color: "var(--text4)" }}>Pedido: {ev.detalle.pedido_numero}</div>}
                      {ev.detalle?.respuesta && <div style={{ fontSize: 11, color: "var(--text4)" }}>{ev.detalle.respuesta}</div>}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text5)", whiteSpace: "nowrap" }}>
                      {ev.created_at ? new Date(ev.created_at).toLocaleString("es-ES") : ""}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

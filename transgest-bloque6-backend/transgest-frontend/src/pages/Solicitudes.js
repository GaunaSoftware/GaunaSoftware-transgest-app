import { useCallback, useEffect, useMemo, useState } from "react";
import {
  actualizarPortalSolicitudAdmin,
  convertirPortalSolicitudAdmin,
  descargarArchivoProtegido,
  getPortalSolicitudesAdmin,
  getPortalSolicitudDocumentosAdmin,
  getPortalSolicitudEventosAdmin,
} from "../services/api";
import { notify, promptDialog } from "../services/notify";

const ESTADO = {
  pendiente: { l: "Pendiente", c: "#f97316" },
  revisada: { l: "En revision", c: "#3b82f6" },
  convertida: { l: "Aceptada", c: "#10b981" },
  descartada: { l: "Rechazada", c: "#ef4444" },
  rechazada: { l: "Rechazada", c: "#ef4444" },
  cancelada: { l: "Cancelada", c: "#ef4444" },
};

function refreshSolicitudBadges() {
  window.dispatchEvent(new CustomEvent("tms:solicitudes-refresh"));
}

function dateEs(v) {
  if (!v) return "-";
  // Incluye el dia de la semana (lo pone el programa a partir de la fecha), asi
  // no depende de lo que el cliente escriba a mano y no hay dias mal escritos.
  return new Date(v).toLocaleDateString("es-ES", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });
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

function isAccepted(sol) {
  return String(sol?.estado || "").toLowerCase() === "convertida";
}

function isRejected(sol) {
  return ["rechazada", "descartada"].includes(String(sol?.estado || "").toLowerCase());
}

function isClosed(sol) {
  return isAccepted(sol) || isRejected(sol) || String(sol?.estado || "").toLowerCase() === "cancelada";
}

function validBultos(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : "";
}

function precioSolicitudLabel(sol = {}) {
  const tipo = String(sol.tipo_precio || "viaje");
  const unit = Number(sol.precio_unitario ?? sol.importe ?? 0);
  const cantidad = Number(sol.cantidad || 0);
  const importe = Number(sol.importe || 0);
  if (!unit && !importe) return "";
  if (tipo === "viaje") return `${(importe || unit).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const units = { kg: "EUR/100kg", tonelada: "EUR/tn", km: "EUR/km", hora: "EUR/h", palet: "EUR/palet" };
  return [
    `${unit.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${units[tipo] || "EUR"}`,
    cantidad ? `${cantidad.toLocaleString("es-ES", { maximumFractionDigits: 3 })} ${tipo === "tonelada" ? "tn" : tipo === "hora" ? "h" : tipo === "palet" ? "palets" : tipo}` : "",
    importe ? `total ${importe.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : "",
  ].filter(Boolean).join(" - ");
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
    validBultos(sol.bultos) ? `Bultos: ${validBultos(sol.bultos)}` : "",
    precioSolicitudLabel(sol) ? `Precio indicado: ${precioSolicitudLabel(sol)}` : "",
    sol.notas ? `Notas: ${sol.notas}` : "",
    sol.pedido_numero ? `Pedido: ${sol.pedido_numero}` : "",
    sol.vehiculo_matricula || sol.matricula_colaborador ? `Tractora: ${sol.vehiculo_matricula || sol.matricula_colaborador}` : "",
    sol.remolque_matricula || sol.remolque_matricula_colaborador ? `Remolque: ${sol.remolque_matricula || sol.remolque_matricula_colaborador}` : "",
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
    <div class="box"><div class="metric">${escapeHtml(resumen.aceptadas || 0)}</div><div class="muted">Aceptadas</div></div>
    <div class="box"><div class="metric">${escapeHtml(resumen.rechazadas || 0)}</div><div class="muted">Rechazadas</div></div>
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
  const [editando, setEditando] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [docsSolicitud, setDocsSolicitud] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);

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
    pendientes: sols.filter(isOpen).length,
    aceptadas: sols.filter(s => s.estado === "convertida").length,
    rechazadas: sols.filter(isRejected).length,
    canceladas: sols.filter(s => s.estado === "cancelada").length,
    vencidas: sols.filter(isAged).length,
  }), [sols]);

  const pendientes = resumen.pendientes;
  const enRechazadas = vista === "rechazadas";
  const totalVistaActual = enRechazadas
    ? resumen.rechazadas
    : estado
      ? sols.filter(s => !isRejected(s) && s.estado === estado).length
      : sols.filter(s => !isRejected(s) && !isClosed(s)).length;

  const visibles = useMemo(() => {
    const term = q.trim().toLowerCase();
    const filtered = sols.filter(s => {
      if (enRechazadas && !isRejected(s)) return false;
      if (!enRechazadas && isRejected(s)) return false;
      if (estado && s.estado !== estado) return false;
      if (!estado && !enRechazadas && isClosed(s)) return false;
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
  }, [sols, estado, q, soloVencidas, orden, enRechazadas]);

  async function rechazar(sol) {
    const motivo = await promptDialog({
      title: "Rechazar solicitud",
      message: `Cliente: ${sol.cliente_nombre || "-"}\nRuta: ${sol.origen || "-"} -> ${sol.destino || "-"}`,
      placeholder: "Motivo visible para el cliente...",
      defaultValue: "",
      confirmText: "Rechazar solicitud",
    });
    if (motivo === null) return;
    setTrabajando(sol.id);
    try {
      const respuesta = String(motivo || "").trim()
        ? `Solicitud rechazada por trafico. Motivo: ${String(motivo).trim()}`
        : "Solicitud rechazada por trafico.";
      await actualizarPortalSolicitudAdmin(sol.id, { estado: "rechazada", respuesta });
      notify("Solicitud rechazada", "success");
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
        estado: "pendiente",
        respuesta: "Solicitud reabierta. Pendiente de gestion.",
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
      await actualizarPortalSolicitudAdmin(sol.id, { respuesta });
      notify("Respuesta guardada", "success");
      await cargar();
      refreshSolicitudBadges();
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function modificarPrecio(sol) {
    const value = await promptDialog({
      title: sol.importe ? "Modificar precio / contraoferta" : "Proponer precio",
      message: `Cliente: ${sol.cliente_nombre || "-"}\nPrecio indicado: ${sol.importe ? `${Number(sol.importe).toFixed(2)} EUR` : "sin precio"}`,
      defaultValue: sol.importe_contraoferta ?? sol.importe ?? "",
      placeholder: "Importe total en EUR",
      confirmText: "Enviar propuesta",
      inputType: "number",
    });
    if (value === null) return;
    const precio = Number(String(value).replace(",", "."));
    if (!Number.isFinite(precio) || precio < 0) {
      notify("Indica un precio valido", "warning");
      return;
    }
    setTrabajando(sol.id);
    try {
      await actualizarPortalSolicitudAdmin(sol.id, {
        importe_contraoferta: precio,
        respuesta: `Trafico propone un precio total de ${precio.toFixed(2)} EUR. Pendiente de respuesta del cliente.`,
      });
      notify("Contraoferta enviada al cliente", "success");
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
      const r = await convertirPortalSolicitudAdmin(sol.id, { limpiar_invalidos: true });
      const solicitudActualizada = r?.solicitud || {};
      const pedido = r?.pedido || {};
      setSols(prev => prev.map(item => String(item.id) === String(sol.id)
        ? {
            ...item,
            ...solicitudActualizada,
            estado: "convertida",
            pedido_id: pedido.id || solicitudActualizada.pedido_id || item.pedido_id,
            pedido_numero: pedido.numero || solicitudActualizada.pedido_numero || item.pedido_numero,
            respuesta: solicitudActualizada.respuesta || `Solicitud aceptada. Pedido ${pedido.numero || ""} creado.`.trim(),
            decision_cliente: "aceptada",
          }
        : item
      ));
      notify(r?.ya_convertida ? "La solicitud ya estaba convertida" : `Solicitud convertida en pedido ${r?.pedido?.numero || ""}`.trim(), "success");
      refreshSolicitudBadges();
      cargar().catch(() => {});
    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.toLowerCase().includes("tardado demasiado")) {
        try {
          notify("El servidor sigue procesando la aceptacion. Compruebo si el pedido se ha creado...", "warning");
          let latest = [];
          for (let i = 0; i < 3; i += 1) {
            await new Promise(resolve => setTimeout(resolve, 1800));
            latest = await getPortalSolicitudesAdmin();
            const found = Array.isArray(latest) ? latest.find(item => String(item.id) === String(sol.id)) : null;
            if (found?.estado === "convertida" || found?.pedido_id || found?.pedido_numero) {
              setSols(latest);
              notify(`Solicitud aceptada${found?.pedido_numero ? ` en pedido ${found.pedido_numero}` : ""}.`, "success");
              refreshSolicitudBadges();
              return;
            }
          }
          if (Array.isArray(latest)) setSols(latest);
          notify("La aceptacion se ha enviado, pero el servidor no ha confirmado a tiempo. Actualiza la bandeja en unos segundos antes de repetir.", "warning");
        } catch (pollError) {
          notify("La aceptacion puede seguir procesandose. Actualiza la bandeja antes de repetir.", "warning");
        }
      } else {
        notify(e.message, "error");
      }
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

  async function abrirEditor(sol) {
    setEditando(sol);
    setEditForm({
      origen: sol.origen || "",
      destino: sol.destino || "",
      fecha_carga: sol.fecha_carga ? String(sol.fecha_carga).slice(0, 10) : "",
      hora_carga: sol.hora_carga || "",
      fecha_descarga: sol.fecha_descarga ? String(sol.fecha_descarga).slice(0, 10) : "",
      hora_descarga: sol.hora_descarga || "",
      mercancia: sol.mercancia || "",
      peso_kg: sol.peso_kg ?? "",
      bultos: validBultos(sol.bultos) || "",
      referencia_cliente: sol.referencia_cliente || "",
      tipo_precio: sol.tipo_precio || "viaje",
      precio_unitario: sol.precio_unitario ?? "",
      cantidad: sol.cantidad ?? "",
      importe: sol.importe ?? "",
      importe_minimo: sol.importe_minimo ?? "",
      minimo_unidades: sol.minimo_unidades ?? "",
      km_ruta: sol.km_ruta ?? "",
      notas: sol.notas || "",
      respuesta: sol.respuesta || "",
    });
    setDocsSolicitud([]);
    setDocsLoading(true);
    try {
      const docs = await getPortalSolicitudDocumentosAdmin(sol.id);
      setDocsSolicitud(Array.isArray(docs) ? docs : []);
    } catch (e) {
      notify(e.message || "No se pudieron cargar los documentos de la solicitud", "warning");
    } finally {
      setDocsLoading(false);
    }
  }

  async function guardarEditor() {
    if (!editando?.id) return;
    if (!String(editForm.origen || "").trim() || !String(editForm.destino || "").trim()) {
      notify("Origen y destino son obligatorios", "warning");
      return;
    }
    setTrabajando(editando.id);
    try {
      const updated = await actualizarPortalSolicitudAdmin(editando.id, editForm);
      setSols(prev => prev.map(item => String(item.id) === String(editando.id) ? { ...item, ...updated } : item));
      setEditando(null);
      notify("Solicitud actualizada", "success");
      refreshSolicitudBadges();
      cargar().catch(() => {});
    } catch (e) {
      notify(e.message || "No se pudo actualizar la solicitud", "error");
    } finally {
      setTrabajando(null);
    }
  }

  async function descargarDocumentoSolicitud(doc) {
    if (!doc?.download_url) {
      notify("Documento no disponible", "warning");
      return;
    }
    try {
      await descargarArchivoProtegido(doc.download_url, doc.nombre || "orden-carga");
    } catch (e) {
      notify(e.message || "No se pudo descargar el documento", "error");
    }
  }

  function exportarCsv() {
    if (!visibles.length) {
      notify("No hay solicitudes para exportar", "warning");
      return;
    }
    const headers = ["estado","cliente","referencia","origen","destino","fecha_carga","hora_carga","mercancia","peso_kg","bultos","precio_cliente","pedido","recibida","antiguedad_horas","notas","respuesta"];
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
      validBultos(s.bultos),
      s.importe,
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
      filtros: { estado: enRechazadas ? "rechazadas" : estado, q, orden, soloVencidas },
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
          ["Aceptadas", "convertida", resumen.aceptadas, "#10b981"],
          ["Rechazadas", "rechazadas", resumen.rechazadas, "#ef4444"],
          ["Canceladas", "cancelada", resumen.canceladas, "#ef4444"],
          ["Sin atender >24h", "vencidas", resumen.vencidas, "#ef4444"],
        ].map(([label, valueEstado, value, color]) => (
          <button key={label} onClick={() => {
              if (valueEstado === "rechazadas") { setVista("rechazadas"); setEstado(""); setSoloVencidas(false); return; }
              setVista("activas");
              if (valueEstado === "vencidas") { setSoloVencidas(v => !v); setEstado(""); }
              else { setEstado(valueEstado); setSoloVencidas(false); }
            }}
            style={{ ...S.kpi, textAlign:"left", cursor:"pointer", borderColor: (valueEstado === "rechazadas" ? enRechazadas : valueEstado === "vencidas" ? soloVencidas : !enRechazadas && estado === valueEstado) ? color : "#dbe5ec", display:"grid", gridTemplateColumns:"54px 1fr", alignItems:"center", gap:14 }}>
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
            ["rechazadas", `Rechazadas (${resumen.rechazadas})`],
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
          <option value="">{enRechazadas ? "Todas las rechazadas" : "Todos los estados activos"}</option>
          {!enRechazadas && <option value="pendiente">Pendientes</option>}
          {!enRechazadas && <option value="revisada">En revision</option>}
          {!enRechazadas && <option value="convertida">Aceptadas</option>}
          {!enRechazadas && <option value="cancelada">Canceladas</option>}
          {enRechazadas && <option value="rechazada">Rechazadas</option>}
          {enRechazadas && <option value="descartada">Rechazadas antiguas</option>}
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
        {(q || estado || soloVencidas || enRechazadas) && (
          <button onClick={()=>{setQ("");setEstado("");setSoloVencidas(false);setVista("activas");}} style={S.btn}>Limpiar</button>
        )}
      </div>
      {!loading && sols.length > 0 && (
        <div style={{ margin:"0 0 16px", fontSize:14, color:"#64748b" }}>
          {enRechazadas ? "Rechazadas: " : "Activas: "}
          Mostrando <strong style={{color:"#0f766e"}}>{visibles.length}</strong> de {totalVistaActual} solicitudes
          {soloVencidas ? " · solo sin atender mas de 24 h" : ""}
        </div>
      )}

      {loading && <div style={{ ...S.card, textAlign: "center", color: "var(--text4)", padding: 28 }}>Cargando solicitudes...</div>}
      {!loading && (sols.length === 0 || visibles.length === 0) && (
        <div style={{ ...S.card, textAlign: "center", color: "#64748b", padding: "58px 24px", minHeight: 250, display:"grid", placeItems:"center" }}>
          <div>
            <div style={{width:128,height:128,borderRadius:"50%",background:"rgba(15,118,110,.10)",margin:"0 auto 18px",display:"grid",placeItems:"center",color:"#0f766e",fontSize:64}}>▱</div>
            <div style={{fontSize:22,fontWeight:900,color:"#0f172a",marginBottom:8}}>
              {enRechazadas && sols.length > 0 ? "No hay solicitudes rechazadas." : "No hay solicitudes con esos filtros."}
            </div>
            <div style={{fontSize:14,color:"#94a3b8"}}>Prueba a cambiar los filtros o el criterio de busqueda.</div>
          </div>
        </div>
      )}

      {!loading && visibles.map(sol => {
        const e = ESTADO[sol.estado] || ESTADO.pendiente;
        const rejected = isRejected(sol);
        const pricePending = sol.decision_precio === "pendiente";
        const disabled = trabajando === sol.id || ["convertida", "rechazada", "descartada", "cancelada"].includes(sol.estado);
        const conversionDisabled = disabled || pricePending;
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
              {Number(sol.viajes || 1) > 1 && <span style={{ fontWeight: 900, color: "#3b82f6" }}>Viajes: {Number(sol.viajes)} (se crearan {Number(sol.viajes)} pedidos)</span>}
              {sol.mercancia && <span>Mercancia: {sol.mercancia}</span>}
              {sol.peso_kg && <span>Peso: {Number(sol.peso_kg).toLocaleString("es-ES")} kg</span>}
              {validBultos(sol.bultos) && <span>Bultos: {validBultos(sol.bultos)}</span>}
              {precioSolicitudLabel(sol) && <span>Precio cliente: {precioSolicitudLabel(sol)}</span>}
              {sol.importe_contraoferta !== null && sol.importe_contraoferta !== undefined && (
                <span style={{fontWeight:900,color:sol.decision_precio === "aceptada" ? "#10b981" : sol.decision_precio === "rechazada" ? "#ef4444" : "#f59e0b"}}>
                  Propuesta: {Number(sol.importe_contraoferta).toLocaleString("es-ES", { minimumFractionDigits:2, maximumFractionDigits:2 })} EUR
                  {sol.decision_precio === "aceptada" ? " - aceptada" : sol.decision_precio === "rechazada" ? " - rechazada" : " - pendiente del cliente"}
                </span>
              )}
              {Number(sol.bultos) < 0 && <span style={{color:"#f97316",fontWeight:900}}>Bultos a revisar: valor negativo corregido al aceptar</span>}
              {sol.fecha_descarga && <span>Descarga: {dateEs(sol.fecha_descarga)} {sol.hora_descarga || ""}</span>}
              {sol.pedido_numero && <span>Pedido: {sol.pedido_numero}</span>}
              {Number(sol.documentos_count || 0) > 0 && <span>{Number(sol.documentos_count || 0)} documento(s) adjunto(s)</span>}
            </div>
            {(sol.vehiculo_matricula || sol.matricula_colaborador || sol.remolque_matricula || sol.remolque_matricula_colaborador) && (
              <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 8 }}>
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.18)", fontSize: 12, color: "var(--text3)" }}>
                  Tractora asignada: <strong style={{ color: "var(--text)" }}>{sol.vehiculo_matricula || sol.matricula_colaborador || "Pendiente"}</strong>
                </div>
                <div style={{ padding: 10, borderRadius: 8, background: "rgba(16,185,129,.08)", border: "1px solid rgba(16,185,129,.18)", fontSize: 12, color: "var(--text3)" }}>
                  Remolque asignado: <strong style={{ color: "var(--text)" }}>{sol.remolque_matricula || sol.remolque_matricula_colaborador || "Pendiente"}</strong>
                </div>
              </div>
            )}
            {sol.notas && <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bg3)", color: "var(--text3)", fontSize: 12 }}>{sol.notas}</div>}
            {sol.respuesta && (
              <div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "rgba(59,130,246,.07)", border: "1px solid rgba(59,130,246,.18)", color: "var(--text3)", fontSize: 12 }}>
                <b style={{ color: "var(--accent)" }}>Respuesta / seguimiento:</b> {sol.respuesta}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              {!rejected && (
                <button onClick={() => convertir(sol)} disabled={conversionDisabled} title={pricePending ? "Pendiente de respuesta del cliente a la contraoferta" : ""} style={{ ...S.btn, background: "#10b981", color: "#fff", borderColor: "#10b981", opacity: conversionDisabled ? .55 : 1 }}>
                  {trabajando === sol.id ? "Procesando..." : pricePending ? "Esperando precio" : "Convertir en pedido"}
                </button>
              )}
              {!rejected && (
                <button onClick={() => reprogramar(sol)} disabled={disabled} style={{ ...S.btn, opacity: disabled ? .55 : 1 }}>
                  Reprogramar
                </button>
              )}
              {!rejected && (
                <button onClick={() => modificarPrecio(sol)} disabled={trabajando === sol.id || ["convertida","rechazada","descartada","cancelada"].includes(sol.estado)} style={{ ...S.btn, color:"#b45309", borderColor:"rgba(245,158,11,.35)" }}>
                  {sol.importe ? "Modificar precio" : "Proponer precio"}
                </button>
              )}
              {!rejected && (
                <button onClick={() => abrirEditor(sol)} disabled={trabajando === sol.id} style={{ ...S.btn, color:"#0f766e", borderColor:"rgba(15,118,110,.25)" }}>
                  Editar
                </button>
              )}
              {!rejected && (
                <button onClick={() => responder(sol)} disabled={trabajando === sol.id || ["convertida","rechazada","descartada","cancelada"].includes(sol.estado)} style={{ ...S.btn, opacity: trabajando === sol.id || ["convertida","rechazada","descartada","cancelada"].includes(sol.estado) ? .55 : 1 }}>
                  Responder / nota
                </button>
              )}
              <button onClick={() => copiarResumen(sol)} style={S.btn}>
                Copiar resumen
              </button>
              <button onClick={() => toggleEventos(sol)} style={S.btn}>
                {eventosAbiertos[sol.id] ? "Ocultar historial" : "Ver historial"}
              </button>
              {rejected ? (
                <button onClick={() => restaurar(sol)} disabled={trabajando === sol.id} style={{ ...S.btn, color: "#10b981", borderColor: "rgba(16,185,129,.25)", opacity: trabajando === sol.id ? .55 : 1 }}>
                  Restaurar
                </button>
              ) : (
                <button onClick={() => rechazar(sol)} disabled={disabled} style={{ ...S.btn, color: "#ef4444", borderColor: "rgba(239,68,68,.25)", opacity: disabled ? .55 : 1 }}>
                  Rechazar
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
      {editando && (
        <div style={{ position:"fixed", inset:0, zIndex:2200, background:"rgba(15,23,42,.45)", display:"grid", placeItems:"center", padding:16 }}>
          <div className="tg-responsive-modal" style={{ width:"min(920px,100%)", maxHeight:"92vh", overflowY:"auto", background:"var(--bg2)", border:"1px solid var(--border)", borderRadius:14, padding:18, boxShadow:"0 24px 70px rgba(15,23,42,.25)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", marginBottom:12 }}>
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, fontSize:22, color:"var(--text)" }}>Editar solicitud</div>
                <div style={{ color:"var(--text4)", fontSize:12, marginTop:3 }}>{editando.cliente_nombre || "-"} · {editando.origen || "-"} -> {editando.destino || "-"}</div>
              </div>
              <button type="button" onClick={()=>setEditando(null)} style={{ ...S.btn, padding:"8px 12px" }}>X</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))", gap:12 }}>
              {[
                ["origen", "Origen", "text"],
                ["destino", "Destino", "text"],
                ["fecha_carga", "Fecha carga", "date"],
                ["hora_carga", "Hora carga", "text"],
                ["fecha_descarga", "Fecha descarga", "date"],
                ["hora_descarga", "Hora descarga", "text"],
                ["mercancia", "Mercancia", "text"],
                ["peso_kg", "Peso kg", "number"],
                ["bultos", "Bultos / palets", "number"],
                ["referencia_cliente", "Referencia cliente", "text"],
                ["km_ruta", "Km ruta", "number"],
                ["importe", "Importe total EUR", "number"],
                ["precio_unitario", "Precio unitario", "number"],
                ["cantidad", "Cantidad", "number"],
                ["importe_minimo", "Minimo EUR", "number"],
                ["minimo_unidades", "Minimo unidades", "number"],
              ].map(([key, label, type]) => (
                <label key={key} style={{ display:"grid", gap:5, fontSize:11, color:"var(--text5)", fontWeight:900, textTransform:"uppercase", letterSpacing:".05em" }}>
                  {label}
                  <input
                    type={type}
                    value={editForm[key] ?? ""}
                    onChange={e=>setEditForm(p=>({...p,[key]:e.target.value}))}
                    style={{ ...S.input, width:"100%", boxSizing:"border-box" }}
                  />
                </label>
              ))}
              <label style={{ display:"grid", gap:5, fontSize:11, color:"var(--text5)", fontWeight:900, textTransform:"uppercase", letterSpacing:".05em" }}>
                Tipo precio
                <select value={editForm.tipo_precio || "viaje"} onChange={e=>setEditForm(p=>({...p,tipo_precio:e.target.value}))} style={{ ...S.input, width:"100%" }}>
                  <option value="viaje">Precio por viaje</option>
                  <option value="km">Por kilometros</option>
                  <option value="tonelada">Por toneladas</option>
                  <option value="kg">Por 100 kg</option>
                  <option value="palet">Por palet</option>
                  <option value="hora">Por horas</option>
                </select>
              </label>
              <label style={{ gridColumn:"1/-1", display:"grid", gap:5, fontSize:11, color:"var(--text5)", fontWeight:900, textTransform:"uppercase", letterSpacing:".05em" }}>
                Notas
                <textarea value={editForm.notas || ""} onChange={e=>setEditForm(p=>({...p,notas:e.target.value}))} style={{ ...S.input, minHeight:80, resize:"vertical", width:"100%", boxSizing:"border-box" }} />
              </label>
              <label style={{ gridColumn:"1/-1", display:"grid", gap:5, fontSize:11, color:"var(--text5)", fontWeight:900, textTransform:"uppercase", letterSpacing:".05em" }}>
                Respuesta / seguimiento visible para el cliente
                <textarea value={editForm.respuesta || ""} onChange={e=>setEditForm(p=>({...p,respuesta:e.target.value}))} style={{ ...S.input, minHeight:74, resize:"vertical", width:"100%", boxSizing:"border-box" }} />
              </label>
            </div>
            <div style={{ marginTop:16, padding:12, borderRadius:10, border:"1px solid var(--border2)", background:"var(--bg3)" }}>
              <div style={{ fontWeight:900, color:"var(--text)", marginBottom:8 }}>Ordenes de carga adjuntas</div>
              {docsLoading ? (
                <div style={{ color:"var(--text4)", fontSize:12 }}>Cargando documentos...</div>
              ) : docsSolicitud.length === 0 ? (
                <div style={{ color:"var(--text5)", fontSize:12 }}>Sin documentos adjuntos en la solicitud.</div>
              ) : (
                <div style={{ display:"grid", gap:8 }}>
                  {docsSolicitud.map(doc => (
                    <div key={doc.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap", padding:"9px 10px", border:"1px solid var(--border2)", borderRadius:8, background:"var(--bg2)" }}>
                      <div>
                        <div style={{ fontWeight:900, color:"var(--text)", fontSize:13 }}>{doc.nombre || "orden-carga"}</div>
                        <div style={{ color:"var(--text5)", fontSize:11 }}>{doc.file_mime || "archivo"} · {doc.file_size_kb || "-"} KB</div>
                      </div>
                      <button type="button" onClick={()=>descargarDocumentoSolicitud(doc)} style={{ ...S.btn, color:"#0f766e" }}>Descargar</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:10, flexWrap:"wrap", marginTop:16 }}>
              <button type="button" onClick={()=>setEditando(null)} style={S.btn}>Cancelar</button>
              <button type="button" onClick={guardarEditor} disabled={trabajando === editando.id} style={{ ...S.btn, background:"#0f766e", color:"#fff", borderColor:"#0f766e", opacity: trabajando === editando.id ? .65 : 1 }}>
                {trabajando === editando.id ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

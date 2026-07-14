import { useCallback, useEffect, useState } from "react";
import {
  cancelarPortalClienteSolicitud,
  crearPortalClienteSolicitud,
  descargarArchivoProtegido,
  getPortalClienteFactura,
  getPortalClienteFacturas,
  getPortalClienteDocumentosResumen,
  getPortalClienteNotificaciones,
  getPortalClientePedidos,
  getPortalClientePuntos,
  getPortalClienteResumen,
  getPortalClienteSolicitudEventos,
  getPortalClienteSolicitudes,
  getPortalPedidoAlbaranes,
  getPortalPedidoDocumentoControl,
  getPortalPedidoEventos,
  marcarPortalClienteNotificacionLeida,
  marcarTodasPortalClienteNotificacionesLeidas,
  responderPortalClienteReprogramacion,
  responderPortalClientePrecio,
} from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { notify } from "../services/notify";
import PortalPointPicker from "../components/PortalPointPicker";

const fmt2 = n => Number(n || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const ESTADOS = {
  pendiente: { l: "Pendiente", c: "#9ca3af" },
  confirmado: { l: "Confirmado", c: "#3b82f6" },
  en_curso: { l: "En ruta", c: "#f97316" },
  descarga: { l: "Descargando", c: "#a78bfa" },
  entregado: { l: "Entregado", c: "#10b981" },
  cancelado: { l: "Cancelado", c: "#ef4444" },
  incidencia: { l: "Incidencia", c: "#fbbf24" },
  facturado: { l: "Facturado", c: "#8b5cf6" },
  convertida: { l: "Aceptada", c: "#10b981" },
  descartada: { l: "Rechazada", c: "#ef4444" },
  rechazada: { l: "Rechazada", c: "#ef4444" },
  cancelada: { l: "Cancelada", c: "#ef4444" },
  revisada: { l: "En revision", c: "#3b82f6" },
};

const TIPOS_PRECIO = [
  { v: "viaje", l: "Precio por viaje (EUR fijo)" },
  { v: "kg", l: "Por kg (EUR/100kg)" },
  { v: "tonelada", l: "Por toneladas (EUR/tn)" },
  { v: "km", l: "Por kilometro (EUR/km)" },
  { v: "hora", l: "Por hora (EUR/h)" },
  { v: "palet", l: "Por palet (EUR/palet)" },
];

function precioSolicitudLabel(item = {}) {
  const tipo = String(item.tipo_precio || "viaje");
  const unit = Number(item.precio_unitario ?? item.importe ?? 0);
  const cantidad = Number(item.cantidad || 0);
  const importe = Number(item.importe || 0);
  if (!unit && !importe) return "-";
  if (tipo === "viaje") return `${(importe || unit).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const units = { kg: "EUR/100kg", tonelada: "EUR/tn", km: "EUR/km", hora: "EUR/h", palet: "EUR/palet" };
  return [
    `${unit.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${units[tipo] || "EUR"}`,
    cantidad ? `${cantidad.toLocaleString("es-ES", { maximumFractionDigits: 3 })} ${tipo === "tonelada" ? "tn" : tipo === "hora" ? "h" : tipo === "palet" ? "palets" : tipo}` : "",
    importe ? `total ${importe.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR` : "",
  ].filter(Boolean).join(" - ");
}

function estadoClienteSurface(estado) {
  const key = String(estado || "").toLowerCase();
  const styles = {
    pendiente: { bg: "rgba(245,158,11,.07)", border: "rgba(245,158,11,.22)", bar: "rgba(245,158,11,.70)" },
    revisada: { bg: "rgba(59,130,246,.06)", border: "rgba(59,130,246,.18)", bar: "rgba(59,130,246,.55)" },
    confirmado: { bg: "rgba(59,130,246,.07)", border: "rgba(59,130,246,.22)", bar: "rgba(59,130,246,.65)" },
    en_curso: { bg: "rgba(34,211,238,.12)", border: "rgba(34,211,238,.28)", bar: "rgba(34,211,238,.70)" },
    descarga: { bg: "rgba(167,139,250,.10)", border: "rgba(167,139,250,.28)", bar: "rgba(167,139,250,.65)" },
    entregado: { bg: "rgba(16,185,129,.08)", border: "rgba(16,185,129,.24)", bar: "rgba(16,185,129,.70)" },
    facturado: { bg: "rgba(139,92,246,.08)", border: "rgba(139,92,246,.24)", bar: "rgba(139,92,246,.62)" },
    incidencia: { bg: "rgba(251,191,36,.13)", border: "rgba(251,191,36,.34)", bar: "rgba(251,191,36,.82)" },
    cancelado: { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.25)", bar: "rgba(239,68,68,.78)" },
    cancelada: { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.25)", bar: "rgba(239,68,68,.78)" },
    rechazada: { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.25)", bar: "rgba(239,68,68,.78)" },
    descartada: { bg: "rgba(239,68,68,.08)", border: "rgba(239,68,68,.25)", bar: "rgba(239,68,68,.78)" },
    convertida: { bg: "rgba(16,185,129,.08)", border: "rgba(16,185,129,.24)", bar: "rgba(16,185,129,.70)" },
  };
  const style = styles[key];
  if (!style) return {};
  return {
    background: style.bg,
    border: `1px solid ${style.border}`,
    boxShadow: `inset 3px 0 0 ${style.bar}`,
  };
}

const TIMELINE = [
  ["pendiente", "Pendiente"],
  ["confirmado", "Confirmado"],
  ["en_curso", "En camino"],
  ["descarga", "Descarga"],
  ["entregado", "Entregado"],
];

function dateEs(v) {
  if (!v) return "-";
  return new Date(v).toLocaleDateString("es-ES");
}

function isValidDateInput(value) {
  if (!value) return true;
  const raw = String(value).trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day;
}

async function downloadDoc(doc) {
  if (doc?.download_url) {
    try {
      await descargarArchivoProtegido(doc.download_url, doc.nombre || "albaran.pdf");
    } catch (e) {
      notify(e.message || "No se pudo descargar el documento", "error");
    }
    return;
  }
  if (!doc?.file_base64) {
    notify("Este albaran no tiene archivo descargable", "warning");
    return;
  }
  const a = document.createElement("a");
  a.href = `data:${doc.file_mime || "application/octet-stream"};base64,${doc.file_base64}`;
  a.download = doc.nombre || "albaran.pdf";
  a.click();
}

function getDocumentoControlUrl(data, download = false) {
  if (!data) return "";
  if (download && data.remision?.download_url) return data.remision.download_url;
  const fromDownload = String(data.remision?.download_url || "")
    .replace(/([?&])download=1\b/, "")
    .replace(/[?&]$/, "");
  return data.documento?.soporte_url || data.documento?.url_publica || data.soporte_url || fromDownload || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildSolicitudesReportHtml({ solicitudes = [], pedidos = [], empresa = {}, user = {} } = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const abiertas = solicitudes.filter(s => ["pendiente", "revisada"].includes(s.estado));
  const convertidas = solicitudes.filter(s => s.estado === "convertida");
  const rechazadas = solicitudes.filter(s => ["rechazada", "descartada"].includes(s.estado));
  const propuestasPendientes = solicitudes.filter(s => s.fecha_propuesta && (!s.decision_cliente || s.decision_cliente === "pendiente"));
  const movimientos = solicitudes.reduce((sum, s) => sum + Number(s.eventos_count || 0), 0);
  const rows = (list) => list.map(s => `<tr>
    <td>${escapeHtml(s.created_at ? new Date(s.created_at).toLocaleDateString("es-ES") : "-")}</td>
    <td>${escapeHtml(s.referencia_cliente || "-")}</td>
    <td>${escapeHtml(s.origen || "-")}</td>
    <td>${escapeHtml(s.destino || "-")}</td>
    <td>${escapeHtml(s.fecha_carga ? new Date(s.fecha_carga).toLocaleDateString("es-ES") : "-")}</td>
    <td>${escapeHtml(s.estado || "-")}</td>
    <td>${escapeHtml(s.pedido_numero || "-")}</td>
    <td>${escapeHtml(s.fecha_propuesta ? `${new Date(s.fecha_propuesta).toLocaleDateString("es-ES")}${s.hora_propuesta ? ` ${s.hora_propuesta}` : ""}` : "-")}</td>
    <td>${escapeHtml(s.decision_cliente || "-")}</td>
    <td>${escapeHtml(Number(s.eventos_count || 0))}${s.ultimo_evento_at ? ` / ${escapeHtml(new Date(s.ultimo_evento_at).toLocaleString("es-ES"))}` : ""}</td>
    <td>${escapeHtml(s.respuesta || "")}</td>
  </tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Resumen de solicitudes</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Resumen de solicitudes del portal cliente</h1>
      <div class="sub">${escapeHtml(empresa.razon_social || "TransGest")} - generado el ${escapeHtml(generated)} para ${escapeHtml(user.nombre || user.username || "cliente")}.</div>
      <div class="grid">
        <div class="box"><div class="metric">${escapeHtml(solicitudes.length)}</div><div class="muted">Solicitudes totales</div></div>
        <div class="box"><div class="metric">${escapeHtml(abiertas.length)}</div><div class="muted">Solicitudes abiertas</div></div>
        <div class="box"><div class="metric">${escapeHtml(propuestasPendientes.length)}</div><div class="muted">Propuestas pendientes</div></div>
        <div class="box"><div class="metric">${escapeHtml(convertidas.length)}</div><div class="muted">Aceptadas en pedido</div></div>
        <div class="box"><div class="metric">${escapeHtml(rechazadas.length)}</div><div class="muted">Rechazadas</div></div>
        <div class="box"><div class="metric">${escapeHtml(movimientos)}</div><div class="muted">Movimientos trazados</div></div>
        <div class="box"><div class="metric">${escapeHtml(pedidos.length)}</div><div class="muted">Viajes visibles</div></div>
      </div>
      <table><thead><tr><th>Fecha</th><th>Referencia</th><th>Origen</th><th>Destino</th><th>Carga</th><th>Estado</th><th>Pedido</th><th>Propuesta</th><th>Decision</th><th>Movimientos</th><th>Respuesta</th></tr></thead><tbody>
        ${rows(solicitudes) || "<tr><td colspan='11'>No hay solicitudes registradas.</td></tr>"}
      </tbody></table>
    </main></body></html>`;
}

function diasVencida(fecha) {
  if (!fecha) return 0;
  const due = new Date(fecha);
  if (Number.isNaN(due.getTime())) return 0;
  due.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.floor((today - due) / 86400000));
}

function estadoCuentaFacturas(facturas = []) {
  const rows = Array.isArray(facturas) ? facturas : [];
  const pendientes = rows.filter(f => ["emitida", "enviada", "vencida", "reclamada", "sin_cobrar"].includes(String(f.estado || "")));
  const buckets = [
    { key: "corriente", label: "No vencido", min: 0, max: 0, total: 0, count: 0 },
    { key: "1_30", label: "1-30 dias", min: 1, max: 30, total: 0, count: 0 },
    { key: "31_60", label: "31-60 dias", min: 31, max: 60, total: 0, count: 0 },
    { key: "60", label: "+60 dias", min: 61, max: Infinity, total: 0, count: 0 },
  ];
  pendientes.forEach(f => {
    const dias = diasVencida(f.fecha_vencimiento);
    const bucket = dias === 0 ? buckets[0] : buckets.find(b => dias >= b.min && dias <= b.max) || buckets[buckets.length - 1];
    bucket.total += Number(f.total || 0);
    bucket.count += 1;
  });
  return {
    pendientes,
    buckets,
    totalPendiente: pendientes.reduce((s, f) => s + Number(f.total || 0), 0),
    totalVencido: pendientes.filter(f => diasVencida(f.fecha_vencimiento) > 0).reduce((s, f) => s + Number(f.total || 0), 0),
  };
}

function matchesSearch(item, query, fields = []) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  return fields.some(field => String(item?.[field] || "").toLowerCase().includes(q));
}

function buildEstadoCuentaReportHtml({ facturas = [], empresa = {}, user = {} } = {}) {
  const estado = estadoCuentaFacturas(facturas);
  const generated = new Date().toLocaleString("es-ES");
  const money = value => `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const bucketRows = estado.buckets.map(b => `<tr>
    <td>${escapeHtml(b.label)}</td>
    <td>${escapeHtml(b.count)}</td>
    <td class="money">${escapeHtml(money(b.total))}</td>
  </tr>`).join("");
  const invoiceRows = estado.pendientes.map(f => {
    const dias = diasVencida(f.fecha_vencimiento);
    return `<tr>
      <td>${escapeHtml(f.numero || "-")}</td>
      <td>${escapeHtml(dateEs(f.fecha))}</td>
      <td>${escapeHtml(dateEs(f.fecha_vencimiento))}</td>
      <td>${escapeHtml(f.estado || "-")}</td>
      <td>${escapeHtml(dias > 0 ? `${dias} dia(s)` : "No vencida")}</td>
      <td class="money">${escapeHtml(money(f.total))}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Estado de cuenta</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:980px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}.money{text-align:right;font-weight:800}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Estado de cuenta</h1>
      <div class="sub">${escapeHtml(empresa.razon_social || "TransGest")} - generado el ${escapeHtml(generated)} para ${escapeHtml(user.nombre || user.username || "cliente")}.</div>
      <div class="grid">
        <div class="box"><div class="metric">${escapeHtml(estado.pendientes.length)}</div><div class="muted">Facturas pendientes</div></div>
        <div class="box"><div class="metric">${escapeHtml(money(estado.totalPendiente))}</div><div class="muted">Total pendiente</div></div>
        <div class="box"><div class="metric">${escapeHtml(money(estado.totalVencido))}</div><div class="muted">Total vencido</div></div>
      </div>
      <h2>Antiguedad de deuda</h2>
      <table><thead><tr><th>Tramo</th><th>Facturas</th><th class="money">Importe</th></tr></thead><tbody>${bucketRows}</tbody></table>
      <h2>Facturas pendientes</h2>
      <table><thead><tr><th>Factura</th><th>Fecha</th><th>Vencimiento</th><th>Estado</th><th>Antiguedad</th><th class="money">Total</th></tr></thead><tbody>
        ${invoiceRows || "<tr><td colspan='6'>No hay facturas pendientes.</td></tr>"}
      </tbody></table>
    </main></body></html>`;
}

function buildDocumentosReportHtml({ documentosResumen = {}, empresa = {}, user = {} } = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const pedidosDocs = Array.isArray(documentosResumen.pedidos) ? documentosResumen.pedidos : [];
  const pendientes = pedidosDocs.filter(p => Number(p.albaranes_count || 0) === 0);
  const rows = pedidosDocs.map(p => `<tr>
    <td>${escapeHtml(p.numero || "-")}</td>
    <td>${escapeHtml(p.referencia_cliente || "-")}</td>
    <td>${escapeHtml(dateEs(p.fecha_carga))}</td>
    <td>${escapeHtml(p.estado || "-")}</td>
    <td>${escapeHtml(p.albaranes_count || 0)}</td>
    <td>${escapeHtml(p.documentos_count || 0)}</td>
    <td>${escapeHtml(p.documentos_factura_count || 0)}</td>
    <td>${escapeHtml(p.ultimo_documento_at ? new Date(p.ultimo_documento_at).toLocaleString("es-ES") : "-")}</td>
  </tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Resumen documental</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}.warn{color:#b45309}.ok{color:#047857}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Resumen documental</h1>
      <div class="sub">${escapeHtml(empresa.razon_social || "TransGest")} - generado el ${escapeHtml(generated)} para ${escapeHtml(user.nombre || user.username || "cliente")}.</div>
      <div class="grid">
        <div class="box"><div class="metric">${escapeHtml(documentosResumen.total || 0)}</div><div class="muted">Viajes revisados</div></div>
        <div class="box"><div class="metric ok">${escapeHtml(documentosResumen.con_albaran || 0)}</div><div class="muted">Con albaran</div></div>
        <div class="box"><div class="metric ${pendientes.length ? "warn" : "ok"}">${escapeHtml(documentosResumen.sin_albaran || 0)}</div><div class="muted">Albaran pendiente</div></div>
        <div class="box"><div class="metric">${escapeHtml(documentosResumen.documentos_total || 0)}</div><div class="muted">Documentos adjuntos</div></div>
      </div>
      <h2>Detalle por viaje</h2>
      <table><thead><tr><th>Pedido</th><th>Ref. cliente</th><th>Carga</th><th>Estado</th><th>Albaranes</th><th>Docs viaje</th><th>Docs factura</th><th>Ultimo documento</th></tr></thead><tbody>
        ${rows || "<tr><td colspan='8'>No hay documentacion disponible.</td></tr>"}
      </tbody></table>
    </main></body></html>`;
}

function solicitudEventoLabel(tipo) {
  const labels = {
    "solicitud.creada": "Solicitud creada",
    "solicitud.reprogramacion.cliente": "Respuesta a reprogramacion",
    "solicitud.reprogramacion.propuesta": "Reprogramacion propuesta",
    "solicitud.convertida": "Convertida en pedido",
    "solicitud.rechazada": "Solicitud rechazada",
    "solicitud.cancelada.cliente": "Cancelada por cliente",
    "solicitud.precio.propuesto": "Nuevo precio propuesto",
    "solicitud.precio.aceptada": "Precio aceptado",
    "solicitud.precio.rechazada": "Precio rechazado",
    "solicitud.actualizada": "Gestion actualizada",
  };
  return labels[tipo] || tipo || "Evento";
}

function solicitudEventoResumen(ev) {
  const d = ev?.detalle || {};
  if (ev.tipo === "solicitud.creada") return [d.origen, d.destino].filter(Boolean).join(" -> ") || "Solicitud registrada.";
  if (ev.tipo === "solicitud.reprogramacion.cliente") return `${d.decision || "Decision"} ${d.fecha_propuesta || ""} ${d.hora_propuesta || ""}`.trim();
  if (ev.tipo === "solicitud.reprogramacion.propuesta") return d.fecha_propuesta ? `${d.fecha_propuesta}${d.hora_propuesta ? ` ${d.hora_propuesta}` : ""}` : "Trafico ha propuesto una nueva fecha.";
  if (ev.tipo === "solicitud.convertida") return d.pedido_numero ? `Pedido ${d.pedido_numero}` : "Convertida en pedido.";
  if (ev.tipo === "solicitud.rechazada") return d.respuesta || "Solicitud rechazada por trafico.";
  if (ev.tipo === "solicitud.cancelada.cliente") return d.motivo ? `Motivo: ${d.motivo}` : "Cancelada desde el portal cliente.";
  if (ev.tipo?.startsWith("solicitud.precio.")) return d.importe_contraoferta !== null && d.importe_contraoferta !== undefined ? `${Number(d.importe_contraoferta).toFixed(2)} EUR` : "Precio actualizado.";
  if (ev.tipo === "solicitud.actualizada") return d.estado ? `Estado: ${d.estado}` : "Gestion actualizada.";
  return "";
}

function buildSolicitudHistorialHtml({ solicitud = {}, eventos = [], empresa = {}, user = {} } = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const estado = ESTADOS[solicitud.estado] || { l: solicitud.estado || "-", c: "#64748b" };
  const eventRows = (Array.isArray(eventos) ? eventos : []).map(ev => `<tr>
    <td>${escapeHtml(ev.created_at ? new Date(ev.created_at).toLocaleString("es-ES") : "-")}</td>
    <td>${escapeHtml(solicitudEventoLabel(ev.tipo))}</td>
    <td>${escapeHtml(solicitudEventoResumen(ev) || "-")}</td>
  </tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Historial de solicitud</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:900px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;font-weight:800}.value{margin-top:5px;font-size:13px;font-weight:800}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}
      .status{display:inline-block;border-radius:20px;padding:4px 10px;background:${escapeHtml(estado.c)}18;color:${escapeHtml(estado.c)};font-weight:800;font-size:12px}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Historial de solicitud de transporte</h1>
      <div class="sub">${escapeHtml(empresa.razon_social || "TransGest")} - generado el ${escapeHtml(generated)} para ${escapeHtml(user.nombre || user.username || "cliente")}.</div>
      <div class="grid">
        <div class="box"><div class="label">Estado</div><div class="value"><span class="status">${escapeHtml(estado.l)}</span></div></div>
        <div class="box"><div class="label">Referencia cliente</div><div class="value">${escapeHtml(solicitud.referencia_cliente || "-")}</div></div>
        <div class="box"><div class="label">Pedido</div><div class="value">${escapeHtml(solicitud.pedido_numero || "-")}</div></div>
        <div class="box"><div class="label">Fecha carga</div><div class="value">${escapeHtml(dateEs(solicitud.fecha_carga))}</div></div>
      </div>
      <div class="grid">
        <div class="box"><div class="label">Origen</div><div class="value">${escapeHtml(solicitud.origen || "-")}</div></div>
        <div class="box"><div class="label">Destino</div><div class="value">${escapeHtml(solicitud.destino || "-")}</div></div>
      </div>
      ${solicitud.respuesta ? `<div class="box"><div class="label">Respuesta de gestion</div><div class="value">${escapeHtml(solicitud.respuesta)}</div></div>` : ""}
      <h2 style="font-size:16px;margin:22px 0 8px">Historial</h2>
      <table><thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th></tr></thead><tbody>
        ${eventRows || "<tr><td colspan='3'>Sin eventos registrados.</td></tr>"}
      </tbody></table>
    </main></body></html>`;
}

export default function PortalClientes() {
  const { user, logout } = useAuth();
  const empresa = useEmpresaPerfil();
  const isProviderPortal = String(user?.rol || "").toLowerCase().includes("colaborador") || String(user?.rol || "").toLowerCase().includes("proveedor") || !!user?.colaborador_id;
  const portalName = isProviderPortal ? "Peticiones viajes" : "Portal cliente";
  const [pedidos, setPedidos] = useState([]);
  const [facturas, setFacturas] = useState([]);
  const [solicitudes, setSolicitudes] = useState([]);
  const [portalResumen, setPortalResumen] = useState(null);
  const [documentosResumen, setDocumentosResumen] = useState({ pedidos: [], total: 0, con_albaran: 0, sin_albaran: 0, documentos_total: 0 });
  const [docs, setDocs] = useState({});
  const [docControl, setDocControl] = useState({});
  const [pedidoEventos, setPedidoEventos] = useState({});
  const [solicitudEventos, setSolicitudEventos] = useState({});
  const [loadingDocs, setLoadingDocs] = useState(null);
  const [loadingDocControl, setLoadingDocControl] = useState(null);
  const [loadingPedidoEventos, setLoadingPedidoEventos] = useState(null);
  const [loadingSolicitudEventos, setLoadingSolicitudEventos] = useState(null);
  const [descargandoSolicitudHistorial, setDescargandoSolicitudHistorial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("seguimiento");
  const [q, setQ] = useState("");
  const [pedSel, setPedSel] = useState(null);
  const [pedidoEventosAbierto, setPedidoEventosAbierto] = useState(null);
  const [solicitudEventosAbierta, setSolicitudEventosAbierta] = useState(null);
  const [facturaSel, setFacturaSel] = useState(null);
  const [loadingFactura, setLoadingFactura] = useState(null);
  const [portalNotificaciones, setPortalNotificaciones] = useState([]);
  const [portalNotificacionesNoLeidas, setPortalNotificacionesNoLeidas] = useState(0);

  const cargar = useCallback(async ({ silencioso = false } = {}) => {
    if (!silencioso) setLoading(true);
    try {
      if (silencioso) {
        const [p, s, n] = await Promise.all([
          getPortalClientePedidos().catch(() => null),
          getPortalClienteSolicitudes().catch(() => null),
          getPortalClienteNotificaciones(20).catch(() => null),
        ]);
        if (Array.isArray(p)) setPedidos(p);
        if (Array.isArray(s)) setSolicitudes(s);
        if (n && Array.isArray(n.data)) {
          setPortalNotificaciones(n.data);
          setPortalNotificacionesNoLeidas(Number(n.no_leidas || 0));
        }
        return;
      }
      const [p, f, s, dr, resumen, n] = await Promise.all([
        getPortalClientePedidos().catch(() => []),
        getPortalClienteFacturas().catch(() => []),
        getPortalClienteSolicitudes().catch(() => []),
        getPortalClienteDocumentosResumen().catch(() => null),
        getPortalClienteResumen().catch(() => null),
        getPortalClienteNotificaciones(20).catch(() => null),
      ]);
      setPedidos(Array.isArray(p) ? p : []);
      setFacturas(Array.isArray(f) ? f : []);
      setSolicitudes(Array.isArray(s) ? s : []);
      setPortalResumen(resumen && typeof resumen === "object" ? resumen : null);
      setDocumentosResumen(dr && Array.isArray(dr.pedidos) ? dr : { pedidos: [], total: 0, con_albaran: 0, sin_albaran: 0, documentos_total: 0 });
      setPortalNotificaciones(n && Array.isArray(n.data) ? n.data : []);
      setPortalNotificacionesNoLeidas(Number(n?.no_leidas || 0));
    } finally {
      if (!silencioso) setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    const interval = window.setInterval(() => cargar({ silencioso: true }), 15000);
    const onVisible = () => {
      if (document.visibilityState === "visible") cargar({ silencioso: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [cargar]);

  async function abrirNovedadCliente(item) {
    const targetTab = item?.data?.tab === "solicitudes" ? "solicitudes" : "seguimiento";
    setTab(targetTab);
    if (!item?.id) return;
    try {
      await marcarPortalClienteNotificacionLeida(item.id);
      setPortalNotificaciones(prev => prev.filter(n => n.id !== item.id));
      setPortalNotificacionesNoLeidas(prev => Math.max(0, prev - 1));
    } catch (error) {
      notify(error.message || "No se pudo marcar la novedad como leida", "error");
    }
  }

  async function marcarNovedadesClienteLeidas() {
    try {
      await marcarTodasPortalClienteNotificacionesLeidas();
      setPortalNotificaciones([]);
      setPortalNotificacionesNoLeidas(0);
    } catch (error) {
      notify(error.message || "No se pudieron marcar las novedades como leidas", "error");
    }
  }

  const solicitudesAbiertas = solicitudes.filter(s => ["pendiente", "revisada"].includes(s.estado));
  const solicitudesConvertidas = solicitudes.filter(s => s.estado === "convertida");
  const reprogramacionesPendientes = solicitudes.filter(s => s.fecha_propuesta && (!s.decision_cliente || s.decision_cliente === "pendiente"));
  const movimientosSolicitudes = solicitudes.reduce((sum, s) => sum + Number(s.eventos_count || 0), 0);
  const pedidosFiltrados = pedidos.filter(p => matchesSearch(p, q, ["numero", "referencia_cliente", "origen", "destino", "mercancia", "vehiculo_matricula", "estado"]));
  const facturasFiltradas = facturas.filter(f => matchesSearch(f, q, ["numero", "estado", "forma_pago"]));
  const solicitudesFiltradas = solicitudes.filter(s => matchesSearch(s, q, [
    "referencia_cliente",
    "origen",
    "destino",
    "mercancia",
    "estado",
    "pedido_numero",
    "respuesta",
    "vehiculo_matricula",
    "matricula_colaborador",
    "remolque_matricula",
    "remolque_matricula_colaborador",
  ]));

  async function verAlbaranes(pedidoId) {
    if (!pedidoId) return;
    if (docs[pedidoId]) {
      setPedSel(pedSel === pedidoId ? null : pedidoId);
      return;
    }
    setLoadingDocs(pedidoId);
    try {
      const data = await getPortalPedidoAlbaranes(pedidoId);
      setDocs(prev => ({ ...prev, [pedidoId]: Array.isArray(data) ? data : [] }));
      setPedSel(pedidoId);
    } finally {
      setLoadingDocs(null);
    }
  }

  async function responderReprogramacion(id, decision) {
    try {
      await responderPortalClienteReprogramacion(id, { decision });
      notify(decision === "aceptada" ? "Nueva fecha aceptada" : "Nueva fecha rechazada", "success");
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function responderPrecio(id, decision) {
    try {
      await responderPortalClientePrecio(id, { decision });
      notify(decision === "aceptada" ? "Precio aceptado" : "Precio rechazado", "success");
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function cancelarSolicitud(solicitud) {
    if (!solicitud?.id) return;
    if (solicitud.pedido_id || solicitud.estado === "convertida") {
      notify("Esta solicitud ya esta convertida en pedido. Contacta con trafico para cancelarla.", "warning");
      return;
    }
    const motivo = window.prompt("Motivo de cancelacion para trafico (opcional):") || "";
    try {
      await cancelarPortalClienteSolicitud(solicitud.id, { motivo });
      notify("Solicitud cancelada.", "success");
      await cargar();
      setTab("solicitudes");
    } catch (e) {
      notify(e.message || "No se pudo cancelar la solicitud.", "error");
    }
  }

  async function verSolicitudEventos(id) {
    if (!id) return;
    if (solicitudEventos[id]) {
      setSolicitudEventosAbierta(solicitudEventosAbierta === id ? null : id);
      return;
    }
    setLoadingSolicitudEventos(id);
    try {
      const data = await getPortalClienteSolicitudEventos(id);
      setSolicitudEventos(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
      setSolicitudEventosAbierta(id);
    } catch (e) {
      notify(e.message || "No se pudo cargar el historial.", "error");
    } finally {
      setLoadingSolicitudEventos(null);
    }
  }

  async function verPedidoEventos(id) {
    if (!id) return;
    if (pedidoEventos[id]) {
      setPedidoEventosAbierto(pedidoEventosAbierto === id ? null : id);
      return;
    }
    setLoadingPedidoEventos(id);
    try {
      const data = await getPortalPedidoEventos(id);
      setPedidoEventos(prev => ({ ...prev, [id]: Array.isArray(data) ? data : [] }));
      setPedidoEventosAbierto(id);
    } catch (e) {
      notify(e.message || "No se pudo cargar la actividad del viaje.", "error");
    } finally {
      setLoadingPedidoEventos(null);
    }
  }

  async function descargarHistorialSolicitud(solicitud) {
    if (!solicitud?.id) return;
    setDescargandoSolicitudHistorial(solicitud.id);
    try {
      let eventos = solicitudEventos[solicitud.id];
      if (!eventos) {
        const data = await getPortalClienteSolicitudEventos(solicitud.id);
        eventos = Array.isArray(data) ? data : [];
        setSolicitudEventos(prev => ({ ...prev, [solicitud.id]: eventos }));
      }
      const html = buildSolicitudHistorialHtml({ solicitud, eventos, empresa, user });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `historial-solicitud-${solicitud.referencia_cliente || solicitud.id}-${new Date().toISOString().slice(0, 10)}.html`.replace(/[^\w.-]+/g, "-");
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Historial de solicitud descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el historial.", "error");
    } finally {
      setDescargandoSolicitudHistorial(null);
    }
  }

  async function verDocumentoControl(pedidoId) {
    if (!pedidoId) return;
    const cachedUrl = getDocumentoControlUrl(docControl[pedidoId]);
    if (cachedUrl) {
      const url = cachedUrl;
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    setLoadingDocControl(pedidoId);
    try {
      const data = await getPortalPedidoDocumentoControl(pedidoId);
      setDocControl(prev => ({ ...prev, [pedidoId]: data || null }));
      const url = getDocumentoControlUrl(data);
      if (url) {
        window.open(url, "_blank", "noopener,noreferrer");
      } else {
        notify("Este viaje todavia no tiene soporte digital disponible", "warning");
      }
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoadingDocControl(null);
    }
  }

  async function verFactura(id) {
    if (!id) return;
    setLoadingFactura(id);
    try {
      const data = await getPortalClienteFactura(id);
      setFacturaSel(data || null);
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setLoadingFactura(null);
    }
  }

  function descargarResumenSolicitudes() {
    try {
      const html = buildSolicitudesReportHtml({ solicitudes, pedidos, empresa, user });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resumen-solicitudes-cliente-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Resumen de solicitudes descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el resumen.", "error");
    }
  }

  const activos = pedidos.filter(p => !["entregado", "cancelado", "facturado"].includes(p.estado));
  const totalFacturado = facturas.reduce((s, f) => s + Number(f.total || 0), 0);
  const pendientePago = facturas
    .filter(f => ["emitida", "enviada", "vencida", "reclamada"].includes(f.estado))
    .reduce((s, f) => s + Number(f.total || 0), 0);
  const estadoCuenta = estadoCuentaFacturas(facturas);
  const docsByPedido = (documentosResumen.pedidos || []).reduce((acc, item) => {
    acc[item.pedido_id] = item;
    return acc;
  }, {});
  const resumenPortal = portalResumen || {
    pedidos: { activos: activos.length },
    solicitudes: { abiertas: solicitudesAbiertas.length, propuestas_pendientes: reprogramacionesPendientes.length },
    facturas: { total_facturado: totalFacturado, total_pendiente: pendientePago, vencidas: estadoCuenta.buckets.filter(b => b.key !== "corriente").reduce((s, b) => s + Number(b.count || 0), 0) },
    documentos: { con_albaran: documentosResumen.con_albaran || 0, viajes: documentosResumen.total || 0, sin_albaran: documentosResumen.sin_albaran || 0 },
    acciones: [],
  };
  const accionesPortal = Array.isArray(resumenPortal.acciones) ? resumenPortal.acciones : [];

  function descargarEstadoCuenta() {
    try {
      const html = buildEstadoCuentaReportHtml({ facturas, empresa, user });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estado-cuenta-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Estado de cuenta descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el estado de cuenta.", "error");
    }
  }

  function descargarResumenDocumental() {
    try {
      const html = buildDocumentosReportHtml({ documentosResumen, empresa, user });
      const blob = new Blob([html], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `resumen-documental-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Resumen documental descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el resumen documental.", "error");
    }
  }

  const S = {
    card: { background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: "14px 16px", marginBottom: 12 },
    th: { textAlign: "left", padding: "8px 12px", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text5)", borderBottom: "1px solid var(--border)" },
    td: { padding: "10px 12px", borderBottom: "1px solid var(--border2)", fontSize: 13, color: "var(--text2)" },
    btn: { padding: "8px 13px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Sans',sans-serif" },
  };

  return (
    <div className="tg-portal-cliente-page" style={{ fontFamily: "'DM Sans',sans-serif", minHeight: "100vh", background: "var(--bg)", paddingBottom: 40 }}>
      <style>{`
        .tg-portal-cliente-page, .tg-portal-cliente-page * { box-sizing:border-box; min-width:0; }
        .tg-portal-cliente-page table { width:100%; }
        @media (max-width: 760px) {
          .tg-portal-cliente-page { overflow-x:hidden; }
          .tg-portal-cliente-page > div:first-of-type { padding:14px 16px !important; }
          .tg-portal-cliente-page > div:first-of-type > div { align-items:flex-start !important; flex-direction:column !important; }
          .tg-portal-cliente-page > div:first-of-type > div > div:last-child { align-items:flex-start !important; width:100%; }
          .tg-portal-cliente-page > div:nth-of-type(2) { padding:16px 14px !important; max-width:100% !important; }
          .tg-portal-cliente-page [style*="display: flex"],
          .tg-portal-cliente-page [style*="display:flex"] { flex-wrap:wrap; }
          .tg-portal-cliente-page [style*="justify-content:flex-end"] { justify-content:flex-start !important; }
          .tg-portal-cliente-page input,
          .tg-portal-cliente-page select,
          .tg-portal-cliente-page textarea,
          .tg-portal-cliente-page button { max-width:100% !important; }
          .tg-portal-cliente-page table {
            display:block;
            overflow-x:auto;
            white-space:nowrap;
            -webkit-overflow-scrolling:touch;
          }
          .tg-portal-cliente-page [style*="position: fixed"],
          .tg-portal-cliente-page [style*="position:fixed"] {
            align-items:flex-start !important;
            padding:10px !important;
            overflow:auto !important;
          }
          .tg-portal-cliente-page [style*="position: fixed"] > div,
          .tg-portal-cliente-page [style*="position:fixed"] > div {
            width:100% !important;
            max-width:calc(100vw - 20px) !important;
            max-height:calc(100dvh - 20px) !important;
          }
        }
      `}</style>
      <div style={{ background: "var(--bg2)", borderBottom: "1px solid var(--border)", padding: "16px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", maxWidth: 1040, margin: "0 auto", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 900, fontSize: 22, color: "var(--text)" }}>
              {empresa.razon_social || portalName}
            </div>
            <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>
              Bienvenido, <strong>{user?.nombre || user?.username}</strong>
            </div>
          </div>
          <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:8 }}>
            <div style={{ fontSize: 11, color: "var(--text5)", textAlign: "right" }}>
              <div>{empresa.telefono || "-"}</div>
              <div>{empresa.email || "-"}</div>
            </div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
              <button
                onClick={logout}
                style={{ ...S.btn, padding:"6px 10px", fontSize:11, color:"#ef4444", borderColor:"rgba(239,68,68,.25)", background:"rgba(239,68,68,.08)" }}
              >
                Salir
              </button>
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 18 }}>
          {[
            ["Viajes activos", resumenPortal.pedidos?.activos || 0, "#3b82f6"],
            [isProviderPortal ? "Peticiones abiertas" : "Solicitudes abiertas", resumenPortal.solicitudes?.abiertas || 0, "#f97316"],
            ["Facturado", `${fmt2(resumenPortal.facturas?.total_facturado)} EUR`, "#10b981"],
            ["Pendiente pago", `${fmt2(resumenPortal.facturas?.total_pendiente)} EUR`, "#f97316"],
            ["Albaranes disponibles", `${resumenPortal.documentos?.con_albaran || 0}/${resumenPortal.documentos?.viajes || 0}`, "#3b82f6"],
          ].map(([l, v, c]) => (
            <div key={l} style={{ ...S.card, marginBottom: 0 }}>
              <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, fontSize: 20, color: c }}>{v}</div>
              <div style={{ fontSize: 11, color: "var(--text5)", textTransform: "uppercase", letterSpacing: ".05em" }}>{l}</div>
            </div>
          ))}
        </div>

        <div style={{ ...S.card, display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))", gap:10, alignItems:"center", marginBottom:16 }}>
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder={isProviderPortal ? "Buscar viajes, facturas, peticiones, matriculas..." : "Buscar viajes, facturas, solicitudes, referencias..."}
            style={{ background:"var(--bg4)", border:"1px solid var(--border2)", color:"var(--text)", borderRadius:8, padding:"10px 12px", outline:"none", fontFamily:"'DM Sans',sans-serif", fontSize:13, minWidth:0 }}
          />
          <div style={{ display:"flex", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
            <button style={S.btn} onClick={cargar} disabled={loading}>{loading ? "Actualizando..." : "Actualizar"}</button>
            <button style={{ ...S.btn, background:"var(--accent)", color:"#fff", borderColor:"var(--accent)" }} onClick={() => setTab("nuevo")}>Nuevo servicio</button>
            <button style={S.btn} onClick={() => setTab("cuenta")}>Estado de cuenta</button>
            <button style={S.btn} onClick={() => setTab("albaranes")}>Documentos</button>
          </div>
        </div>

        {portalNotificacionesNoLeidas > 0 && portalNotificaciones.length > 0 && (
          <section style={{ ...S.card, marginBottom:16, border:"1px solid rgba(59,130,246,.35)", background:"rgba(59,130,246,.07)" }} aria-label="Novedades de tus solicitudes y viajes">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, flexWrap:"wrap", marginBottom:10 }}>
              <div>
                <div style={{ fontWeight:900, color:"var(--text)" }}>Novedades para ti</div>
                <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>
                  {portalNotificacionesNoLeidas} actualizacion{portalNotificacionesNoLeidas === 1 ? "" : "es"} sin leer de trafico o gerencia.
                </div>
              </div>
              <button type="button" style={S.btn} onClick={marcarNovedadesClienteLeidas}>Marcar todas como leidas</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(min(100%,240px),1fr))", gap:8 }}>
              {portalNotificaciones.slice(0, 3).map(item => (
                <button
                  type="button"
                  key={item.id}
                  onClick={() => abrirNovedadCliente(item)}
                  style={{ textAlign:"left", border:"1px solid rgba(59,130,246,.25)", background:"var(--bg3)", borderRadius:8, padding:"11px 12px", cursor:"pointer", minWidth:0 }}
                >
                  <div style={{ fontSize:13, fontWeight:900, color:"var(--text)", overflowWrap:"anywhere" }}>{item.titulo || "Actualizacion"}</div>
                  <div style={{ fontSize:12, color:"var(--text4)", marginTop:4, lineHeight:1.4, overflowWrap:"anywhere" }}>{item.mensaje || "Consulta el detalle actualizado."}</div>
                  <div style={{ fontSize:10, color:"var(--text5)", marginTop:7 }}>{item.created_at ? new Date(item.created_at).toLocaleString("es-ES") : ""}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {accionesPortal.length > 0 && (
          <div style={{ ...S.card, marginBottom: 16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", flexWrap:"wrap", marginBottom:10 }}>
              <div>
                <div style={{ fontWeight:900, color:"var(--text)" }}>Acciones pendientes</div>
                <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>Prioridades detectadas automaticamente en viajes, facturas, documentos y solicitudes.</div>
              </div>
              <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, fontWeight:900, color:"var(--accent)" }}>{accionesPortal.length}</span>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))", gap:8 }}>
              {accionesPortal.map((a, idx) => {
                const color = a.prioridad === "alta" ? "#ef4444" : a.prioridad === "media" ? "#f59e0b" : "#3b82f6";
                return (
                  <button key={`${a.tipo || "accion"}-${idx}`} onClick={() => a.tab && setTab(a.tab)}
                    style={{ textAlign:"left", border:"1px solid var(--border2)", background:"var(--bg3)", borderRadius:8, padding:"10px 12px", cursor:a.tab ? "pointer" : "default" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", gap:8, alignItems:"center" }}>
                      <span style={{ fontWeight:900, color:"var(--text)", fontSize:13 }}>{a.titulo || "Accion pendiente"}</span>
                      <span style={{ padding:"2px 7px", borderRadius:20, fontSize:10, fontWeight:900, color, background:`${color}16`, textTransform:"uppercase" }}>{a.prioridad || "normal"}</span>
                    </div>
                    <div style={{ marginTop:5, fontSize:12, color:"var(--text4)", lineHeight:1.35 }}>{a.detalle || "-"}</div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--border)", marginBottom: 16 }}>
          {[
            ["seguimiento", "Seguimiento"],
            ["nuevo", isProviderPortal ? "Nueva peticion" : "Solicitar servicio"],
            ["albaranes", "Albaranes"],
            ["facturas", "Facturas"],
            ["cuenta", "Estado de cuenta"],
            ["solicitudes", isProviderPortal ? "Peticiones viajes" : "Mis solicitudes"],
          ].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              style={{ padding: "9px 15px", border: "none", borderBottom: `2px solid ${tab === id ? "var(--accent)" : "transparent"}`, background: "transparent", color: tab === id ? "var(--accent)" : "var(--text4)", fontWeight: 800, cursor: "pointer" }}>
              {label}
            </button>
          ))}
        </div>

        {loading && <div style={{ ...S.card, textAlign: "center", color: "var(--text4)", padding: 28 }}>Cargando portal...</div>}

        {!loading && tab === "seguimiento" && (
          <div>
            {pedidosFiltrados.length === 0 ? <Empty text={q ? "No hay viajes que coincidan con la busqueda." : "Todavia no hay viajes registrados."} /> : pedidosFiltrados.map(p => {
              const estado = ESTADOS[p.estado] || ESTADOS.pendiente;
              const surface = estadoClienteSurface(p.estado);
              const stIdx = Math.max(0, TIMELINE.findIndex(([k]) => k === p.estado));
              const dcd = docControl[p.id];
              return (
                <div key={p.id} style={{ ...S.card, ...surface }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div>
                      <div style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 900, color: "var(--accent)", fontSize: 13 }}>{p.numero}</div>
                      <div style={{ fontWeight: 800, color: "var(--text)", marginTop: 4 }}>{p.origen || "-"} -> {p.destino || "-"}</div>
                      {p.referencia_cliente && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>Ref. cliente: {p.referencia_cliente}</div>}
                    </div>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 800, color: estado.c, background: `${estado.c}18`, border: `1px solid ${estado.c}30` }}>{estado.l}</span>
                  </div>

                  <div style={{ display: "flex", gap: 4, alignItems: "center", marginTop: 16 }}>
                    {TIMELINE.map(([k, label], i) => {
                      const done = i <= stIdx;
                      const curr = i === stIdx;
                      return (
                        <div key={k} style={{ display: "flex", alignItems: "center", flex: i < TIMELINE.length - 1 ? 1 : "none" }}>
                          <div style={{ minWidth: 74, textAlign: "center" }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", margin: "0 auto 4px", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 900, background: curr ? "var(--accent)" : done ? "rgba(16,185,129,.16)" : "var(--bg4)", border: curr ? "2px solid var(--accent)" : done ? "2px solid rgba(16,185,129,.5)" : "1px solid var(--border2)", color: curr ? "#fff" : done ? "#10b981" : "var(--text5)" }}>
                              {done ? "OK" : ""}
                            </div>
                            <div style={{ fontSize: 10, color: curr ? "var(--accent)" : done ? "#10b981" : "var(--text5)", fontWeight: done ? 800 : 500 }}>{label}</div>
                          </div>
                          {i < TIMELINE.length - 1 && <div style={{ flex: 1, height: 2, background: i < stIdx ? "rgba(16,185,129,.45)" : "var(--border2)", margin: "0 4px 14px" }} />}
                        </div>
                      );
                    })}
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 8, marginTop: 14 }}>
                    <Mini label="Carga" value={`${dateEs(p.fecha_carga)} ${p.hora_carga || ""}`.trim()} />
                    <Mini label="Descarga" value={`${dateEs(p.fecha_descarga || p.fecha_entrega)} ${p.hora_descarga || ""}`.trim()} />
                    <Mini label="Tractora" value={p.vehiculo_matricula || p.matricula_colaborador || "Pendiente"} />
                    <Mini label="Remolque" value={p.remolque_matricula || p.remolque_matricula_colaborador || "Pendiente"} />
                    <Mini label="Ubicacion" value={p.ubicacion_actual || p.ultima_posicion || "Pendiente de GPS"} />
                  </div>
                  <div style={{ display:"flex", gap:8, marginTop:12, flexWrap:"wrap", alignItems:"center" }}>
                    <button style={S.btn} onClick={() => verPedidoEventos(p.id)} disabled={loadingPedidoEventos === p.id}>
                      {loadingPedidoEventos === p.id ? "Cargando actividad..." : pedidoEventosAbierto === p.id ? "Ocultar actividad" : "Ver actividad"}
                    </button>
                    <button style={S.btn} onClick={() => verDocumentoControl(p.id)} disabled={loadingDocControl === p.id}>
                      {loadingDocControl === p.id ? "Preparando DCD..." : "Documento digital"}
                    </button>
                    {getDocumentoControlUrl(dcd, true) && (
                      <button style={S.btn} onClick={() => window.open(getDocumentoControlUrl(dcd, true), "_blank", "noopener,noreferrer")}>
                        Descargar DCD
                      </button>
                    )}
                    {dcd?.status && (
                      <span style={{ fontSize: 11, color: dcd.status.ready ? "#10b981" : "#f59e0b", fontWeight: 800 }}>
                        {dcd.status.ready ? "DCD listo" : "DCD pendiente"}
                      </span>
                    )}
                    {dcd?.remision?.etiqueta && (
                      <span style={{ fontSize: 11, color: "var(--text4)" }}>
                        {dcd.remision.etiqueta}
                      </span>
                    )}
                  </div>
                  {Array.isArray(dcd?.status?.faltantes) && dcd.status.faltantes.length > 0 && (
                    <div style={{ marginTop:10, fontSize:11, color:"#f59e0b", background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.2)", borderRadius:8, padding:"8px 10px" }}>
                      Faltan datos para dejar el documento completo: {dcd.status.faltantes.slice(0, 3).join(" - ")}{dcd.status.faltantes.length > 3 ? "..." : ""}
                    </div>
                  )}
                  {pedidoEventosAbierto === p.id && (
                    <div style={{ marginTop: 12, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 12px" }}>
                      {(pedidoEventos[p.id] || []).length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text5)" }}>Todavia no hay actividad trazada para este viaje.</div>
                      ) : (pedidoEventos[p.id] || []).map(ev => (
                        <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border2)" }}>
                          <div style={{ fontSize: 11, color: "var(--text5)" }}>{ev.created_at ? new Date(ev.created_at).toLocaleString("es-ES") : "-"}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{ev.etiqueta || ev.tipo || "Evento"}</div>
                            {ev.resumen && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 2 }}>{ev.resumen}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "nuevo" && <SolicitudServicio onDone={cargar} setTab={setTab} />}

        {!loading && tab === "albaranes" && (
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", flexWrap:"wrap", marginBottom:12, paddingBottom:12, borderBottom:"1px solid var(--border2)" }}>
              <div>
                <div style={{ fontWeight:900, color:"var(--text)" }}>Resumen documental</div>
                <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>Estado de albaranes y documentos disponibles por viaje.</div>
              </div>
              <button style={S.btn} onClick={descargarResumenDocumental}>Descargar resumen</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:8, marginBottom:12, paddingBottom:12, borderBottom:"1px solid var(--border2)" }}>
              {[
                ["Viajes", documentosResumen.total || 0, "var(--accent)"],
                ["Con albaran", documentosResumen.con_albaran || 0, "#10b981"],
                ["Pendientes", documentosResumen.sin_albaran || 0, (documentosResumen.sin_albaran || 0) ? "#f97316" : "#10b981"],
                ["Documentos", documentosResumen.documentos_total || 0, "#3b82f6"],
              ].map(([label,value,color]) => (
                <div key={label} style={{ background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:8, padding:"9px 10px" }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:900, color, fontSize:18 }}>{value}</div>
                  <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em", fontWeight:800 }}>{label}</div>
                </div>
              ))}
            </div>
            {pedidosFiltrados.length === 0 ? <Empty text={q ? "No hay documentos que coincidan con la busqueda." : "No hay viajes con documentacion."} /> : pedidosFiltrados.map(p => {
              const albs = docs[p.id] || [];
              const resumen = docsByPedido[p.id] || {};
              return (
                <div key={p.id} style={{ borderBottom: "1px solid var(--border2)", padding: "11px 0" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                    <div>
                      <div style={{ fontWeight: 900, color: "var(--text)" }}>{p.numero} - {p.origen || "-"} -> {p.destino || "-"}</div>
                      <div style={{ fontSize: 12, color: "var(--text4)" }}>{dateEs(p.fecha_carga)}</div>
                      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:5 }}>
                        <span style={{ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:800, color:Number(resumen.albaranes_count || 0) > 0 ? "#10b981" : "#f97316", background:Number(resumen.albaranes_count || 0) > 0 ? "rgba(16,185,129,.12)" : "rgba(249,115,22,.12)" }}>
                          {Number(resumen.albaranes_count || 0) > 0 ? `${resumen.albaranes_count} albaran(es)` : "Albaran pendiente"}
                        </span>
                        {Number(resumen.documentos_factura_count || 0) > 0 && (
                          <span style={{ padding:"2px 8px", borderRadius:20, fontSize:11, fontWeight:800, color:"#3b82f6", background:"rgba(59,130,246,.12)" }}>
                            {resumen.documentos_factura_count} doc. factura
                          </span>
                        )}
                      </div>
                    </div>
                    <button style={S.btn} onClick={() => verAlbaranes(p.id)} disabled={loadingDocs === p.id}>
                      {loadingDocs === p.id ? "Cargando..." : "Ver albaranes"}
                    </button>
                  </div>
                  {pedSel === p.id && (
                    <div style={{ marginTop: 10, background: "var(--bg3)", borderRadius: 8, padding: 10 }}>
                      {albs.length === 0 ? <div style={{ color: "var(--text5)", fontSize: 12 }}>Sin albaranes adjuntos todavia.</div> : albs.map(d => (
                        <button key={d.id} onClick={() => downloadDoc(d)} style={{ ...S.btn, marginRight: 8, marginBottom: 8 }}>
                          Descargar {d.nombre || "albaran"}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!loading && tab === "facturas" && (
          <div style={S.card}>
            {facturasFiltradas.length === 0 ? <Empty text={q ? "No hay facturas que coincidan con la busqueda." : "No hay facturas emitidas."} /> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead><tr>{["Factura", "Fecha", "Vencimiento", "Base", "IVA", "Total", "Estado", "Acciones"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{facturasFiltradas.map(f => {
                  const e = ESTADOS[f.estado] || { l: f.estado || "-", c: "var(--text4)" };
                  return (
                    <tr key={f.id}>
                      <td style={{ ...S.td, fontFamily: "'JetBrains Mono',monospace", fontWeight: 800, color: "var(--accent)" }}>{f.numero}</td>
                      <td style={S.td}>{dateEs(f.fecha)}</td>
                      <td style={S.td}>{dateEs(f.fecha_vencimiento)}</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{fmt2(f.base_imponible)} EUR</td>
                      <td style={{ ...S.td, textAlign: "right" }}>{fmt2(f.cuota_iva)} EUR</td>
                      <td style={{ ...S.td, textAlign: "right", fontWeight: 900, color: "#10b981" }}>{fmt2(f.total)} EUR</td>
                      <td style={S.td}><span style={{ padding: "3px 9px", borderRadius: 20, color: e.c, background: `${e.c}18`, fontSize: 11, fontWeight: 800 }}>{e.l}</span></td>
                      <td style={S.td}>
                        <button style={S.btn} onClick={() => verFactura(f.id)} disabled={loadingFactura === f.id}>
                          {loadingFactura === f.id ? "Abriendo..." : "Ver factura"}
                        </button>
                      </td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        )}

        {!loading && tab === "cuenta" && (
          <div style={S.card}>
            <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"flex-start", flexWrap:"wrap", marginBottom:14, paddingBottom:12, borderBottom:"1px solid var(--border2)" }}>
              <div>
                <div style={{ fontFamily:"'Syne',sans-serif", fontWeight:900, color:"var(--text)", fontSize:18 }}>Estado de cuenta</div>
                <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>Resumen de facturas pendientes, vencimientos e importes abiertos.</div>
              </div>
              <button style={S.btn} onClick={descargarEstadoCuenta}>Descargar estado</button>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))", gap:10, marginBottom:14 }}>
              {[
                ["Facturas pendientes", estadoCuenta.pendientes.length, "#3b82f6"],
                ["Total pendiente", `${fmt2(estadoCuenta.totalPendiente)} EUR`, "#f97316"],
                ["Total vencido", `${fmt2(estadoCuenta.totalVencido)} EUR`, estadoCuenta.totalVencido > 0 ? "#ef4444" : "#10b981"],
              ].map(([label, value, color]) => (
                <div key={label} style={{ background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:8, padding:"10px 12px" }}>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontWeight:900, fontSize:18, color }}>{value}</div>
                  <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em", fontWeight:800 }}>{label}</div>
                </div>
              ))}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:8, marginBottom:14 }}>
              {estadoCuenta.buckets.map(b => (
                <div key={b.key} style={{ border:"1px solid var(--border2)", borderRadius:8, padding:"9px 10px", background:b.total > 0 ? "rgba(245,158,11,.08)" : "var(--bg3)" }}>
                  <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em", fontWeight:800 }}>{b.label}</div>
                  <div style={{ marginTop:5, fontFamily:"'JetBrains Mono',monospace", fontWeight:900, color:b.key === "corriente" ? "#10b981" : "#f97316" }}>{fmt2(b.total)} EUR</div>
                  <div style={{ fontSize:11, color:"var(--text4)", marginTop:2 }}>{b.count} factura(s)</div>
                </div>
              ))}
            </div>
            {estadoCuenta.pendientes.length === 0 ? (
              <Empty text="No hay facturas pendientes de pago." />
            ) : (
              <table style={{ width:"100%", borderCollapse:"collapse" }}>
                <thead><tr>{["Factura", "Fecha", "Vencimiento", "Estado", "Antiguedad", "Total", "Acciones"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
                <tbody>{estadoCuenta.pendientes.map(f => {
                  const dias = diasVencida(f.fecha_vencimiento);
                  const e = ESTADOS[f.estado] || { l:f.estado || "-", c:"var(--text4)" };
                  return (
                    <tr key={f.id}>
                      <td style={{ ...S.td, fontFamily:"'JetBrains Mono',monospace", fontWeight:800, color:"var(--accent)" }}>{f.numero}</td>
                      <td style={S.td}>{dateEs(f.fecha)}</td>
                      <td style={S.td}>{dateEs(f.fecha_vencimiento)}</td>
                      <td style={S.td}><span style={{ padding:"3px 9px", borderRadius:20, color:e.c, background:`${e.c}18`, fontSize:11, fontWeight:800 }}>{e.l}</span></td>
                      <td style={{ ...S.td, color:dias > 0 ? "#ef4444" : "var(--text4)", fontWeight:dias > 0 ? 800 : 600 }}>{dias > 0 ? `${dias} dia(s)` : "No vencida"}</td>
                      <td style={{ ...S.td, textAlign:"right", fontWeight:900, color:"#f97316" }}>{fmt2(f.total)} EUR</td>
                      <td style={S.td}><button style={S.btn} onClick={() => verFactura(f.id)} disabled={loadingFactura === f.id}>{loadingFactura === f.id ? "Abriendo..." : "Ver factura"}</button></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
        )}

        {!loading && tab === "solicitudes" && (
          <div style={S.card}>
            {solicitudesFiltradas.length > 0 && (
              <div style={{ marginBottom:12, paddingBottom:10, borderBottom:"1px solid var(--border2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", gap:12, alignItems:"center", marginBottom:10 }}>
                  <div>
                    <div style={{ fontWeight:900, color:"var(--text)" }}>Resumen de solicitudes</div>
                    <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>Descarga un resguardo interno con estado, referencias y respuestas.</div>
                  </div>
                  <button style={S.btn} onClick={descargarResumenSolicitudes}>Descargar resumen</button>
                </div>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8 }}>
                  {[
                    ["Abiertas", solicitudesAbiertas.length, "#f97316"],
                    ["Propuestas pendientes", reprogramacionesPendientes.length, reprogramacionesPendientes.length ? "#f59e0b" : "#10b981"],
                    ["Aceptadas", solicitudesConvertidas.length, "#10b981"],
                    ["Movimientos", movimientosSolicitudes, "#3b82f6"],
                  ].map(([label,value,color]) => (
                    <div key={label} style={{ background:"var(--bg3)", border:"1px solid var(--border2)", borderRadius:8, padding:"9px 11px" }}>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:17, fontWeight:900, color }}>{value}</div>
                      <div style={{ fontSize:10, color:"var(--text5)", textTransform:"uppercase", letterSpacing:".06em", fontWeight:800 }}>{label}</div>
                    </div>
                  ))}
                </div>
                {reprogramacionesPendientes.length > 0 && (
                  <div style={{ marginTop:10, padding:"9px 11px", borderRadius:8, border:"1px solid rgba(245,158,11,.25)", background:"rgba(245,158,11,.08)", color:"#f59e0b", fontSize:12, fontWeight:800 }}>
                    Tienes {reprogramacionesPendientes.length} propuesta{reprogramacionesPendientes.length === 1 ? "" : "s"} de reprogramacion pendiente{reprogramacionesPendientes.length === 1 ? "" : "s"} de aceptar o rechazar.
                  </div>
                )}
              </div>
            )}
            {solicitudesFiltradas.length === 0 ? <Empty text={q ? "No hay solicitudes que coincidan con la busqueda." : "No has enviado solicitudes."} /> : solicitudesFiltradas.map(s => {
              const e = ESTADOS[s.estado] || ESTADOS.pendiente;
              const pedidoEstado = s.pedido_estado ? (ESTADOS[s.pedido_estado] || { l:s.pedido_estado, c:"#64748b" }) : null;
              const surface = estadoClienteSurface(s.pedido_estado || s.estado);
              return (
                <div key={s.id} style={{
                  ...surface,
                  borderBottom: surface.border || "1px solid var(--border2)",
                  borderRadius: surface.border ? 8 : 0,
                  padding: "11px 12px",
                  margin: surface.border ? "0 0 10px" : 0,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div style={{ fontWeight: 900, color: "var(--text)" }}>{s.origen} -> {s.destino}</div>
                      <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>
                        Carga: {dateEs(s.fecha_carga)} - Ref: {s.referencia_cliente || "-"} {s.pedido_numero ? `- Pedido ${s.pedido_numero}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text5)", marginTop: 3 }}>
                        Movimientos: {Number(s.eventos_count || 0)}{s.ultimo_evento_at ? ` - ultimo ${new Date(s.ultimo_evento_at).toLocaleString("es-ES")}` : ""}
                      </div>
                    </div>
                    <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"flex-end" }}>
                      <span style={{ alignSelf: "flex-start", padding: "3px 10px", borderRadius: 20, color: e.c, background: `${e.c}18`, fontSize: 11, fontWeight: 800 }}>{e.l}</span>
                      {pedidoEstado && (
                        <span style={{ alignSelf:"flex-start", padding:"3px 10px", borderRadius:20, color:pedidoEstado.c, background:`${pedidoEstado.c}18`, border:`1px solid ${pedidoEstado.c}30`, fontSize:11, fontWeight:800 }}>
                          Viaje: {pedidoEstado.l}
                        </span>
                      )}
                    </div>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:8, marginTop:10 }}>
                    <Mini label="Mercancia" value={s.mercancia || "-"} />
                    <Mini label="Peso" value={s.peso_kg ? `${Number(s.peso_kg).toLocaleString("es-ES")} kg` : "-"} />
                    <Mini label="Bultos / palets" value={s.bultos || "-"} />
                    <Mini label="Precio indicado" value={precioSolicitudLabel(s)} />
                    <Mini label="Descarga" value={s.fecha_descarga ? `${dateEs(s.fecha_descarga)} ${s.hora_descarga || ""}`.trim() : "-"} />
                  </div>
                  {s.importe_contraoferta !== null && s.importe_contraoferta !== undefined && (
                    <div style={{ marginTop:10, padding:"10px 12px", borderRadius:8, background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.25)" }}>
                      <div style={{ fontSize:12, fontWeight:900, color:"var(--text)" }}>
                        Precio propuesto por trafico: {Number(s.importe_contraoferta).toLocaleString("es-ES", { minimumFractionDigits:2, maximumFractionDigits:2 })} EUR
                      </div>
                      <div style={{ fontSize:12, color:"var(--text4)", marginTop:3 }}>
                        {s.decision_precio === "aceptada" && "Has aceptado este precio."}
                        {s.decision_precio === "rechazada" && "Has rechazado este precio. Trafico revisara la solicitud."}
                        {(!s.decision_precio || s.decision_precio === "pendiente") && "Revisa la contraoferta antes de que trafico convierta la solicitud en pedido."}
                      </div>
                      {(!s.decision_precio || s.decision_precio === "pendiente") && (
                        <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:9 }}>
                          <button onClick={() => responderPrecio(s.id, "aceptada")} style={{ ...S.btn, background:"#10b981", color:"#fff", borderColor:"#10b981" }}>Aceptar precio</button>
                          <button onClick={() => responderPrecio(s.id, "rechazada")} style={{ ...S.btn, color:"#ef4444", borderColor:"rgba(239,68,68,.25)" }}>Rechazar precio</button>
                        </div>
                      )}
                    </div>
                  )}
                  {(s.vehiculo_matricula || s.matricula_colaborador || s.remolque_matricula || s.remolque_matricula_colaborador) && (
                    <div style={{ marginTop:10, padding:"10px 12px", borderRadius:8, background:"rgba(16,185,129,.08)", border:"1px solid rgba(16,185,129,.18)", fontSize:12, color:"var(--text3)" }}>
                      Matrículas asignadas:
                      <strong style={{ color:"var(--text)", marginLeft:6 }}>{s.vehiculo_matricula || s.matricula_colaborador || "Tractora pendiente"}</strong>
                      {(s.remolque_matricula || s.remolque_matricula_colaborador) && (
                        <span> · Remolque <strong style={{ color:"var(--text)" }}>{s.remolque_matricula || s.remolque_matricula_colaborador}</strong></span>
                      )}
                    </div>
                  )}
                  {s.respuesta && <div style={{ marginTop: 8, fontSize: 12, color: "var(--text3)" }}>{s.respuesta}</div>}
                  {s.fecha_propuesta && (
                    <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid rgba(59,130,246,.2)", background: "rgba(59,130,246,.08)" }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: "var(--text)" }}>
                        Propuesta de reprogramacion: {dateEs(s.fecha_propuesta)}{s.hora_propuesta ? ` ${s.hora_propuesta}` : ""}
                      </div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "var(--text4)" }}>
                        {s.decision_cliente === "aceptada" && "Ya has aceptado esta propuesta."}
                        {s.decision_cliente === "rechazada" && "Has rechazado esta propuesta. La solicitud vuelve a quedar pendiente."}
                        {(!s.decision_cliente || s.decision_cliente === "pendiente") && "Trafico ha propuesto una nueva fecha. Acepta o rechaza para que puedan planificar el viaje."}
                      </div>
                      {(!s.decision_cliente || s.decision_cliente === "pendiente") && (
                        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                          <button onClick={() => responderReprogramacion(s.id, "aceptada")} style={{ ...S.btn, background: "#10b981", borderColor: "#10b981", color: "#fff" }}>
                            Aceptar nueva fecha
                          </button>
                          <button onClick={() => responderReprogramacion(s.id, "rechazada")} style={{ ...S.btn, color: "#ef4444", borderColor: "rgba(239,68,68,.25)" }}>
                            Rechazar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      style={{ ...S.btn, padding: "6px 10px", fontSize: 12 }}
                      onClick={() => verSolicitudEventos(s.id)}
                      disabled={loadingSolicitudEventos === s.id}
                    >
                      {loadingSolicitudEventos === s.id ? "Cargando historial..." : solicitudEventosAbierta === s.id ? "Ocultar historial" : "Ver historial"}
                    </button>
                    {["pendiente", "revisada"].includes(String(s.estado || "").toLowerCase()) && !s.pedido_id && (
                      <button
                        style={{ ...S.btn, padding: "6px 10px", fontSize: 12, background: "rgba(239,68,68,.08)", color: "#ef4444", borderColor: "rgba(239,68,68,.25)" }}
                        onClick={() => cancelarSolicitud(s)}
                      >
                        Cancelar solicitud
                      </button>
                    )}
                    <button
                      style={{ ...S.btn, padding: "6px 10px", fontSize: 12, background: "rgba(16,185,129,.12)", color: "#10b981", borderColor: "rgba(16,185,129,.25)" }}
                      onClick={() => descargarHistorialSolicitud(s)}
                      disabled={descargandoSolicitudHistorial === s.id}
                    >
                      {descargandoSolicitudHistorial === s.id ? "Preparando historial..." : "Descargar historial"}
                    </button>
                  </div>
                  {solicitudEventosAbierta === s.id && (
                    <div style={{ marginTop: 10, background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "10px 12px" }}>
                      {(solicitudEventos[s.id] || []).length === 0 ? (
                        <div style={{ fontSize: 12, color: "var(--text5)" }}>Sin eventos registrados.</div>
                      ) : (solicitudEventos[s.id] || []).map(ev => (
                        <div key={ev.id} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border2)" }}>
                          <div style={{ fontSize: 11, color: "var(--text5)" }}>{ev.created_at ? new Date(ev.created_at).toLocaleString("es-ES") : "-"}</div>
                          <div>
                            <div style={{ fontSize: 12, fontWeight: 900, color: "var(--text)" }}>{solicitudEventoLabel(ev.tipo)}</div>
                            {solicitudEventoResumen(ev) && <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 2 }}>{solicitudEventoResumen(ev)}</div>}
                          </div>
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
      {facturaSel && <FacturaPortalModal factura={facturaSel} onClose={() => setFacturaSel(null)} empresa={empresa} />}
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div style={{ background: "var(--bg3)", border: "1px solid var(--border2)", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text5)", fontWeight: 800 }}>{label}</div>
      <div style={{ marginTop: 2, color: "var(--text)", fontSize: 12, fontWeight: 700 }}>{value || "-"}</div>
    </div>
  );
}

function Empty({ text }) {
  return <div style={{ padding: 26, textAlign: "center", color: "var(--text5)", fontSize: 13 }}>{text}</div>;
}

function FacturaPortalModal({ factura, onClose, empresa }) {
  const lineas = Array.isArray(factura.lineas) ? factura.lineas : [];
  const extracostes = Array.isArray(factura.extracostes) ? factura.extracostes : [];
  const pedidos = Array.isArray(factura.pedidos) ? factura.pedidos : [];
  const documentos = Array.isArray(factura.documentos) ? factura.documentos : [];
  const albaranes = Array.isArray(factura.albaranes) ? factura.albaranes : [];

  function imprimir() {
    const rows = lineas.map(l => `
      <tr>
        <td>${String(l.concepto || "")}</td>
        <td class="num">${fmt2(l.cantidad || 1)}</td>
        <td class="num">${fmt2(l.precio_unit || 0)} EUR</td>
        <td class="num">${fmt2(Number(l.cantidad || 1) * Number(l.precio_unit || 0))} EUR</td>
      </tr>
    `).join("");
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><title>Factura ${factura.numero || ""}</title>
      <style>
        body{font-family:Arial,sans-serif;color:#111827;padding:32px}
        h1{font-size:22px;margin:0 0 4px} .muted{color:#64748b;font-size:12px}
        table{width:100%;border-collapse:collapse;margin-top:22px} th,td{border-bottom:1px solid #e5e7eb;padding:9px;text-align:left;font-size:13px}
        th{font-size:11px;text-transform:uppercase;color:#64748b}.num{text-align:right}
        .totals{margin-left:auto;margin-top:18px;width:260px}.totals div{display:flex;justify-content:space-between;padding:6px 0}
      </style></head><body>
      <h1>Factura ${factura.numero || ""}</h1>
      <div class="muted">${empresa?.razon_social || "TransGest"} - Fecha ${dateEs(factura.fecha)} - Vencimiento ${dateEs(factura.fecha_vencimiento)}</div>
      <table><thead><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="totals">
        <div><span>Base</span><strong>${fmt2(factura.base_imponible)} EUR</strong></div>
        <div><span>IVA</span><strong>${fmt2(factura.cuota_iva)} EUR</strong></div>
        <div><span>Total</span><strong>${fmt2(factura.total)} EUR</strong></div>
      </div>
      ${factura.forma_pago ? `<p class="muted"><strong>Forma de pago:</strong> ${factura.forma_pago}</p>` : ""}
      </body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 18 }}>
      <div style={{ width: "min(880px,96vw)", maxHeight: "92vh", overflow: "auto", background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 20px 60px rgba(0,0,0,.28)" }}>
        <div style={{ padding: "16px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 900, color: "var(--text)", fontSize: 18 }}>Factura {factura.numero}</div>
            <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 3 }}>{dateEs(factura.fecha)} - Vence {dateEs(factura.fecha_vencimiento)}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button onClick={imprimir} style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--accent)", color: "#fff", fontWeight: 800, cursor: "pointer" }}>Imprimir / PDF</button>
            <button onClick={onClose} style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontWeight: 800, cursor: "pointer" }}>Cerrar</button>
          </div>
        </div>
        <div style={{ padding: 18 }}>
          {pedidos.length > 0 && (
            <div style={{ marginBottom: 14, fontSize: 12, color: "var(--text4)" }}>
              Viajes incluidos: {pedidos.map(p => p.numero).join(", ")}
            </div>
          )}
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Concepto", "Cantidad", "Precio", "Importe"].map(h => <th key={h} style={{ textAlign: h === "Concepto" ? "left" : "right", padding: "8px 10px", color: "var(--text5)", fontSize: 10, textTransform: "uppercase", borderBottom: "1px solid var(--border)" }}>{h}</th>)}</tr></thead>
            <tbody>
              {lineas.map(l => (
                <tr key={l.id || l.concepto}>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text)" }}>{l.concepto || "-"}</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text3)", textAlign: "right" }}>{fmt2(l.cantidad || 1)}</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text3)", textAlign: "right" }}>{fmt2(l.precio_unit || 0)} EUR</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text)", textAlign: "right", fontWeight: 800 }}>{fmt2(Number(l.cantidad || 1) * Number(l.precio_unit || 0))} EUR</td>
                </tr>
              ))}
              {extracostes.map(x => (
                <tr key={x.id || x.concepto}>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text)" }}>{x.concepto || x.tipo || "Extra"}</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text3)", textAlign: "right" }}>1,00</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text3)", textAlign: "right" }}>{fmt2(x.importe || 0)} EUR</td>
                  <td style={{ padding: "9px 10px", borderBottom: "1px solid var(--border2)", color: "var(--text)", textAlign: "right", fontWeight: 800 }}>{fmt2(x.importe || 0)} EUR</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginLeft: "auto", marginTop: 16, maxWidth: 280, display: "grid", gap: 7 }}>
            {[["Base", factura.base_imponible], ["IVA", factura.cuota_iva], ["Total", factura.total]].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", color: k === "Total" ? "#10b981" : "var(--text3)", fontWeight: k === "Total" ? 900 : 700 }}>
                <span>{k}</span><span>{fmt2(v)} EUR</span>
              </div>
            ))}
          </div>
          {factura.forma_pago && <div style={{ marginTop: 14, fontSize: 12, color: "var(--text4)" }}>Forma de pago: <strong>{factura.forma_pago}</strong></div>}
          {documentos.length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: "var(--text5)", marginBottom: 8 }}>Documentos vinculados</div>
              {documentos.map(doc => (
                <button key={doc.id} onClick={() => downloadDoc(doc)} style={{ marginRight: 8, marginBottom: 8, padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border2)", background: "var(--bg3)", color: "var(--text)", fontWeight: 800, cursor: "pointer" }}>
                  Descargar {doc.nombre || "documento"}
                </button>
              ))}
            </div>
          )}
          {albaranes.length > 0 && (
            <div style={{ marginTop: 18, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", color: "var(--text5)", marginBottom: 8 }}>Albaranes de viajes incluidos</div>
              {albaranes.map(doc => (
                <button key={`${doc.pedido_id}-${doc.id}`} onClick={() => downloadDoc(doc)} style={{ marginRight: 8, marginBottom: 8, padding: "8px 12px", borderRadius: 7, border: "1px solid rgba(16,185,129,.25)", background: "rgba(16,185,129,.10)", color: "#10b981", fontWeight: 800, cursor: "pointer" }}>
                  {doc.pedido_numero ? `${doc.pedido_numero}: ` : ""}{doc.nombre || "albaran"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SolicitudServicio({ onDone, setTab }) {
  const [saving, setSaving] = useState(false);
  const [puntos, setPuntos] = useState([]);
  const [puntosLoading, setPuntosLoading] = useState(true);
  const [puntosError, setPuntosError] = useState("");
  const [form, setForm] = useState({
    referencia_cliente: "",
    origen: "",
    destino: "",
    fecha_carga: "",
    hora_carga: "",
    fecha_descarga: "",
    hora_descarga: "",
    mercancia: "",
    peso_kg: "",
    bultos: "",
    importe: "",
    tipo_precio: "viaje",
    precio_unitario: "",
    cantidad: "",
    importe_minimo: "",
    minimo_unidades: "",
    km_ruta: "",
    notas: "",
    origen_punto_id: "",
    destino_punto_id: "",
  });
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const inp = { background: "var(--bg4)", border: "1px solid var(--border2)", color: "var(--text)", padding: "9px 12px", borderRadius: 8, fontSize: 13, outline: "none", width: "100%", boxSizing: "border-box" };
  const lbl = { display: "block", fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--text5)", margin: "12px 0 4px" };

  const cargarPuntos = useCallback(async () => {
    setPuntosLoading(true);
    setPuntosError("");
    try {
      const data = await getPortalClientePuntos();
      setPuntos(Array.isArray(data) ? data : []);
    } catch (error) {
      setPuntosError(error.message || "No se pudieron cargar los puntos guardados");
    } finally {
      setPuntosLoading(false);
    }
  }, []);

  useEffect(() => { cargarPuntos(); }, [cargarPuntos]);

  function pointText(point = {}) {
    const parts = [point.nombre, point.direccion, point.ciudad, point.provincia]
      .map(value => String(value || "").trim())
      .filter((value, index, all) => value && all.indexOf(value) === index);
    return parts.join(" - ");
  }

  function selectPoint(tipo, point) {
    const idKey = tipo === "carga" ? "origen_punto_id" : "destino_punto_id";
    const textKey = tipo === "carga" ? "origen" : "destino";
    setForm(prev => ({
      ...prev,
      [idKey]: point?.id || "",
      ...(point ? { [textKey]: pointText(point) } : {}),
    }));
  }

  function addPoint(point) {
    if (!point?.id) return;
    setPuntos(prev => prev.some(item => String(item.id) === String(point.id)) ? prev : [...prev, point]);
  }

  function cleanPayload(source = form) {
    const tipo = source.tipo_precio || "viaje";
    let cantidad = source.cantidad;
    if (!cantidad && tipo === "km") cantidad = source.km_ruta;
    if (!cantidad && tipo === "palet") cantidad = source.bultos;
    if (!cantidad && tipo === "tonelada" && Number(source.peso_kg) > 0) cantidad = String(Number(source.peso_kg) / 1000);
    if (!cantidad && tipo === "kg") cantidad = source.peso_kg;
    return {
      ...source,
      peso_kg: source.peso_kg || null,
      bultos: source.bultos || null,
      importe: source.importe === "" || source.importe === undefined || source.importe === null ? null : source.importe,
      tipo_precio: source.tipo_precio || "viaje",
      precio_unitario: source.precio_unitario === "" || source.precio_unitario === undefined || source.precio_unitario === null ? null : source.precio_unitario,
      cantidad: cantidad === "" || cantidad === undefined || cantidad === null ? null : cantidad,
      importe_minimo: source.importe_minimo === "" || source.importe_minimo === undefined || source.importe_minimo === null ? null : source.importe_minimo,
      minimo_unidades: source.minimo_unidades === "" || source.minimo_unidades === undefined || source.minimo_unidades === null ? null : source.minimo_unidades,
      km_ruta: source.km_ruta === "" || source.km_ruta === undefined || source.km_ruta === null ? null : source.km_ruta,
    };
  }

  async function enviar() {
    if (!form.origen || !form.destino) {
      notify("Origen y destino son obligatorios", "warning");
      return;
    }
    if (!isValidDateInput(form.fecha_carga) || !isValidDateInput(form.fecha_descarga)) {
      notify("Revisa las fechas. Usa el selector de fecha o el formato AAAA-MM-DD.", "warning");
      return;
    }
    setSaving(true);
    try {
      const res = await crearPortalClienteSolicitud({
        ...cleanPayload(form),
      });
      if (res?.duplicada) {
        notify("Ya existe una solicitud pendiente similar. La hemos abierto como referencia.", "warning");
      } else {
        notify("Solicitud enviada. Trafico la revisara y la convertira en pedido.", "success");
      }
      setForm({ referencia_cliente: "", origen: "", destino: "", fecha_carga: "", hora_carga: "", fecha_descarga: "", hora_descarga: "", mercancia: "", peso_kg: "", bultos: "", importe: "", tipo_precio: "viaje", precio_unitario: "", cantidad: "", importe_minimo: "", minimo_unidades: "", km_ruta: "", notas: "", origen_punto_id: "", destino_punto_id: "" });
      await onDone();
      setTab("solicitudes");
    } catch (e) {
      notify(e.message, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ background: "var(--bg2)", border: "1px solid var(--border)", borderRadius: 8, padding: 18 }}>
      <div style={{ fontWeight: 900, color: "var(--text)", fontSize: 16 }}>Solicitar nuevo servicio</div>
      <div style={{ fontSize: 12, color: "var(--text4)", marginTop: 4 }}>La solicitud queda vinculada solo a tu empresa transportista y a tu ficha de cliente.</div>
      {puntosLoading && <div style={{ marginTop:10, fontSize:12, color:"var(--text4)" }}>Cargando puntos guardados...</div>}
      {puntosError && (
        <div style={{ marginTop:10, display:"flex", gap:10, alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", padding:"9px 11px", border:"1px solid rgba(239,68,68,.28)", borderRadius:8, background:"rgba(239,68,68,.07)", color:"#ef4444", fontSize:12 }}>
          <span>{puntosError}</span>
          <button type="button" onClick={cargarPuntos} style={{ padding:"8px 12px", borderRadius:7, border:"1px solid rgba(239,68,68,.3)", background:"var(--bg3)", color:"#ef4444", fontWeight:800, cursor:"pointer" }}>Reintentar</button>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: "0 14px", marginTop: 8 }}>
        <div><label style={lbl}>Referencia cliente</label><input style={inp} value={form.referencia_cliente} onChange={f("referencia_cliente")} placeholder="Pedido, OC, referencia interna..." /></div>
        <div><label style={lbl}>Mercancia</label><input style={inp} value={form.mercancia} onChange={f("mercancia")} placeholder="Tipo de mercancia" /></div>
        <div>
          <label style={lbl}>Origen *</label>
          <input style={inp} value={form.origen} onChange={event=>setForm(prev=>({...prev,origen:event.target.value,origen_punto_id:""}))} placeholder="Poblacion o direccion de carga" />
          <PortalPointPicker tipo="carga" points={puntos} selectedId={form.origen_punto_id} onSelect={point=>selectPoint("carga", point)} onCreated={addPoint} />
        </div>
        <div>
          <label style={lbl}>Destino *</label>
          <input style={inp} value={form.destino} onChange={event=>setForm(prev=>({...prev,destino:event.target.value,destino_punto_id:""}))} placeholder="Poblacion de descarga" />
          <PortalPointPicker tipo="descarga" points={puntos} selectedId={form.destino_punto_id} onSelect={point=>selectPoint("descarga", point)} onCreated={addPoint} />
        </div>
        <div><label style={lbl}>Fecha carga</label><input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={form.fecha_carga} onChange={f("fecha_carga")} /></div>
        <div><label style={lbl}>Hora carga</label><input style={inp} value={form.hora_carga} onChange={f("hora_carga")} placeholder="08:00 / Manana / Cita previa" /></div>
        <div><label style={lbl}>Fecha descarga</label><input type="date" min="2000-01-01" max="2100-12-31" style={inp} value={form.fecha_descarga} onChange={f("fecha_descarga")} /></div>
        <div><label style={lbl}>Hora descarga</label><input style={inp} value={form.hora_descarga} onChange={f("hora_descarga")} placeholder="16:00 / Tarde / Cita previa" /></div>
        <div><label style={lbl}>Peso kg</label><input type="number" style={inp} value={form.peso_kg} onChange={f("peso_kg")} /></div>
        <div><label style={lbl}>Bultos / palets</label><input type="number" min="0" step="1" style={inp} value={form.bultos} onChange={e=>setForm(p=>({...p,bultos:Number(e.target.value) < 0 ? "" : e.target.value}))} /></div>
        <div>
          <label style={lbl}>Tipo de precio</label>
          <select style={inp} value={form.tipo_precio} onChange={e=>setForm(p=>({...p,tipo_precio:e.target.value,precio_unitario:"",cantidad:"",importe:"",importe_minimo:"",minimo_unidades:""}))}>
            {TIPOS_PRECIO.map(tipo => <option key={tipo.v} value={tipo.v}>{tipo.l}</option>)}
          </select>
        </div>
        <div>
          <label style={lbl}>{form.tipo_precio === "viaje" ? "Precio viaje si lo conoces (EUR)" : form.tipo_precio === "kg" ? "Precio unitario (EUR/100kg)" : form.tipo_precio === "tonelada" ? "Precio unitario (EUR/tn)" : form.tipo_precio === "km" ? "Precio unitario (EUR/km)" : form.tipo_precio === "palet" ? "Precio unitario (EUR/palet)" : "Precio unitario (EUR/h)"}</label>
          <input type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={form.precio_unitario} onChange={e=>setForm(p=>({...p,precio_unitario:e.target.value,importe:p.tipo_precio === "viaje" ? e.target.value : p.importe}))} placeholder="Opcional" />
        </div>
        {form.tipo_precio !== "viaje" && (
          <div>
            <label style={lbl}>{form.tipo_precio === "kg" ? "Peso facturable (kg)" : form.tipo_precio === "tonelada" ? "Toneladas" : form.tipo_precio === "km" ? "Kilometros" : form.tipo_precio === "palet" ? "Palets" : "Horas"}</label>
            <input type="number" min="0" step="0.001" inputMode="decimal" style={inp} value={form.cantidad} onChange={f("cantidad")} placeholder="Opcional" />
          </div>
        )}
        <div>
          <label style={lbl}>{form.tipo_precio === "viaje" ? "Minimo EUR" : "Minimo facturable"}</label>
          <input type="number" min="0" step="0.01" inputMode="decimal" style={inp} value={form.tipo_precio === "viaje" ? form.importe_minimo : form.minimo_unidades} onChange={e=>setForm(p=>({...p,[p.tipo_precio === "viaje" ? "importe_minimo" : "minimo_unidades"]:e.target.value}))} placeholder="Opcional" />
        </div>
        <div><label style={lbl}>Km ruta estimados</label><input type="number" min="0" step="0.1" inputMode="decimal" style={inp} value={form.km_ruta} onChange={f("km_ruta")} placeholder="Opcional" /></div>
        <div style={{ gridColumn: "1/-1" }}><label style={lbl}>Notas</label><textarea style={{ ...inp, minHeight: 86, resize: "vertical" }} value={form.notas} onChange={f("notas")} placeholder="Instrucciones de carga, contacto, horarios, observaciones..." /></div>
      </div>
      <button onClick={enviar} disabled={saving} style={{ marginTop: 16, width: "100%", padding: "12px 18px", borderRadius: 8, border: "none", background: "var(--accent)", color: "#fff", fontWeight: 900, cursor: "pointer", opacity: saving ? .65 : 1 }}>
        {saving ? "Enviando..." : "Enviar solicitud"}
      </button>
    </div>
  );
}

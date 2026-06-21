import { getLogoDataUrl } from "../services/logoHelper";
import { useState, useEffect, useCallback , useMemo } from "react";
import { getFacturas, getFactura, getFacturaFiscal, facturaFiscalXmlUrl, facturasFiscalLoteXmlUrl, getControlCobros, getBloqueosDocumentalesCobro, cambiarEstadoFactura, crearRectificativa, getPedidos, getClientes, borrarFactura, crearFactura, procesarReclamacionesFacturas, getFacturacionFiscalResumen, reencolarFacturaFiscal, procesarColaFiscalFacturas, sincronizarFacturaFiscal, revisarEmailFactura, enviarEmailFactura, getPagosColaboradorPendientes, guardarPedidoColaboradorPago, getEmpresaConfig, editarPedido } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { useEmpresaPerfil } from "../hooks/useEmpresaPerfil";
import { confirmDialog, notify } from "../services/notify";
import { clearRuntimeFocus, readRuntimeFocus } from "../services/runtimeFocus";

const ESTADOS = ["borrador","emitida","enviada","cobrada","vencida","reclamada","sin_cobrar"];
const EC = { borrador:"#6b7280",emitida:"var(--accent-l)",enviada:"#22d3ee",cobrada:"var(--green)",vencida:"#ef4444",reclamada:"#f97316",sin_cobrar:"#b91c1c",rectificada:"#f97316" };
const ESTADO_FACTURA_LABELS = {
  borrador: "Borrador",
  emitida: "Emitida",
  enviada: "Enviada",
  cobrada: "Cobrada",
  vencida: "Vencida",
  reclamada: "Reclamada",
  sin_cobrar: "Sin cobrar",
  rectificada: "Rectificada",
};
const estadoFacturaLabel = estado => ESTADO_FACTURA_LABELS[String(estado || "").toLowerCase()] || String(estado || "-").replace(/_/g, " ");
const fmt2 = n => Number(n||0).toLocaleString("es-ES",{minimumFractionDigits:2,maximumFractionDigits:2});
const ivaLabel = (tipoIva, regimen) => {
  const reg = String(regimen || "").toLowerCase();
  if (reg === "exento") return "Exento";
  if (reg === "reducido") return "10%";
  if (reg === "superreducido") return "4%";
  if (reg === "cero") return "0%";
  return `${Number(tipoIva ?? 21)}%`;
};

const S = {
  page: {flex:1, padding:"32px 40px",fontFamily:"'DM Sans',sans-serif",background:"linear-gradient(180deg,#fbfdff 0%,#f8fafc 100%)",minHeight:"100vh"},
  title:{fontFamily:"'Syne',sans-serif",fontSize:30,fontWeight:900,color:"var(--text)",marginBottom:6},
  sub:  {fontSize:13,color:"var(--text4)",marginBottom:28},
  card: {background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,overflow:"hidden",marginBottom:18,boxShadow:"0 10px 30px rgba(15,23,42,.04)"},
  th:   {textAlign:"left",padding:"14px 16px",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",borderBottom:"1px solid var(--border)",background:"rgba(248,250,252,.86)",whiteSpace:"nowrap"},
  td:   {padding:"14px 16px",borderBottom:"1px solid var(--border)",fontSize:13,color:"var(--text2)",verticalAlign:"middle"},
  btn:  {padding:"10px 14px",borderRadius:8,border:"1px solid var(--border2)",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",display:"inline-flex",alignItems:"center",gap:7,background:"var(--bg3)",color:"var(--text3)"},
  sel:  {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none"},
  inp:  {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"10px 12px",borderRadius:8,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"},
  modal:{position:"fixed",inset:0,background:"rgba(0,0,0,.9)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",padding:20},
  badge:{display:"inline-flex",alignItems:"center",padding:"2px 9px",borderRadius:20,fontSize:11,fontWeight:700},
  lbl:  {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:4,marginTop:10},
};

function FinanceIcon({ icon = "wallet" }) {
  const common = { width:28, height:28, viewBox:"0 0 24 24", fill:"none", stroke:"currentColor", strokeWidth:"1.8", strokeLinecap:"round", strokeLinejoin:"round", "aria-hidden":"true" };
  if (icon === "check") return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="m8.5 12 2.2 2.2 4.8-5" /></svg>;
  if (icon === "clock") return <svg {...common}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /></svg>;
  if (icon === "doc") return <svg {...common}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v5h5" /><path d="M9 13h6" /><path d="M9 17h5" /></svg>;
  return <svg {...common}><path d="M4 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z" /><path d="M4 7V5a2 2 0 0 1 2-2h11" /><path d="M16 13h.01" /></svg>;
}

function FinanceKpi({ label, value, color, icon }) {
  const softBg = String(color).startsWith("#") ? `${color}12` : "rgba(20,184,166,.10)";
  const softBorder = String(color).startsWith("#") ? `${color}22` : "rgba(20,184,166,.22)";
  return (
    <div style={{background:"var(--card-bg)",border:"1px solid var(--border)",borderRadius:12,padding:"26px 28px",display:"flex",alignItems:"center",gap:20,minHeight:106,boxShadow:"0 12px 34px rgba(15,23,42,.05)"}}>
      <div style={{width:58,height:58,borderRadius:10,display:"inline-flex",alignItems:"center",justifyContent:"center",color,background:softBg,border:`1px solid ${softBorder}`,flexShrink:0}}>
        <FinanceIcon icon={icon} />
      </div>
      <div>
        <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:22,fontWeight:900,color,lineHeight:1}}>{value}</div>
        <div style={{fontSize:11,fontWeight:900,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginTop:11}}>{label}</div>
      </div>
    </div>
  );
}

function fmtDate(value, withTime = false) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("es-ES", withTime ? {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  } : {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function broadcastFacturasChanged(detail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("tms:facturas-changed", { detail }));
}

function normalizarDetalleCambioFactura(result = {}, fallback = {}) {
  return {
    factura_id: result?.factura_id || fallback.factura_id || null,
    estado_nuevo: result?.estado_nuevo || fallback.estado_nuevo || null,
    pedido_estado_aplicado: result?.pedido_estado_aplicado || fallback.pedido_estado_aplicado || null,
    pedido_ids_afectados: Array.isArray(result?.pedido_ids_afectados)
      ? result.pedido_ids_afectados
      : Array.isArray(fallback.pedido_ids_afectados)
        ? fallback.pedido_ids_afectados
        : [],
    eliminada: Boolean(result?.eliminada || fallback.eliminada),
  };
}

// Helper para formatear direccion desglosada
function formatDireccion(obj, prefijo="") {
  const p = prefijo;
  const calle    = obj[p+"calle"]       || obj.direccion || "";
  const num      = obj[p+"num_ext"]     || "";
  const piso     = obj[p+"piso_puerta"] || "";
  const cp       = obj[p+"cod_postal"]  || obj.cp || "";
  const mun      = obj[p+"municipio"]   || obj.ciudad || "";
  const prov     = obj[p+"provincia"]   || "";
  const pais     = obj[p+"pais_iso"]    || obj.pais || "ES";

  const linea1 = [calle, num, piso].filter(Boolean).join(" ");
  const linea2 = [cp, mun, prov !== mun ? prov : ""].filter(Boolean).join(" ");
  const linea3 = pais !== "ES" ? pais : "";
  return [linea1, linea2, linea3].filter(Boolean).join(", ");
}

function getFiscalAcceptedReference(eventos = []) {
  const accepted = Array.isArray(eventos)
    ? eventos.find((ev) => ev.evento_tipo === "queue.accepted")
    : null;
  return accepted?.detalle?.registro_aeat || accepted?.detalle?.csv || "";
}

function getFiscalProviderUuid(envios = []) {
  const latest = Array.isArray(envios) ? envios[0] : null;
  return latest?.response?.provider_uuid
    || latest?.response?.uuid
    || latest?.response?.response?.uuid
    || latest?.response?.response?.data?.uuid
    || latest?.response?.response?.registro?.uuid
    || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildFiscalEvidenceHtml(data = {}) {
  const factura = data.factura || {};
  const registro = data.registro || null;
  const eventos = Array.isArray(data.eventos) ? data.eventos : [];
  const envios = Array.isArray(data.envios) ? data.envios : [];
  const config = data.config || {};
  const acceptedRef = getFiscalAcceptedReference(eventos);
  const providerUuid = getFiscalProviderUuid(envios);
  const lastSend = envios[0] || null;
  const checks = getFiscalDocumentChecks({ fiscal: registro, acceptedRef, providerUuid, lastSend });
  const generated = new Date().toLocaleString("es-ES");
  const rows = [
    ["Factura", factura.numero || factura.id || "-"],
    ["Fecha", factura.fecha ? new Date(factura.fecha).toLocaleDateString("es-ES") : "-"],
    ["Estado factura", factura.estado || "-"],
    ["Total", factura.total != null ? `${Number(factura.total).toLocaleString("es-ES", { minimumFractionDigits: 2 })} EUR` : "-"],
    ["Modo fiscal", registro?.modo || config.modo || "-"],
    ["Entorno", registro?.entorno || config.entorno || "-"],
    ["Estado fiscal", registro?.estado_envio || "-"],
    ["Huella", registro?.huella || "-"],
    ["Hash anterior", registro?.hash_anterior || "-"],
    ["Referencia aceptada", acceptedRef || "-"],
    ["UUID proveedor", providerUuid || "-"],
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Justificante fiscal ${escapeHtml(factura.numero || "")}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:920px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      table{width:100%;border-collapse:collapse;margin:14px 0}td,th{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
      .check{border:1px solid #e5e7eb;border-radius:9px;padding:10px 12px;background:#f8fafc}
      .ok{color:#047857;font-weight:800}.ko{color:#b45309;font-weight:800}
      .box{margin-top:16px;border:1px solid #dbeafe;background:#eff6ff;border-radius:10px;padding:12px 14px;font-size:12px}
      pre{white-space:pre-wrap;word-break:break-word;font-size:11px;background:#0f172a;color:#dbeafe;border-radius:8px;padding:10px}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Justificante fiscal TransGest</h1>
      <div class="sub">Generado el ${escapeHtml(generated)}. Este documento resume la trazabilidad fiscal interna y el estado del canal configurado.</div>
      <table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>
      <h2 style="font-size:16px;margin-top:20px">Comprobaciones</h2>
      <div class="grid">${checks.map(c => `<div class="check"><div class="${c.ok ? "ok" : "ko"}">${c.ok ? "OK" : "Pendiente"} - ${escapeHtml(c.label)}</div><div class="sub" style="margin:4px 0 0">${escapeHtml(c.detail)}</div></div>`).join("") || "<div class='check'>Sin registro fiscal todavia.</div>"}</div>
      <h2 style="font-size:16px;margin-top:20px">Ultimos envios</h2>
      <table><thead><tr><th>Sistema</th><th>Estado</th><th>Intento</th><th>Procesado</th><th>Error</th></tr></thead><tbody>
        ${envios.slice(0, 8).map(e => `<tr><td>${escapeHtml(e.sistema || "-")}</td><td>${escapeHtml(e.estado || "-")}</td><td>${escapeHtml(e.intento ?? "-")}</td><td>${escapeHtml(e.processed_at ? new Date(e.processed_at).toLocaleString("es-ES") : "-")}</td><td>${escapeHtml(e.error || "")}</td></tr>`).join("") || "<tr><td colspan='5'>Sin envios fiscales registrados.</td></tr>"}
      </tbody></table>
      <h2 style="font-size:16px;margin-top:20px">Ultimos eventos</h2>
      <table><thead><tr><th>Fecha</th><th>Evento</th><th>Detalle</th></tr></thead><tbody>
        ${eventos.slice(0, 10).map(e => `<tr><td>${escapeHtml(e.created_at ? new Date(e.created_at).toLocaleString("es-ES") : "-")}</td><td>${escapeHtml(e.evento_tipo || "-")}</td><td><pre>${escapeHtml(JSON.stringify(e.detalle || {}, null, 2))}</pre></td></tr>`).join("") || "<tr><td colspan='3'>Sin eventos fiscales registrados.</td></tr>"}
      </tbody></table>
      <div class="box">Software: ${escapeHtml(config.verifactu?.software_nombre || "TransGest")} - ID ${escapeHtml(config.verifactu?.software_id || "transgest-tms")} - Version ${escapeHtml(config.verifactu?.software_version || "-")}</div>
    </main></body></html>`;
}

function buildCobrosReportHtml({ controlCobros = {}, cobrosCfg = {}, facturas = [] } = {}) {
  const resumen = controlCobros.resumen || {};
  const proximas = Array.isArray(controlCobros.proximas) ? controlCobros.proximas : [];
  const riesgo = Array.isArray(controlCobros.riesgo) ? controlCobros.riesgo : [];
  const vencidas = Array.isArray(facturas)
    ? facturas.filter((f) => ["vencida", "reclamada", "sin_cobrar"].includes(String(f.estado || "")))
    : [];
  const generated = new Date().toLocaleString("es-ES");
  const money = (value) => `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const date = (value, withTime = false) => fmtDate(value, withTime);
  const resumenRows = [
    ["Pendientes", resumen.pendientes],
    ["Vencidas", resumen.vencidas],
    ["Reclamadas", resumen.reclamadas],
    ["Sin cobrar", resumen.sin_cobrar],
    ["A revisar hoy", resumen.revisar_hoy],
    ["Importe pendiente", money(resumen.importe_pendiente)],
    ["Importe reclamado", money(resumen.importe_reclamado)],
    ["Importe sin cobrar", money(resumen.importe_sin_cobrar)],
  ];
  const cfgRows = [
    ["Revision tras vencimiento", `${Number(cobrosCfg.dias_revision_post_vencimiento || 0)} dia(s)`],
    ["Dias entre reclamaciones", `${Number(cobrosCfg.dias_entre_reclamaciones || 0)} dia(s)`],
    ["Maximo de reclamaciones", Number(cobrosCfg.max_envios_reclamacion || 0)],
    ["Dias hasta juridico", `${Number(cobrosCfg.dias_hasta_juridico || 0)} dia(s)`],
    ["Email automatico", cobrosCfg.envio_email_auto ? "Si" : "No"],
  ];
  const invoiceRow = (f) => `<tr>
    <td>${escapeHtml(f.numero || f.id || "-")}</td>
    <td>${escapeHtml(f.cliente_nombre || "-")}</td>
    <td>${escapeHtml(estadoFacturaLabel(f.estado))}</td>
    <td>${escapeHtml(date(f.fecha_vencimiento))}</td>
    <td>${escapeHtml(date(f.revision_cobro_at, true))}</td>
    <td>${escapeHtml(Number(f.reclamacion_envios || 0))}</td>
    <td>${escapeHtml(money(f.total))}</td>
  </tr>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Informe de control de cobros</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1040px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}
      table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
      .box{border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;padding:12px 14px}
      .metric{font-size:20px;font-weight:800}.muted{color:#64748b;font-size:11px;margin-top:4px}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Informe de control de cobros</h1>
      <div class="sub">Generado el ${escapeHtml(generated)}. Documento interno para seguimiento de vencimientos, reclamaciones y riesgo de impago.</div>
      <div class="grid">
        <div class="box"><div class="metric">${escapeHtml(Number(resumen.vencidas || 0))}</div><div class="muted">Facturas vencidas</div></div>
        <div class="box"><div class="metric">${escapeHtml(Number(resumen.reclamadas || 0))}</div><div class="muted">Facturas reclamadas</div></div>
        <div class="box"><div class="metric">${escapeHtml(Number(resumen.sin_cobrar || 0))}</div><div class="muted">Facturas sin cobrar</div></div>
        <div class="box"><div class="metric">${escapeHtml(money(resumen.importe_pendiente))}</div><div class="muted">Importe pendiente</div></div>
      </div>
      <h2>Resumen</h2>
      <table><tbody>${resumenRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v ?? 0)}</td></tr>`).join("")}</tbody></table>
      <h2>Politica activa</h2>
      <table><tbody>${cfgRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>
      <h2>Proximas revisiones</h2>
      <table><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>Vencimiento</th><th>Revision</th><th>Envios</th><th>Total</th></tr></thead><tbody>
        ${proximas.slice(0, 30).map(invoiceRow).join("") || "<tr><td colspan='7'>No hay revisiones programadas.</td></tr>"}
      </tbody></table>
      <h2>Riesgo de cobro</h2>
      <table><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>Vencimiento</th><th>Revision</th><th>Envios</th><th>Total</th></tr></thead><tbody>
        ${riesgo.slice(0, 50).map(invoiceRow).join("") || "<tr><td colspan='7'>No hay facturas en riesgo.</td></tr>"}
      </tbody></table>
      <h2>Listado vencido/reclamado</h2>
      <table><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>Vencimiento</th><th>Revision</th><th>Envios</th><th>Total</th></tr></thead><tbody>
        ${vencidas.slice(0, 120).map(invoiceRow).join("") || "<tr><td colspan='7'>No hay facturas vencidas o reclamadas en el listado actual.</td></tr>"}
      </tbody></table>
    </main></body></html>`;
}

function buildTesoreriaReportHtml({ prevision = {}, facturas = [], pagosProveedor = [] } = {}) {
  const generated = new Date().toLocaleString("es-ES");
  const buckets = Array.isArray(prevision.buckets) ? prevision.buckets : [];
  const proximos = Array.isArray(prevision.proximos) ? prevision.proximos : [];
  const money = (value) => `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
  const totalCobros = buckets.reduce((sum, b) => sum + Number(b.cobros || 0), 0);
  const totalPagos = buckets.reduce((sum, b) => sum + Number(b.pagos || 0), 0);
  const capitalActual = Number(prevision.capitalActual || 0);
  const neto30 = Number(prevision.neto30 || 0);
  const saldoPrevisto30 = Number(prevision.saldoPrevisto30 ?? (capitalActual + neto30));
  const pendientesCobro = Array.isArray(facturas)
    ? facturas.filter(f => ["emitida", "enviada", "vencida", "reclamada", "sin_cobrar"].includes(String(f.estado || "")) && Number(f.total || 0) > 0)
    : [];
  const pagosPendientes = Array.isArray(pagosProveedor)
    ? pagosProveedor.filter(p => !p.pagado && Number(p.importe || p.precio_colaborador || 0) > 0)
    : [];
  const bucketRows = buckets.map(b => {
    const neto = Number(b.cobros || 0) - Number(b.pagos || 0);
    return `<tr>
      <td>${escapeHtml(b.label || "-")}</td>
      <td class="money green">${escapeHtml(money(b.cobros))}</td>
      <td class="money amber">${escapeHtml(money(b.pagos))}</td>
      <td class="money ${neto < 0 ? "red" : ""}">${escapeHtml(money(neto))}</td>
      <td>${escapeHtml(Array.isArray(b.items) ? b.items.length : 0)}</td>
    </tr>`;
  }).join("");
  const movementRows = proximos.map(item => `<tr>
    <td>${escapeHtml(fmtDate(item.fecha))}</td>
    <td>${escapeHtml(item.tipo === "cobro" ? "Cobro" : "Pago")}</td>
    <td>${escapeHtml(item.titulo || "-")}</td>
    <td>${escapeHtml(item.subtitulo || "-")}</td>
    <td class="money ${item.tipo === "cobro" ? "green" : "amber"}">${escapeHtml(item.tipo === "cobro" ? `+${money(item.importe)}` : `-${money(item.importe)}`)}</td>
  </tr>`).join("");
  const facturaRows = pendientesCobro.slice(0, 80).map(f => `<tr>
    <td>${escapeHtml(f.numero || "-")}</td>
    <td>${escapeHtml(f.cliente_nombre || "-")}</td>
    <td>${escapeHtml(f.estado || "-")}</td>
    <td>${escapeHtml(fmtDate(f.fecha_vencimiento || f.revision_cobro_at || f.fecha))}</td>
    <td class="money green">${escapeHtml(money(f.total))}</td>
  </tr>`).join("");
  const pagoRows = pagosPendientes.slice(0, 80).map(p => `<tr>
    <td>${escapeHtml(p.numero || "-")}</td>
    <td>${escapeHtml(p.colaborador_nombre || "-")}</td>
    <td>${escapeHtml([p.origen, p.destino].filter(Boolean).join(" -> ") || "-")}</td>
    <td>${escapeHtml(fmtDate(p.fecha_pago_calculada || p.fecha_descarga || p.fecha_carga))}</td>
    <td class="money amber">${escapeHtml(money(p.importe || p.precio_colaborador))}</td>
  </tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Informe de tesoreria</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1080px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:14px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}
      table{width:100%;border-collapse:collapse;margin:10px 0}td,th{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}
      .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
      .box{border:1px solid #e5e7eb;border-radius:10px;background:#f8fafc;padding:12px 14px}
      .metric{font-size:20px;font-weight:800}.muted{color:#64748b;font-size:11px;margin-top:4px}
      .money{text-align:right;font-weight:800}.green{color:#047857}.amber{color:#b45309}.red{color:#dc2626}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Informe de tesoreria</h1>
      <div class="sub">Generado el ${escapeHtml(generated)}. Prevision interna basada en vencimientos de facturas y pagos pendientes a colaboradores/proveedores.</div>
      <div class="grid">
        <div class="box"><div class="metric green">${escapeHtml(money(totalCobros))}</div><div class="muted">Cobros en horizonte visible</div></div>
        <div class="box"><div class="metric amber">${escapeHtml(money(totalPagos))}</div><div class="muted">Pagos en horizonte visible</div></div>
        <div class="box"><div class="metric">${escapeHtml(money(capitalActual))}</div><div class="muted">Capital actual</div></div>
        <div class="box"><div class="metric ${saldoPrevisto30 < 0 ? "red" : "green"}">${escapeHtml(money(saldoPrevisto30))}</div><div class="muted">Saldo previsto a 30 dias</div></div>
        <div class="box"><div class="metric ${neto30 < 0 ? "red" : "green"}">${escapeHtml(money(neto30))}</div><div class="muted">Neto proximos 30 dias</div></div>
        <div class="box"><div class="metric">${escapeHtml(pendientesCobro.length + pagosPendientes.length)}</div><div class="muted">Movimientos pendientes</div></div>
      </div>
      <h2>Resumen por plazo</h2>
      <table><thead><tr><th>Plazo</th><th>Cobros</th><th>Pagos</th><th>Neto</th><th>Movimientos</th></tr></thead><tbody>${bucketRows || "<tr><td colspan='5'>Sin datos de prevision.</td></tr>"}</tbody></table>
      <h2>Proximos movimientos</h2>
      <table><thead><tr><th>Fecha</th><th>Tipo</th><th>Documento</th><th>Cliente/proveedor</th><th>Importe</th></tr></thead><tbody>${movementRows || "<tr><td colspan='5'>Sin movimientos proximos.</td></tr>"}</tbody></table>
      <h2>Cobros pendientes</h2>
      <table><thead><tr><th>Factura</th><th>Cliente</th><th>Estado</th><th>Fecha prevista</th><th>Importe</th></tr></thead><tbody>${facturaRows || "<tr><td colspan='5'>Sin cobros pendientes en el listado actual.</td></tr>"}</tbody></table>
      <h2>Pagos a colaboradores/proveedores</h2>
      <table><thead><tr><th>Pedido</th><th>Proveedor</th><th>Ruta</th><th>Fecha pago</th><th>Importe</th></tr></thead><tbody>${pagoRows || "<tr><td colspan='5'>Sin pagos pendientes a proveedor.</td></tr>"}</tbody></table>
    </main></body></html>`;
}

function buildOrdenPagoProveedorHtml(group = {}) {
  const viajes = Array.isArray(group.viajes) ? group.viajes : [];
  const generado = new Date().toLocaleString("es-ES");
  const total = viajes.reduce((sum, p) => sum + Number(p.importe || p.precio_colaborador || 0), 0);
  const rows = viajes.map(p => `
    <tr>
      <td>${escapeHtml(p.numero || "-")}</td>
      <td>${escapeHtml([p.origen, p.destino].filter(Boolean).join(" -> ") || "-")}</td>
      <td>${escapeHtml(fmtDate(p.fecha_carga))}</td>
      <td>${escapeHtml(fmtDate(p.fecha_descarga))}</td>
      <td>${escapeHtml(p.factura_nombre || "Pendiente")}</td>
      <td>${escapeHtml(fmtDate(p.fecha_pago_calculada))}</td>
      <td class="money">${escapeHtml(fmt2(p.importe || p.precio_colaborador))} EUR</td>
    </tr>
  `).join("");
  return `<!doctype html><html><head><meta charset="utf-8"/>
    <title>Orden de pago ${escapeHtml(group.nombre || "")}</title>
    <style>
      body{font-family:Arial,sans-serif;margin:28px;color:#111827}
      h1{font-size:22px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      .box{border:1px solid #cbd5e1;border-radius:8px;padding:12px;margin-bottom:14px}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #e2e8f0;padding:8px;text-align:left;font-size:12px}
      th{background:#f8fafc;text-transform:uppercase;font-size:10px;color:#64748b}.money{text-align:right;font-weight:700}
      .total{font-size:18px;font-weight:800;text-align:right;margin-top:14px}.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:36px}.line{border-top:1px solid #94a3b8;padding-top:8px;color:#64748b;font-size:12px}
      @media print{button{display:none}body{margin:18px}}
    </style></head><body>
      <button onclick="window.print()">Imprimir / guardar PDF</button>
      <h1>Orden de pago a proveedor</h1>
      <div class="sub">Generado el ${escapeHtml(generado)} desde TransGest.</div>
      <div class="box">
        <strong>${escapeHtml(group.nombre || "Proveedor sin nombre")}</strong><br/>
        Condiciones: ${escapeHtml(group.formaPago || "Sin condiciones guardadas")}<br/>
        Viajes incluidos: ${escapeHtml(viajes.length)}
      </div>
      <table><thead><tr><th>Pedido</th><th>Ruta</th><th>Carga</th><th>Descarga</th><th>Factura</th><th>Pago previsto</th><th>Importe</th></tr></thead><tbody>${rows || "<tr><td colspan='7'>Sin viajes pendientes.</td></tr>"}</tbody></table>
      <div class="total">Total orden: ${escapeHtml(fmt2(total))} EUR</div>
      <div class="sign"><div class="line">Revisado por administracion</div><div class="line">Autorizacion de pago</div></div>
    </body></html>`;
}

function getLastExternalFiscalSync(eventos = []) {
  return (Array.isArray(eventos) ? eventos : []).find((ev) => ["sync.verifacti.manual", "webhook.verifacti.recibido"].includes(ev?.evento_tipo)) || null;
}

function getLatestFiscalQueueOutcome(envios = []) {
  const latest = Array.isArray(envios) ? envios[0] : null;
  if (!latest) return null;
  if (latest.estado === "error") {
    return {
      tone: "#ef4444",
      title: "Ultimo intento con error",
      detail: latest.error || "El canal devolvio un error en el ultimo intento.",
    };
  }
  if (latest.estado === "procesando") {
    return {
      tone: "#22d3ee",
      title: "Envio en curso",
      detail: "La factura esta en procesamiento dentro de la cola fiscal.",
    };
  }
  if (latest.estado === "aceptado" || latest.processed_at) {
    return {
      tone: "var(--green)",
      title: "Ultimo envio procesado",
      detail: latest.processed_at
        ? `Procesado el ${new Date(latest.processed_at).toLocaleString("es-ES")}`
        : "La cola ya marco este envio como procesado.",
    };
  }
  return {
    tone: "#f59e0b",
    title: "Pendiente de reintento",
    detail: "La factura sigue a la espera de siguiente procesamiento fiscal.",
  };
}

function getFiscalDocumentChecks({ fiscal, acceptedRef, providerUuid, lastSend }) {
  if (!fiscal) return [];
  return [
    {
      label: "Huella",
      ok: !!fiscal.huella,
      detail: fiscal.huella ? "Documento fiscal generado." : "Aun no hay huella fiscal.",
    },
    {
      label: "Encadenado",
      ok: fiscal.hash_anterior !== undefined && fiscal.hash_anterior !== null,
      detail: fiscal.hash_anterior ? "Hay hash anterior encadenado." : "Es el primer registro o no habia cadena previa.",
    },
    {
      label: "Referencia aceptada",
      ok: !!acceptedRef,
      detail: acceptedRef ? "Existe referencia fiscal aceptada." : "Aun no consta referencia aceptada del canal.",
    },
    {
      label: "UUID proveedor",
      ok: fiscal.modo !== "verifactu" || !!providerUuid,
      detail: fiscal.modo === "verifactu"
        ? (providerUuid ? "Proveedor externo identificado." : "Aun no hay UUID de proveedor.")
        : "No aplica en este modo fiscal.",
    },
    {
      label: "Reintento programado",
      ok: !lastSend?.next_retry_at,
      detail: lastSend?.next_retry_at
        ? `Pendiente para ${new Date(lastSend.next_retry_at).toLocaleString("es-ES")}.`
        : "No hay reintentos pendientes ahora mismo.",
    },
  ];
}

function getFiscalStateMeta(estado) {
  if (estado === "aceptado") {
    return {
      title: "Registro fiscal aceptado",
      color: "var(--green)",
      bg: "rgba(16,185,129,.08)",
      border: "rgba(16,185,129,.25)",
      text: "La factura ya dispone de trazabilidad fiscal registrada y aceptada.",
    };
  }
  if (estado === "error") {
    return {
      title: "Incidencia fiscal pendiente",
      color: "#ef4444",
      bg: "rgba(239,68,68,.08)",
      border: "rgba(239,68,68,.25)",
      text: "Hay una incidencia fiscal que conviene revisar antes de darla por cerrada.",
    };
  }
  return {
    title: "Envio fiscal pendiente",
    color: "#f59e0b",
    bg: "rgba(245,158,11,.08)",
    border: "rgba(245,158,11,.22)",
    text: "La factura esta preparada, pero aun no consta aceptada por el bloque fiscal.",
  };
}

function getFacturaFiscalRowMeta(factura) {
  if (!factura?.fiscal_modo) {
    return {
      label: "Sin registro",
      tone: "#94a3b8",
      bg: "rgba(148,163,184,.10)",
      detail: "Aun no existe registro fiscal para esta factura.",
    };
  }
  if (factura.fiscal_estado_envio === "aceptado") {
    return {
      label: "Aceptada",
      tone: "var(--green)",
      bg: "rgba(16,185,129,.12)",
      detail: factura.fiscal_referencia_aceptada
        ? `Referencia ${String(factura.fiscal_referencia_aceptada).slice(0, 22)}${String(factura.fiscal_referencia_aceptada).length > 22 ? "..." : ""}`
        : factura.fiscal_ultimo_envio_at
          ? `Aceptada tras el ultimo envio del ${new Date(factura.fiscal_ultimo_envio_at).toLocaleString("es-ES")}.`
          : "La factura ya consta aceptada en el canal fiscal.",
    };
  }
  if (factura.fiscal_estado_envio === "error") {
    return {
      label: "Con error",
      tone: "#ef4444",
      bg: "rgba(239,68,68,.12)",
      detail: factura.fiscal_next_retry_at
        ? `Reintento previsto para ${new Date(factura.fiscal_next_retry_at).toLocaleString("es-ES")}.`
        : ((factura.fiscal_ultimo_error && String(factura.fiscal_ultimo_error).slice(0, 80)) || "Hay una incidencia fiscal pendiente de revisar."),
    };
  }
  return {
    label: factura.fiscal_queue_estado === "procesando" ? "Procesando" : "Pendiente",
    tone: "#f59e0b",
    bg: "rgba(245,158,11,.12)",
    detail: factura.fiscal_next_retry_at
      ? `Siguiente reintento ${new Date(factura.fiscal_next_retry_at).toLocaleString("es-ES")}.`
      : factura.fiscal_provider_uuid
        ? `Proveedor ${String(factura.fiscal_provider_uuid).slice(0, 18)}${String(factura.fiscal_provider_uuid).length > 18 ? "..." : ""}`
        : "El envio fiscal sigue pendiente de aceptacion.",
  };
}

function VistaFactura({factura, onClose, onRectificar, onSyncFiscal, onExportFiscal, onCambiarEstado, rectificadasIds=new Set()}) {
  const empresa = useEmpresaPerfil();
  // Safety: ensure factura has required fields
  if (!factura || !factura.id) {
    return (
      <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center"}}>
        <div style={{background:"var(--bg2)",borderRadius:12,padding:32,textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:12}}>Aviso</div>
          <div style={{color:"var(--text)"}}>Error al cargar la factura</div>
          <button onClick={onClose} style={{marginTop:16,padding:"8px 20px",borderRadius:8,border:"1px solid var(--border2)",background:"var(--bg4)",color:"var(--text)",cursor:"pointer"}}>Cerrar</button>
        </div>
      </div>
    );
  }
  const esRect  = factura.estado==="rectificada" || factura.serie?.startsWith("R") || (factura.factura_original_numero);
  const lineas  = Array.isArray(factura.lineas) ? factura.lineas : [];
  const documentos = Array.isArray(factura.documentos) ? factura.documentos : [];
  const fiscal = factura.fiscal || null;
  const fiscalEventos = Array.isArray(factura.fiscal_eventos) ? factura.fiscal_eventos : [];
  const fiscalAcceptedRef = getFiscalAcceptedReference(fiscalEventos);
  const fiscalEnvios = Array.isArray(factura.fiscal_envios) ? factura.fiscal_envios : [];
  const auditLog = Array.isArray(factura.audit_log) ? factura.audit_log : [];
  const emailLog = Array.isArray(factura.email_log) ? factura.email_log : [];
  const ultimoEnvioFiscal = fiscalEnvios[0] || null;
  const fiscalProviderUuid = getFiscalProviderUuid(fiscalEnvios);
  const ultimoSyncFiscal = getLastExternalFiscalSync(fiscalEventos);
  const fiscalMeta = getFiscalStateMeta(fiscal?.estado_envio);
  const fiscalQueueOutcome = getLatestFiscalQueueOutcome(fiscalEnvios);
  const fiscalDocumentChecks = getFiscalDocumentChecks({
    fiscal,
    acceptedRef: fiscalAcceptedRef,
    providerUuid: fiscalProviderUuid,
    lastSend: ultimoEnvioFiscal,
  });
  const cobroTimeline = !esRect ? [
    factura.fecha && { label: "Factura emitida", value: fmtDate(factura.fecha), tone: "var(--text2)" },
    factura.fecha_vencimiento && { label: "Vencimiento", value: fmtDate(factura.fecha_vencimiento), tone: "#f59e0b" },
    factura.revision_cobro_at && { label: "Revision programada", value: fmtDate(factura.revision_cobro_at), tone: "var(--accent)" },
    factura.reclamacion_ultimo_envio_at && { label: "Ultima reclamacion", value: fmtDate(factura.reclamacion_ultimo_envio_at, true), tone: "#f97316" },
    factura.reclamacion_hasta && { label: "Seguimiento hasta", value: fmtDate(factura.reclamacion_hasta), tone: "#ef4444" },
    factura.estado === "cobrada" && { label: "Factura cobrada", value: "Marcada como cobrada", tone: "var(--green)" },
    factura.estado === "sin_cobrar" && { label: "Escalada", value: "Marcada como sin cobrar", tone: "#ef4444" },
  ].filter(Boolean) : [];

  async function enviarEmail() {
    const mail = factura.cliente_email_facturacion || factura.cliente_email || "";
    try {
      const revision = await revisarEmailFactura(factura.id, mail);
      if (Array.isArray(revision?.bloqueantes) && revision.bloqueantes.length) {
        await confirmDialog({
          title: "No se puede enviar",
          message: revision.bloqueantes.join("\n"),
          confirmText: "Aceptar",
          tone: "warning",
        });
        return;
      }
      if (Array.isArray(revision?.avisos) && revision.avisos.length) {
        const ok = await confirmDialog({
          title: "Revisar antes de enviar",
          message: `La factura puede enviarse, pero conviene revisar:\n\n- ${revision.avisos.join("\n- ")}\n\nSe prepararan ${Number(revision.adjuntos_estimados || 1)} adjunto(s). ¿Enviar igualmente?`,
          confirmText: "Enviar igualmente",
          tone: "warning",
        });
        if (!ok) return;
      }
      const result = await enviarEmailFactura(factura.id, { destinatario: mail, force: true });
      broadcastFacturasChanged(normalizarDetalleCambioFactura(result, {
        factura_id: factura.id,
        estado_nuevo: result?.estado || "enviada",
        pedido_estado_aplicado: "facturado",
      }));
      notify(result?.simulado
        ? `Email simulado. Factura preparada con ${Number(result?.adjuntos || 0)} adjunto(s).`
        : `Factura enviada con ${Number(result?.adjuntos || 0)} adjunto(s).`,
        result?.simulado ? "warning" : "success");
      onClose();
    } catch(e) {
      notify(e.message || "No se pudo enviar la factura por email", "error");
    }
  }

  return (
    <div style={S.modal} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:`1px solid ${esRect?"rgba(249,115,22,.4)":"var(--border2)"}`,borderRadius:14,width:"min(820px,97vw)",maxHeight:"96vh",overflowY:"auto",display:"flex",flexDirection:"column"}}>
        {/* Toolbar */}
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"12px 18px",borderBottom:"1px solid #141a28",flexShrink:0}}>
          <span style={{flex:1,fontFamily:"'Syne',sans-serif",fontWeight:700,fontSize:14,color:"var(--text)"}}>
            {factura.numero}
            {esRect&&<span style={{fontSize:11,color:"#f97316",marginLeft:8,fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>FACTURA RECTIFICATIVA</span>}
          </span>
          <button style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}} onClick={async()=>{
              const mail = factura.cliente_email_facturacion || factura.cliente_email || "";
              if (!mail) {
                await confirmDialog({
                  title: "Enviar sin email",
                  message: "Este cliente no tiene email configurado. Añade un email de facturacion al cliente antes de enviar la factura.",
                  confirmText: "Aceptar",
                  tone: "warning",
                });
                return;
              }
              await enviarEmail();
            }}>
              Enviar
              {factura.estado==="enviada" && <span style={{fontSize:9,marginLeft:4,opacity:0.7}}>enviada</span>}
            </button>
          <button style={{...S.btn,background:"var(--bg4)",color:"var(--text2)",border:"1px solid #1e2d45"}} onClick={()=>{
            // Open new window with invoice HTML for printing
            const wrapper = document.getElementById("factura-print-wrapper");
            if (!wrapper) { notify("Error: no se encontro el contenido de la factura", "error"); return; }
            const w = window.open("","_blank","width=900,height=700");
            w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<title>Factura ${factura.numero||""}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;padding:32px;color:#111;font-size:12px;line-height:1.5;background:#fff}
  img{max-height:52px;max-width:160px;object-fit:contain;display:block;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;margin:12px 0}
  th{background:#f3f4f6;padding:7px 10px;text-align:left;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px}
  td{padding:7px 10px;border-bottom:1px solid #e5e7eb;font-size:12px}
  .header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:14px;border-bottom:2px solid #1d4ed8}
  .total-row{font-weight:800;font-size:14px;background:#f0f9ff}
  .fiscal-box{margin-top:18px;padding:14px 16px;border-radius:10px;border:1px solid #d1d5db;background:#f8fafc}
  .fiscal-summary{margin-bottom:10px;padding:10px 12px;border-radius:8px}
  .fiscal-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px 18px}
  .fiscal-k{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#64748b}
  .fiscal-v{font-size:12px;color:#111827;font-weight:600;word-break:break-word}
  .fiscal-mono{font-family:'Courier New',monospace;font-size:11px;word-break:break-all}
  .fiscal-note{margin-top:10px;font-size:10px;color:#475569;line-height:1.5}
  @media print{@page{margin:1cm;size:A4}body{padding:0}}
</style></head><body>`);
            w.document.write(wrapper.innerHTML);
            w.document.write("</body></html>");
            w.document.close();
            w.focus();
            setTimeout(()=>w.print(), 500);
          }}>Imprimir / PDF</button>
          {!esRect && factura.estado!=="rectificada" && !rectificadasIds.has(factura.id) && !rectificadasIds.has(factura.numero) && !rectificadasIds.has(String(factura.id)) && (
            <button style={{...S.btn,background:"rgba(249,115,22,.15)",color:"#f97316",border:"1px solid rgba(249,115,22,.3)"}} onClick={()=>onRectificar(factura)}>Rectificar</button>
          )}
          {onCambiarEstado && !esRect && factura.estado !== "cobrada" && factura.estado !== "rectificada" && (
            <button
              style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)"}}
              onClick={()=>onCambiarEstado(factura.id, "cobrada")}
            >
              Marcar cobrada
            </button>
          )}
          {onCambiarEstado && !esRect && !["reclamada","sin_cobrar","cobrada","borrador","rectificada"].includes(factura.estado) && (
            <button
              style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",border:"1px solid rgba(249,115,22,.25)"}}
              onClick={()=>onCambiarEstado(factura.id, "reclamada")}
            >
              Reclamar
            </button>
          )}
          {onCambiarEstado && !esRect && factura.estado === "reclamada" && (
            <button
              style={{...S.btn,background:"rgba(239,68,68,.12)",color:"#ef4444",border:"1px solid rgba(239,68,68,.25)"}}
              onClick={()=>onCambiarEstado(factura.id, "sin_cobrar")}
            >
              Pasar a sin cobrar
            </button>
          )}
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:14,cursor:"pointer",padding:"0 4px"}}>Cerrar</button>
        </div>

        {/* Contenido */}
        <div style={{padding:"28px 32px"}} id="factura-print-wrapper">
          {/* Cabecera */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}>
            <div>
              {getLogoDataUrl() && (
                <img src={getLogoDataUrl()} alt="Logo"
                  style={{maxHeight:52,maxWidth:160,objectFit:"contain",marginBottom:8,display:"block"}}/>
              )}
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:18,color:"var(--text)",marginBottom:4}}>{empresa.razon_social||"Tu Empresa S.L."}</div>
              <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.7}}>
                {empresa.cif&&<div>CIF: {empresa.cif}</div>}
                {empresa.domicilio&&<div>{empresa.domicilio}</div>}
                {(empresa.cp||empresa.municipio)&&<div>{empresa.cp} {empresa.municipio}{empresa.provincia?`, ${empresa.provincia}`:""}</div>}
                {empresa.telefono&&<div>Tel: {empresa.telefono}</div>}
                {empresa.email&&<div>{empresa.email}</div>}
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:22,color:esRect?"#f97316":"var(--accent-xl)",marginBottom:6}}>
                {esRect?"FACTURA RECTIFICATIVA":"FACTURA"}
              </div>
              <div style={{fontSize:14,color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontWeight:700}}>{factura.numero}</div>
              <div style={{fontSize:11,color:"var(--text4)",marginTop:4}}>Fecha: {factura.fecha?new Date(factura.fecha).toLocaleDateString("es-ES"):"-"}</div>
              {factura.fecha_vencimiento&&<div style={{fontSize:11,color:"var(--text4)"}}>Vcto: {new Date(factura.fecha_vencimiento).toLocaleDateString("es-ES")}</div>}
              {esRect&&factura.factura_original_numero&&<div style={{fontSize:11,color:"#f97316",marginTop:4,fontWeight:700}}>Rectifica: {factura.factura_original_numero}</div>}
              {!esRect && (rectificadasIds.has(factura.id)||rectificadasIds.has(factura.numero)||rectificadasIds.has(String(factura.id))) && (
                <div style={{fontSize:11,background:"rgba(249,115,22,.1)",border:"1px solid rgba(249,115,22,.3)",borderRadius:5,padding:"3px 8px",marginTop:5,color:"#f97316",fontWeight:700,display:"inline-block"}}>
                  Ya tiene rectificativa emitida
                </div>
              )}
            </div>
          </div>

          <div style={{borderBottom:"1px solid #141a28",marginBottom:18}}/>

          {/* Cliente */}
          <div style={{background:"var(--bg3)",borderRadius:8,padding:"12px 16px",marginBottom:20}}>
            <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:6}}>Facturado a</div>
            <div style={{fontWeight:700,fontSize:14,color:"var(--text)",marginBottom:3}}>{factura.cliente_nombre}</div>
            <div style={{fontSize:12,color:"var(--text3)",lineHeight:1.6}}>
              {factura.cliente_cif&&<div>CIF/NIF: {factura.cliente_cif}</div>}
              {/* Direccion social */}
              {factura.cliente_direccion&&(
                <div style={{marginTop:2,fontSize:12,color:"var(--text2)"}}>
                  {factura.cliente_direccion}
                </div>
              )}
              {/* Direccion fiscal si es diferente */}
              {factura.cliente_dir_fiscal_distinta && factura.cliente_dir_fiscal && (
                <div style={{marginTop:4,padding:"4px 8px",background:"rgba(59,130,246,.07)",
                  border:"1px solid rgba(59,130,246,.15)",borderRadius:5,fontSize:11,color:"var(--accent)"}}>
                  Dir. fiscal: {factura.cliente_dir_fiscal}
                </div>
              )}
            </div>
          </div>

          {/* Motivo rectificacion */}
          {esRect&&factura.motivo_rectificacion&&(
            <div style={{background:"rgba(249,115,22,.08)",border:"1px solid rgba(249,115,22,.2)",borderRadius:8,padding:"9px 14px",marginBottom:16,fontSize:12,color:"#b07030"}}>
              <strong>Motivo:</strong> {factura.motivo_rectificacion}
            </div>
          )}

          {!esRect && (
            <details style={{background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"10px 14px",marginBottom:16}}>
              <summary style={{cursor:"pointer",fontSize:11,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text4)"}}>
                Seguimiento de cobro
              </summary>
              <div style={{marginTop:10}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Seguimiento de cobro</div>
              <div style={{fontSize:11,color:"var(--text5)",marginBottom:8}}>
                Los envios de reclamacion, ultimo email y seguimiento hasta se calculan desde la politica de cobros configurada en Mi Empresa &gt; Configuracion facturas.
              </div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"8px 18px",fontSize:12}}>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Estado</div>
                  <div style={{color:EC[factura.estado]||"var(--text2)",fontWeight:700}}>{estadoFacturaLabel(factura.estado)}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Vencimiento</div>
                  <div style={{color:"var(--text2)"}}>{fmtDate(factura.fecha_vencimiento)}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Revision cobro</div>
                  <div style={{color:"var(--text2)"}}>{fmtDate(factura.revision_cobro_at)}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Envios reclamacion</div>
                  <div style={{color:"var(--text2)"}}>{Number(factura.reclamacion_envios || 0)}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Ultimo email</div>
                  <div style={{color:"var(--text2)"}}>{fmtDate(factura.reclamacion_ultimo_envio_at, true)}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Seguimiento hasta</div>
                  <div style={{color:"var(--text2)"}}>{fmtDate(factura.reclamacion_hasta)}</div>
                </div>
              </div>
              {cobroTimeline.length > 0 && (
                <div style={{marginTop:12,paddingTop:10,borderTop:"1px solid #141a28"}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Historial resumido</div>
                  <div style={{display:"grid",gap:6}}>
                    {cobroTimeline.map((item, idx)=>(
                      <div key={`${item.label}-${idx}`} style={{display:"flex",justifyContent:"space-between",gap:12,fontSize:11}}>
                        <span style={{color:item.tone,fontWeight:700}}>{item.label}</span>
                        <span style={{color:"var(--text3)",textAlign:"right"}}>{item.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </details>
          )}

          {/* Lineas */}
          <table style={{width:"100%",borderCollapse:"collapse",marginBottom:20}}>
            <thead>
              <tr style={{borderBottom:"2px solid #141a28"}}>
                {["Descripcion","Cant.","Precio unit.","Subtotal"].map(h=>(
                  <th key={h} style={{textAlign:h==="Descripcion"?"left":"right",padding:"7px 12px",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lineas.map((l,i)=>(
                <tr key={i} style={{borderBottom:"1px solid #0f1520"}}>
                  <td style={{padding:"8px 12px",fontSize:13,color:"var(--text2)"}}>{l.concepto}</td>
                  <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace"}}>{l.cantidad}</td>
                  <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(l.precio_unit)} EUR</td>
                  <td style={{padding:"8px 12px",textAlign:"right",fontWeight:600,color:"var(--text)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2((l.cantidad||0)*(l.precio_unit||0))} EUR</td>
                </tr>
              ))}
              {lineas.length===0&&<tr><td colSpan={4} style={{padding:12,textAlign:"center",color:"var(--text5)",fontSize:12}}>Sin lineas registradas</td></tr>}
            </tbody>
          </table>

          {documentos.length>0&&(
            <div style={{background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"10px 14px",marginBottom:18}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:6}}>Albaranes y documentos vinculados</div>
              {documentos.map(doc=>(
                <div key={doc.id} style={{display:"flex",justifyContent:"space-between",gap:10,padding:"5px 0",borderTop:"1px solid #0f1520",fontSize:12,color:"var(--text3)"}}>
                  <span style={{fontWeight:600,color:"var(--text2)"}}>{doc.nombre}</span>
                  <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text5)"}}>{doc.tipo || doc.file_mime || "documento"}</span>
                </div>
              ))}
            </div>
          )}

          {emailLog.length > 0 && (
            <div style={{background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"10px 14px",marginBottom:18}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:6}}>Envios por email</div>
              {emailLog.slice(0,6).map(item=>(
                <div key={item.id} style={{padding:"7px 0",borderTop:"1px solid #0f1520"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11}}>
                    <span style={{color:"var(--text2)",fontWeight:800}}>{item.destinatario || "-"}</span>
                    <span style={{color:item.estado==="error"?"#ef4444":item.estado==="simulado"?"#f59e0b":"var(--green)",fontWeight:800}}>{item.estado}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                    {fmtDate(item.sent_at, true)} - {Number(item.adjuntos_count || 0)} adjunto(s){item.provider ? ` - ${item.provider}` : ""}
                  </div>
                  {item.error && <div style={{fontSize:11,color:"#ef4444",marginTop:2}}>{item.error}</div>}
                </div>
              ))}
            </div>
          )}

          {auditLog.length > 0 && (
            <div style={{background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"10px 14px",marginBottom:18}}>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:6}}>Historial de acciones</div>
              {auditLog.slice(0,8).map(item=>(
                <div key={item.id} style={{padding:"7px 0",borderTop:"1px solid #0f1520"}}>
                  <div style={{display:"flex",justifyContent:"space-between",gap:10,fontSize:11}}>
                    <span style={{color:"var(--text2)",fontWeight:700}}>
                      {item.campo === "estado" ? "Cambio de estado" : item.campo || "Actualizacion"}
                    </span>
                    <span style={{color:"var(--text5)"}}>{fmtDate(item.created_at, true)}</span>
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>
                    {item.valor_antes || "-"} -> {item.valor_nuevo || "-"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>
                    {item.usuario_nombre || item.usuario_email || "Usuario"}{item.ip ? ` - ${item.ip}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Totales */}
          <div style={{display:"flex",justifyContent:"flex-end"}}>
            <div style={{width:260}}>
              {[ ["Base imponible",`${fmt2(factura.base_imponible||0)} EUR`], [`IVA (${ivaLabel(factura.tipo_iva, factura.iva_regimen || factura.cliente_iva_regimen)})`,`${fmt2(factura.cuota_iva||0)} EUR`] ].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #0f1520",fontSize:13,color:"var(--text3)"}}>
                  <span>{k}</span><span style={{fontFamily:"'JetBrains Mono',monospace"}}>{v}</span>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",padding:"10px 0",marginTop:4}}>
                <span style={{fontWeight:800,fontSize:15,color:"var(--text)"}}>TOTAL</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:17,color:"var(--green)"}}>{fmt2(factura.total)} EUR</span>
              </div>
            </div>
          </div>

          {fiscal && (
            <div className="fiscal-box" style={{marginTop:18,paddingTop:14,borderTop:"1px solid #141a28"}}>
              <div
                className="fiscal-summary"
                style={{
                  marginBottom:12,
                  padding:"10px 12px",
                  borderRadius:8,
                  background:fiscalMeta.bg,
                  border:`1px solid ${fiscalMeta.border}`,
                }}
              >
                <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"center",flexWrap:"wrap"}}>
                  <div>
                    <div style={{fontSize:13,fontWeight:800,color:fiscalMeta.color}}>{fiscalMeta.title}</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2,lineHeight:1.45}}>{fiscalMeta.text}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
                    {onExportFiscal && (
                      <button
                        onClick={()=>onExportFiscal(factura.id)}
                        style={{...S.btn,background:"rgba(148,163,184,.10)",color:"var(--text3)",border:"1px solid rgba(148,163,184,.24)",padding:"5px 8px"}}
                      >
                        Descargar justificante fiscal
                      </button>
                    )}
                    {onSyncFiscal && fiscal?.modo === "verifactu" && fiscalProviderUuid && (
                      <button
                        onClick={()=>onSyncFiscal(factura.id)}
                        style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}
                      >
                        Sincronizar Verifacti
                      </button>
                    )}
                    <div style={{fontSize:11,fontWeight:700,color:fiscalMeta.color,textTransform:"uppercase",letterSpacing:".06em"}}>
                      {String(fiscal.modo || "ninguno").toUpperCase()} - {fiscal.entorno || "pruebas"}
                    </div>
                  </div>
                </div>
              </div>
              <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Registro fiscal</div>
              {!!fiscalDocumentChecks.length && (
                <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>
                  {fiscalDocumentChecks.map((check) => (
                    <span
                      key={check.label}
                      title={check.detail}
                      style={{
                        fontSize:10,
                        fontWeight:800,
                        borderRadius:999,
                        padding:"4px 8px",
                        background:check.ok ? "rgba(16,185,129,.12)" : "rgba(245,158,11,.12)",
                        border:`1px solid ${check.ok ? "rgba(16,185,129,.24)" : "rgba(245,158,11,.24)"}`,
                        color:check.ok ? "var(--green)" : "#f59e0b",
                      }}
                    >
                      {check.ok ? "OK" : "REV"} · {check.label}
                    </span>
                  ))}
                </div>
              )}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8,marginBottom:10}}>
                <div style={{padding:"8px 10px",borderRadius:8,border:"1px solid #1e2d45",background:"var(--bg3)"}}>
                  <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Aceptacion fiscal</div>
                  <div style={{fontSize:12,fontWeight:800,color:fiscalAcceptedRef ? "var(--green)" : "#f59e0b",marginTop:4}}>
                    {fiscalAcceptedRef ? "Aceptada" : "Pendiente"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.45}}>
                    {fiscalAcceptedRef ? "Ya existe una referencia aceptada del canal." : "Todavia no consta referencia aceptada."}
                  </div>
                </div>
                <div style={{padding:"8px 10px",borderRadius:8,border:"1px solid #1e2d45",background:"var(--bg3)"}}>
                  <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>Encadenado</div>
                  <div style={{fontSize:12,fontWeight:800,color:fiscal.hash_anterior ? "var(--green)" : "#94a3b8",marginTop:4}}>
                    {fiscal.hash_anterior ? "Con cadena previa" : "Inicio de cadena"}
                  </div>
                  <div style={{fontSize:11,color:"var(--text4)",marginTop:3,lineHeight:1.45}}>
                    {fiscal.hash_anterior ? "Este registro enlaza con una huella anterior." : "No habia una huella previa para encadenar."}
                  </div>
                </div>
              </div>
              <div className="fiscal-grid" style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"8px 18px",fontSize:12}}>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Modo</div>
                  <div style={{color:"var(--text2)",fontWeight:700}}>{String(fiscal.modo || "ninguno").toUpperCase()} - {fiscal.entorno || "pruebas"}</div>
                </div>
                <div>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Estado envio</div>
                  <div style={{color:fiscal.estado_envio==="aceptado"?"var(--green)":fiscal.estado_envio==="error"?"#ef4444":"#f59e0b",fontWeight:700}}>{fiscal.estado_envio || "pendiente"}</div>
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Huella</div>
                  <div style={{color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,wordBreak:"break-all"}}>{fiscal.huella || "sin huella"}</div>
                </div>
                <div style={{gridColumn:"1 / -1"}}>
                  <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Hash anterior</div>
                  <div style={{color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,wordBreak:"break-all"}}>
                    {fiscal.hash_anterior || "sin hash anterior"}
                  </div>
                </div>
                {fiscalAcceptedRef && (
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Referencia fiscal</div>
                    <div style={{color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,wordBreak:"break-all"}}>{fiscalAcceptedRef}</div>
                  </div>
                )}
                {fiscal.ultimo_envio_at && (
                  <div>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Ultimo envio</div>
                    <div style={{color:"var(--text2)"}}>{new Date(fiscal.ultimo_envio_at).toLocaleString("es-ES")}</div>
                  </div>
                )}
                {ultimoEnvioFiscal && (
                  <div>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Ultimo intento</div>
                    <div style={{color:"var(--text2)"}}>
                      {ultimoEnvioFiscal.estado || "pendiente"} - intento {Number(ultimoEnvioFiscal.intento || 0)}
                    </div>
                  </div>
                )}
                {fiscalProviderUuid && (
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>UUID proveedor</div>
                    <div style={{color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontSize:11,wordBreak:"break-all"}}>{fiscalProviderUuid}</div>
                  </div>
                )}
                {ultimoSyncFiscal && (
                  <div>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Ultima sync externa</div>
                    <div style={{color:"var(--text2)"}}>
                      {ultimoSyncFiscal.evento_tipo === "webhook.verifacti.recibido" ? "Webhook" : "Manual"} - {new Date(ultimoSyncFiscal.created_at).toLocaleString("es-ES")}
                    </div>
                  </div>
                )}
                {fiscal.qr_text && (
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Cadena fiscal</div>
                    <div style={{color:"var(--text2)",fontFamily:"'JetBrains Mono',monospace",fontSize:10,wordBreak:"break-all"}}>{fiscal.qr_text}</div>
                  </div>
                )}
                {fiscal.ultimo_error && (
                  <div style={{gridColumn:"1 / -1"}}>
                    <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Ultimo error</div>
                    <div style={{color:"#ef4444"}}>{fiscal.ultimo_error}</div>
                  </div>
                )}
              </div>
              {(fiscalQueueOutcome || ultimoEnvioFiscal?.next_retry_at || ultimoEnvioFiscal?.processed_at) && (
                <div style={{marginTop:12,background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"10px 12px"}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:8}}>Ultimo resultado del canal</div>
                  {fiscalQueueOutcome && (
                    <div style={{fontSize:12,fontWeight:800,color:fiscalQueueOutcome.tone}}>
                      {fiscalQueueOutcome.title}
                    </div>
                  )}
                  {fiscalQueueOutcome?.detail && (
                    <div style={{fontSize:11,color:"var(--text3)",lineHeight:1.5,marginTop:4}}>
                      {fiscalQueueOutcome.detail}
                    </div>
                  )}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:"8px 18px",marginTop:8}}>
                    {ultimoEnvioFiscal?.next_retry_at && (
                      <div>
                        <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Siguiente reintento</div>
                        <div style={{color:"#f59e0b",fontWeight:700}}>{new Date(ultimoEnvioFiscal.next_retry_at).toLocaleString("es-ES")}</div>
                      </div>
                    )}
                    {ultimoEnvioFiscal?.processed_at && (
                      <div>
                        <div style={{color:"var(--text5)",fontSize:10,textTransform:"uppercase",fontWeight:700,letterSpacing:".06em"}}>Procesado en cola</div>
                        <div style={{color:"var(--text2)"}}>{new Date(ultimoEnvioFiscal.processed_at).toLocaleString("es-ES")}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="fiscal-note" style={{marginTop:10,fontSize:10,color:"var(--text5)",lineHeight:1.55}}>
                Este documento incorpora la huella y la trazabilidad fiscal asociada a la factura. Conviene conservar esta referencia junto al PDF final y cualquier justificante vinculado.
              </div>
              {fiscalEventos.length > 0 && (
                <div style={{marginTop:12,background:"var(--bg3)",border:"1px solid #141a28",borderRadius:8,padding:"8px 10px"}}>
                  <div style={{fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)",marginBottom:6}}>Trazabilidad fiscal</div>
                  {fiscalEventos.slice(0,5).map((ev) => (
                    <div key={ev.id} style={{padding:"6px 0",borderTop:"1px solid #0f1520"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:11}}>
                        <span style={{color:"var(--text2)",fontWeight:700}}>{ev.evento_tipo}</span>
                        <span style={{color:"var(--text5)"}}>{new Date(ev.created_at).toLocaleString("es-ES")}</span>
                      </div>
                      {ev.detalle?.detalle && <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{ev.detalle.detalle}</div>}
                      {ev.detalle?.registro_aeat && <div style={{fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>Ref: {ev.detalle.registro_aeat}</div>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* IBAN */}
          {empresa.iban&&<div style={{marginTop:18,paddingTop:14,borderTop:"1px solid #141a28",fontSize:11,color:"var(--text5)"}}><strong style={{color:"var(--text4)"}}>Datos bancarios:</strong> {empresa.iban}{empresa.bic?` - BIC: ${empresa.bic}`:""}{empresa.banco?` - ${empresa.banco}`:""}</div>}
          {empresa.texto_pie&&<div style={{marginTop:10,fontSize:11,color:"var(--text5)",lineHeight:1.6}}>{empresa.texto_pie}</div>}
        </div>
      </div>
    </div>
  );
}

function ModalRectificativa({facturaOriginal, onClose, onSaved}) {
  const empresa   = useEmpresaPerfil();
  const serieRect = empresa.serie_rectificativas || "R";
  const [motivo,   setMotivo]   = useState("");
  const [tipoRect, setTipoRect] = useState("diferencia");
  const [importe,  setImporte]  = useState("");
  const [saving,   setSaving]   = useState(false);

  const MOTIVOS = ["Error en datos fiscales del cliente","IVA aplicado incorrectamente","Importe facturado incorrecto","Servicio no prestado o prestado parcialmente","Devolucion / descuento posterior","Resolucion judicial o administrativa","Otro motivo"];

  async function emitir() {
    if (!motivo) { notify("Indica el motivo de rectificacion", "warning"); return; }
    if (tipoRect==="diferencia"&&!importe) { notify("Indica el importe de la rectificacion", "warning"); return; }
    setSaving(true);
    try {
      const data = {
        cliente_id:             facturaOriginal.cliente_id,
        serie:                  serieRect,
        fecha:                  new Date().toISOString().slice(0,10),
        estado:                 "emitida",
        factura_original_id:    facturaOriginal.id,
        factura_original_numero:facturaOriginal.numero,
        motivo_rectificacion:   motivo,
        tipo_rectificacion:     tipoRect,
        observaciones:`FACTURA RECTIFICATIVA. Rectifica la factura ${facturaOriginal.numero}. Motivo: ${motivo}`,
        lineas: tipoRect==="diferencia"
          ? [{concepto:`Rectificacion factura ${facturaOriginal.numero} - ${motivo}`,cantidad:1,precio_unit:parseFloat(importe)}]
          : [{concepto:`Anulacion total factura ${facturaOriginal.numero}`,cantidad:1,precio_unit:-(parseFloat(facturaOriginal.base_imponible)||0)}],
        pedidos_ids: facturaOriginal.pedidos_ids || [],
      };
      await crearRectificativa(data);
      const cambioEstado = await cambiarEstadoFactura(facturaOriginal.id, "rectificada");
      broadcastFacturasChanged(normalizarDetalleCambioFactura(cambioEstado, {
        factura_id: facturaOriginal.id,
        estado_nuevo: "rectificada",
        pedido_estado_aplicado: "facturado",
      }));
      onSaved();
    } catch(e) { notify("Error: "+e.message, "error"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{...S.modal,zIndex:300}} onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid rgba(249,115,22,.3)",borderRadius:14,padding:26,width:"min(540px,96vw)",maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{fontFamily:"'Syne',sans-serif",fontSize:16,fontWeight:700,color:"#f97316",marginBottom:6}}>Factura rectificativa</div>
        <div style={{fontSize:12,color:"var(--text3)",marginBottom:16}}>Rectifica: <strong style={{color:"var(--text2)"}}>{facturaOriginal.numero}</strong> - {facturaOriginal.cliente_nombre} - {fmt2(facturaOriginal.total)} EUR</div>

        <div style={{background:"rgba(249,115,22,.07)",border:"1px solid rgba(249,115,22,.15)",borderRadius:8,padding:"9px 14px",fontSize:11,color:"#9a6030",marginBottom:16,lineHeight:1.6}}>
          <strong>RD 1619/2012 Art. 15:</strong> La rectificativa lleva la serie <strong>{serieRect}</strong>, numeracion correlativa propia, e identifica expresamente la factura original. El motivo es obligatorio segun la AEAT.
        </div>

        <div>
          <label style={S.lbl}>Motivo de rectificacion * (AEAT)</label>
          <select value={motivo} onChange={e=>setMotivo(e.target.value)} style={{...S.inp,background:"var(--bg4)"}}>
            <option value="">Seleccionar...</option>
            {MOTIVOS.map(m=><option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div style={{marginTop:12}}>
          <label style={S.lbl}>Tipo de rectificacion</label>
          <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap"}}>
            {[{v:"diferencia",l:"Por diferencia"},{v:"sustitucion",l:"Por sustitucion (anulacion total)"}].map(opt=>(
              <label key={opt.v} style={{display:"flex",alignItems:"center",gap:7,cursor:"pointer",padding:"7px 12px",borderRadius:7,border:`1px solid ${tipoRect===opt.v?"#f97316":"var(--border2)"}`,background:tipoRect===opt.v?"rgba(249,115,22,.1)":"transparent",fontSize:12,color:tipoRect===opt.v?"#f97316":"var(--text3)"}}>
                <input type="radio" value={opt.v} checked={tipoRect===opt.v} onChange={()=>setTipoRect(opt.v)} style={{accentColor:"#f97316"}}/>
                {opt.l}
              </label>
            ))}
          </div>
        </div>

        {tipoRect==="diferencia"&&(
          <div>
            <label style={S.lbl}>Importe de la rectificacion (EUR)</label>
            <input type="number" step="0.01" style={S.inp} value={importe} onChange={e=>setImporte(e.target.value)} placeholder="Ej: -50.00 (negativo = reducir importe)"/>
            <div style={{fontSize:10,color:"var(--text5)",marginTop:3}}>Negativo = devolver/reducir / Positivo = cargo adicional</div>
          </div>
        )}
        {tipoRect==="sustitucion"&&(
          <div style={{background:"rgba(59,130,246,.07)",border:"1px solid rgba(59,130,246,.15)",borderRadius:8,padding:"9px 14px",marginTop:12,fontSize:12,color:"#5a7ab8"}}>
            Se emitira una rectificativa por -{fmt2(facturaOriginal.base_imponible)} EUR (base) que anula la factura original completa.
          </div>
        )}

        <div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}>
          <button style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid #1e2d45"}} onClick={onClose}>Cancelar</button>
          <button style={{...S.btn,background:"rgba(249,115,22,.2)",color:"#f97316",border:"1px solid rgba(249,115,22,.4)"}} onClick={emitir} disabled={saving}>
            {saving?"Emitiendo...":"Emitir rectificativa"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Modal: Facturar multiples pedidos de un cliente
function ModalFacturarMultiple({ onClose }) {
  const empresa  = useEmpresaPerfil();
  const [clientes,   setClientes]   = useState([]);
  const [clienteSel, setClienteSel] = useState("");
  const [pedidos,    setPedidos]    = useState([]);
  const [resumenClientes, setResumenClientes] = useState([]);
  const [selIds,     setSelIds]     = useState(new Set());
  const [modo,       setModo]       = useState("linea"); // linea|detalle|kg
  const [concepto,   setConcepto]   = useState("");
  const [loading,    setLoading]    = useState(false);
  const [loadingResumen, setLoadingResumen] = useState(false);
  const [saving,     setSaving]     = useState(false);
  const [paso,       setPaso]       = useState(1);
  const [lineasEdit, setLineasEdit] = useState([]);
  const [confirmCantidades, setConfirmCantidades] = useState(false);
  const [confirmReferencias, setConfirmReferencias] = useState(false);
  const [confirmAlbaranes, setConfirmAlbaranes] = useState(false);
  const [refEdit, setRefEdit] = useState(null);

  const hoy = new Date();
  const [fechaDesde, setFechaDesde] = useState(new Date(hoy.getFullYear(),hoy.getMonth(),1).toISOString().slice(0,10));
  const [fechaHasta, setFechaHasta] = useState(new Date(hoy.getFullYear(),hoy.getMonth()+1,0).toISOString().slice(0,10));
  useEffect(()=>{
    getClientes().then(d=>setClientes(Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[])).catch(()=>{});
  },[]);

  const pedidoFacturableEnPeriodo = useCallback((p) => {
    const tieneFacturaDefinitiva = p.factura_id && p.factura_estado !== "borrador";
    if (tieneFacturaDefinitiva) return false;
    if (p.estado !== "entregado") return false;
    const f = p.fecha_carga || p.fecha_pedido || "";
    return (!fechaDesde || f >= fechaDesde) && (!fechaHasta || f <= fechaHasta);
  }, [fechaDesde, fechaHasta]);

  useEffect(()=>{
    setLoadingResumen(true);
    getPedidos({desde:fechaDesde, hasta:fechaHasta, facturado:"false", limit:1000}).then(d=>{
      const arr = (Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : []).filter(pedidoFacturableEnPeriodo);
      const by = new Map();
      arr.forEach(p => {
        const key = p.cliente_id || "sin-cliente";
        const prev = by.get(key) || {
          cliente_id: p.cliente_id || "",
          cliente_nombre: p.cliente_nombre || "Sin cliente",
          pedidos: [],
          total: 0,
          kg: 0,
        };
        prev.pedidos.push(p);
        prev.total += Number(p.importe || 0);
        prev.kg += Number(p.peso_kg || p.kg || 0);
        by.set(key, prev);
      });
      setResumenClientes([...by.values()].sort((a,b) => b.total - a.total || a.cliente_nombre.localeCompare(b.cliente_nombre)));
    }).catch(()=>setResumenClientes([])).finally(()=>setLoadingResumen(false));
  },[fechaDesde, fechaHasta, pedidoFacturableEnPeriodo]);

  useEffect(()=>{
    if (!clienteSel) { setPedidos([]); return; }
    setLoading(true);
    getPedidos({cliente_id:clienteSel, desde:fechaDesde, hasta:fechaHasta, facturado:"false", limit:1000}).then(d=>{
      const arr = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
      // Facturable: entregado y sin factura definitiva. Los borradores automaticos se pueden reagrupar.
      const filt = arr.filter(pedidoFacturableEnPeriodo);
      setPedidos(filt);
      setSelIds(new Set(filt.map(p=>p.id)));
    }).catch(()=>{}).finally(()=>setLoading(false));
  },[clienteSel, fechaDesde, fechaHasta, pedidoFacturableEnPeriodo]);

  useEffect(()=>{
    const fmtD = d => d ? new Date(d).toLocaleDateString("es-ES",{day:"2-digit",month:"long",year:"numeric"}).toUpperCase() : "";
    setConcepto(`VIAJES REALIZADOS DEL ${fmtD(fechaDesde)} AL ${fmtD(fechaHasta)}`);
  },[fechaDesde, fechaHasta]);

  const selArr   = pedidos.filter(p=>selIds.has(p.id));
  const totalSel = selArr.reduce((s,p)=>s+Number(p.importe||0),0);
  const totalKg  = selArr.reduce((s,p)=>s+Number(p.peso_kg||p.kg||0),0);
  const fmtN = n => Number(n||0).toLocaleString("es-ES",{maximumFractionDigits:0});
  const tieneReferenciaCliente = p => String(p.referencia_cliente || p.ref_cliente || p.referencia_factura || "").trim().length > 0;
  const documentosPedido = p => Number(p.albaranes_count ?? p.albaran_count ?? p.documentos_count ?? p.docs_count ?? 0) || 0;
  const tieneSoportePedido = p => documentosPedido(p) > 0 || p.tiene_albaran === true || p.albaran_subido === true || Boolean(p.albaran_url || p.documento_control_url);

  function toggleSel(id){ setSelIds(p=>{ const n=new Set(p); n.has(id)?n.delete(id):n.add(id); return n; }); }
  function toggleAll(){ selIds.size===pedidos.length ? setSelIds(new Set()) : setSelIds(new Set(pedidos.map(p=>p.id))); }

  function buildLineas(){
    const cliente = clientes.find(c=>c.id===clienteSel);
    const modoFact = modo || cliente?.modo_facturacion || "linea";
    if (modoFact==="agrupada_linea" || modo==="linea") {
      return [{ concepto, cantidad:1, precio_unit: totalSel }];
    }
    if (modoFact==="agrupada_kg" || modo==="kg") {
      // Group by tarifa (precio_unitario)
      const tarifas = {};
      selArr.forEach(p=>{
        const t = p.precio_unitario||0;
        const k = String(t);
        if (!tarifas[k]) tarifas[k]={ tarifa:t, kg:0, importes:0, n:0 };
        tarifas[k].kg    += Number(p.peso_kg||p.kg||0);
        tarifas[k].importes += Number(p.importe||0);
        tarifas[k].n++;
      });
      return Object.values(tarifas).map(t=>({
        concepto: t.tarifa>0
          ? `Transporte ${fmtN(t.kg)} kg a ${fmt2(t.tarifa)} EUR/tn (${t.n} viajes)`
          : `Transporte - ${t.n} viajes`,
        cantidad: t.tarifa>0 ? t.kg/1000 : 1,
        precio_unit: t.tarifa>0 ? t.tarifa : t.importes,
      }));
    }
    // detalle: one line per pedido
    return selArr.map(p=>({
      concepto: `${p.numero}${p.referencia_cliente ? " / Ref. "+p.referencia_cliente : ""} - ${p.origen||""}${p.destino?" -> "+p.destino:""} (${p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"-"})`,
      cantidad: 1,
      precio_unit: Number(p.importe||0),
    }));
  }

  useEffect(() => {
    setLineasEdit(buildLineas().map((l, idx) => ({ ...l, id: `linea-${idx}` })));
    setConfirmCantidades(false);
    setConfirmReferencias(false);
    setConfirmAlbaranes(false);
  // buildLineas depende del estado actual del modal; estos deps cubren los cambios que regeneran el borrador.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clienteSel, fechaDesde, fechaHasta, modo, concepto, pedidos, selIds]);

  function updateLineaFactura(idx, key, value) {
    setLineasEdit(prev => prev.map((linea, i) => i === idx ? { ...linea, [key]: key === "concepto" ? value : value } : linea));
    setConfirmCantidades(false);
  }

  async function guardarReferenciaPedido() {
    if (!refEdit?.pedido?.id) return;
    try {
      const referencia = String(refEdit.referencia || "").trim();
      const actualizado = await editarPedido(refEdit.pedido.id, { referencia_cliente: referencia || null });
      setPedidos(prev => prev.map(p => p.id === refEdit.pedido.id ? { ...p, ...actualizado, referencia_cliente: referencia } : p));
      setConfirmReferencias(false);
      setRefEdit(null);
      notify("Referencia del pedido actualizada.", "success");
    } catch (e) {
      notify(e.message || "No se pudo actualizar la referencia del pedido.", "error");
    }
  }

  const lineasValidas = lineasEdit
    .map(l => ({
      concepto: String(l.concepto || "").trim(),
      cantidad: Number(String(l.cantidad || 0).replace(",", ".")) || 0,
      precio_unit: Number(String(l.precio_unit || 0).replace(",", ".")) || 0,
    }))
    .filter(l => l.concepto && l.cantidad !== 0);
  const totalLineasEdit = lineasValidas.reduce((s,l)=>s+(Number(l.cantidad||0)*Number(l.precio_unit||0)),0);
  const pedidosSinReferencia = selArr.filter(p => !tieneReferenciaCliente(p));
  const pedidosSinSoporte = selArr.filter(p => !tieneSoportePedido(p));
  const pedidosImporteCero = selArr.filter(p => Number(p.importe || 0) <= 0);
  const diferenciaLineas = Math.abs(totalLineasEdit - totalSel);
  const revisionFacturacion = [
    pedidosSinReferencia.length ? `${pedidosSinReferencia.length} pedido(s) sin referencia de cliente` : null,
    pedidosSinSoporte.length ? `${pedidosSinSoporte.length} pedido(s) sin albaran/documento adjunto detectado` : null,
    pedidosImporteCero.length ? `${pedidosImporteCero.length} pedido(s) con importe cero o negativo` : null,
    diferenciaLineas > 0.01 ? `El total editado difiere ${fmt2(diferenciaLineas)} EUR del total de pedidos` : null,
  ].filter(Boolean);
  const listoParaBorrador = clienteSel && selArr.length > 0 && lineasValidas.length > 0 && confirmCantidades && confirmReferencias && confirmAlbaranes;

  async function emitir(){
    if (!clienteSel)     { notify("Selecciona un cliente", "warning"); return; }
    if (selArr.length===0){ notify("Selecciona al menos un pedido", "warning"); return; }
    if (!listoParaBorrador) { notify("Completa la revision previa de cantidades, referencias y albaranes.", "warning"); setPaso(4); return; }
    setSaving(true);
    try {
      const lineas = lineasValidas;
      const created = await crearFactura({
        cliente_id:  clienteSel,
        serie:       empresa.serie_facturas||"A",
        fecha:       new Date().toISOString().slice(0,10),
        estado:      "borrador",
        pedidos_ids: selArr.map(p=>p.id),
        lineas,
        observaciones: `Periodo ${fechaDesde} - ${fechaHasta}. ${selArr.length} viajes.`,
      });
      broadcastFacturasChanged(normalizarDetalleCambioFactura(created, {
        factura_id: created?.id || null,
        estado_nuevo: "borrador",
        pedido_estado_aplicado: "entregado",
        pedido_ids_afectados: selArr.map(p=>p.id),
      }));
      notify(`Borrador creado con ${lineas.length} linea(s) por ${fmt2(totalLineasEdit)} EUR`, "success");
      onClose();
    } catch(e){ notify("Error: "+e.message, "error"); }
    finally { setSaving(false); }
  }

  const inp = {background:"var(--bg4)",border:"1px solid var(--border2)",color:"var(--text)",padding:"7px 10px",borderRadius:7,fontFamily:"'DM Sans',sans-serif",fontSize:13,outline:"none",width:"100%",boxSizing:"border-box"};
  const lbl = {display:"block",fontSize:10,fontWeight:700,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:3,marginTop:10};
  const th  = {textAlign:"left",padding:"7px 10px",fontSize:10,fontWeight:700,textTransform:"uppercase",color:"var(--text5)",borderBottom:"1px solid var(--border)",background:"var(--bg3)"};
  const td  = {padding:"7px 10px",borderBottom:"1px solid var(--border2)",fontSize:12,color:"var(--text2)"};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.85)",zIndex:300,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}
      onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div style={{background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:14,padding:22,width:"min(760px,96vw)",maxHeight:"93vh",overflowY:"auto"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:16,color:"var(--text)"}}>Facturar pedidos de cliente</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"var(--text4)",fontSize:14,cursor:"pointer"}}>Cerrar</button>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6,marginBottom:14}}>
          {[
            [1,"Cliente y periodo"],
            [2,"Viajes"],
            [3,"Lineas"],
            [4,"Confirmacion"],
          ].map(([n,label])=>(
            <button key={n} type="button" onClick={()=>setPaso(n)} style={{padding:"7px 8px",borderRadius:8,border:`1px solid ${paso===n?"var(--green)":"var(--border2)"}`,background:paso===n?"rgba(16,185,129,.12)":"var(--bg3)",color:paso===n?"var(--green)":"var(--text4)",fontSize:11,fontWeight:800,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>
              {n}. {label}
            </button>
          ))}
        </div>

        {/* Seleccion cliente + periodo */}
        {paso===1 && <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:14}}>
          <div>
            <label style={lbl}>Cliente *</label>
            <select value={clienteSel} onChange={e=>setClienteSel(e.target.value)} style={inp}>
              <option value="">Seleccionar cliente...</option>
              {clientes.map(c=><option key={c.id} value={c.id}>{c.nombre}{c.cif?" - "+c.cif:""}</option>)}
            </select>
          </div>
          <div>
            <label style={lbl}>Periodo desde</label>
            <input type="date" style={inp} value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)}/>
          </div>
          <div>
            <label style={lbl}>Hasta</label>
            <input type="date" style={inp} value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)}/>
          </div>
        </div>}

        {paso===1 && <div style={{marginBottom:14,border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",background:"var(--bg3)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:"8px 10px",borderBottom:"1px solid var(--border)"}}>
            <div>
              <div style={{fontSize:11,fontWeight:800,color:"var(--text3)",textTransform:"uppercase",letterSpacing:".06em"}}>Pedidos pendientes por cliente</div>
              <div style={{fontSize:11,color:"var(--text5)"}}>Selecciona un cliente para desplegar sus viajes facturables del periodo.</div>
            </div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:800,color:"var(--green)"}}>
              {resumenClientes.reduce((s,c)=>s+c.pedidos.length,0)} viajes
            </div>
          </div>
          {loadingResumen ? (
            <div style={{padding:12,textAlign:"center",color:"var(--text5)",fontSize:12}}>Cargando resumen...</div>
          ) : resumenClientes.length === 0 ? (
            <div style={{padding:12,textAlign:"center",color:"var(--text5)",fontSize:12}}>Sin pedidos entregados pendientes de facturar en este periodo</div>
          ) : (
            <div style={{maxHeight:190,overflowY:"auto"}}>
              {resumenClientes.map(g => {
                const active = String(clienteSel || "") === String(g.cliente_id || "");
                return (
                  <button
                    key={g.cliente_id || g.cliente_nombre}
                    type="button"
                    onClick={()=>{ setClienteSel(g.cliente_id); setPaso(2); }}
                    style={{
                      width:"100%",
                      display:"grid",
                      gridTemplateColumns:"1fr auto auto",
                      gap:10,
                      alignItems:"center",
                      textAlign:"left",
                      padding:"9px 10px",
                      border:0,
                      borderBottom:"1px solid var(--border2)",
                      background:active ? "rgba(16,185,129,.10)" : "transparent",
                      color:"var(--text2)",
                      cursor:g.cliente_id ? "pointer" : "default",
                      fontFamily:"'DM Sans',sans-serif",
                    }}
                    disabled={!g.cliente_id}
                  >
                    <span style={{fontWeight:800,color:active ? "var(--green)" : "var(--text)"}}>
                      {active ? "Abierto - " : ""}{g.cliente_nombre}
                    </span>
                    <span style={{fontSize:12,color:"var(--text4)"}}>{g.pedidos.length} pedido(s)</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:800,color:"var(--green)"}}>{fmt2(g.total)} EUR</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>}

        {/* Modo factura */}
        {paso===2 && <div style={{marginBottom:12}}>
          <label style={lbl}>Formato de la factura</label>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {[
              ["linea",   "Una sola linea",     "Un concepto global con importe total"],
              ["detalle", "Linea por viaje",     "Una linea por cada pedido con detalle"],
              ["kg",      "Agrupado por kg/tarifa","Agrupa por tarifa, muestra kg y precio/tn"],
            ].map(([v,l,d])=>(
              <button key={v} onClick={()=>setModo(v)}
                style={{padding:"6px 14px",borderRadius:8,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:600,
                  background:modo===v?"var(--accent)":"var(--bg3)",
                  border:`1.5px solid ${modo===v?"var(--accent)":"var(--border)"}`,
                  color:modo===v?"#fff":"var(--text3)"}}>
                <div>{l}</div>
                <div style={{fontSize:10,fontWeight:400,color:modo===v?"rgba(255,255,255,.82)":"var(--text5)",marginTop:1}}>{d}</div>
              </button>
            ))}
          </div>
        </div>}

        {/* Concepto (solo modo linea) */}
        {paso===2 && modo==="linea" && (
          <div style={{marginBottom:12}}>
            <label style={lbl}>Concepto de la factura</label>
            <textarea value={concepto} onChange={e=>setConcepto(e.target.value)}
              style={{...inp,minHeight:52,resize:"vertical"}}/>
          </div>
        )}

        {/* Lista pedidos */}
        {paso===2 && clienteSel && (
          <>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <div style={{fontSize:12,fontWeight:700,color:"var(--text4)",textTransform:"uppercase",letterSpacing:".06em"}}>
                Pedidos entregados pendientes de emitir ({pedidos.length})
              </div>
              <button onClick={toggleAll} style={{fontSize:11,padding:"3px 10px",borderRadius:5,border:"1px solid var(--border)",background:"var(--bg3)",color:"var(--text3)",cursor:"pointer",fontFamily:"'DM Sans',sans-serif",fontWeight:600}}>
                {selIds.size===pedidos.length?"Deseleccionar todo":"Seleccionar todo"}
              </button>
            </div>

            {loading ? (
              <div style={{padding:20,textAlign:"center",color:"var(--text5)"}}>Cargando pedidos...</div>
            ) : pedidos.length===0 ? (
              <div style={{padding:20,textAlign:"center",color:"var(--text5)",background:"var(--bg3)",borderRadius:8}}>
                Sin pedidos entregados pendientes de emitir para este cliente en el periodo seleccionado
              </div>
            ) : (
              <div style={{border:"1px solid var(--border)",borderRadius:8,overflow:"hidden",marginBottom:14,maxHeight:280,overflowY:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse"}}>
                  <thead style={{position:"sticky",top:0,zIndex:2}}>
                    <tr>
                      <th style={{...th,width:32}}><input type="checkbox" checked={selIds.size===pedidos.length} onChange={toggleAll}/></th>
                      <th style={th}>No. Pedido</th><th style={th}>Fecha</th><th style={th}>Origen -> Destino</th>
                      <th style={th}>Ref.</th><th style={th}>Docs</th><th style={th}>Kg</th><th style={th}>Importe</th><th style={th}>Factura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pedidos.map(p=>(
                      <tr key={p.id} onClick={()=>toggleSel(p.id)} style={{cursor:"pointer",background:selIds.has(p.id)?"rgba(59,130,246,.06)":"transparent"}}>
                        <td style={{...td,textAlign:"center"}}><input type="checkbox" checked={selIds.has(p.id)} onChange={()=>toggleSel(p.id)} onClick={e=>e.stopPropagation()}/></td>
                        <td style={{...td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--accent)",fontSize:11}}>{p.numero}</td>
                        <td style={{...td,fontSize:11}}>{p.fecha_carga?new Date(p.fecha_carga).toLocaleDateString("es-ES"):"-"}</td>
                        <td style={{...td,fontSize:11}}>{p.origen||""}{p.destino?" -> "+p.destino:""}</td>
                        <td style={{...td,fontSize:11}}>
                          {tieneReferenciaCliente(p) ? (
                            <button
                              type="button"
                              onClick={e=>{e.stopPropagation();setRefEdit({ pedido:p, referencia:p.referencia_cliente || p.ref_cliente || p.referencia_factura || "" });}}
                              title="Editar referencia del cliente"
                              style={{display:"inline-flex",padding:"2px 7px",borderRadius:5,background:"rgba(16,185,129,.10)",color:"var(--green)",fontWeight:800,border:"1px solid rgba(16,185,129,.20)",cursor:"pointer"}}
                            >OK</button>
                          ) : (
                            <button
                              type="button"
                              onClick={e=>{e.stopPropagation();setRefEdit({ pedido:p, referencia:"" });}}
                              title="Añadir referencia del cliente"
                              style={{display:"inline-flex",padding:"2px 7px",borderRadius:5,background:"rgba(245,158,11,.12)",color:"#f59e0b",fontWeight:800,border:"1px solid rgba(245,158,11,.25)",cursor:"pointer"}}
                            >Falta</button>
                          )}
                        </td>
                        <td style={{...td,fontSize:11}}>
                          {tieneSoportePedido(p) ? (
                            <span style={{display:"inline-flex",padding:"2px 7px",borderRadius:5,background:"rgba(16,185,129,.10)",color:"var(--green)",fontWeight:800}}>{documentosPedido(p) || "OK"}</span>
                          ) : (
                            <span style={{display:"inline-flex",padding:"2px 7px",borderRadius:5,background:"rgba(239,68,68,.10)",color:"#ef4444",fontWeight:800}}>No</span>
                          )}
                        </td>
                        <td style={{...td,fontSize:11,textAlign:"right"}}>{fmtN(p.peso_kg||p.kg||0)}</td>
                        <td style={{...td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--green)",textAlign:"right"}}>{fmt2(p.importe||0)} EUR</td>
                        <td style={{...td,fontSize:11}}>
                          {p.factura_estado==="borrador" ? (
                            <span style={{display:"inline-flex",padding:"2px 7px",borderRadius:5,background:"rgba(245,158,11,.12)",color:"#f59e0b",fontWeight:700}}>
                              Borrador {p.factura_numero || ""}
                            </span>
                          ) : (
                            <span style={{color:"var(--text5)"}}>Pendiente</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Preview de lineas */}
            {false && selArr.length>0 && (
              <div style={{background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.2)",borderRadius:9,padding:"12px 16px",marginBottom:14}}>
                <div style={{fontWeight:700,fontSize:12,color:"#10b981",marginBottom:8,textTransform:"uppercase",letterSpacing:".06em"}}>
                  Preview - {buildLineas().length} linea(s) en la factura
                </div>
                {buildLineas().map((l,i)=>(
                  <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid rgba(16,185,129,.1)",fontSize:12,color:"var(--text2)"}}>
                    <span style={{flex:1,paddingRight:12}}>{l.concepto}</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--green)",whiteSpace:"nowrap"}}>{fmt2(l.cantidad*l.precio_unit)} EUR</span>
                  </div>
                ))}
                <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:6,borderTop:"2px solid rgba(16,185,129,.3)"}}>
                  <div style={{fontSize:12,color:"var(--text4)"}}>
                    {selArr.length} viaje(s) - {fmtN(totalKg)} kg - {modo==="linea"?"1 linea":`${buildLineas().length} lineas`}
                  </div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:"var(--green)"}}>{fmt2(totalSel)} EUR</div>
                </div>
              </div>
            )}
          </>
        )}

        {paso===3 && (
          <div style={{background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.2)",borderRadius:9,padding:"12px 16px",marginBottom:14}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:10,alignItems:"center",marginBottom:10}}>
              <div>
                <div style={{fontWeight:800,fontSize:12,color:"#10b981",textTransform:"uppercase",letterSpacing:".06em"}}>Revision de lineas de factura</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Ajusta conceptos, cantidades o importes antes de crear el borrador.</div>
              </div>
              <button type="button" onClick={()=>setLineasEdit(prev=>[...prev,{id:`extra-${Date.now()}`,concepto:"Concepto adicional",cantidad:1,precio_unit:0}])} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.24)",padding:"5px 8px"}}>Anadir linea</button>
            </div>
            <div style={{display:"grid",gap:8}}>
              {lineasEdit.map((l,i)=>(
                <div key={l.id || i} style={{display:"grid",gridTemplateColumns:"1fr 90px 120px 34px",gap:8,alignItems:"center"}}>
                  <input value={l.concepto || ""} onChange={e=>updateLineaFactura(i,"concepto",e.target.value)} style={inp} />
                  <input value={l.cantidad ?? ""} onChange={e=>updateLineaFactura(i,"cantidad",e.target.value)} style={{...inp,textAlign:"right"}} />
                  <input value={l.precio_unit ?? ""} onChange={e=>updateLineaFactura(i,"precio_unit",e.target.value)} style={{...inp,textAlign:"right"}} />
                  <button type="button" onClick={()=>setLineasEdit(prev=>prev.filter((_,idx)=>idx!==i))} style={{...S.btn,padding:"7px 9px",background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.24)"}}>x</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12,paddingTop:8,borderTop:"1px solid rgba(16,185,129,.2)"}}>
              <div style={{fontSize:12,color:"var(--text4)"}}>{selArr.length} viaje(s) - {fmtN(totalKg)} kg - {lineasValidas.length} linea(s)</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:18,color:"var(--green)"}}>{fmt2(totalLineasEdit)} EUR</div>
            </div>
          </div>
        )}

        {paso===4 && (
          <div style={{border:"1px solid var(--border)",borderRadius:9,padding:14,background:"var(--bg3)",marginBottom:14}}>
            <div style={{fontWeight:800,fontSize:13,color:"var(--text)",marginBottom:4}}>Control previo antes de facturar</div>
            <div style={{fontSize:11,color:"var(--text5)",marginBottom:12}}>Este paso evita devoluciones por referencias, albaranes o importes incorrectos.</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:12}}>
              {[
                ["Pedidos", selArr.length, "var(--accent)", "rgba(59,130,246,.10)"],
                ["Referencias pendientes", pedidosSinReferencia.length, pedidosSinReferencia.length ? "#f59e0b" : "var(--green)", pedidosSinReferencia.length ? "rgba(245,158,11,.12)" : "rgba(16,185,129,.10)"],
                ["Sin albaran/doc", pedidosSinSoporte.length, pedidosSinSoporte.length ? "#ef4444" : "var(--green)", pedidosSinSoporte.length ? "rgba(239,68,68,.10)" : "rgba(16,185,129,.10)"],
                ["Diferencia", `${fmt2(diferenciaLineas)} EUR`, diferenciaLineas > 0.01 ? "#f59e0b" : "var(--green)", diferenciaLineas > 0.01 ? "rgba(245,158,11,.12)" : "rgba(16,185,129,.10)"],
              ].map(([label,value,color,bg])=>(
                <div key={label} style={{border:"1px solid var(--border2)",borderRadius:8,padding:"8px 10px",background:bg}}>
                  <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{label}</div>
                  <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:900,color,marginTop:3}}>{value}</div>
                </div>
              ))}
            </div>
            {revisionFacturacion.length > 0 ? (
              <div style={{border:"1px solid rgba(245,158,11,.28)",background:"rgba(245,158,11,.08)",borderRadius:8,padding:"9px 10px",marginBottom:12}}>
                <div style={{fontSize:11,fontWeight:800,color:"#f59e0b",textTransform:"uppercase",letterSpacing:".06em",marginBottom:5}}>Puntos a revisar</div>
                <ul style={{margin:"0 0 0 16px",padding:0,color:"var(--text3)",fontSize:12,lineHeight:1.45}}>
                  {revisionFacturacion.map((aviso,idx)=><li key={idx}>{aviso}</li>)}
                </ul>
              </div>
            ) : (
              <div style={{border:"1px solid rgba(16,185,129,.22)",background:"rgba(16,185,129,.08)",borderRadius:8,padding:"9px 10px",marginBottom:12,color:"var(--green)",fontSize:12,fontWeight:800}}>
                Revision automatica sin incidencias detectadas.
              </div>
            )}
            <div style={{display:"grid",gap:8}}>
              <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,color:"var(--text3)"}}>
                <input type="checkbox" checked={confirmCantidades} onChange={e=>setConfirmCantidades(e.target.checked)} />
                <span>He revisado cantidades, precios e IVA de las lineas. Total previsto: <strong>{fmt2(totalLineasEdit)} EUR</strong>.</span>
              </label>
              <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,color:"var(--text3)"}}>
                <input type="checkbox" checked={confirmReferencias} onChange={e=>setConfirmReferencias(e.target.checked)} />
                <span>Las referencias del cliente y el periodo de factura son correctos.</span>
              </label>
              <label style={{display:"flex",gap:8,alignItems:"flex-start",fontSize:13,color:"var(--text3)"}}>
                <input type="checkbox" checked={confirmAlbaranes} onChange={e=>setConfirmAlbaranes(e.target.checked)} />
                <span>Albaranes/soportes revisados o marcados como pendientes asumidos antes de emitir.</span>
              </label>
            </div>
          </div>
        )}

        {refEdit && (
          <div style={{position:"fixed",inset:0,zIndex:3000,background:"rgba(15,23,42,.42)",display:"flex",alignItems:"center",justifyContent:"center",padding:16}} onClick={e=>e.target===e.currentTarget&&setRefEdit(null)}>
            <div style={{width:"min(420px,96vw)",background:"var(--bg2)",border:"1px solid var(--border2)",borderRadius:12,boxShadow:"0 24px 64px rgba(15,23,42,.28)",padding:18}}>
              <div style={{fontFamily:"'Syne',sans-serif",fontSize:17,fontWeight:800,color:"var(--text)",marginBottom:6}}>Referencia cliente</div>
              <div style={{fontSize:12,color:"var(--text4)",lineHeight:1.4,marginBottom:12}}>
                Pedido {refEdit.pedido?.numero || "-"} · {refEdit.pedido?.origen || "-"} -&gt; {refEdit.pedido?.destino || "-"}
              </div>
              <label style={{display:"block",fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)",marginBottom:5}}>Referencia</label>
              <input
                autoFocus
                value={refEdit.referencia || ""}
                onChange={e=>setRefEdit(prev=>({...prev,referencia:e.target.value}))}
                onKeyDown={e=>{ if (e.key === "Enter") guardarReferenciaPedido(); if (e.key === "Escape") setRefEdit(null); }}
                style={{...inp,width:"100%"}}
                placeholder="Referencia / pedido del cliente"
              />
              <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:16}}>
                <button type="button" onClick={()=>setRefEdit(null)} style={{...S.btn,background:"transparent",color:"var(--text3)",border:"1px solid var(--border2)"}}>Cancelar</button>
                <button type="button" onClick={guardarReferenciaPedido} style={{...S.btn,background:"var(--accent)",color:"#fff",border:"1px solid var(--accent)"}}>Guardar referencia</button>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 18px",borderRadius:7,border:"1px solid var(--border2)",background:"transparent",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            Cancelar
          </button>
          {paso>1 && <button onClick={()=>setPaso(p=>Math.max(1,p-1))} style={{padding:"8px 18px",borderRadius:7,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text3)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:600,cursor:"pointer"}}>
            Anterior
          </button>}
          {paso<4 ? (
            <button onClick={()=>setPaso(p=>Math.min(4,p+1))} disabled={(paso===1&&!clienteSel)||(paso===2&&selArr.length===0)}
              style={{padding:"8px 20px",borderRadius:7,border:"none",background:((paso!==1||clienteSel)&&(paso!==2||selArr.length>0))?"var(--green)":"var(--bg4)",color:((paso!==1||clienteSel)&&(paso!==2||selArr.length>0))?"#fff":"var(--text5)",fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              Siguiente
            </button>
          ) : <button onClick={emitir} disabled={saving||!listoParaBorrador}
            style={{padding:"8px 20px",borderRadius:7,border:"none",background:listoParaBorrador?"var(--green)":"var(--bg4)",color:listoParaBorrador?"#fff":"var(--text5)",
              fontFamily:"'DM Sans',sans-serif",fontSize:13,fontWeight:700,cursor:saving||selArr.length===0?"not-allowed":"pointer",opacity:saving?0.7:1}}>
            {saving?"Creando borrador...":"Crear borrador revisado"}
          </button>}
        </div>
      </div>
    </div>
  );
}

function readFacturacionFocus() {
  return readRuntimeFocus("tms_facturacion_focus");
}

function monthBounds(value = new Date()) {
  const d = value instanceof Date ? value : new Date(`${value}-01T00:00:00`);
  const year = d.getFullYear();
  const month = d.getMonth();
  return {
    monthValue: `${year}-${String(month + 1).padStart(2, "0")}`,
    desde: `${year}-${String(month + 1).padStart(2, "0")}-01`,
    hasta: `${year}-${String(month + 1).padStart(2, "0")}-${String(new Date(year, month + 1, 0).getDate()).padStart(2, "0")}`,
  };
}

export default function Facturacion() {
  const { puedeEditar } = useAuth();
  const canEdit           = puedeEditar("facturas");
  const [activeFacturacionTab, setActiveFacturacionTab] = useState("facturas");
  const [focusFactura]    = useState(() => readFacturacionFocus());
  const [facturas,     setFacturas]     = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [filtro,       setFiltro]       = useState(() => focusFactura?.estado || "todos");
  const defaultMonth = monthBounds();
  const [periodoMes, setPeriodoMes] = useState(defaultMonth.monthValue);
  const [fechaDesde, setFechaDesde] = useState(defaultMonth.desde);
  const [fechaHasta, setFechaHasta] = useState(defaultMonth.hasta);
  const [filtroFechasCustom, setFiltroFechasCustom] = useState(false);
  const [agruparCliente, setAgruparCliente] = useState(true);
  const [clientesAbiertos, setClientesAbiertos] = useState({});
  const [fiscalEstadoFiltro, setFiscalEstadoFiltro] = useState("todos");
  const [fiscalModoFiltro, setFiscalModoFiltro] = useState("todos");
  const [busqueda,     setBusqueda]     = useState(() => focusFactura?.numero || "");
  const [page,         setPage]         = useState(1);
  const [totalPages,   setTotalPages]   = useState(1);
  const [totalCount,   setTotalCount]   = useState(0);
  const PAGE_SIZE = 50;
  const [vistaFact,    setVistaFact]    = useState(null);
  const [modalRect,    setModalRect]    = useState(null);
  const [modalMulti,   setModalMulti]   = useState(false); // facturar multiples pedidos de un cliente
  const [clientes,     setClientes]     = useState([]); // needed for factura enrichment
  const [controlCobros,setControlCobros]= useState(null);
  const [bloqueosDocCobro,setBloqueosDocCobro] = useState(null);
  const [fiscalResumen,setFiscalResumen]= useState(null);
  const [pagosProveedor, setPagosProveedor] = useState([]);
  const [proveedoresAbiertos, setProveedoresAbiertos] = useState({});
  const [filtroPagosProveedor, setFiltroPagosProveedor] = useState("todos");
  const [pagoProveedorEdit, setPagoProveedorEdit] = useState(null);
  const [pagoProveedorForm, setPagoProveedorForm] = useState({});
  const [capitalActual, setCapitalActual] = useState(0);
  const [cobrosCfg,    setCobrosCfg]    = useState({
    dias_revision_post_vencimiento: 1,
    dias_entre_reclamaciones: 7,
    max_envios_reclamacion: 6,
    dias_hasta_juridico: 45,
    envio_email_auto: true,
  });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const params = filtro!=="todos" ? {estado:filtro} : {};
      if (fechaDesde) params.desde = fechaDesde;
      if (fechaHasta) params.hasta = fechaHasta;
      if (fiscalEstadoFiltro !== "todos") params.fiscal_estado = fiscalEstadoFiltro;
      if (fiscalModoFiltro !== "todos") params.fiscal_modo = fiscalModoFiltro;
      params.page  = page;
      params.limit = PAGE_SIZE;
      const data   = await getFacturas(params);
      const rows   = Array.isArray(data?.data)?data.data:Array.isArray(data)?data:[];
      setFacturas(rows);
      if (data?.pagination) {
        setTotalPages(data.pagination.totalPages || 1);
        setTotalCount(data.pagination.total || rows.length);
      } else { setTotalPages(1); setTotalCount(rows.length); }
      // Auto-cleanup: delete orphan borradores (borrador with 0 linked pedidos)
      const orphans = rows.filter(f=>f.estado==="borrador" && Number(f.num_pedidos||0)===0);
      for(const f of orphans){
        try{ await borrarFactura(f.id); } catch(e){ /* ignore */ }
      }
      if(orphans.length>0) {
        // Reload after cleanup
        const data2 = await getFacturas(params);
        const rows2 = Array.isArray(data2?.data)?data2.data:Array.isArray(data2)?data2:[];
        setFacturas(rows2);
      }
      getControlCobros().then(d => {
        setControlCobros(d);
        if (d?.config) setCobrosCfg(prev => ({ ...prev, ...d.config }));
      }).catch(()=>setControlCobros(null));
      getBloqueosDocumentalesCobro().then(setBloqueosDocCobro).catch(()=>setBloqueosDocCobro(null));
      getFacturacionFiscalResumen().then(setFiscalResumen).catch(()=>setFiscalResumen(null));
      getPagosColaboradorPendientes().then(d => setPagosProveedor(Array.isArray(d) ? d : [])).catch(()=>setPagosProveedor([]));
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  },[filtro, fiscalEstadoFiltro, fiscalModoFiltro, fechaDesde, fechaHasta, page]);

  useEffect(()=>{ setPage(1); },[filtro, fiscalEstadoFiltro, fiscalModoFiltro, fechaDesde, fechaHasta]);
  useEffect(()=>{cargar();},[cargar]);
  useEffect(() => {
    let alive = true;
    getEmpresaConfig().then(cfg => {
      if (!alive) return;
      const safe = cfg && typeof cfg === "object" ? cfg : {};
      const capital = Number(safe?.cfg_precios?.tesoreria?.capital_actual || 0);
      setCapitalActual(capital);
    }).catch(()=>{});
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const sync = () => { cargar(); };
    window.addEventListener("tms:facturas-changed", sync);
    window.addEventListener("tms:pedidos-changed", sync);
    return () => {
      window.removeEventListener("tms:facturas-changed", sync);
      window.removeEventListener("tms:pedidos-changed", sync);
    };
  }, [cargar]);
  useEffect(() => {
    if (!focusFactura?.factura_id || loading) return;
    const found = facturas.find(f => String(f.id) === String(focusFactura.factura_id));
    if (!found) return;
    const t = window.setTimeout(() => {
      document.getElementById(`factura-row-${focusFactura.factura_id}`)?.scrollIntoView({ behavior:"smooth", block:"center" });
      clearRuntimeFocus("tms_facturacion_focus");
    }, 180);
    return () => window.clearTimeout(t);
  }, [facturas, focusFactura, loading]);
  // Load clientes for invoice enrichment (CIF, address, email)
  useEffect(()=>{
    getClientes("","true",1,200).then(d=>setClientes(Array.isArray(d?.data)?d.data:Array.isArray(d)?d:[])).catch(()=>{});
  },[]);

  async function abrirFacturaPorId(id, fallback = null) {
    try {
      const d = await getFactura(id);
      setVistaFact(d || fallback || null);
    }
    catch {
      if (fallback) setVistaFact(fallback);
    }
  }

  async function handleRowClick(f) {
    await abrirFacturaPorId(f.id, f);
  }

  async function cambiarEstado(id, estado) {
    if (!canEdit) return;
    try {
      const result = await cambiarEstadoFactura(id, estado);
      broadcastFacturasChanged(normalizarDetalleCambioFactura(result, {
        factura_id: id,
        estado_nuevo: estado,
        pedido_estado_aplicado: estado === "borrador" ? "entregado" : "facturado",
      }));
      if (vistaFact && String(vistaFact.id) === String(id)) {
        const refreshed = await getFactura(id);
        setVistaFact(refreshed);
      }
      await cargar();
    }
    catch(e) { notify(e.message, "error"); }
  }

  async function cambiarEstadoRapido(factura, estado) {
    if (!factura?.id || !canEdit) return;
    await cambiarEstado(factura.id, estado);
  }

  async function enviarFacturaRapida(factura) {
    if (!factura?.id || !canEdit) return;
    const mail = factura.cliente_email_facturacion || factura.cliente_email || "";
    if (!mail) {
      await confirmDialog({
        title: "Factura sin email",
        message: "Este cliente no tiene email de facturacion configurado. Anade un email al cliente antes de enviar.",
        confirmText: "Aceptar",
        tone: "warning",
      });
      return;
    }
    try {
      const revision = await revisarEmailFactura(factura.id, mail);
      if (Array.isArray(revision?.bloqueantes) && revision.bloqueantes.length) {
        await confirmDialog({
          title: "No se puede enviar",
          message: revision.bloqueantes.join("\n"),
          confirmText: "Aceptar",
          tone: "warning",
        });
        return;
      }
      if (Array.isArray(revision?.avisos) && revision.avisos.length) {
        const ok = await confirmDialog({
          title: "Revisar antes de enviar",
          message: `La factura puede enviarse, pero conviene revisar:\n\n- ${revision.avisos.join("\n- ")}\n\nSe prepararan ${Number(revision.adjuntos_estimados || 1)} adjunto(s). ¿Enviar igualmente?`,
          confirmText: "Enviar igualmente",
          tone: "warning",
        });
        if (!ok) return;
      }
      const result = await enviarEmailFactura(factura.id, { destinatario: mail, force: true });
      broadcastFacturasChanged(normalizarDetalleCambioFactura(result, {
        factura_id: factura.id,
        estado_nuevo: result?.estado || "enviada",
        pedido_estado_aplicado: "facturado",
      }));
      notify(result?.simulado
        ? `Email simulado. Factura preparada con ${Number(result?.adjuntos || 0)} adjunto(s).`
        : `Factura enviada con ${Number(result?.adjuntos || 0)} adjunto(s).`,
        result?.simulado ? "warning" : "success");
      await cargar();
    } catch (e) {
      notify(e.message || "No se pudo enviar la factura por email", "error");
    }
  }

  async function eliminarFacturaBorrador(id) {
    if (!canEdit) return;
    const ok = await confirmDialog({
      title: "Eliminar borrador",
      message: "Eliminar factura borrador?",
      confirmText: "Eliminar",
      tone: "danger",
    });
    if (!ok) return;
    try {
      const result = await borrarFactura(id);
      broadcastFacturasChanged(normalizarDetalleCambioFactura(result, {
        factura_id: id,
        eliminada: true,
        pedido_estado_aplicado: "entregado",
      }));
      if (vistaFact && String(vistaFact.id) === String(id)) setVistaFact(null);
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function procesarColaFiscal() {
    if (!canEdit) return;
    try {
      const result = await procesarColaFiscalFacturas({ limit: 10 });
      notify(`Cola fiscal: ${result.accepted || 0} aceptadas, ${result.deferred || 0} pendientes externas, ${result.errors || 0} con error`, "success");
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function procesarFacturaFiscalAhora(facturaId) {
    if (!canEdit) return;
    try {
      const result = await procesarColaFiscalFacturas({ limit: 1, factura_id: facturaId });
      notify(`Factura fiscal: ${result.accepted || 0} aceptada, ${result.deferred || 0} pendiente externa, ${result.errors || 0} con error`, "success");
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function sincronizarFacturaVerifactiAhora(facturaId) {
    if (!canEdit) return;
    try {
      const result = await sincronizarFacturaFiscal(facturaId);
      notify(`Verifacti ${result.numero || ""}: ${String(result.provider_status || "pendiente").toUpperCase()}`, "success");
      if (vistaFact && String(vistaFact.id) === String(facturaId)) {
        const refreshed = await getFactura(facturaId);
        setVistaFact(refreshed);
      }
      await cargar();
    } catch (e) {
      notify(e.message, "error");
    }
  }

  async function descargarJustificanteFiscal(facturaId) {
    try {
      const data = await getFacturaFiscal(facturaId);
      const numero = String(data?.factura?.numero || facturaId || "factura").replace(/[^\w.-]+/g, "_");
      const html = buildFiscalEvidenceHtml(data);
      const blob = new Blob([html], { type:"text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `justificante-fiscal-${numero}-${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Justificante fiscal descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el justificante fiscal.", "error");
    }
  }

  async function descargarXmlFiscal(facturaId) {
    try {
      const token = localStorage.getItem("tms_token") || "";
      const res = await fetch(facturaFiscalXmlUrl(facturaId), { headers:{ Authorization:`Bearer ${token}` } });
      if (!res.ok) throw new Error("No se pudo descargar el XML fiscal.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `fiscal-${facturaId}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("XML fiscal descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el XML fiscal.", "error");
    }
  }

  async function descargarLoteXmlFiscal() {
    try {
      const token = localStorage.getItem("tms_token") || "";
      const params = {
        desde: fechaDesde || "",
        hasta: fechaHasta || "",
        estado: fiscalEstadoFiltro || "todos",
        modo: fiscalModoFiltro || "todos",
      };
      const res = await fetch(facturasFiscalLoteXmlUrl(params), { headers:{ Authorization:`Bearer ${token}` } });
      if (!res.ok) throw new Error("No se pudo descargar el lote XML fiscal.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `lote-fiscal-${new Date().toISOString().slice(0,10)}.xml`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Lote XML fiscal descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo descargar el lote XML fiscal.", "error");
    }
  }

  function descargarInformeCobros() {
    try {
      const html = buildCobrosReportHtml({ controlCobros, cobrosCfg, facturas });
      const blob = new Blob([html], { type:"text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-control-cobros-${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Informe de cobros descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el informe de cobros.", "error");
    }
  }

  function descargarInformeTesoreria() {
    try {
      const html = buildTesoreriaReportHtml({ prevision: previsionTesoreria, facturas, pagosProveedor });
      const blob = new Blob([html], { type:"text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `informe-tesoreria-${new Date().toISOString().slice(0,10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      notify("Informe de tesoreria descargado.", "success");
    } catch (e) {
      notify(e.message || "No se pudo generar el informe de tesoreria.", "error");
    }
  }

  function abrirGestionPagoProveedor(pago) {
    if (!pago) return;
    setPagoProveedorEdit(pago);
    setPagoProveedorForm({
      factura_nombre: pago.factura_nombre || "",
      factura_data: pago.factura_data || "",
      fecha_recepcion: pago.fecha_recepcion || "",
      fecha_pago_calculada: pago.fecha_pago_calculada || "",
      fecha_pago_real: pago.fecha_pago_real || "",
      fecha_documentacion_recepcion: pago.fecha_documentacion_recepcion || "",
      importe: Number(pago.importe || pago.precio_colaborador || 0),
      pagado: Boolean(pago.pagado),
      documentacion_recibida: Boolean(pago.documentacion_recibida),
      notas_pago: pago.notas_pago || "",
    });
  }

  async function guardarGestionPagoProveedor(overrides = {}) {
    if (!canEdit || !pagoProveedorEdit?.pedido_id) return;
    const payload = {
      ...pagoProveedorForm,
      ...overrides,
      importe: Number(String((overrides.importe ?? pagoProveedorForm.importe) || 0).replace(",", ".")) || 0,
    };
    try {
      await guardarPedidoColaboradorPago(pagoProveedorEdit.pedido_id, payload);
      notify("Pago de proveedor actualizado.", "success");
      setPagoProveedorEdit(null);
      await cargar();
      window.dispatchEvent(new CustomEvent("tms:pedidos-changed"));
    } catch (e) {
      notify(e.message || "No se pudo actualizar el pago del proveedor.", "error");
    }
  }

  async function accionRapidaPagoProveedor(pago, tipo) {
    if (!canEdit || !pago?.pedido_id) return;
    const today = new Date().toISOString().slice(0, 10);
    let payload = {
      factura_nombre: pago.factura_nombre || "",
      factura_data: pago.factura_data || "",
      fecha_recepcion: pago.fecha_recepcion || "",
      fecha_pago_calculada: pago.fecha_pago_calculada || "",
      fecha_pago_real: pago.fecha_pago_real || "",
      fecha_documentacion_recepcion: pago.fecha_documentacion_recepcion || "",
      importe: Number(pago.importe || pago.precio_colaborador || 0),
      pagado: Boolean(pago.pagado),
      documentacion_recibida: Boolean(pago.documentacion_recibida),
      notas_pago: pago.notas_pago || "",
    };
    if (tipo === "documentacion") {
      payload = { ...payload, documentacion_recibida: true, fecha_documentacion_recepcion: today };
    }
    if (tipo === "factura") {
      payload = { ...payload, factura_nombre: payload.factura_nombre || `Factura proveedor ${pago.numero}`, fecha_recepcion: today };
    }
    if (tipo === "pagado") {
      const pendientes = [
        !payload.factura_nombre ? "falta la factura del proveedor" : null,
        !payload.documentacion_recibida ? "falta confirmar la documentacion" : null,
      ].filter(Boolean);
      if (pendientes.length) {
        const continuar = await confirmDialog({
          title: "Pago con revision pendiente",
          message: `El viaje ${pago.numero} tiene ${pendientes.join(" y ")}. Lo normal es recepcionar factura y documentacion antes de pagar.\n\nQuieres marcarlo como pagado igualmente?`,
          confirmText: "Pagar igualmente",
          tone: "warning",
        });
        if (!continuar) return;
      }
      const ok = await confirmDialog({
        title: "Marcar proveedor pagado",
        message: `Marcar como pagado el viaje ${pago.numero} por ${fmt2(payload.importe)} EUR?`,
        confirmText: "Marcar pagado",
        tone: "success",
      });
      if (!ok) return;
      payload = { ...payload, pagado: true, fecha_pago_real: today };
    }
    try {
      await guardarPedidoColaboradorPago(pago.pedido_id, payload);
      notify("Pago de proveedor actualizado.", "success");
      await cargar();
      window.dispatchEvent(new CustomEvent("tms:pedidos-changed"));
    } catch (e) {
      notify(e.message || "No se pudo actualizar el pago del proveedor.", "error");
    }
  }

  function verFacturaProveedor(data) {
    if (!data) return;
    const win = window.open();
    if (!win) return;
    win.document.write(`<iframe src="${String(data).replace(/"/g, "&quot;")}" style="border:0;width:100vw;height:100vh"></iframe>`);
    win.document.close();
  }

  function imprimirOrdenPagoProveedor(group) {
    const win = window.open();
    if (!win) {
      notify("El navegador ha bloqueado la ventana de la orden de pago.", "warning");
      return;
    }
    win.document.write(buildOrdenPagoProveedorHtml(group));
    win.document.close();
  }

  function leerFacturaProveedor(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPagoProveedorForm(prev => ({
      ...prev,
      factura_nombre: file.name,
      factura_data: String(reader.result || ""),
      fecha_recepcion: prev.fecha_recepcion || new Date().toISOString().slice(0, 10),
    }));
    reader.onerror = () => notify("No se pudo leer la factura adjunta.", "error");
    reader.readAsDataURL(file);
  }

  function cambiarMesPeriodo(value) {
    setPeriodoMes(value);
    const bounds = monthBounds(value);
    setFechaDesde(bounds.desde);
    setFechaHasta(bounds.hasta);
  }

  const filtradas = useMemo(() => facturas.filter(f=>{
    if (busqueda&&!`${f.numero} ${f.cliente_nombre}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  }), [facturas, busqueda]);
  const facturasPorCliente = useMemo(() => {
    const map = new Map();
    for (const f of filtradas) {
      const key = f.cliente_id || f.cliente_nombre || "sin-cliente";
      const current = map.get(key) || { key, cliente: f.cliente_nombre || "Sin cliente", facturas: [], total: 0 };
      current.facturas.push(f);
      current.total += Number(f.total || 0);
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => a.cliente.localeCompare(b.cliente));
  }, [filtradas]);
  const pagosProveedorPorColaborador = useMemo(() => {
    const map = new Map();
    const today = new Date().toISOString().slice(0, 10);
    for (const p of pagosProveedor) {
      if (filtroPagosProveedor === "vencidos" && !(p.fecha_pago_calculada && String(p.fecha_pago_calculada).slice(0, 10) < today)) continue;
      if (filtroPagosProveedor === "sin_factura" && p.factura_nombre) continue;
      if (filtroPagosProveedor === "sin_docs" && p.documentacion_recibida) continue;
      const key = p.colaborador_id || p.colaborador_nombre || "sin-proveedor";
      const current = map.get(key) || {
        key,
        nombre: p.colaborador_nombre || "Proveedor sin nombre",
        formaPago: p.colaborador_forma_pago || "",
        viajes: [],
        total: 0,
        pendientesFactura: 0,
        pendientesDocumentacion: 0,
        vencidos: 0,
      };
      current.viajes.push(p);
      current.total += Number(p.importe || p.precio_colaborador || 0);
      if (!p.factura_nombre) current.pendientesFactura += 1;
      if (!p.documentacion_recibida) current.pendientesDocumentacion += 1;
      if (p.fecha_pago_calculada && String(p.fecha_pago_calculada).slice(0, 10) < today) current.vencidos += 1;
      map.set(key, current);
    }
    return Array.from(map.values()).sort((a, b) => {
      if (b.vencidos !== a.vencidos) return b.vencidos - a.vencidos;
      return b.total - a.total;
    });
  }, [pagosProveedor, filtroPagosProveedor]);
  const tableItems = useMemo(() => {
    if (!agruparCliente) return filtradas;
    return facturasPorCliente.flatMap(group => [
      { __group: true, ...group },
      ...(clientesAbiertos[group.key] ? group.facturas : []),
    ]);
  }, [agruparCliente, filtradas, facturasPorCliente, clientesAbiertos]);

  const total     = useMemo(() => facturas.filter(f=>f.estado!=="rectificada").reduce((s,f)=>s+Number(f.total||0),0), [facturas]);
  const cobrado   = useMemo(() => facturas.filter(f=>f.estado==="cobrada").reduce((s,f)=>s+Number(f.total||0),0), [facturas]);
  const pendiente = useMemo(() => facturas.filter(f=>["emitida","enviada","vencida"].includes(f.estado)&&Number(f.total||0)>0).reduce((s,f)=>s+Number(f.total||0),0), [facturas]);
  const nRect          = facturas.filter(f=>f.estado==="rectificada"||(f.serie&&f.serie.length<=3&&!["A","B"].includes(f.serie))).length;
  const controlResumen = controlCobros?.resumen || {};
  const proximasCobro = Array.isArray(controlCobros?.proximas) ? controlCobros.proximas : [];
  const facturasRiesgo = Array.isArray(controlCobros?.riesgo) ? controlCobros.riesgo : [];
  const bloqueoDocResumen = bloqueosDocCobro?.resumen || {};
  const bloqueoDocItems = [
    ...(Array.isArray(bloqueosDocCobro?.pedidos) ? bloqueosDocCobro.pedidos.map(x => ({...x, tipo:"pedido"})) : []),
    ...(Array.isArray(bloqueosDocCobro?.facturas) ? bloqueosDocCobro.facturas.map(x => ({...x, tipo:"factura"})) : []),
    ...(Array.isArray(bloqueosDocCobro?.cobros) ? bloqueosDocCobro.cobros.map(x => ({...x, tipo:"cobro"})) : []),
  ].slice(0, 12);
  const previsionTesoreria = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const addDays = days => {
      const d = new Date(today);
      d.setDate(d.getDate() + days);
      return d;
    };
    const end7 = addDays(7);
    const end30 = addDays(30);
    const end60 = addDays(60);
    const buckets = [
      { key: "vencido", label: "Vencido", desde: null, hasta: new Date(today.getTime() - 1), cobros: 0, pagos: 0, items: [] },
      { key: "7", label: "0-7 dias", desde: today, hasta: end7, cobros: 0, pagos: 0, items: [] },
      { key: "30", label: "8-30 dias", desde: new Date(end7.getTime() + 86400000), hasta: end30, cobros: 0, pagos: 0, items: [] },
      { key: "60", label: "31-60 dias", desde: new Date(end30.getTime() + 86400000), hasta: end60, cobros: 0, pagos: 0, items: [] },
    ];
    const pickBucket = date => buckets.find(b => {
      if (!date || Number.isNaN(date.getTime())) return false;
      if (b.key === "vencido") return date < today;
      return date >= b.desde && date <= b.hasta;
    });
    const addItem = item => {
      const bucket = pickBucket(item.dateObj);
      if (!bucket) return;
      if (item.tipo === "cobro") bucket.cobros += item.importe;
      else bucket.pagos += item.importe;
      bucket.items.push(item);
    };
    facturas.forEach(f => {
      if (!["emitida", "enviada", "vencida", "reclamada", "sin_cobrar"].includes(f.estado)) return;
      const importe = Number(f.total || 0);
      if (importe <= 0) return;
      const fecha = f.fecha_vencimiento || f.revision_cobro_at || f.fecha;
      addItem({
        tipo: "cobro",
        fecha,
        dateObj: new Date(fecha),
        importe,
        titulo: f.numero || "Factura",
        subtitulo: f.cliente_nombre || "Cliente",
        id: f.id,
      });
    });
    pagosProveedor.forEach(p => {
      if (p.pagado) return;
      const importe = Number(p.importe || p.precio_colaborador || 0);
      if (importe <= 0) return;
      const fecha = p.fecha_pago_calculada || p.fecha_descarga || p.fecha_carga;
      addItem({
        tipo: "pago",
        fecha,
        dateObj: new Date(fecha),
        importe,
        titulo: p.numero || "Viaje proveedor",
        subtitulo: p.colaborador_nombre || "Proveedor",
        pedido_id: p.pedido_id,
      });
    });
    const totalCobros30 = buckets.filter(b => ["vencido", "7", "30"].includes(b.key)).reduce((s, b) => s + b.cobros, 0);
    const totalPagos30 = buckets.filter(b => ["vencido", "7", "30"].includes(b.key)).reduce((s, b) => s + b.pagos, 0);
    const proximos = buckets.flatMap(b => b.items)
      .sort((a, b) => a.dateObj - b.dateObj || (b.tipo === "pago" ? 1 : -1))
      .slice(0, 6);
    const neto30 = totalCobros30 - totalPagos30;
    return { buckets, totalCobros30, totalPagos30, capitalActual, neto30, saldoPrevisto30: capitalActual + neto30, proximos };
  }, [facturas, pagosProveedor, capitalActual]);
  const fiscalInfo = fiscalResumen?.resumen || {};
  const fiscalRecientes = Array.isArray(fiscalResumen?.recientes) ? fiscalResumen.recientes : [];
  const fiscalCola = Array.isArray(fiscalResumen?.cola) ? fiscalResumen.cola : [];
  const fiscalSchedulerInfo = fiscalResumen?.scheduler || null;
  const fiscalSetupStatus = fiscalResumen?.status || null;
  const usaVerifacti = fiscalResumen?.config?.modo === "verifactu" && fiscalResumen?.config?.verifactu?.proveedor === "verifacti";
  // IDs de facturas que ya tienen rectificativa emitida
  const rectificadasIds = new Set(facturas.filter(f=>f.factura_original_id||f.factura_original_numero).map(f=>f.factura_original_id||f.factura_original_numero));
  const fiscalQuickFilters = [
    { key: "todos", label: "Todo", value: Number(fiscalInfo.total_registros || 0), color: "var(--text3)" },
    { key: "aceptado", label: "Aceptadas", value: Number(fiscalInfo.aceptados || 0), color: "var(--green)" },
    { key: "pendiente", label: "Pendientes", value: Number(fiscalInfo.pendientes || 0), color: "#f59e0b" },
    { key: "error", label: "Errores", value: Number(fiscalInfo.con_error || 0), color: "#ef4444" },
    { key: "sin_registro", label: "Sin registro", value: facturas.filter(f=>!f.fiscal_modo).length, color: "#94a3b8" },
  ];
  const resumenGestionFinanciera = [
    { label:"Cobros a revisar", value:Number(controlResumen.revisar_hoy || 0), detail:`${Number(controlResumen.vencidas || 0)} vencidas`, color:Number(controlResumen.vencidas || 0) ? "#ef4444" : "var(--green)" },
    { label:"Riesgo documental", value:Number(bloqueoDocResumen.total || bloqueoDocResumen.bloqueos || bloqueoDocItems.length || 0), detail:`${fmt2(Number(bloqueoDocResumen.importe_bloqueado_facturacion || 0)+Number(bloqueoDocResumen.importe_facturas_con_soporte_pendiente || 0)+Number(bloqueoDocResumen.importe_cobro_riesgo_documental || 0))} EUR`, color:Number(bloqueoDocItems.length || 0) ? "#f59e0b" : "var(--green)" },
    { label:"Fiscal pendiente", value:Number(fiscalInfo.pendientes || 0)+Number(fiscalInfo.con_error || 0)+Number(fiscalInfo.atascados || 0), detail:`${Number(fiscalInfo.aceptados || 0)} aceptadas`, color:Number(fiscalInfo.con_error || 0) ? "#ef4444" : "#f59e0b" },
    { label:"Tesoreria 30 dias", value:`${fmt2(previsionTesoreria.saldoPrevisto30)} EUR`, detail:`Neto ${fmt2(previsionTesoreria.neto30)} EUR`, color:previsionTesoreria.saldoPrevisto30 < 0 ? "#ef4444" : "var(--green)" },
    { label:"Pagos proveedor", value:pagosProveedor.length, detail:`${fmt2(previsionTesoreria.totalPagos30)} EUR proximos`, color:"#f59e0b" },
  ];

  return (
    <div style={S.page}>
      <div style={{display:"flex",justifyContent:"space-between",gap:16,alignItems:"flex-start",marginBottom:24}}>
        <div style={{display:"flex",gap:18,alignItems:"flex-start"}}>
          <div style={{width:46,height:46,borderRadius:10,display:"inline-flex",alignItems:"center",justifyContent:"center",background:"rgba(20,184,166,.10)",border:"1px solid rgba(20,184,166,.20)",color:"var(--accent-xl)",flexShrink:0}}>
            <FinanceIcon icon="wallet" />
          </div>
          <div>
            <div style={S.title}>Gestión financiera</div>
            <div style={{...S.sub,marginBottom:0}}>Facturas de clientes, seguimiento de cobros, pagos a proveedores y tesorería en una sola vista.</div>
          </div>
        </div>
      </div>

      {focusFactura?.source === "control_tower" && !focusFactura?.factura_id && (
        <div style={{...S.card,marginBottom:14,borderColor:"rgba(20,184,166,.35)",background:"rgba(20,184,166,.07)"}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap"}}>
            <div style={{flex:"1 1 320px"}}>
              <div style={{fontSize:10,fontWeight:900,textTransform:"uppercase",letterSpacing:".07em",color:"var(--accent-xl)",marginBottom:5}}>Control Tower</div>
              <div style={{fontSize:13,fontWeight:900,color:"var(--text)"}}>{focusFactura.title || focusFactura.action || "Accion financiera pendiente"}</div>
              <div style={{fontSize:12,color:"var(--text4)",marginTop:4,lineHeight:1.4}}>{focusFactura.description || "Revisa esta senal desde facturacion."}</div>
            </div>
            <span style={{fontSize:11,fontWeight:900,border:"1px solid rgba(20,184,166,.35)",background:"rgba(20,184,166,.10)",color:"var(--accent-xl)",borderRadius:20,padding:"4px 9px"}}>
              {focusFactura.action || focusFactura.action_key || "Revisar"}
            </span>
          </div>
        </div>
      )}

      {/* KPIs */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(180px,1fr))",gap:24,marginBottom:28}}>
        {[
          {l:"Total facturado",    v:`${fmt2(total)} EUR`,     c:"var(--text)", icon:"wallet"},
          {l:"Cobrado",            v:`${fmt2(cobrado)} EUR`,   c:"var(--green)", icon:"check"},
          {l:"Pendiente cobro",    v:`${fmt2(pendiente)} EUR`, c:"#f59e0b", icon:"clock"},
          {l:"Rectificadas",       v:nRect,                    c:"#fb7185", icon:"doc"},
        ].map((k,i)=><FinanceKpi key={i} label={k.l} value={k.v} color={k.c} icon={k.icon} />)}
      </div>

      <div style={{...S.card,marginBottom:22,borderColor:"rgba(20,184,166,.24)",background:"linear-gradient(135deg, rgba(20,184,166,.07), var(--card-bg))"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:12}}>
          <div>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:16,color:"var(--text)"}}>Resumen general financiero</div>
            <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>Cobros, pagos, fiscalidad, soporte documental y caja prevista en una sola lectura.</div>
          </div>
          <span style={{fontSize:11,color:pendiente>0?"#f59e0b":"var(--green)",fontWeight:900}}>
            Pendiente {fmt2(pendiente)} EUR
          </span>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10}}>
          {resumenGestionFinanciera.map(item=>(
            <div key={item.label} style={{background:"var(--bg3)",border:"1px solid var(--border)",borderRadius:9,padding:"10px 12px"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:17,fontWeight:900,color:item.color}}>{item.value}</div>
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",marginTop:4}}>{item.label}</div>
              <div style={{fontSize:11,color:"var(--text4)",marginTop:3}}>{item.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{display:"flex",gap:14,flexWrap:"wrap",marginBottom:22,padding:"0 6px",alignItems:"center"}}>
        <label style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".08em",color:"var(--text5)"}}>Area de trabajo</label>
        <select value={activeFacturacionTab} onChange={e=>setActiveFacturacionTab(e.target.value)} style={{...S.sel,minWidth:260,fontWeight:800}}>
          <option value="facturas">Facturas de clientes ({totalCount})</option>
          <option value="cobros">Seguimiento de cobros ({Number(controlResumen.revisar_hoy || 0)} a revisar)</option>
          <option value="pagos">Pagos a proveedores y tesoreria ({pagosProveedor.length})</option>
        </select>
        <span style={{fontSize:12,color:"var(--text5)"}}>
          {activeFacturacionTab === "facturas" && "Emision, fiscalidad y listado de facturas de clientes."}
          {activeFacturacionTab === "cobros" && "Vencimientos, reclamaciones y riesgo de impago."}
          {activeFacturacionTab === "pagos" && "Pagos a colaboradores/proveedores y saldo previsto de caja."}
        </span>
      </div>

      {activeFacturacionTab === "pagos" && (
      <div style={{...S.card,padding:14,marginBottom:16,borderColor:previsionTesoreria.saldoPrevisto30 < 0 ? "rgba(239,68,68,.35)" : "rgba(34,211,160,.28)"}}>
        <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",flexWrap:"wrap",marginBottom:10}}>
          <div style={{flex:"1 1 360px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Tesoreria real</div>
            <div style={{fontSize:12,color:"var(--text4)"}}>Saldo actual de caja/bancos mas cobros previstos menos pagos a colaboradores, usando vencimientos y fechas de pago configuradas.</div>
            <div style={{display:"inline-flex",gap:8,alignItems:"center",flexWrap:"wrap",marginTop:10,padding:"8px 10px",borderRadius:8,border:"1px solid #1e2d45",background:"var(--bg3)"}}>
              <span style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>Capital actual</span>
              <strong style={{fontFamily:"'JetBrains Mono',monospace",fontSize:13,color:"var(--text)"}}>{fmt2(previsionTesoreria.capitalActual)} EUR</strong>
              <span style={{fontSize:11,color:"var(--text5)"}}>Se modifica desde Mi Empresa &gt; Tesoreria.</span>
            </div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".07em",color:"var(--text5)"}}>Saldo previsto a 30 dias</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:19,fontWeight:900,color:previsionTesoreria.saldoPrevisto30 < 0 ? "#ef4444" : "var(--green)"}}>
              {fmt2(previsionTesoreria.saldoPrevisto30)} EUR
            </div>
            <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>
              Capital {fmt2(previsionTesoreria.capitalActual)} + neto {fmt2(previsionTesoreria.neto30)}
            </div>
            <button onClick={descargarInformeTesoreria} style={{...S.btn,marginTop:8,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.25)"}}>Informe tesoreria</button>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8}}>
          {previsionTesoreria.buckets.map(b => {
            const neto = b.cobros - b.pagos;
            return (
              <div key={b.key} style={{border:"1px solid #1e2d45",borderRadius:8,padding:"9px 10px",background:"var(--bg3)"}}>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)"}}>{b.label}</div>
                <div style={{display:"grid",gap:2,marginTop:6,fontSize:11,color:"var(--text4)"}}>
                  <span>Cobros <strong style={{color:"var(--green)",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(b.cobros)}</strong></span>
                  <span>Pagos <strong style={{color:"#f59e0b",fontFamily:"'JetBrains Mono',monospace"}}>{fmt2(b.pagos)}</strong></span>
                </div>
                <div style={{marginTop:6,fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:neto < 0 ? "#ef4444" : "var(--text)"}}>
                  {fmt2(neto)} EUR
                </div>
              </div>
            );
          })}
        </div>
        {previsionTesoreria.proximos.length > 0 && (
          <div style={{marginTop:10,borderTop:"1px solid #1e2d45",paddingTop:9,display:"grid",gap:6}}>
            {previsionTesoreria.proximos.map((item, idx) => (
              <div key={`${item.tipo}-${item.id || item.pedido_id || idx}`} style={{display:"grid",gridTemplateColumns:"85px 1fr auto",gap:10,alignItems:"center",fontSize:12,color:"var(--text3)"}}>
                <span style={{fontFamily:"'JetBrains Mono',monospace",color:"var(--text5)"}}>{fmtDate(item.fecha)}</span>
                <span><strong style={{color:item.tipo === "cobro" ? "var(--green)" : "#f59e0b"}}>{item.tipo === "cobro" ? "Cobro" : "Pago"}</strong> {item.titulo} - {item.subtitulo}</span>
                <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:item.tipo === "cobro" ? "var(--green)" : "#f59e0b"}}>
                  {item.tipo === "cobro" ? "+" : "-"}{fmt2(item.importe)} EUR
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {activeFacturacionTab === "facturas" && (
      <div style={{...S.card,padding:"24px 26px",marginBottom:22,borderColor:(Number(fiscalInfo.con_error||0)>0||Number(fiscalInfo.atascados||0)>0||fiscalCola.some(i=>i.estado==="error"||i.atascado))?"rgba(239,68,68,.24)":"var(--border)"}}>
        <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 260px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:20,color:"var(--text)",marginBottom:8}}>Bloque fiscal AEAT</div>
            <div style={{fontSize:13,color:"var(--text4)"}}>
              Modo {String(fiscalResumen?.config?.modo || "ninguno").toUpperCase()} - {Number(fiscalInfo.total_registros||0)} registros - {Number(fiscalInfo.pendientes||0)} pendientes
            </div>
            {fiscalSetupStatus?.summary && (
              <div style={{fontSize:11,color:fiscalSetupStatus.level === "ok" ? "var(--green)" : fiscalSetupStatus.level === "warning" ? "#f59e0b" : "#ef4444",marginTop:4,fontWeight:700}}>
                {fiscalSetupStatus.summary}
              </div>
            )}
            {fiscalSchedulerInfo?.enabled && (
              <div style={{fontSize:12,color:"var(--text5)",marginTop:8}}>
                Motor automatico cada {Number(fiscalSchedulerInfo.interval_minutes || 5)} min{fiscalSchedulerInfo.last_run_at ? ` - Ultimo ciclo ${new Date(fiscalSchedulerInfo.last_run_at).toLocaleString("es-ES")}` : ""}
              </div>
            )}
          </div>
          {canEdit && (
            <button onClick={procesarColaFiscal} style={{...S.btn,background:"rgba(16,185,129,.09)",color:"var(--green)",border:"1px solid rgba(16,185,129,.28)"}}>
              Procesar cola fiscal
            </button>
          )}
          <button onClick={descargarLoteXmlFiscal} style={{...S.btn,background:"rgba(59,130,246,.08)",color:"#2563eb",border:"1px solid rgba(59,130,246,.24)"}}>
            Descargar lote XML
          </button>
          {[
            ["Aceptados", fiscalInfo.aceptados, "var(--green)"],
            ["Pendientes", fiscalInfo.pendientes, "#f59e0b"],
            ["Errores", fiscalInfo.con_error, "#ef4444"],
            ["Atascados", fiscalInfo.atascados, "#fb7185"],
          ].map(([label,value,color])=>(
            <div key={label} style={{minWidth:104,background:`${color}08`,border:`1px solid ${color}28`,borderRadius:9,padding:"12px 14px"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,fontSize:18,color}}>{Number(value||0)}</div>
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:900,textTransform:"uppercase",letterSpacing:".06em",marginTop:4}}>{label}</div>
            </div>
          ))}
        </div>
        {(fiscalRecientes.length>0 || fiscalCola.length>0) && (
          <div style={{marginTop:22,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:18}}>
            {fiscalRecientes.slice(0,4).map(item=>(
              <div key={item.id} style={{border:"1px solid var(--border)",borderRadius:10,padding:"16px 18px",background:"var(--card-bg)",boxShadow:"0 8px 22px rgba(15,23,42,.04)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:15,fontWeight:900,color:"var(--text)"}}>
                  <span>{item.numero}</span>
                  <span style={{color:item.estado_envio==="aceptado"?"var(--green)":item.estado_envio==="error"?"#ef4444":"#f59e0b",background:item.estado_envio==="aceptado"?"rgba(16,185,129,.12)":"rgba(245,158,11,.10)",borderRadius:7,padding:"3px 10px",fontSize:11}}>{item.estado_envio}</span>
                </div>
                <div style={{fontSize:12,color:"var(--text4)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",marginTop:8}}>{item.cliente_nombre}</div>
                <div style={{fontSize:12,color:"var(--text5)",marginTop:8}}>{String(item.modo || "").toUpperCase()} - {item.huella ? item.huella.slice(0,12) : "sin huella"}</div>
                {item.provider_uuid && (
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
                    UUID {String(item.provider_uuid).slice(0,18)}...
                  </div>
                )}
                {item.ultimo_sync_at && (
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>
                    {item.ultimo_sync_tipo === "webhook.verifacti.recibido" ? "Webhook" : "Sync manual"} - {new Date(item.ultimo_sync_at).toLocaleString("es-ES")}
                  </div>
                )}
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  <button onClick={()=>abrirFacturaPorId(item.factura_id)} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}>
                    Ver factura
                  </button>
                  <button onClick={()=>descargarXmlFiscal(item.factura_id)} style={{...S.btn,background:"rgba(148,163,184,.12)",color:"var(--text3)",border:"1px solid rgba(148,163,184,.25)",padding:"5px 8px"}}>
                    XML
                  </button>
                  {canEdit && item.estado_envio !== "aceptado" && (
                    <button
                      onClick={async()=>{
                        try {
                          await reencolarFacturaFiscal(item.factura_id);
                          await procesarFacturaFiscalAhora(item.factura_id);
                        } catch (e) {
                          notify(e.message, "error");
                        }
                      }}
                      style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.25)",padding:"5px 8px"}}
                    >
                      Reintentar
                    </button>
                  )}
                  {canEdit && usaVerifacti && item.estado_envio !== "aceptado" && item.provider_uuid && (
                    <button
                      onClick={()=>sincronizarFacturaVerifactiAhora(item.factura_id)}
                      style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}
                    >
                      Sincronizar
                    </button>
                  )}
                </div>
              </div>
            ))}
            {fiscalCola.slice(0,4).map(item=>(
              <div key={`cola-${item.id}`} style={{border:item.atascado ? "1px solid rgba(251,113,133,.35)" : "1px solid #1e2d45",borderRadius:8,padding:"8px 10px",background:item.atascado ? "rgba(251,113,133,.07)" : "rgba(15,21,32,.55)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,fontWeight:800,color:"var(--text)"}}>
                  <span>{item.numero || "Factura pendiente"}</span>
                  <span style={{color:item.atascado ? "#fb7185" : item.estado==="error"?"#ef4444":item.estado==="procesando"?"#22d3ee":"#f59e0b"}}>
                    {item.atascado ? "atascado" : item.estado}
                  </span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{item.cliente_nombre || "Sin cliente"}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>{String(item.sistema || "").toUpperCase()} - intento {Number(item.intento || 0)}</div>
                {item.provider_uuid && (
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4,fontFamily:"'JetBrains Mono',monospace"}}>
                    UUID {String(item.provider_uuid).slice(0,18)}...
                  </div>
                )}
                {item.ultimo_sync_at && (
                  <div style={{fontSize:10,color:"var(--text5)",marginTop:4}}>
                    {item.ultimo_sync_tipo === "webhook.verifacti.recibido" ? "Webhook" : "Sync manual"} - {new Date(item.ultimo_sync_at).toLocaleString("es-ES")}
                  </div>
                )}
                {item.error && (
                  <div style={{fontSize:11,color:"#ef4444",marginTop:6,lineHeight:1.45}}>
                    {item.error}
                  </div>
                )}
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  {item.factura_id && (
                    <button onClick={()=>abrirFacturaPorId(item.factura_id)} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}>
                      Ver factura
                    </button>
                  )}
                  {canEdit && item.factura_id && (
                    <button onClick={()=>procesarFacturaFiscalAhora(item.factura_id)} style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.25)",padding:"5px 8px"}}>
                      Procesar ahora
                    </button>
                  )}
                  {canEdit && usaVerifacti && item.factura_id && item.provider_uuid && (
                    <button onClick={()=>sincronizarFacturaVerifactiAhora(item.factura_id)} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}>
                      Sincronizar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {activeFacturacionTab === "pagos" && pagosProveedor.length > 0 && (
        <div style={{...S.card,padding:14,marginBottom:16,borderColor:"rgba(251,191,36,.35)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Pagos pendientes a proveedores</div>
              <div style={{fontSize:12,color:"var(--text4)"}}>Abre cada proveedor para revisar viajes, factura, documentacion, vencimientos y ordenes de pago.</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
              <select value={filtroPagosProveedor} onChange={e=>setFiltroPagosProveedor(e.target.value)} style={S.sel}>
                <option value="todos">Todos</option>
                <option value="vencidos">Vencidos</option>
                <option value="sin_factura">Sin factura</option>
                <option value="sin_docs">Sin documentacion</option>
              </select>
              <span style={{...S.badge,background:"rgba(251,191,36,.12)",border:"1px solid rgba(251,191,36,.24)",color:"#f59e0b"}}>{pagosProveedor.length} viajes</span>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"#f59e0b"}}>{fmt2(pagosProveedor.reduce((s,p)=>s+Number(p.importe || p.precio_colaborador || 0),0))} EUR</span>
            </div>
          </div>
          <div style={{display:"grid",gap:8}}>
            {pagosProveedorPorColaborador.map(group=>{
              const open = Boolean(proveedoresAbiertos[group.key]);
              return (
                <div key={group.key} style={{border:"1px solid #1e2d45",borderRadius:8,overflow:"hidden",background:"var(--bg3)"}}>
                  <button type="button" onClick={()=>setProveedoresAbiertos(prev=>({...prev,[group.key]:!prev[group.key]}))} style={{width:"100%",border:0,background:open?"rgba(251,191,36,.08)":"transparent",color:"var(--text)",padding:"10px 12px",display:"grid",gridTemplateColumns:"minmax(180px,1fr) auto auto auto",gap:10,alignItems:"center",textAlign:"left",cursor:"pointer"}}>
                    <span><span style={{fontWeight:900,fontSize:13}}>{open ? "v " : "> "}{group.nombre}</span><span style={{display:"block",fontSize:11,color:"var(--text5)",marginTop:2}}>{group.formaPago || "Sin condiciones guardadas"} - {group.viajes.length} viaje(s)</span></span>
                    <span style={{...S.badge,background:group.pendientesFactura?"rgba(251,191,36,.12)":"rgba(34,211,160,.12)",color:group.pendientesFactura?"#f59e0b":"var(--green)"}}>{group.pendientesFactura} sin factura</span>
                    <span style={{...S.badge,background:group.pendientesDocumentacion?"rgba(59,130,246,.12)":"rgba(34,211,160,.12)",color:group.pendientesDocumentacion?"var(--accent)":"var(--green)"}}>{group.pendientesDocumentacion} sin docs</span>
                    <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:900,color:group.vencidos?"#ef4444":"#f59e0b",textAlign:"right"}}>{fmt2(group.total)} EUR</span>
                  </button>
                  {open && (
                    <div style={{display:"grid",gap:6,padding:10,borderTop:"1px solid #1e2d45"}}>
                      <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"center",flexWrap:"wrap",padding:"0 2px 4px"}}>
                        <span style={{fontSize:11,color:"var(--text5)"}}>
                          {group.vencidos ? `${group.vencidos} vencido(s). ` : ""}Revisa factura y documentacion antes de autorizar el pago.
                        </span>
                        <button onClick={()=>imprimirOrdenPagoProveedor(group)} style={{...S.btn,padding:"5px 9px",background:"rgba(251,191,36,.12)",color:"#f59e0b",border:"1px solid rgba(251,191,36,.28)"}}>Orden de pago</button>
                      </div>
                      {group.viajes.map(p=>(
                        <div key={`${p.pedido_id}-${p.pago_id || "pendiente"}`} style={{display:"grid",gridTemplateColumns:"minmax(210px,1.3fr) minmax(180px,1fr) minmax(110px,.5fr) auto",gap:10,alignItems:"center",padding:"8px 9px",border:"1px solid #1e2d45",borderRadius:8,background:p.pendiente_factura ? "rgba(251,191,36,.06)" : "rgba(15,21,32,.55)"}}>
                          <div>
                            <button type="button" onClick={()=>abrirGestionPagoProveedor(p)} style={{border:0,background:"transparent",color:"var(--accent)",fontWeight:900,cursor:"pointer",padding:0}}>{p.numero}</button>
                            <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>{p.origen} -&gt; {p.destino}</div>
                            <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Carga {fmtDate(p.fecha_carga)} - Descarga {fmtDate(p.fecha_descarga)}</div>
                          </div>
                          <div style={{display:"flex",gap:5,flexWrap:"wrap"}}>
                            <span style={{...S.badge,background:p.factura_nombre?"rgba(34,211,160,.12)":"rgba(251,191,36,.12)",color:p.factura_nombre?"var(--green)":"#f59e0b"}}>{p.factura_nombre ? "factura recibida" : "falta factura"}</span>
                            <span style={{...S.badge,background:p.documentacion_recibida?"rgba(34,211,160,.12)":"rgba(59,130,246,.12)",color:p.documentacion_recibida?"var(--green)":"var(--accent)"}}>{p.documentacion_recibida ? "docs ok" : "falta docs"}</span>
                            <span style={{fontSize:11,color:"var(--text5)",width:"100%"}}>Pago: {fmtDate(p.fecha_pago_calculada)}</span>
                          </div>
                          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,fontWeight:900,color:"var(--text2)"}}>{fmt2(p.importe || p.precio_colaborador)} EUR</div>
                          <div style={{display:"flex",gap:6,flexWrap:"wrap",justifyContent:"flex-end"}}>
                            {canEdit && !p.documentacion_recibida && <button onClick={()=>accionRapidaPagoProveedor(p,"documentacion")} style={{...S.btn,padding:"5px 8px",background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.24)"}}>Docs recibida</button>}
                            {canEdit && !p.factura_nombre && <button onClick={()=>accionRapidaPagoProveedor(p,"factura")} style={{...S.btn,padding:"5px 8px",background:"rgba(251,191,36,.12)",color:"#f59e0b",border:"1px solid rgba(251,191,36,.24)"}}>Factura recibida</button>}
                            {p.factura_data && <button onClick={()=>verFacturaProveedor(p.factura_data)} style={{...S.btn,padding:"5px 8px",background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.24)"}}>Ver factura</button>}
                            <button onClick={()=>abrirGestionPagoProveedor(p)} style={{...S.btn,padding:"5px 8px",background:"var(--bg4)",color:"var(--text3)",border:"1px solid #1e2d45"}}>Gestionar</button>
                            {canEdit && <button onClick={()=>accionRapidaPagoProveedor(p,"pagado")} style={{...S.btn,padding:"5px 8px",background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.24)"}}>Pagado</button>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {false && pagosProveedor.length > 0 && (
        <div style={{...S.card,padding:14,marginBottom:16,borderColor:"rgba(251,191,36,.35)"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:10}}>
            <div>
              <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Pagos pendientes a proveedores</div>
              <div style={{fontSize:12,color:"var(--text4)"}}>
                Viajes de colaborador pendientes de factura recibida o de pago. Las fechas se calculan con Mi Empresa &gt; condiciones de pago a colaboradores.
              </div>
            </div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"#f59e0b"}}>
              {fmt2(pagosProveedor.reduce((s,p)=>s+Number(p.importe || p.precio_colaborador || 0),0))} EUR
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:8}}>
            {pagosProveedor.slice(0,6).map(p=>(
              <div key={`${p.pedido_id}-${p.pago_id || "pendiente"}`} style={{border:"1px solid #1e2d45",borderRadius:8,padding:"9px 10px",background:p.pendiente_factura ? "rgba(251,191,36,.07)" : "var(--bg3)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,fontWeight:800,color:"var(--text)"}}>
                  <span>{p.numero}</span>
                  <span style={{color:p.pendiente_factura ? "#f59e0b" : "var(--green)"}}>{p.pendiente_factura ? "falta factura" : "vto. pago"}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.colaborador_nombre}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:3}}>{p.origen} -> {p.destino}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text2)",marginTop:5}}>{fmt2(p.importe || p.precio_colaborador)} EUR</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>
                  Recibida: {fmtDate(p.fecha_recepcion)} · Pago: {fmtDate(p.fecha_pago_calculada)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeFacturacionTab === "cobros" && (
      <>
      <div style={{...S.card,padding:14,marginBottom:16,borderColor:Number(bloqueoDocResumen.total_bloqueos||0)>0?"rgba(239,68,68,.35)":"rgba(34,211,160,.24)"}}>
        <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:12,flexWrap:"wrap",marginBottom:12}}>
          <div style={{flex:"1 1 320px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Bloqueos documental-cobro</div>
            <div style={{fontSize:12,color:"var(--text4)"}}>Viajes y facturas que pueden frenar emision, reclamacion o cobro por falta de POD, albaran o CMR.</div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            {[
              ["Pedidos sin soporte", bloqueoDocResumen.pedidos_sin_soporte, "#f59e0b"],
              ["Facturas afectadas", bloqueoDocResumen.facturas_con_soporte_pendiente, "#ef4444"],
              ["Cobros en riesgo", bloqueoDocResumen.cobros_en_riesgo_documental, "#b91c1c"],
              ["Importe bloqueado", `${fmt2(Number(bloqueoDocResumen.importe_bloqueado_facturacion||0)+Number(bloqueoDocResumen.importe_facturas_con_soporte_pendiente||0)+Number(bloqueoDocResumen.importe_cobro_riesgo_documental||0))} EUR`, "var(--text)"],
            ].map(([label,value,color])=>(
              <div key={label} style={{minWidth:130,border:"1px solid #1e2d45",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:15,fontWeight:900,color}}>{value || 0}</div>
                <div style={{fontSize:10,fontWeight:800,textTransform:"uppercase",letterSpacing:".06em",color:"var(--text5)",marginTop:2}}>{label}</div>
              </div>
            ))}
          </div>
        </div>
        {bloqueoDocItems.length === 0 ? (
          <div style={{fontSize:12,color:"var(--green)",fontWeight:800,padding:"8px 0"}}>No hay bloqueos documentales relevantes ahora mismo.</div>
        ) : (
          <div style={{display:"grid",gap:7}}>
            {bloqueoDocItems.map((item, idx) => {
              const isPedido = item.tipo === "pedido";
              const isCobro = item.tipo === "cobro";
              const color = isCobro ? "#b91c1c" : isPedido ? "#f59e0b" : "#ef4444";
              const titulo = isPedido ? (item.numero || "Pedido") : (item.numero || "Factura");
              const subtitulo = isPedido
                ? `${item.cliente_nombre || "Cliente"} - ${[item.origen,item.destino].filter(Boolean).join(" > ") || "Ruta sin datos"}`
                : `${item.cliente_nombre || "Cliente"} - ${estadoFacturaLabel(item.estado)} - ${fmt2(item.total)} EUR`;
              return (
                <div key={`${item.tipo}-${item.id || idx}`} style={{display:"grid",gridTemplateColumns:"110px minmax(0,1fr) auto",gap:10,alignItems:"center",border:"1px solid #1e2d45",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                  <span style={{...S.badge,background:`${color}18`,border:`1px solid ${color}44`,color}}>{isPedido ? "Pedido" : isCobro ? "Cobro" : "Factura"}</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:900,color:"var(--text)"}}>{titulo}</div>
                    <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>{subtitulo}</div>
                    <div style={{fontSize:11,color:"var(--text4)",marginTop:2}}>{item.accion}</div>
                  </div>
                  <div style={{textAlign:"right",fontSize:11,color:"var(--text4)"}}>
                    {(item.bloqueos || []).map((b,i)=><div key={i} style={{fontWeight:800,color}}>{b}</div>)}
                    <div style={{fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>{isPedido ? `${fmt2(item.importe)} EUR` : `${Number(item.pedidos_sin_soporte||0)} pedido(s)`}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div style={{...S.card,padding:14,borderColor:Number(controlResumen.revisar_hoy||0)>0?"rgba(249,115,22,.45)":"#141a28"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
          <div style={{flex:"1 1 260px"}}>
            <div style={{fontFamily:"'Syne',sans-serif",fontWeight:800,fontSize:15,color:"var(--text)",marginBottom:4}}>Control de cobros</div>
            <div style={{fontSize:12,color:"var(--text4)"}}>
              {Number(controlResumen.revisar_hoy||0)} factura(s) a revisar hoy - {fmt2(controlResumen.importe_pendiente||0)} EUR pendientes
            </div>
          </div>
          {canEdit && (<button onClick={async()=>{ try { const r = await procesarReclamacionesFacturas(); notify(`Revision cobro: ${r.reclamadas||0} reclamadas, ${r.sin_cobrar||0} sin cobrar, ${r.emails||0} emails`, "success"); cargar(); } catch(e) { notify(e.message, "error"); } }} style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",border:"1px solid rgba(249,115,22,.25)"}}>Revisar cobros</button>)}
          <button onClick={descargarInformeCobros} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)"}}>Informe cobros</button>
          {[ 
            ["Vencidas", controlResumen.vencidas, "#ef4444"],
            ["Reclamadas", controlResumen.reclamadas, "#f97316"],
            ["Sin cobrar", controlResumen.sin_cobrar, "#b91c1c"],
          ].map(([label,value,color])=>(
            <div key={label} style={{minWidth:110,background:`${color}12`,border:`1px solid ${color}33`,borderRadius:8,padding:"8px 10px"}}>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,fontSize:16,color}}>{Number(value||0)}</div>
              <div style={{fontSize:10,color:"var(--text5)",fontWeight:700,textTransform:"uppercase",letterSpacing:".06em"}}>{label}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:12}}>
          <button onClick={()=>setFiltro("todos")} style={{...S.btn,background:filtro==="todos"?"var(--accent)":"var(--bg3)",color:filtro==="todos"?"#fff":"var(--text3)",border:`1px solid ${filtro==="todos"?"var(--accent)":"var(--border2)"}`}}>Todos</button>
          <button onClick={()=>setFiltro("vencida")} style={{...S.btn,background:filtro==="vencida"?"#dc2626":"var(--bg3)",color:filtro==="vencida"?"#fff":"var(--text3)",border:`1px solid ${filtro==="vencida"?"#dc2626":"var(--border2)"}`}}>Vencidas</button>
          <button onClick={()=>setFiltro("reclamada")} style={{...S.btn,background:filtro==="reclamada"?"#ea580c":"var(--bg3)",color:filtro==="reclamada"?"#fff":"var(--text3)",border:`1px solid ${filtro==="reclamada"?"#ea580c":"var(--border2)"}`}}>Reclamadas</button>
          <button onClick={()=>setFiltro("sin_cobrar")} style={{...S.btn,background:filtro==="sin_cobrar"?"#b91c1c":"var(--bg3)",color:filtro==="sin_cobrar"?"#fff":"var(--text3)",border:`1px solid ${filtro==="sin_cobrar"?"#b91c1c":"var(--border2)"}`}}>Sin cobrar</button>
          <button onClick={()=>setFiltro("enviada")} style={{...S.btn,background:filtro==="enviada"?"#0891b2":"var(--bg3)",color:filtro==="enviada"?"#fff":"var(--text3)",border:`1px solid ${filtro==="enviada"?"#0891b2":"var(--border2)"}`}}>Enviadas</button>
        </div>
        {proximasCobro.length>0 && (
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:8}}>
            {proximasCobro.slice(0,4).map(f=>(
              <div key={`proxima-${f.id}`} style={{border:"1px solid #1e2d45",borderRadius:8,padding:"8px 10px",background:"rgba(15,21,32,.45)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,fontWeight:800,color:"var(--text)"}}>
                  <span>{f.numero}</span>
                  <span style={{color:EC[f.estado]||"#f59e0b"}}>{estadoFacturaLabel(f.estado)}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Revision {fmtDate(f.revision_cobro_at)}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Vencimiento {fmtDate(f.fecha_vencimiento)}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text2)",marginTop:4}}>{fmt2(f.total)} EUR</div>
                <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
                  <button onClick={()=>abrirFacturaPorId(f.id, f)} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}>Ver factura</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {facturasRiesgo.length>0 && (
          <div style={{marginTop:12,display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(210px,1fr))",gap:8}}>
            {facturasRiesgo.slice(0,4).map(f=>(
              <div key={f.id} style={{border:"1px solid #1e2d45",borderRadius:8,padding:"8px 10px",background:"var(--bg3)"}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,fontSize:12,fontWeight:800,color:"var(--text)"}}>
                  <span>{f.numero}</span><span style={{color:EC[f.estado]||"#f97316"}}>{estadoFacturaLabel(f.estado)}</span>
                </div>
                <div style={{fontSize:11,color:"var(--text4)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{f.cliente_nombre}</div>
                <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:"var(--text2)",marginTop:3}}>{fmt2(f.total)} EUR</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:4}}>Vencimiento {fmtDate(f.fecha_vencimiento)}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Revision {fmtDate(f.revision_cobro_at)}</div>
                <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Envios {Number(f.reclamacion_envios || 0)}{f.reclamacion_ultimo_envio_at ? ` - Ultimo ${fmtDate(f.reclamacion_ultimo_envio_at, true)}` : ""}</div>
                {f.reclamacion_hasta && (
                  <div style={{fontSize:11,color:"var(--text5)",marginTop:2}}>Seguimiento hasta {fmtDate(f.reclamacion_hasta)}</div>
                )}
                <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:8}}>
                  <button
                    onClick={()=>abrirFacturaPorId(f.id, f)}
                    style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.25)",padding:"5px 8px"}}
                  >
                    Ver factura
                  </button>
                  {canEdit && f.estado !== "cobrada" && (
                    <button
                      onClick={()=>cambiarEstadoRapido(f, "cobrada")}
                      style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)",padding:"5px 8px"}}
                    >
                      Marcar cobrada
                    </button>
                  )}
                  {canEdit && !["reclamada","sin_cobrar","cobrada"].includes(f.estado) && (
                    <button
                      onClick={()=>cambiarEstadoRapido(f, "reclamada")}
                      style={{...S.btn,background:"rgba(249,115,22,.12)",color:"#f97316",border:"1px solid rgba(249,115,22,.25)",padding:"5px 8px"}}
                    >
                      Reclamar
                    </button>
                  )}
                  {canEdit && f.estado === "reclamada" && (
                    <button
                      onClick={()=>cambiarEstadoRapido(f, "sin_cobrar")}
                      style={{...S.btn,background:"rgba(239,68,68,.12)",color:"#ef4444",border:"1px solid rgba(239,68,68,.25)",padding:"5px 8px"}}
                    >
                      Sin cobrar
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}

      {activeFacturacionTab === "facturas" && (
      <>
      {/* Filtros */}
      <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
        {!filtroFechasCustom ? (
          <input type="month" value={periodoMes} onChange={e=>cambiarMesPeriodo(e.target.value)} style={{...S.inp,width:150}}/>
        ) : (
          <>
            <input type="date" value={fechaDesde} onChange={e=>setFechaDesde(e.target.value)} style={{...S.inp,width:150}}/>
            <input type="date" value={fechaHasta} onChange={e=>setFechaHasta(e.target.value)} style={{...S.inp,width:150}}/>
          </>
        )}
        <button
          onClick={()=>setFiltroFechasCustom(v=>!v)}
          style={{...S.btn,background:filtroFechasCustom?"rgba(20,184,166,.12)":"var(--bg3)",color:filtroFechasCustom?"var(--accent-xl)":"var(--text3)",border:`1px solid ${filtroFechasCustom?"rgba(20,184,166,.30)":"var(--border2)"}`}}
        >
          {filtroFechasCustom ? "Usar mes" : "Filtro personalizado"}
        </button>
        <select value={filtro} onChange={e=>setFiltro(e.target.value)} style={S.sel}>
          <option value="todos">Todos los estados</option>
          {[...ESTADOS,"rectificada"].map(e=><option key={e} value={e}>{estadoFacturaLabel(e)}</option>)}
        </select>
        <select value={fiscalEstadoFiltro} onChange={e=>setFiscalEstadoFiltro(e.target.value)} style={S.sel}>
          <option value="todos">Fiscal: todos</option>
          <option value="aceptado">Fiscal aceptado</option>
          <option value="pendiente">Fiscal pendiente</option>
          <option value="error">Fiscal con error</option>
          <option value="sin_registro">Sin registro fiscal</option>
        </select>
        <select value={fiscalModoFiltro} onChange={e=>setFiscalModoFiltro(e.target.value)} style={{...S.sel,padding:"7px 12px",fontSize:13}}>
          <option value="todos">Modo fiscal: todos</option>
          <option value="verifactu">VERIFACTU</option>
          <option value="sii">SII</option>
          <option value="ninguno">Sin modo</option>
        </select>
        <input value={busqueda} onChange={e=>setBusqueda(e.target.value)} placeholder="Buscar por numero o cliente..." style={{...S.inp,width:270}}/>
        {canEdit && (
          <button onClick={()=>setModalMulti(true)} style={{...S.btn,background:"rgba(16,185,129,.15)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)"}}>
            Facturar pedidos de cliente
          </button>
        )}
        <button
          onClick={()=>setAgruparCliente(v=>!v)}
          style={{...S.btn,background:agruparCliente?"rgba(34,211,160,.12)":"var(--bg3)",color:agruparCliente?"var(--green)":"var(--text4)",border:"1px solid rgba(34,211,160,.22)"}}
        >
          {agruparCliente ? "Vista por cliente" : "Agrupar por cliente"}
        </button>
        <span style={{marginLeft:"auto",fontSize:11,color:"var(--text5)"}}>Doble clic o boton Ver para abrir la factura</span>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:14}}>
        {fiscalQuickFilters.map((item) => {
          const active = fiscalEstadoFiltro === item.key || (item.key === "todos" && fiscalEstadoFiltro === "todos");
          return (
            <button
              key={item.key}
              onClick={() => setFiscalEstadoFiltro(item.key)}
              style={{
                ...S.btn,
                padding:"6px 10px",
                background: active ? `${item.color}18` : "var(--bg3)",
                color: item.color,
                border:`1px solid ${active ? `${item.color}55` : "#1e2d45"}`,
              }}
            >
              {item.label} <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,fontWeight:800}}>{Number(item.value || 0)}</span>
            </button>
          );
        })}
      </div>

      <div style={{...S.card,borderRadius:12}}>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>{["No. Factura","Cliente","Fecha","Vcto.","Base","IVA","Total","Estado","Acciones"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text5)"}}>Cargando...</td></tr>
              : filtradas.length===0
              ? <tr><td colSpan={9} style={{...S.td,textAlign:"center",color:"var(--text5)",padding:40}}>Sin facturas</td></tr>
              : tableItems.map(f=>{
                if (f.__group) {
                  const open = !!clientesAbiertos[f.key];
                  return (
                    <tr key={`cliente-${f.key}`} onClick={()=>setClientesAbiertos(prev=>({...prev,[f.key]:!open}))} style={{cursor:"pointer",background:"rgba(34,211,160,.07)"}}>
                      <td colSpan={9} style={{...S.td,borderBottom:"1px solid #1e2d45",padding:"10px 14px"}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12}}>
                          <div style={{fontWeight:800,color:"var(--text)"}}>{open ? "v" : ">"} {f.cliente}</div>
                          <div style={{display:"flex",gap:12,alignItems:"center",fontSize:12,color:"var(--text4)"}}>
                            <span>{f.facturas.length} factura(s)</span>
                            <span style={{fontFamily:"'JetBrains Mono',monospace",fontWeight:800,color:"var(--green)"}}>{fmt2(f.total)} EUR</span>
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                }
                const esRect = f.estado==="rectificada" || (f.serie && f.serie !== "A" && f.serie !== "B");
                const fiscalRowMeta = getFacturaFiscalRowMeta(f);
                return (
                  <tr key={f.id} id={`factura-row-${f.id}`} onClick={()=>handleRowClick(f)} style={{
                    cursor:"pointer",
                    background: String(focusFactura?.factura_id || "") === String(f.id) ? "rgba(34,211,160,.10)" : undefined,
                    boxShadow: String(focusFactura?.factura_id || "") === String(f.id) ? "inset 3px 0 0 var(--green)" : undefined,
                  }}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--bg5)"}
                    onMouseLeave={e=>e.currentTarget.style.background=String(focusFactura?.factura_id || "") === String(f.id) ? "rgba(34,211,160,.10)" : "transparent"}>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12,color:esRect?"#f97316":"var(--accent-xl)"}}>
                      {f.numero}{esRect&&<span style={{fontSize:9,marginLeft:4,color:"#f97316"}}>RECT.</span>}{Number(f.num_pedidos||0)===0&&["emitida","enviada","cobrada"].includes(f.estado)&&<span title="Sin pedidos vinculados" style={{fontSize:9,marginLeft:4,color:"#ef4444",fontWeight:700}}>REVISION</span>}{Number(f.num_pedidos||0)===0&&!esRect&&<span title="Sin pedidos vinculados" style={{fontSize:9,marginLeft:4,color:"#ef4444",fontWeight:700}}>HUERFANA</span>}
                    </td>
                    <td style={{...S.td,fontWeight:600,color:"var(--text)",fontSize:12}}>{f.cliente_nombre}</td>
                    <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{f.fecha?new Date(f.fecha).toLocaleDateString("es-ES"):"-"}</td>
                    <td style={{...S.td,fontSize:11,color:"var(--text4)",fontFamily:"'JetBrains Mono',monospace"}}>{f.fecha_vencimiento?new Date(f.fecha_vencimiento).toLocaleDateString("es-ES"):"-"}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:12}}>{fmt2(f.base_imponible)} EUR</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:"var(--text4)"}}>{ivaLabel(f.tipo_iva, f.iva_regimen)}</td>
                    <td style={{...S.td,fontFamily:"'JetBrains Mono',monospace",fontWeight:700,color:"var(--text)"}}>{fmt2(f.total)} EUR</td>
                    <td style={S.td}>
                      <div style={{display:"flex",flexDirection:"column",gap:5,alignItems:"flex-start"}}>
                        <span style={{...S.badge,background:`${EC[f.estado]||"#6b7280"}1a`,color:EC[f.estado]||"#6b7280"}}>{estadoFacturaLabel(f.estado)}</span>
                        {f.fiscal_modo ? (
                          <span style={{
                            ...S.badge,
                            background:`${f.fiscal_estado_envio==="aceptado"?"rgba(16,185,129,.14)":f.fiscal_estado_envio==="error"?"rgba(239,68,68,.14)":"rgba(245,158,11,.14)"}`,
                            color:f.fiscal_estado_envio==="aceptado"?"var(--green)":f.fiscal_estado_envio==="error"?"#ef4444":"#f59e0b",
                          }}>
                            {String(f.fiscal_modo).toUpperCase()} - {f.fiscal_estado_envio || "pendiente"}
                          </span>
                        ) : (
                          <span style={{...S.badge,background:"rgba(148,163,184,.12)",color:"#94a3b8"}}>
                            Sin registro fiscal
                          </span>
                        )}
                        <div style={{
                          fontSize:10,
                          lineHeight:1.45,
                          color:fiscalRowMeta.tone,
                          background:fiscalRowMeta.bg,
                          border:`1px solid ${fiscalRowMeta.tone}30`,
                          borderRadius:7,
                          padding:"5px 7px",
                          maxWidth:220,
                        }}>
                          <div style={{fontWeight:800,textTransform:"uppercase",letterSpacing:".05em",fontSize:9,marginBottom:2}}>
                            {fiscalRowMeta.label}
                          </div>
                          <div style={{color:"var(--text4)"}}>{fiscalRowMeta.detail}</div>
                        </div>
                      </div>
                    </td>
                    <td style={S.td} onClick={e=>e.stopPropagation()}>
                      {f.estado==="rectificada"
                        ? <span style={{fontSize:11,color:"#f97316",fontWeight:700}}>Rectificada</span>
                        : f.estado==="borrador"
                          ? canEdit && (
                            <div style={{display:"flex",gap:5,alignItems:"center"}}>
                              <button title="Abrir factura" style={{...S.btn,background:"rgba(59,130,246,.10)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.20)",padding:"5px 8px"}} onClick={()=>abrirFacturaPorId(f.id, f)}>Ver</button>
                              <button title="Emitir factura" style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)",padding:"5px 8px"}} onClick={()=>cambiarEstado(f.id,"emitida")}>Emitir</button>
                              <select value={f.estado} onChange={e=>cambiarEstado(f.id,e.target.value)} style={S.sel}>
                                {ESTADOS.map(e=><option key={e} value={e}>{estadoFacturaLabel(e)}</option>)}
                              </select>
                              <button title="Emitir rectificativa" style={{...S.btn,background:"rgba(249,115,22,.1)",color:"#f97316",border:"1px solid rgba(249,115,22,.2)",padding:"5px 8px"}} onClick={()=>setModalRect(f)}>Rectificar</button>
                              <button title="Eliminar borrador" style={{...S.btn,background:"rgba(239,68,68,.1)",color:"#ef4444",border:"1px solid rgba(239,68,68,.2)",padding:"5px 8px"}} onClick={()=>eliminarFacturaBorrador(f.id)}>Eliminar</button>
                            </div>
                          )
                          : (
                            <div style={{display:"flex",gap:5,alignItems:"center",flexWrap:"wrap"}}>
                              <button title="Abrir factura" style={{...S.btn,background:"rgba(59,130,246,.10)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.20)",padding:"5px 8px"}} onClick={()=>abrirFacturaPorId(f.id, f)}>Ver</button>
                              {canEdit && ["emitida","enviada"].includes(f.estado) && (
                                <button title={f.estado==="enviada" ? "Reenviar factura" : "Enviar factura"} style={{...S.btn,background:"rgba(16,185,129,.12)",color:"var(--green)",border:"1px solid rgba(16,185,129,.25)",padding:"5px 8px"}} onClick={()=>enviarFacturaRapida(f)}>
                                  {f.estado==="enviada" ? "Reenviar" : "Enviar"}
                                </button>
                              )}
                              <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:`${EC[f.estado]||"#6b7280"}22`,color:EC[f.estado]||"#6b7280",fontWeight:700}}>{estadoFacturaLabel(f.estado)}</span>
                              {canEdit && f.estado !== "cobrada" && (
                                <button title="Marcar cobrada" style={{...S.btn,background:"rgba(16,185,129,.10)",color:"var(--green)",border:"1px solid rgba(16,185,129,.20)",padding:"5px 8px"}} onClick={()=>cambiarEstado(f.id,"cobrada")}>Cobrada</button>
                              )}
                              {canEdit && !["reclamada","sin_cobrar","cobrada","rectificada"].includes(f.estado) && (
                                <button title="Marcar reclamada" style={{...S.btn,background:"rgba(249,115,22,.10)",color:"#f97316",border:"1px solid rgba(249,115,22,.20)",padding:"5px 8px"}} onClick={()=>cambiarEstado(f.id,"reclamada")}>Reclamar</button>
                              )}
                              {canEdit && f.estado === "reclamada" && (
                                <button title="Pasar a sin cobrar" style={{...S.btn,background:"rgba(239,68,68,.10)",color:"#ef4444",border:"1px solid rgba(239,68,68,.20)",padding:"5px 8px"}} onClick={()=>cambiarEstado(f.id,"sin_cobrar")}>Sin cobrar</button>
                              )}
                              {canEdit&&<button title="Emitir rectificativa" style={{...S.btn,background:"rgba(249,115,22,.1)",color:"#f97316",border:"1px solid rgba(249,115,22,.2)",padding:"5px 8px"}} onClick={()=>setModalRect(f)}>Rectificar</button>}
                              {canEdit && f.fiscal_modo && (
                                <button
                                  title="Reencolar envio fiscal"
                                  style={{...S.btn,background:"rgba(34,211,238,.10)",color:"#22d3ee",border:"1px solid rgba(34,211,238,.25)",padding:"5px 8px"}}
                                  onClick={async()=>{ try { await reencolarFacturaFiscal(f.id); await cargar(); } catch(e) { notify(e.message, "error"); } }}
                                >
                                  Fiscal
                                </button>
                              )}
                            </div>
                          )
                      }
                    </td>
                  </tr>
                );
              })
            }
          </tbody>
        </table>
      </div>
      </>
      )}

      {vistaFact && (() => {
        const cli = clientes.find(c=>c.id===vistaFact.cliente_id);
        const facturaEnriquecida = {
          ...vistaFact,
          cliente_cif:      vistaFact.cliente_cif     || cli?.cif        || "",
          cliente_direccion: vistaFact.cliente_direccion || formatDireccion(cli||{}) || "",
          cliente_dir_fiscal: cli?.dir_fiscal_distinta
            ? formatDireccion(cli||{}, "fiscal_")
            : null,
          cliente_dir_envio:vistaFact.cliente_dir_envio|| cli?.dir_envio_facturas || "",
          cliente_dir_fiscal_distinta: cli?.dir_fiscal_distinta || false,
          cliente_email:    vistaFact.cliente_email    || cli?.email_facturas || cli?.email || "",
        };
        return <VistaFactura factura={facturaEnriquecida} onClose={()=>setVistaFact(null)} onSyncFiscal={sincronizarFacturaVerifactiAhora} onExportFiscal={descargarJustificanteFiscal} onCambiarEstado={canEdit ? cambiarEstado : null} rectificadasIds={rectificadasIds} onRectificar={f=>{setVistaFact(null);setModalRect(f);}}/>;
      })()}
      {/* Paginacion */}
      {activeFacturacionTab === "facturas" && totalPages>1&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:8,padding:"12px 0",flexWrap:"wrap"}}>
          <button onClick={()=>setPage(1)} disabled={page===1} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===1?"not-allowed":"pointer",opacity:page===1?.5:1}}>{"<<"}</button>
          <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{padding:"5px 12px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===1?"not-allowed":"pointer",opacity:page===1?.5:1}}>{"< Anterior"}</button>
          <span style={{fontSize:13,color:"var(--text3)",fontWeight:600,padding:"0 8px"}}>Pagina {page} de {totalPages} - {totalCount} facturas</span>
          <button onClick={()=>setPage(p=>Math.min(totalPages,p+1))} disabled={page===totalPages} style={{padding:"5px 12px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===totalPages?"not-allowed":"pointer",opacity:page===totalPages ? .5 : 1}}>{"Siguiente >"}</button>
          <button onClick={()=>setPage(totalPages)} disabled={page===totalPages} style={{padding:"5px 10px",borderRadius:6,border:"1px solid var(--border2)",background:"var(--bg3)",color:"var(--text4)",fontSize:12,cursor:page===totalPages?"not-allowed":"pointer",opacity:page===totalPages ? .5 : 1}}>{">>"}</button>
        </div>
      )}

      {pagoProveedorEdit && (
        <div style={{...S.modal,zIndex:260}} onClick={e=>e.target===e.currentTarget&&setPagoProveedorEdit(null)}>
          <div style={{background:"var(--bg2)",border:"1px solid #1e2d45",borderRadius:10,width:"min(760px,96vw)",maxHeight:"90vh",overflow:"auto",padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",gap:12,alignItems:"flex-start",marginBottom:12}}>
              <div>
                <div style={{fontFamily:"'Syne',sans-serif",fontWeight:900,fontSize:18,color:"var(--text)"}}>Gestion pago proveedor</div>
                <div style={{fontSize:12,color:"var(--text4)",marginTop:3}}>
                  {pagoProveedorEdit.numero} - {pagoProveedorEdit.colaborador_nombre} - {pagoProveedorEdit.origen} &gt; {pagoProveedorEdit.destino}
                </div>
              </div>
              <button onClick={()=>setPagoProveedorEdit(null)} style={{...S.btn,background:"var(--bg4)",color:"var(--text3)",border:"1px solid #1e2d45"}}>Cerrar</button>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(190px,1fr))",gap:10}}>
              <label>
                <span style={S.lbl}>Importe proveedor</span>
                <input value={pagoProveedorForm.importe ?? ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,importe:e.target.value}))} style={S.inp} />
              </label>
              <label>
                <span style={S.lbl}>Fecha recepcion factura</span>
                <input type="date" value={pagoProveedorForm.fecha_recepcion || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,fecha_recepcion:e.target.value}))} style={S.inp} />
              </label>
              <label>
                <span style={S.lbl}>Fecha aviso / pago</span>
                <input type="date" value={pagoProveedorForm.fecha_pago_calculada || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,fecha_pago_calculada:e.target.value}))} style={S.inp} />
              </label>
              <label>
                <span style={S.lbl}>Fecha pago real</span>
                <input type="date" value={pagoProveedorForm.fecha_pago_real || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,fecha_pago_real:e.target.value,pagado:Boolean(e.target.value)}))} style={S.inp} />
              </label>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(240px,1fr))",gap:10,marginTop:8}}>
              <label>
                <span style={S.lbl}>Factura proveedor</span>
                <input value={pagoProveedorForm.factura_nombre || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,factura_nombre:e.target.value}))} placeholder="Numero o nombre de factura" style={S.inp} />
              </label>
              <label>
                <span style={S.lbl}>Adjuntar factura</span>
                <input type="file" accept=".pdf,image/*" onChange={e=>leerFacturaProveedor(e.target.files?.[0])} style={{...S.inp,padding:"6px 8px"}} />
              </label>
              <label>
                <span style={S.lbl}>Fecha documentacion recibida</span>
                <input type="date" value={pagoProveedorForm.fecha_documentacion_recepcion || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,fecha_documentacion_recepcion:e.target.value,documentacion_recibida:Boolean(e.target.value)}))} style={S.inp} />
              </label>
            </div>

            <div style={{display:"flex",gap:12,flexWrap:"wrap",marginTop:12}}>
              <label style={{display:"flex",alignItems:"center",gap:7,fontSize:13,color:"var(--text3)",fontWeight:700}}>
                <input type="checkbox" checked={Boolean(pagoProveedorForm.documentacion_recibida)} onChange={e=>setPagoProveedorForm(prev=>({...prev,documentacion_recibida:e.target.checked,fecha_documentacion_recepcion:e.target.checked && !prev.fecha_documentacion_recepcion ? new Date().toISOString().slice(0,10) : prev.fecha_documentacion_recepcion}))} />
                Documentacion recepcionada
              </label>
              <label style={{display:"flex",alignItems:"center",gap:7,fontSize:13,color:"var(--text3)",fontWeight:700}}>
                <input type="checkbox" checked={Boolean(pagoProveedorForm.pagado)} onChange={e=>setPagoProveedorForm(prev=>({...prev,pagado:e.target.checked,fecha_pago_real:e.target.checked && !prev.fecha_pago_real ? new Date().toISOString().slice(0,10) : prev.fecha_pago_real}))} />
                Pagado
              </label>
            </div>

            <label>
              <span style={S.lbl}>Notas / orden de pago</span>
              <textarea value={pagoProveedorForm.notas_pago || ""} onChange={e=>setPagoProveedorForm(prev=>({...prev,notas_pago:e.target.value}))} rows={3} style={{...S.inp,resize:"vertical"}} placeholder="Notas internas, numero de orden de pago o instrucciones para administracion." />
            </label>

            <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap",marginTop:16}}>
              {pagoProveedorForm.factura_data && <button onClick={()=>verFacturaProveedor(pagoProveedorForm.factura_data)} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.24)"}}>Ver factura adjunta</button>}
              <button onClick={()=>guardarGestionPagoProveedor({documentacion_recibida:true,fecha_documentacion_recepcion:pagoProveedorForm.fecha_documentacion_recepcion || new Date().toISOString().slice(0,10)})} style={{...S.btn,background:"rgba(59,130,246,.12)",color:"var(--accent)",border:"1px solid rgba(59,130,246,.24)"}}>Marcar docs recibida</button>
              <button onClick={async()=>{
                const pendientes = [
                  !pagoProveedorForm.factura_nombre ? "falta la factura del proveedor" : null,
                  !pagoProveedorForm.documentacion_recibida ? "falta confirmar la documentacion" : null,
                ].filter(Boolean);
                if (pendientes.length) {
                  const ok = await confirmDialog({
                    title: "Pago con revision pendiente",
                    message: `Este pago tiene ${pendientes.join(" y ")}. Quieres marcarlo como pagado igualmente?`,
                    confirmText: "Pagar igualmente",
                    tone: "warning",
                  });
                  if (!ok) return;
                }
                await guardarGestionPagoProveedor({pagado:true,fecha_pago_real:pagoProveedorForm.fecha_pago_real || new Date().toISOString().slice(0,10)});
              }} style={{...S.btn,background:"rgba(34,211,160,.12)",color:"var(--green)",border:"1px solid rgba(34,211,160,.24)"}}>Marcar pagado</button>
              <button onClick={()=>guardarGestionPagoProveedor()} style={{...S.btn,background:"var(--green)",color:"#04130f"}}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {modalMulti && <ModalFacturarMultiple onClose={()=>{setModalMulti(false);cargar();}}/>}
      {modalRect && <ModalRectificativa facturaOriginal={modalRect} onClose={()=>setModalRect(null)} onSaved={()=>{setModalRect(null);cargar();}}/>}
    </div>
  );
}

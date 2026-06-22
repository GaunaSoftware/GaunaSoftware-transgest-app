const { cacheMiddleware } = require("../services/cache");
// src/routes/colaboradores.js
const express = require("express");
const crypto = require("crypto");
const db      = require("../services/db");
const { authenticate, GERENTE_O_TRAFICO } = require("../middleware/auth");
const { crearNotificacion, ensureNotificacionesSchema } = require("../services/notificaciones");
const { enviarEmail } = require("../services/email");
const { buildDocumentoControlPayload } = require("../services/documentoControl");
const { validateBase64Upload } = require("../services/uploadValidation");
const router  = express.Router();
let colaboradorOpsSchemaPromise = null;

async function ensureColaboradorOpsSchema() {
  if (!colaboradorOpsSchemaPromise) {
    colaboradorOpsSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS colaborador_pagos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
          fecha DATE NOT NULL,
          concepto VARCHAR(180),
          importe NUMERIC(12,2) NOT NULL DEFAULT 0,
          estado VARCHAR(20) NOT NULL DEFAULT 'pagado',
          notas TEXT,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(()=>{});
      await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_pagos_empresa_colaborador_fecha ON colaborador_pagos(empresa_id, colaborador_id, fecha DESC)").catch(()=>{});
      await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN DEFAULT false").catch(()=>{});
      await db.query("ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS origen_creacion VARCHAR(60)").catch(()=>{});
      await db.query(`
        CREATE TABLE IF NOT EXISTS colaborador_documentos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
          tipo VARCHAR(40) NOT NULL DEFAULT 'otro',
          nombre VARCHAR(180) NOT NULL,
          caducidad DATE,
          notas TEXT,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(()=>{});
      await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_documentos_empresa_colaborador_caducidad ON colaborador_documentos(empresa_id, colaborador_id, caducidad)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_documentos ADD COLUMN IF NOT EXISTS file_base64 TEXT").catch(()=>{});
      await db.query("ALTER TABLE colaborador_documentos ADD COLUMN IF NOT EXISTS file_mime VARCHAR(120)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_documentos ADD COLUMN IF NOT EXISTS file_size_kb INTEGER").catch(()=>{});
      await db.query(`
        CREATE TABLE IF NOT EXISTS colaborador_liquidacion_tokens (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
          token_hash VARCHAR(80) NOT NULL UNIQUE,
          expires_at TIMESTAMPTZ NOT NULL,
          opened_at TIMESTAMPTZ,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `).catch(()=>{});
      await db.query("CREATE INDEX IF NOT EXISTS idx_colaborador_liq_tokens_hash ON colaborador_liquidacion_tokens(token_hash)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS acknowledged_ip VARCHAR(80)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS acknowledged_user_agent TEXT").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS downloaded_at TIMESTAMPTZ").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS download_count INTEGER NOT NULL DEFAULT 0").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS downloaded_ip VARCHAR(80)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS downloaded_user_agent TEXT").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS opened_alerted_at TIMESTAMPTZ").catch(()=>{});
      await db.query("ALTER TABLE colaborador_liquidacion_tokens ADD COLUMN IF NOT EXISTS acknowledged_alerted_at TIMESTAMPTZ").catch(()=>{});
      await db.query(`
        CREATE TABLE IF NOT EXISTS colaborador_vehiculos (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          colaborador_id UUID REFERENCES colaboradores(id) ON DELETE CASCADE,
          empresa_id UUID,
          matricula VARCHAR(20) NOT NULL,
          activo BOOLEAN DEFAULT true,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `).catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS marca VARCHAR(100)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS modelo VARCHAR(100)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS tipo VARCHAR(50)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS tara_kg INTEGER").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS carga_max_kg INTEGER").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS bastidor VARCHAR(100)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS num_ejes INTEGER").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS longitud_m NUMERIC(5,2)").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS notas TEXT").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS doc_tarjeta_transp TEXT").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS doc_tarjeta_exp DATE").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS doc_seguro_venc DATE").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS doc_itv_venc DATE").catch(()=>{});
      await db.query("ALTER TABLE colaborador_vehiculos ADD COLUMN IF NOT EXISTS doc_tacografo_venc DATE").catch(()=>{});
    })().catch((error) => {
      colaboradorOpsSchemaPromise = null;
      throw error;
    });
  }
  await colaboradorOpsSchemaPromise;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicBaseUrl(req) {
  const envUrl = process.env.PUBLIC_APP_URL || process.env.APP_PUBLIC_URL || "";
  const reqUrl = req?.protocol && typeof req.get === "function" ? `${req.protocol}://${req.get("host")}` : "";
  const isLocal = (value) => {
    try {
      const url = new URL(String(value || ""));
      return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    } catch {
      return false;
    }
  };
  if (envUrl && !(isLocal(envUrl) && reqUrl && !isLocal(reqUrl))) return envUrl;
  return reqUrl || "http://localhost";
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  return `${Number(value || 0).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function dateEs(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-ES");
}

function safeFilename(value, fallback = "documento") {
  const cleaned = String(value || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function isAlbaranDoc(doc = {}) {
  const raw = `${doc.tipo || ""} ${doc.nombre || ""}`.toLowerCase();
  return raw.includes("albaran") || raw.includes("albarán") || raw.includes("pod") || raw.includes("cmr");
}

function fechaMediodia(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  }
  const raw = String(value || "").trim();
  if (!raw) return null;
  const iso = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  const parsed = iso ? new Date(`${iso[1]}T12:00:00`) : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate(), 12, 0, 0, 0);
}

function documentStatus(doc = {}) {
  if (!doc.caducidad) return { label: "Sin caducidad", cls: "amber", days: null };
  const d = fechaMediodia(doc.caducidad);
  if (!d) return { label: "Sin caducidad", cls: "amber", days: null };
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Math.ceil((d.getTime() - today.getTime()) / 86400000);
  if (days < 0) return { label: "Caducado", cls: "red", days };
  if (days <= 30) return { label: `${days} dias`, cls: "amber", days };
  return { label: `${days} dias`, cls: "green", days };
}

function diasHastaFecha(value) {
  if (!value) return null;
  const d = fechaMediodia(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.ceil((d.getTime() - today.getTime()) / 86400000);
}

function facturaNumero(f = {}) {
  return f.numero_factura || f.num_factura || f.numero || "";
}

const QA_COLABORADOR_SQL_FILTER = `
  NOT (
    LOWER(COALESCE(nombre,'')) LIKE 'qa colaborador revision %'
    OR LOWER(COALESCE(email,'')) LIKE 'qa-colaborador-%@example.com'
    OR UPPER(COALESCE(cif,'')) LIKE 'QAREV%'
  )
`;

function estadoFacturasProveedor(facturas = []) {
  const pendientes = facturas.filter(f => !["pagada", "pagado"].includes(String(f.estado || "").toLowerCase()));
  const vencidas = pendientes.filter(f => {
    const dias = diasHastaFecha(f.vencimiento);
    return dias !== null && dias < 0;
  });
  const proximas = pendientes.filter(f => {
    const dias = diasHastaFecha(f.vencimiento);
    return dias !== null && dias >= 0 && dias <= 7;
  });
  const sinVencimiento = pendientes.filter(f => !f.vencimiento);
  const sinNumero = facturas.filter(f => !facturaNumero(f));
  return { pendientes, vencidas, proximas, sinVencimiento, sinNumero };
}

function situacionFacturaProveedor(f = {}) {
  const estado = String(f.estado || "").toLowerCase();
  if (["pagada", "pagado"].includes(estado)) return { label: "Pagada", cls: "green", dias_vencimiento: diasHastaFecha(f.vencimiento) };
  if (!facturaNumero(f)) return { label: "Pendiente de numero", cls: "amber", dias_vencimiento: diasHastaFecha(f.vencimiento) };
  const dias = diasHastaFecha(f.vencimiento);
  if (dias !== null && dias < 0) return { label: `Vencida hace ${Math.abs(dias)} dia(s)`, cls: "red", dias_vencimiento: dias };
  if (dias !== null && dias <= 7) return { label: `Vence en ${dias} dia(s)`, cls: "amber", dias_vencimiento: dias };
  if (["revisada", "validada", "aceptada"].includes(estado)) return { label: "Revisada, pendiente de pago", cls: "amber", dias_vencimiento: dias };
  if (estado === "pendiente") return { label: "Pendiente de revision", cls: "amber", dias_vencimiento: dias };
  return { label: f.estado || "Pendiente", cls: "amber", dias_vencimiento: dias };
}

function resumenPagosProveedor(viajes = [], facturas = [], pagos = []) {
  const totalViajes = viajes.reduce((s, p) => s + Number(p.importe_colaborador || p.precio_colaborador || 0), 0);
  const totalFacturado = facturas.reduce((s, f) => s + Number(f.total || 0), 0);
  const totalPagado = pagos
    .filter(p => ["pagado", "pagada"].includes(String(p.estado || "").toLowerCase()))
    .reduce((s, p) => s + Number(p.importe || 0), 0);
  const pendienteFactura = Math.max(0, totalViajes - totalFacturado);
  const pendientePago = Math.max(0, totalFacturado - totalPagado);
  return {
    total_viajes: totalViajes,
    total_facturado: totalFacturado,
    total_pagado: totalPagado,
    pendiente_factura: pendienteFactura,
    pendiente_pago: pendientePago,
    pagos_registrados: pagos.length,
    facturas_recibidas: facturas.length,
    estado: pendientePago > 0 ? "pendiente_pago" : pendienteFactura > 0 ? "pendiente_factura" : "al_dia",
  };
}

function resumenDocumentosProveedor(documentos = []) {
  const enriched = documentos.map(d => ({ ...d, estado_doc: documentStatus(d) }));
  return {
    total: enriched.length,
    caducados: enriched.filter(d => d.estado_doc.days !== null && d.estado_doc.days < 0).length,
    proximos_30: enriched.filter(d => d.estado_doc.days !== null && d.estado_doc.days >= 0 && d.estado_doc.days <= 30).length,
    sin_caducidad: enriched.filter(d => d.estado_doc.days === null).length,
    estado: enriched.some(d => d.estado_doc.days !== null && d.estado_doc.days < 0)
      ? "bloqueante"
      : enriched.some(d => d.estado_doc.days !== null && d.estado_doc.days <= 30)
        ? "revisar"
        : "ok",
  };
}

function docsVehiculoProveedor(v = {}) {
  return [
    { clave: "tarjeta_transporte", nombre: "Tarjeta transporte", caducidad: v.doc_tarjeta_exp || null },
    { clave: "seguro", nombre: "Seguro", caducidad: v.doc_seguro_venc || null },
    { clave: "itv", nombre: "ITV", caducidad: v.doc_itv_venc || null },
    { clave: "tacografo", nombre: "Tacografo", caducidad: v.doc_tacografo_venc || null },
  ].map(doc => {
    const status = documentStatus(doc);
    return {
      ...doc,
      estado: status.label,
      estado_color: status.cls,
      dias: status.days,
    };
  });
}

function resumenVehiculosProveedor(vehiculos = []) {
  const docs = vehiculos.flatMap(docsVehiculoProveedor);
  return {
    total_vehiculos: vehiculos.length,
    documentos_revisados: docs.length,
    caducados: docs.filter(d => d.dias !== null && d.dias < 0).length,
    proximos_30: docs.filter(d => d.dias !== null && d.dias >= 0 && d.dias <= 30).length,
    sin_fecha: docs.filter(d => d.dias === null).length,
    estado: docs.some(d => d.dias !== null && d.dias < 0)
      ? "bloqueante"
      : docs.some(d => d.dias !== null && d.dias <= 30) || docs.some(d => d.dias === null)
        ? "revisar"
        : "ok",
  };
}

function accionesPortalProveedor({ pagos, documentos, vehiculos, facturas, viajes }) {
  const acciones = [];
  if (documentos.caducados > 0) acciones.push({
    tipo: "documentos_caducados",
    prioridad: "alta",
    tab: "documentos",
    titulo: "Documentacion administrativa caducada",
    detalle: `${documentos.caducados} documento(s) caducado(s)`,
  });
  if (vehiculos.caducados > 0) acciones.push({
    tipo: "vehiculos_caducados",
    prioridad: "alta",
    tab: "vehiculos",
    titulo: "Documentacion de vehiculo caducada",
    detalle: `${vehiculos.caducados} documento(s) de vehiculo caducado(s)`,
  });
  if (facturas.vencidas.length > 0) acciones.push({
    tipo: "facturas_vencidas",
    prioridad: "alta",
    tab: "facturas",
    titulo: "Facturas vencidas pendientes",
    detalle: `${facturas.vencidas.length} factura(s) vencida(s)`,
  });
  if (documentos.proximos_30 > 0 || vehiculos.proximos_30 > 0) acciones.push({
    tipo: "caducidades_proximas",
    prioridad: "media",
    tab: documentos.proximos_30 > 0 ? "documentos" : "vehiculos",
    titulo: "Caducidades proximas",
    detalle: `${documentos.proximos_30 + vehiculos.proximos_30} documento(s) vencen en 30 dias`,
  });
  if (pagos.pendiente_pago > 0) acciones.push({
    tipo: "pendiente_pago",
    prioridad: "media",
    tab: "pagos",
    titulo: "Importe pendiente de pago",
    detalle: money(pagos.pendiente_pago),
  });
  if (pagos.pendiente_factura > 0) acciones.push({
    tipo: "pendiente_factura",
    prioridad: "media",
    tab: "facturas",
    titulo: "Viajes pendientes de factura",
    detalle: money(pagos.pendiente_factura),
  });
  if (viajes.sin_soporte > 0) acciones.push({
    tipo: "viajes_sin_soporte",
    prioridad: "media",
    tab: "viajes",
    titulo: "Viajes sin albaran/POD/CMR",
    detalle: `${viajes.sin_soporte} viaje(s) sin soporte documental`,
  });
  return acciones;
}

function buildPortalProveedorResumen(data = {}) {
  const viajes = data.viajes || [];
  const facturas = data.facturas || [];
  const pagos = data.pagos || [];
  const documentos = data.documentos || [];
  const vehiculos = data.vehiculos || [];
  const viajesResumen = {
    total: viajes.length,
    con_soporte: viajes.filter(v => Number(v.albaranes_count || 0) > 0).length,
    sin_soporte: viajes.filter(v => Number(v.albaranes_count || 0) <= 0).length,
  };
  const pagosResumen = resumenPagosProveedor(viajes, facturas, pagos);
  const documentosResumen = resumenDocumentosProveedor(documentos);
  const vehiculosResumen = resumenVehiculosProveedor(vehiculos);
  const facturasEstado = estadoFacturasProveedor(facturas);
  const facturasResumen = {
    total: facturas.length,
    pendientes: facturasEstado.pendientes.length,
    vencidas: facturasEstado.vencidas.length,
    proximas_7: facturasEstado.proximas.length,
    sin_numero: facturasEstado.sinNumero.length,
    sin_vencimiento: facturasEstado.sinVencimiento.length,
  };
  return {
    colaborador: {
      id: data.token?.colaborador_id,
      nombre: data.token?.nombre || "",
      cif: data.token?.cif || "",
    },
    generated_at: new Date().toISOString(),
    viajes: viajesResumen,
    facturas: facturasResumen,
    pagos: pagosResumen,
    documentos: documentosResumen,
    vehiculos: vehiculosResumen,
    acciones: accionesPortalProveedor({
      pagos: pagosResumen,
      documentos: documentosResumen,
      vehiculos: vehiculosResumen,
      facturas: facturasEstado,
      viajes: viajesResumen,
    }),
    _facturas_estado: facturasEstado,
  };
}

function renderPortalProveedorAccionesHtml(data = {}, tokenValue = "") {
  const resumen = buildPortalProveedorResumen(data);
  const viajes = data.viajes || [];
  const facturas = data.facturas || [];
  const documentos = data.documentos || [];
  const vehiculos = data.vehiculos || [];
  const accionesRows = resumen.acciones.map(a => `<tr>
    <td><span class="${a.prioridad === "alta" ? "red" : "amber"}">${htmlEscape(a.prioridad)}</span></td>
    <td>${htmlEscape(a.titulo)}</td>
    <td>${htmlEscape(a.detalle)}</td>
    <td>${htmlEscape(a.tab || "-")}</td>
  </tr>`).join("");
  const viajesSinSoporte = viajes
    .filter(v => Number(v.albaranes_count || 0) <= 0)
    .slice(0, 80)
    .map(v => `<tr>
      <td>${htmlEscape(v.numero || v.referencia_cliente || v.id)}</td>
      <td>${htmlEscape(dateEs(v.fecha_carga))}</td>
      <td>${htmlEscape([v.origen, v.destino].filter(Boolean).join(" -> ") || "-")}</td>
      <td>${htmlEscape(v.cliente_nombre || "-")}</td>
      <td class="money">${htmlEscape(money(v.importe_colaborador || v.precio_colaborador))}</td>
    </tr>`).join("");
  const facturasPendientes = facturas
    .filter(f => !["pagada", "pagado"].includes(String(f.estado || "").toLowerCase()))
    .slice(0, 80)
    .map(f => {
      const sit = situacionFacturaProveedor(f);
      return `<tr>
        <td>${htmlEscape(facturaNumero(f) || "Sin numero")}</td>
        <td>${htmlEscape(f.referencia_orden || f.referencia_cliente || "-")}</td>
        <td>${htmlEscape(dateEs(f.vencimiento))}</td>
        <td class="${sit.cls}">${htmlEscape(sit.label)}</td>
        <td class="money">${htmlEscape(money(f.total))}</td>
      </tr>`;
    }).join("");
  const documentosRiesgo = documentos
    .map(d => ({ ...d, status: documentStatus(d) }))
    .filter(d => d.status.days === null || d.status.days <= 30)
    .slice(0, 80)
    .map(d => `<tr>
      <td>${htmlEscape(d.nombre || "-")}</td>
      <td>${htmlEscape(d.tipo || "-")}</td>
      <td>${htmlEscape(dateEs(d.caducidad))}</td>
      <td class="${d.status.cls}">${htmlEscape(d.status.label)}</td>
    </tr>`).join("");
  const vehiculosRiesgo = vehiculos.flatMap(v => docsVehiculoProveedor(v)
    .filter(d => ["red", "amber"].includes(d.estado_color))
    .map(d => ({ matricula: v.matricula, nombre: d.nombre, caducidad: d.caducidad, estado: d.estado, cls: d.estado_color })))
    .slice(0, 80)
    .map(d => `<tr>
      <td>${htmlEscape(d.matricula || "-")}</td>
      <td>${htmlEscape(d.nombre || "-")}</td>
      <td>${htmlEscape(dateEs(d.caducidad))}</td>
      <td class="${d.cls}">${htmlEscape(d.estado || "-")}</td>
    </tr>`).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Informe de acciones proveedor</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1080px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      table{width:100%;border-collapse:collapse;margin-top:10px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}.money{text-align:right;font-weight:800}.green{color:#047857}.amber{color:#b45309}.red{color:#dc2626}
      .note{border:1px solid #dbe3ef;border-radius:9px;background:#f8fafc;padding:12px;font-size:13px;line-height:1.45;color:#334155}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Informe de acciones proveedor</h1>
      <div class="sub">${htmlEscape(resumen.colaborador.nombre || "Colaborador")} - generado el ${htmlEscape(new Date().toLocaleString("es-ES"))} desde TransGest.</div>
      <div class="grid">
        <div class="box"><div class="metric ${resumen.acciones.length ? "amber" : "green"}">${htmlEscape(resumen.acciones.length)}</div><div class="muted">Acciones pendientes</div></div>
        <div class="box"><div class="metric ${resumen.viajes.sin_soporte ? "amber" : "green"}">${htmlEscape(resumen.viajes.sin_soporte)}</div><div class="muted">Viajes sin soporte</div></div>
        <div class="box"><div class="metric ${resumen.facturas.vencidas ? "red" : "green"}">${htmlEscape(resumen.facturas.vencidas)}</div><div class="muted">Facturas vencidas</div></div>
        <div class="box"><div class="metric ${resumen.pagos.pendiente_pago > 0 ? "red" : "green"}">${htmlEscape(money(resumen.pagos.pendiente_pago))}</div><div class="muted">Pendiente de pago</div></div>
        <div class="box"><div class="metric ${resumen.pagos.pendiente_factura > 0 ? "amber" : "green"}">${htmlEscape(money(resumen.pagos.pendiente_factura))}</div><div class="muted">Pendiente de factura</div></div>
        <div class="box"><div class="metric ${resumen.documentos.caducados || resumen.vehiculos.caducados ? "red" : resumen.documentos.proximos_30 || resumen.vehiculos.proximos_30 ? "amber" : "green"}">${htmlEscape(resumen.documentos.caducados + resumen.documentos.proximos_30 + resumen.vehiculos.caducados + resumen.vehiculos.proximos_30)}</div><div class="muted">Avisos documentales</div></div>
      </div>
      <div class="note">Este informe resume lo que el proveedor debe resolver para evitar bloqueos de documentacion, facturacion o pago. Los enlaces operativos siguen disponibles desde el portal seguro.</div>
      <h2>Prioridades</h2>
      <table><thead><tr><th>Prioridad</th><th>Accion</th><th>Detalle</th><th>Zona portal</th></tr></thead><tbody>${accionesRows || "<tr><td colspan='4'>Sin acciones urgentes.</td></tr>"}</tbody></table>
      <h2>Viajes sin soporte documental</h2>
      <table><thead><tr><th>Pedido</th><th>Fecha</th><th>Ruta</th><th>Cliente</th><th class="money">Importe</th></tr></thead><tbody>${viajesSinSoporte || "<tr><td colspan='5'>Todos los viajes revisados tienen soporte documental.</td></tr>"}</tbody></table>
      <h2>Facturas pendientes o en riesgo</h2>
      <table><thead><tr><th>Factura</th><th>Referencia</th><th>Vencimiento</th><th>Situacion</th><th class="money">Total</th></tr></thead><tbody>${facturasPendientes || "<tr><td colspan='5'>Sin facturas pendientes.</td></tr>"}</tbody></table>
      <h2>Documentacion administrativa</h2>
      <table><thead><tr><th>Documento</th><th>Tipo</th><th>Caducidad</th><th>Estado</th></tr></thead><tbody>${documentosRiesgo || "<tr><td colspan='4'>Sin documentos administrativos en riesgo.</td></tr>"}</tbody></table>
      <h2>Documentacion de vehiculos</h2>
      <table><thead><tr><th>Matricula</th><th>Documento</th><th>Caducidad</th><th>Estado</th></tr></thead><tbody>${vehiculosRiesgo || "<tr><td colspan='4'>Sin documentos de vehiculo en riesgo.</td></tr>"}</tbody></table>
      ${tokenValue ? `<p class="sub">Portal seguro asociado: ${htmlEscape(String(tokenValue).slice(0, 8))}...</p>` : ""}
    </main></body></html>`;
}

async function logPedidoEventoPortal(pedidoId, empresaId, tipo, detalle = {}) {
  await db.query(
    `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,detalle)
     VALUES ($1,$2,$3,'colaborador_portal',$4)`,
    [pedidoId, empresaId, tipo, JSON.stringify(detalle || {})]
  ).catch(() => {});
}

async function notificarAlbaranProveedor(empresaId, pedido = {}, colaborador = {}, documento = {}) {
  if (documento.skip_notificacion) return;
  const usuarios = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','trafico','administrativo','contable')
      LIMIT 30`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all((usuarios.rows || []).map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "colaborador_albaran_subido",
    titulo: "Albaran recibido de proveedor",
    mensaje: `${colaborador.nombre || "Colaborador"} ha subido ${documento.nombre || "un albaran"} para ${pedido.numero || pedido.id}.`,
    data: {
      pedido_id: pedido.id,
      colaborador_id: colaborador.id,
      documento_id: documento.id,
      view: "pedidos",
      dedupe_key: `colaborador_albaran_subido:${documento.id || pedido.id || ""}`,
    },
  }).catch(() => null)));
}

async function notificarFacturaProveedor(empresaId, pedido = {}, colaborador = {}, factura = {}) {
  if (factura.skip_notificacion) return;
  const usuarios = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','administrativo','contable')
      LIMIT 30`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all((usuarios.rows || []).map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "colaborador_factura_subida",
    titulo: "Factura recibida de proveedor",
    mensaje: `${colaborador.nombre || "Colaborador"} ha subido factura ${facturaNumero(factura) || ""} para ${pedido.numero || pedido.id}.`.trim(),
    data: {
      pedido_id: pedido.id,
      colaborador_id: colaborador.id,
      factura_id: factura.id,
      view: "colaboradores",
      dedupe_key: `colaborador_factura_subida:${factura.id || pedido.id || facturaNumero(factura) || ""}`,
    },
  }).catch(() => null)));
}

async function notificarDocumentoProveedor(empresaId, colaborador = {}, documento = {}) {
  if (documento.skip_notificacion) return;
  const usuarios = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','trafico','administrativo','contable')
      LIMIT 30`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all((usuarios.rows || []).map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "colaborador_documento_subido",
    titulo: "Documento recibido de proveedor",
    mensaje: `${colaborador.nombre || "Colaborador"} ha subido ${documento.nombre || "un documento administrativo"}.`,
    data: {
      colaborador_id: colaborador.id,
      documento_id: documento.id,
      view: "colaboradores",
      dedupe_key: `colaborador_documento_subido:${documento.id || colaborador.id || ""}`,
    },
  }).catch(() => null)));
}

function isQaRequest(req) {
  return String(req.get?.("x-transgest-qa") || "").trim() === "1";
}

function renderLiquidacionColaboradorHtml({ colaborador, viajes, facturas, pagos, documentos = [], vehiculos = [], token = "" }) {
  const totalViajes = viajes.reduce((s, p) => s + Number(p.importe_colaborador || p.precio_colaborador || 0), 0);
  const totalFacturado = facturas.reduce((s, f) => s + Number(f.total || 0), 0);
  const totalPagado = pagos.filter(p => String(p.estado || "") === "pagado").reduce((s, p) => s + Number(p.importe || 0), 0);
  const pendienteFactura = Math.max(0, totalViajes - totalFacturado);
  const pendientePago = Math.max(0, totalFacturado - totalPagado);
  const estadoProveedor = estadoFacturasProveedor(facturas);
  const pagosResumen = resumenPagosProveedor(viajes, facturas, pagos);
  const documentosResumen = resumenDocumentosProveedor(documentos);
  const vehiculosResumen = resumenVehiculosProveedor(vehiculos);
  const viajesResumen = {
    total: viajes.length,
    con_soporte: viajes.filter(v => Number(v.albaranes_count || 0) > 0).length,
    sin_soporte: viajes.filter(v => Number(v.albaranes_count || 0) <= 0).length,
  };
  const acciones = accionesPortalProveedor({
    pagos: pagosResumen,
    documentos: documentosResumen,
    vehiculos: vehiculosResumen,
    facturas: estadoProveedor,
    viajes: viajesResumen,
  });
  const docsCaducados = documentos.filter(d => documentStatus(d).days !== null && documentStatus(d).days < 0);
  const docsProximos = documentos.filter(d => {
    const days = documentStatus(d).days;
    return days !== null && days >= 0 && days <= 30;
  });
  const accionRows = acciones.map(a => `<div class="action ${a.prioridad === "alta" ? "danger" : "notice"}">
    <span class="pill">${htmlEscape(a.prioridad)}</span>
    <strong>${htmlEscape(a.titulo)}</strong>
    <span>${htmlEscape(a.detalle)}</span>
  </div>`).join("");
  const viajeRows = viajes.map(v => `<tr>
    <td>${htmlEscape(v.numero || v.referencia_cliente || v.id)}</td>
    <td>${htmlEscape(dateEs(v.fecha_carga))}</td>
    <td>${htmlEscape([v.origen, v.destino].filter(Boolean).join(" -> ") || "-")}</td>
    <td>${htmlEscape(v.cliente_nombre || "-")}</td>
    <td class="money">${htmlEscape(money(v.importe_colaborador || v.precio_colaborador))}</td>
    <td>${Number(v.albaranes_count || 0) > 0 ? `<span class="green">${htmlEscape(v.albaranes_count)} disponible(s)</span>` : `<span class="amber">Pendiente</span>`}</td>
    <td>
      ${token ? `<button type="button" class="mini" onclick="verAlbaranes('${htmlEscape(v.id)}')">Ver</button>
      <button type="button" class="mini" onclick="abrirDcd('${htmlEscape(v.id)}')">Documento digital</button>
      <label class="mini upload">Subir albaran<input type="file" accept="image/*,.pdf" onchange="subirAlbaran(event,'${htmlEscape(v.id)}','${htmlEscape(v.numero || v.id)}')"></label>
      <label class="mini upload">Subir factura<input type="file" accept="image/*,.pdf" onchange="subirFactura(event,'${htmlEscape(v.id)}','${htmlEscape(v.numero || v.id)}','${htmlEscape(v.precio_colaborador || v.importe_colaborador || 0)}')"></label>` : "-"}
      <div id="docs-${htmlEscape(v.id)}" class="docs"></div>
    </td>
  </tr>`).join("");
  const facturaRows = facturas.map(f => {
    const situacion = situacionFacturaProveedor(f);
    return `<tr>
    <td>${htmlEscape(facturaNumero(f) || "Sin numero")}</td>
    <td>${htmlEscape(f.referencia_orden || f.referencia_cliente || "-")}</td>
    <td>${htmlEscape(dateEs(f.fecha))}</td>
    <td>${htmlEscape(dateEs(f.vencimiento))}</td>
    <td>${htmlEscape(f.estado || "-")}</td>
    <td class="${situacion.cls}">${htmlEscape(situacion.label)}</td>
    <td class="money">${htmlEscape(money(f.total))}</td>
    <td>${token && f.archivo_base64 ? `<a class="mini" href="/api/v1/colaboradores/public/portal/${htmlEscape(token)}/facturas/${htmlEscape(f.id)}/descargar">Descargar</a>` : "-"}</td>
  </tr>`;
  }).join("");
  const pagoRows = pagos.map(p => `<tr>
    <td>${htmlEscape(dateEs(p.fecha))}</td>
    <td>${htmlEscape(p.concepto || "-")}</td>
    <td>${htmlEscape(p.estado || "-")}</td>
    <td>${htmlEscape(p.notas || "")}</td>
    <td class="money">${htmlEscape(money(p.importe))}</td>
  </tr>`).join("");
  const documentoRows = documentos.map(d => {
    const status = documentStatus(d);
    return `<tr>
      <td>${htmlEscape(d.nombre || "-")}</td>
      <td>${htmlEscape(d.tipo || "-")}</td>
      <td>${htmlEscape(dateEs(d.caducidad))}</td>
      <td class="${status.cls}">${htmlEscape(status.label)}</td>
      <td>${htmlEscape(d.notas || "")}${token && d.file_base64 ? `<br><a class="mini" href="/api/v1/colaboradores/public/portal/${htmlEscape(token)}/documentos/${htmlEscape(d.id)}/descargar">Descargar</a>` : ""}</td>
    </tr>`;
  }).join("");
  const vehiculoRows = vehiculos.map(v => {
    const docs = docsVehiculoProveedor(v);
    const docsText = docs.map(d => `<span class="${d.estado_color}">${htmlEscape(d.nombre)}: ${htmlEscape(d.estado)}</span>`).join("<br>");
    return `<tr>
      <td>${htmlEscape(v.matricula || "-")}</td>
      <td>${htmlEscape([v.marca, v.modelo].filter(Boolean).join(" ") || "-")}</td>
      <td>${htmlEscape(v.tipo || "-")}</td>
      <td>${docsText || "-"}</td>
    </tr>`;
  }).join("");
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Liquidacion ${htmlEscape(colaborador.nombre || "")}</title>
    <style>
      body{font-family:Arial,sans-serif;background:#f8fafc;color:#111827;margin:0;padding:28px}
      main{max-width:1080px;margin:0 auto;background:#fff;border:1px solid #dbe3ef;border-radius:12px;padding:24px 28px}
      h1{font-size:24px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:18px}
      h2{font-size:16px;margin:22px 0 8px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:16px 0}
      .box{border:1px solid #e5e7eb;border-radius:9px;background:#f8fafc;padding:12px}.metric{font-size:20px;font-weight:800}.muted{font-size:11px;color:#64748b;margin-top:4px}
      .ack{margin:18px 0;padding:14px 16px;border:1px solid #bbf7d0;background:#f0fdf4;border-radius:9px;color:#166534}.ack button{background:#047857;color:white;border:0;border-radius:7px;padding:10px 14px;font-weight:800;cursor:pointer}.ack.done{border-color:#d1fae5;background:#ecfdf5}
      .warn{margin:18px 0;padding:14px 16px;border:1px solid #fed7aa;background:#fff7ed;border-radius:9px;color:#9a3412;font-size:13px;line-height:1.45}
      .actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0 18px}
      .action{border:1px solid #dbe3ef;border-radius:9px;background:#f8fafc;padding:12px;font-size:13px;display:grid;gap:5px}
      .action.danger{border-color:#fecaca;background:#fff1f2;color:#991b1b}.action.notice{border-color:#fed7aa;background:#fff7ed;color:#92400e}.pill{font-size:10px;text-transform:uppercase;font-weight:800;color:#64748b}
      .download{display:inline-flex;margin:0 0 14px 0;background:#0f766e;color:#fff;text-decoration:none;border-radius:7px;padding:10px 14px;font-weight:800;font-size:13px}
      .mini{display:inline-flex;align-items:center;gap:6px;margin:2px 4px 2px 0;border:1px solid #0f766e;background:#ecfeff;color:#0f766e;border-radius:7px;padding:7px 10px;font-size:12px;font-weight:800;cursor:pointer;text-decoration:none}
      .upload input{display:none}.docs{font-size:11px;color:#64748b;margin-top:5px;line-height:1.5}.docs a{color:#0f766e;font-weight:800}
      table{width:100%;border-collapse:collapse;margin-top:14px}th,td{border-bottom:1px solid #e5e7eb;padding:9px 10px;text-align:left;font-size:12px;vertical-align:top}
      th{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#64748b;background:#f8fafc}.money{text-align:right;font-weight:800}.green{color:#047857}.amber{color:#b45309}.red{color:#dc2626}
      @media print{body{background:#fff;padding:0}main{border:none;border-radius:0;max-width:none}}
    </style></head><body><main>
      <h1>Liquidacion de colaborador</h1>
      <div class="sub">${htmlEscape(colaborador.nombre || "Colaborador")} - generado el ${htmlEscape(new Date().toLocaleString("es-ES"))} desde TransGest.</div>
      <div class="grid">
        <div class="box"><div class="metric amber">${htmlEscape(money(totalViajes))}</div><div class="muted">A pagar por viajes</div></div>
        <div class="box"><div class="metric green">${htmlEscape(money(totalFacturado))}</div><div class="muted">Facturas recibidas</div></div>
        <div class="box"><div class="metric green">${htmlEscape(money(totalPagado))}</div><div class="muted">Pagado registrado</div></div>
        <div class="box"><div class="metric ${pendienteFactura > 0 ? "amber" : "green"}">${htmlEscape(money(pendienteFactura))}</div><div class="muted">Pendiente de factura</div></div>
        <div class="box"><div class="metric ${pendientePago > 0 ? "red" : "green"}">${htmlEscape(money(pendientePago))}</div><div class="muted">Pendiente de pago</div></div>
        <div class="box"><div class="metric ${docsCaducados.length ? "red" : docsProximos.length ? "amber" : "green"}">${htmlEscape(documentos.length)}</div><div class="muted">Documentos registrados</div></div>
        <div class="box"><div class="metric ${docsCaducados.length ? "red" : "green"}">${htmlEscape(docsCaducados.length)}</div><div class="muted">Documentos caducados</div></div>
        <div class="box"><div class="metric ${vehiculosResumen.estado === "bloqueante" ? "red" : vehiculosResumen.estado === "revisar" ? "amber" : "green"}">${htmlEscape(vehiculosResumen.total_vehiculos)}</div><div class="muted">Vehiculos proveedor</div></div>
        <div class="box"><div class="metric ${vehiculosResumen.caducados ? "red" : vehiculosResumen.proximos_30 ? "amber" : "green"}">${htmlEscape(vehiculosResumen.caducados + vehiculosResumen.proximos_30)}</div><div class="muted">Avisos vehiculo</div></div>
        <div class="box"><div class="metric ${estadoProveedor.vencidas.length ? "red" : "green"}">${htmlEscape(estadoProveedor.vencidas.length)}</div><div class="muted">Facturas vencidas</div></div>
        <div class="box"><div class="metric ${estadoProveedor.proximas.length ? "amber" : "green"}">${htmlEscape(estadoProveedor.proximas.length)}</div><div class="muted">Vencen en 7 dias</div></div>
        <div class="box"><div class="metric ${estadoProveedor.sinNumero.length ? "amber" : "green"}">${htmlEscape(estadoProveedor.sinNumero.length)}</div><div class="muted">Facturas sin numero</div></div>
      </div>
      <h2>Prioridades del portal</h2>
      <div class="actions">${accionRows || `<div class="action"><strong>Sin acciones urgentes</strong><span>No hay bloqueos destacados en este enlace.</span></div>`}</div>
      ${(estadoProveedor.vencidas.length || estadoProveedor.proximas.length || estadoProveedor.sinVencimiento.length || estadoProveedor.sinNumero.length) ? `
        <div class="warn">
          <strong>Seguimiento administrativo.</strong>
          Hay ${htmlEscape(estadoProveedor.vencidas.length)} factura(s) vencida(s),
          ${htmlEscape(estadoProveedor.proximas.length)} con vencimiento en 7 dias,
          ${htmlEscape(estadoProveedor.sinVencimiento.length)} sin vencimiento y
          ${htmlEscape(estadoProveedor.sinNumero.length)} sin numero registrado.
        </div>
      ` : ""}
      ${colaborador.acknowledged_at ? `
        <div class="ack done"><strong>Liquidacion revisada.</strong> Confirmada el ${htmlEscape(new Date(colaborador.acknowledged_at).toLocaleString("es-ES"))}.</div>
      ` : token ? `
        <form class="ack" method="post" action="/api/v1/colaboradores/public/liquidacion/${htmlEscape(token)}/ack">
          <p style="margin:0 0 10px 0"><strong>Acuse de recibo</strong></p>
          <p style="margin:0 0 12px 0;font-size:13px">Marca esta liquidacion como recibida/revisada para que administracion tenga constancia.</p>
          <button type="submit">Confirmar revision</button>
        </form>
      ` : ""}
      ${token ? `<a class="download" href="/api/v1/colaboradores/public/liquidacion/${htmlEscape(token)}/descargar">Descargar informe HTML</a>
      <a class="download" style="background:#334155;margin-left:8px" href="/api/v1/colaboradores/public/portal/${htmlEscape(token)}/informe-acciones">Informe de acciones</a>
      <a class="download" style="background:#0f766e;margin-left:8px" href="/api/v1/colaboradores/public/portal/${htmlEscape(token)}/operativa">Modo conductor</a>` : ""}
      <h2>Portal proveedor</h2>
      <div class="warn">
        Puedes revisar tus viajes, confirmar la liquidacion y subir albaranes firmados por viaje. Para subir una factura primero debe existir albaran, POD o CMR del viaje; asi administracion recibe la factura con soporte documental.
      </div>
      ${token ? `<div class="warn">
        <strong>Subir documentacion administrativa.</strong>
        <label class="mini upload">Subir documento<input type="file" accept="image/*,.pdf" onchange="subirDocumentoProveedor(event)"></label>
        <span id="docs-admin-status" class="docs"></span>
      </div>` : ""}
      <h2>Viajes</h2><table><thead><tr><th>Pedido</th><th>Fecha</th><th>Ruta</th><th>Cliente</th><th class="money">Importe</th><th>Albaranes</th><th>Acciones</th></tr></thead><tbody>${viajeRows || "<tr><td colspan='7'>Sin viajes.</td></tr>"}</tbody></table>
      <h2>Facturas recibidas</h2><table><thead><tr><th>Factura</th><th>Referencia</th><th>Fecha</th><th>Vencimiento</th><th>Estado</th><th>Situacion</th><th class="money">Total</th><th>Archivo</th></tr></thead><tbody>${facturaRows || "<tr><td colspan='8'>Sin facturas recibidas.</td></tr>"}</tbody></table>
      <h2>Pagos registrados</h2><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Estado</th><th>Notas</th><th class="money">Importe</th></tr></thead><tbody>${pagoRows || "<tr><td colspan='5'>Sin pagos registrados.</td></tr>"}</tbody></table>
      <h2>Documentacion registrada</h2><table><thead><tr><th>Documento</th><th>Tipo</th><th>Caducidad</th><th>Estado</th><th>Notas</th></tr></thead><tbody>${documentoRows || "<tr><td colspan='5'>Sin documentacion registrada.</td></tr>"}</tbody></table>
      <h2>Vehiculos del proveedor</h2><table><thead><tr><th>Matricula</th><th>Modelo</th><th>Tipo</th><th>Documentacion</th></tr></thead><tbody>${vehiculoRows || "<tr><td colspan='4'>Sin vehiculos registrados.</td></tr>"}</tbody></table>
    </main>
    ${token ? `<script>
      const TOKEN = ${JSON.stringify(token)};
      function msg(id, text, ok){
        const box = document.getElementById('docs-' + id);
        if (box) box.innerHTML = '<span class="' + (ok ? 'green' : 'red') + '">' + String(text || '').replace(/[<>&]/g, '') + '</span>';
      }
      async function verAlbaranes(id){
        const box = document.getElementById('docs-' + id);
        if (!box) return;
        box.textContent = 'Cargando...';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(id) + '/albaranes');
        const data = await res.json().catch(()=>[]);
        if (!res.ok) { box.textContent = data.error || 'No se pudieron cargar los albaranes'; return; }
        if (!Array.isArray(data) || !data.length) { box.textContent = 'Sin albaranes adjuntos todavia.'; return; }
        box.innerHTML = data.map(d => '<a href="' + d.download_url + '">' + (d.nombre || 'albaran') + '</a>').join('<br>');
      }
      async function abrirDcd(id){
        const box = document.getElementById('docs-' + id);
        if (box) box.textContent = 'Preparando documento digital...';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(id) + '/documento-control');
        const data = await res.json().catch(()=>({}));
        if (!res.ok) {
          if (box) box.innerHTML = '<span class="red">' + String(data.error || 'No se pudo preparar el documento digital').replace(/[<>&]/g, '') + '</span>';
          return;
        }
        const url = data.remision && data.remision.download_url ? data.remision.download_url : (data.soporte_url || (data.documento && data.documento.soporte_url) || '');
        if (box) {
          box.innerHTML = (data.status && data.status.ready ? '<span class="green">DCD listo</span>' : '<span class="amber">DCD pendiente de datos</span>')
            + (url ? '<br><a href="' + url + '" target="_blank" rel="noreferrer">Abrir documento digital</a>' : '');
        }
        if (url) window.open(url, '_blank', 'noopener');
      }
      async function subirAlbaran(ev,id,ref){
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { msg(id, 'Archivo demasiado grande', false); return; }
        msg(id, 'Subiendo...', true);
        const reader = new FileReader();
        reader.onload = async () => {
          const body = {
            nombre: file.name || ('albaran-' + ref + '.pdf'),
            tipo: 'albaran_colaborador',
            file_base64: String(reader.result || ''),
            file_mime: file.type || 'application/octet-stream',
            file_size_kb: Math.ceil(file.size / 1024),
            notas: 'Subido desde portal proveedor'
          };
          const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(id) + '/albaranes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(()=>({}));
          if (!res.ok) { msg(id, data.error || 'No se pudo subir el albaran', false); return; }
          msg(id, 'Albaran recibido y trazado.', true);
          verAlbaranes(id);
        };
        reader.readAsDataURL(file);
      }
      async function subirFactura(ev,id,ref,precio){
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { msg(id, 'Archivo demasiado grande', false); return; }
        const numero = window.prompt('Numero de factura del proveedor', '') || '';
        const totalTxt = window.prompt('Total factura EUR', String(precio || '').replace('.', ',')) || '';
        const total = Number(String(totalTxt).replace(',', '.')) || Number(precio || 0) || 0;
        msg(id, 'Subiendo factura...', true);
        const reader = new FileReader();
        reader.onload = async () => {
          const body = {
            numero_factura: numero,
            total,
            archivo_nombre: file.name || ('factura-' + ref + '.pdf'),
            archivo_base64: String(reader.result || ''),
            archivo_mime: file.type || 'application/octet-stream',
            notas: 'Subida desde portal proveedor'
          };
          const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(id) + '/factura', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json().catch(()=>({}));
          if (!res.ok) { msg(id, data.error || 'No se pudo subir la factura', false); return; }
          msg(id, 'Factura recibida y pendiente de revision.', true);
        };
        reader.readAsDataURL(file);
      }
      async function subirDocumentoProveedor(ev){
        const file = ev.target.files && ev.target.files[0];
        ev.target.value = '';
        const status = document.getElementById('docs-admin-status');
        const setStatus = (text, ok) => { if (status) status.innerHTML = '<span class="' + (ok ? 'green' : 'red') + '">' + String(text || '').replace(/[<>&]/g, '') + '</span>'; };
        if (!file) return;
        if (file.size > 4 * 1024 * 1024) { setStatus('Archivo demasiado grande', false); return; }
        const tipo = window.prompt('Tipo de documento', 'seguro') || 'otro';
        const caducidad = window.prompt('Caducidad AAAA-MM-DD (opcional)', '') || '';
        setStatus('Subiendo documento...', true);
        const reader = new FileReader();
        reader.onload = async () => {
          const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/documentos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tipo,
              nombre: file.name || 'documento-proveedor',
              caducidad,
              file_base64: String(reader.result || ''),
              file_mime: file.type || 'application/octet-stream',
              file_size_kb: Math.ceil(file.size / 1024),
              notas: 'Subido desde portal proveedor'
            })
          });
          const data = await res.json().catch(()=>({}));
          if (!res.ok) { setStatus(data.error || 'No se pudo subir el documento', false); return; }
          setStatus('Documento recibido y avisado a administracion.', true);
        };
        reader.readAsDataURL(file);
      }
    </script>` : ""}
  </body></html>`;
}

function renderPortalProveedorOperativaHtml({ token = "", colaborador = {}, viajes = [] }) {
  const activos = [...(Array.isArray(viajes) ? viajes : [])]
    .filter((viaje) => !["cancelado", "cancelada"].includes(String(viaje.estado || "").trim().toLowerCase()))
    .sort((a, b) => {
      const da = new Date(a.fecha_carga || a.created_at || 0).getTime();
      const dbb = new Date(b.fecha_carga || b.created_at || 0).getTime();
      return dbb - da;
    })
    .slice(0, 24);

  const cards = activos.map((viaje) => {
    const workflow = buildPortalProveedorOperativa(viaje, {});
    const ruta = [viaje.origen, viaje.destino].filter(Boolean).join(" -> ") || "-";
    return `<article class="trip" data-pedido-id="${htmlEscape(viaje.id)}">
      <div class="trip-head">
        <div>
          <div class="trip-ref">${htmlEscape(viaje.numero || viaje.referencia_cliente || viaje.id)}</div>
          <div class="trip-route">${htmlEscape(ruta)}</div>
        </div>
        <div class="trip-badges">
          <span class="badge badge-${htmlEscape(workflow.status)}" data-trip-status>${htmlEscape(workflow.status.replace("_", " "))}</span>
          <span class="badge badge-neutral">${htmlEscape(String(viaje.estado || "pendiente").replace("_", " "))}</span>
        </div>
      </div>
      <div class="trip-meta">
        <span><strong>Cliente:</strong> ${htmlEscape(viaje.cliente_nombre || "-")}</span>
        <span><strong>Carga:</strong> ${htmlEscape(dateEs(viaje.fecha_carga))}${viaje.hora_carga ? ` ${htmlEscape(viaje.hora_carga)}` : ""}</span>
        <span><strong>Descarga:</strong> ${htmlEscape(dateEs(viaje.fecha_descarga))}${viaje.hora_descarga ? ` ${htmlEscape(viaje.hora_descarga)}` : ""}</span>
        <span><strong>Mercancia:</strong> ${htmlEscape(viaje.mercancia || viaje.descripcion_carga || "-")}</span>
      </div>
      <div class="trip-actions">
        <button type="button" class="btn btn-primary" data-action="load-operativa" data-pedido-id="${htmlEscape(viaje.id)}">Abrir seguimiento</button>
        <button type="button" class="btn" data-action="open-dcd" data-pedido-id="${htmlEscape(viaje.id)}">DCD</button>
        <button type="button" class="btn" data-action="list-docs" data-pedido-id="${htmlEscape(viaje.id)}">Albaranes</button>
      </div>
      <div class="trip-panel" id="trip-panel-${htmlEscape(viaje.id)}">
        <div class="trip-placeholder">Pulsa en "Abrir seguimiento" para marcar carga, viaje, descarga y subir documentos.</div>
      </div>
    </article>`;
  }).join("");

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/>
    <title>Operativa proveedor ${htmlEscape(colaborador.nombre || "")}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1"/>
    <style>
      :root{color-scheme:light;font-family:Arial,sans-serif}
      *{box-sizing:border-box}
      body{margin:0;background:#f4f7fb;color:#0f172a}
      main{max-width:1180px;margin:0 auto;padding:24px 18px 40px}
      .hero{background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;padding:20px 22px;box-shadow:0 18px 40px rgba(15,23,42,.06)}
      .eyebrow{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#64748b}
      h1{margin:8px 0 6px;font-size:28px;line-height:1.1}
      .sub{color:#475569;font-size:14px;line-height:1.45;max-width:820px}
      .mini-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-top:18px}
      .mini-card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 14px}
      .mini-card strong{display:block;font-size:21px;color:#0f766e}
      .mini-card span{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:#64748b;font-weight:800}
      .hint{margin-top:16px;padding:12px 14px;border-radius:12px;background:#ecfeff;border:1px solid #a5f3fc;color:#155e75;font-size:13px;line-height:1.45}
      .list{display:grid;gap:14px;margin-top:18px}
      .trip{background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:16px;box-shadow:0 12px 32px rgba(15,23,42,.05)}
      .trip-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}
      .trip-ref{font-size:18px;font-weight:900}
      .trip-route{margin-top:4px;color:#334155;font-size:14px;font-weight:700}
      .trip-badges{display:flex;gap:8px;flex-wrap:wrap}
      .badge{padding:6px 10px;border-radius:999px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}
      .badge-pendiente{background:#fff7ed;color:#c2410c}
      .badge-carga{background:#eff6ff;color:#1d4ed8}
      .badge-en_ruta{background:#ecfeff;color:#0f766e}
      .badge-descarga{background:#f5f3ff;color:#7c3aed}
      .badge-completa{background:#ecfdf5;color:#047857}
      .badge-neutral{background:#f8fafc;color:#475569;border:1px solid #dbe3ef}
      .trip-meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin-top:14px;font-size:13px;color:#334155}
      .trip-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
      .btn{border:1px solid #cbd5e1;background:#fff;color:#0f172a;border-radius:10px;padding:10px 12px;font-size:13px;font-weight:800;cursor:pointer}
      .btn:hover{background:#f8fafc}
      .btn-primary{background:#0f766e;border-color:#0f766e;color:#fff}
      .trip-panel{margin-top:14px;border:1px dashed #cbd5e1;border-radius:14px;padding:14px;background:#f8fafc}
      .trip-placeholder{color:#64748b;font-size:13px}
      .progress{display:grid;gap:10px}
      .step{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:10px 12px}
      .step.done{background:#ecfdf5;border-color:#bbf7d0}
      .step-index{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#e2e8f0;color:#0f172a;font-size:12px;font-weight:900}
      .step.done .step-index{background:#10b981;color:#fff}
      .step-copy strong{display:block;font-size:13px}
      .step-copy span{display:block;font-size:11px;color:#64748b;margin-top:2px}
      .step-copy small{display:block;font-size:11px;color:#047857;margin-top:3px}
      .upload{position:relative;overflow:hidden}
      .upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
      .empty{margin-top:18px;padding:24px;border-radius:16px;border:1px dashed #cbd5e1;background:#fff;color:#64748b;text-align:center}
      .docs-list,.op-status{margin-top:10px;font-size:12px;line-height:1.55;color:#475569}
      .docs-list a{color:#0f766e;font-weight:800;text-decoration:none}
      .ok{color:#047857;font-weight:800}
      .error{color:#dc2626;font-weight:800}
      .warn{color:#b45309;font-weight:800}
      @media (max-width:720px){
        main{padding:14px 12px 28px}
        .hero,.trip{padding:14px}
        h1{font-size:24px}
        .step{grid-template-columns:1fr;align-items:flex-start}
      }
    </style></head><body><main>
      <section class="hero">
        <div class="eyebrow">Acceso temporal de viaje</div>
        <h1>Seguimiento operativo del colaborador</h1>
        <div class="sub">
          Este acceso sirve para que el colaborador o su conductor marque los hitos del viaje, suba albaranes y lleve el DCD.
          No incluye tacografo ni acceso a la app interna de choferes.
        </div>
        <div class="mini-grid">
          <div class="mini-card"><strong>${htmlEscape(colaborador.nombre || "Colaborador")}</strong><span>Proveedor</span></div>
          <div class="mini-card"><strong>${htmlEscape(String(activos.length))}</strong><span>Viajes visibles</span></div>
          <div class="mini-card"><strong>${htmlEscape(viajes.filter((v) => Number(v.albaranes_count || 0) > 0).length)}</strong><span>Viajes con soporte</span></div>
        </div>
        <div class="hint">
          Recomendado para subcontratados: se comparte un enlace seguro y temporal, se registra todo en el pedido real
          y el equipo de trafico ve los cambios al momento.
        </div>
      </section>
      ${cards ? `<section class="list">${cards}</section>` : `<div class="empty">No hay viajes activos disponibles para este acceso.</div>`}
    </main>
    <script>
      const TOKEN = ${JSON.stringify(token)};
      const escapeHtml = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;" }[char] || char));
      const fmtDateTime = (value) => {
        if (!value) return "";
        const d = new Date(value);
        if (Number.isNaN(d.getTime())) return "";
        return d.toLocaleString("es-ES");
      };
      function panel(id){ return document.getElementById("trip-panel-" + id); }
      function statusClass(status){
        return "badge badge-" + String(status || "pendiente").replace(/[^a-z_]/gi, "");
      }
      function renderWorkflow(tripId, data){
        const box = panel(tripId);
        if (!box) return;
        const workflow = data && data.workflow ? data.workflow : null;
        const pedido = data && data.pedido ? data.pedido : {};
        if (!workflow) {
          box.innerHTML = '<div class="error">No se pudo cargar la operativa.</div>';
          return;
        }
        const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
        box.innerHTML = '<div class="trip-badges" style="margin-bottom:12px"><span class="' + statusClass(workflow.status) + '">' + escapeHtml(String(workflow.status || "pendiente").replace("_"," ")) + '</span><span class="badge badge-neutral">' + escapeHtml(String(pedido.estado || "pendiente").replace("_"," ")) + '</span></div>'
          + '<div class="progress">'
          + steps.map((step) => {
            const done = !!step.done;
            const actionButton = step.type === "upload"
              ? '<label class="btn upload">' + (done ? 'Sustituir documento' : 'Subir documento') + '<input type="file" accept="image/*,.pdf" data-upload-fase="' + escapeHtml(step.fase || "") + '" data-pedido-id="' + escapeHtml(tripId) + '"></label>'
              : (!done ? '<button type="button" class="btn btn-primary" data-run-action="' + escapeHtml(step.action || "") + '" data-pedido-id="' + escapeHtml(tripId) + '">Marcar</button>' : '<span class="ok">Hecho</span>');
            return '<div class="step ' + (done ? 'done' : '') + '">'
              + '<div class="step-index">' + escapeHtml(step.order) + '</div>'
              + '<div class="step-copy"><strong>' + escapeHtml(step.label || "") + '</strong><span>' + escapeHtml(step.help || "") + '</span>' + (step.at ? '<small>Registrado ' + escapeHtml(fmtDateTime(step.at)) + '</small>' : '') + '</div>'
              + '<div>' + actionButton + '</div>'
              + '</div>';
          }).join("")
          + '</div>'
          + '<div class="op-status" id="op-status-' + escapeHtml(tripId) + '"></div>'
          + '<div class="docs-list" id="docs-' + escapeHtml(tripId) + '"></div>';
      }
      async function loadOperativa(tripId){
        const box = panel(tripId);
        if (box) box.innerHTML = '<div class="trip-placeholder">Cargando operativa...</div>';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(tripId) + '/operativa');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (box) box.innerHTML = '<div class="error">' + escapeHtml(data.error || 'No se pudo cargar la operativa') + '</div>';
          return;
        }
        renderWorkflow(tripId, data);
      }
      async function runAction(tripId, action){
        const status = document.getElementById('op-status-' + tripId);
        if (status) status.innerHTML = '<span class="warn">Guardando cambio...</span>';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(tripId) + '/operativa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (status) status.innerHTML = '<span class="error">' + escapeHtml(data.error || 'No se pudo guardar') + '</span>';
          return;
        }
        renderWorkflow(tripId, data);
        const nextStatus = document.getElementById('op-status-' + tripId);
        if (nextStatus) nextStatus.innerHTML = '<span class="ok">Estado actualizado.</span>';
      }
      async function uploadDoc(file, tripId, fase){
        const status = document.getElementById('op-status-' + tripId);
        if (status) status.innerHTML = '<span class="warn">Subiendo documento...</span>';
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
          reader.readAsDataURL(file);
        });
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(tripId) + '/albaranes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nombre: file.name || ('albaran-' + tripId + '.pdf'),
            tipo: fase === 'descarga' ? 'albaran_descarga_colaborador' : 'albaran_carga_colaborador',
            fase,
            file_base64: base64,
            file_mime: file.type || 'application/octet-stream',
            file_size_kb: Math.round((file.size || 0) / 1024)
          })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (status) status.innerHTML = '<span class="error">' + escapeHtml(data.error || 'No se pudo subir el archivo') + '</span>';
          return;
        }
        await loadOperativa(tripId);
        const nextStatus = document.getElementById('op-status-' + tripId);
        if (nextStatus) nextStatus.innerHTML = '<span class="ok">Documento subido correctamente.</span>';
      }
      async function listDocs(tripId){
        const box = document.getElementById('docs-' + tripId) || panel(tripId);
        if (box) box.innerHTML = '<span class="warn">Cargando documentos...</span>';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(tripId) + '/albaranes');
        const data = await res.json().catch(() => []);
        if (!res.ok) {
          if (box) box.innerHTML = '<span class="error">' + escapeHtml(data.error || 'No se pudieron cargar los documentos') + '</span>';
          return;
        }
        if (!Array.isArray(data) || !data.length) {
          if (box) box.innerHTML = '<span class="warn">Sin albaranes adjuntos todavia.</span>';
          return;
        }
        if (box) box.innerHTML = data.map((doc) => '<a href="' + escapeHtml(doc.download_url || '#') + '">' + escapeHtml(doc.nombre || 'albaran') + '</a>').join('<br>');
      }
      async function openDcd(tripId){
        const status = document.getElementById('op-status-' + tripId) || panel(tripId);
        if (status) status.innerHTML = '<span class="warn">Preparando DCD...</span>';
        const res = await fetch('/api/v1/colaboradores/public/portal/' + encodeURIComponent(TOKEN) + '/pedidos/' + encodeURIComponent(tripId) + '/documento-control');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (status) status.innerHTML = '<span class="error">' + escapeHtml(data.error || 'No se pudo preparar el DCD') + '</span>';
          return;
        }
        const url = data.remision && data.remision.download_url ? data.remision.download_url : (data.soporte_url || (data.documento && data.documento.soporte_url) || '');
        if (url) {
          window.open(url, '_blank', 'noopener,noreferrer');
          if (status) status.innerHTML = '<span class="ok">DCD listo en una nueva pestana.</span>';
        } else if (status) {
          status.innerHTML = '<span class="warn">El DCD se ha generado, pero falta una URL de descarga.</span>';
        }
      }
      document.addEventListener('click', async (event) => {
        const trigger = event.target.closest('[data-action],[data-run-action]');
        if (!trigger) return;
        const tripId = trigger.getAttribute('data-pedido-id');
        if (!tripId) return;
        if (trigger.getAttribute('data-action') === 'load-operativa') return loadOperativa(tripId);
        if (trigger.getAttribute('data-action') === 'list-docs') return listDocs(tripId);
        if (trigger.getAttribute('data-action') === 'open-dcd') return openDcd(tripId);
        const action = trigger.getAttribute('data-run-action');
        if (action) return runAction(tripId, action);
      });
      document.addEventListener('change', async (event) => {
        const input = event.target;
        if (!input.matches('input[data-upload-fase]')) return;
        const tripId = input.getAttribute('data-pedido-id');
        const fase = input.getAttribute('data-upload-fase') || 'carga';
        const file = input.files && input.files[0];
        if (tripId && file) await uploadDoc(file, tripId, fase);
        input.value = '';
      });
    </script>
  </body></html>`;
}

async function getLiquidacionPublicData(tokenValue) {
  const tokenHash = hashToken(tokenValue);
  const tokenRes = await db.query(
    `SELECT t.*, c.nombre, c.cif
         FROM colaborador_liquidacion_tokens t
         JOIN colaboradores c ON c.id=t.colaborador_id AND c.empresa_id=t.empresa_id
        WHERE t.token_hash=$1 AND t.expires_at > NOW()
        LIMIT 1`,
    [tokenHash]
  );
  const token = tokenRes.rows[0];
  if (!token) return null;
  const [viajes, facturas, pagos, documentos, vehiculos] = await Promise.all([
    db.query(
      `SELECT p.*, c.nombre AS cliente_nombre, p.precio_colaborador AS importe_colaborador,
              COALESCE(docs.albaranes_count,0)::int AS albaranes_count
           FROM pedidos p
           LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
           LEFT JOIN LATERAL (
             SELECT COUNT(*) AS albaranes_count
               FROM pedido_docs d
              WHERE d.pedido_id=p.id
                AND d.empresa_id=p.empresa_id
                AND (
                  LOWER(COALESCE(d.tipo,'')) LIKE '%albaran%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%albaran%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
                  OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                  OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
                )
           ) docs ON true
          WHERE p.empresa_id=$1 AND p.colaborador_id=$2
          ORDER BY p.fecha_carga DESC NULLS LAST, p.created_at DESC NULLS LAST
          LIMIT 500`,
      [token.empresa_id, token.colaborador_id]
    ),
    db.query(
      `SELECT cf.*, p.numero, p.referencia_cliente
           FROM colaborador_facturas cf
           LEFT JOIN pedidos p ON p.id=cf.pedido_id
          WHERE cf.empresa_id=$1 AND cf.colaborador_id=$2
          ORDER BY cf.fecha DESC, cf.created_at DESC
          LIMIT 500`,
      [token.empresa_id, token.colaborador_id]
    ),
    db.query(
      `SELECT *
           FROM colaborador_pagos
          WHERE empresa_id=$1 AND colaborador_id=$2
          ORDER BY fecha DESC, created_at DESC
          LIMIT 500`,
      [token.empresa_id, token.colaborador_id]
    ),
    db.query(
      `SELECT id,tipo,nombre,caducidad,notas,created_at,file_base64,file_mime,file_size_kb
           FROM colaborador_documentos
          WHERE empresa_id=$1 AND colaborador_id=$2
          ORDER BY caducidad ASC NULLS LAST, created_at DESC
          LIMIT 200`,
      [token.empresa_id, token.colaborador_id]
    ),
    db.query(
      `SELECT id,matricula,marca,modelo,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
              doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc
         FROM colaborador_vehiculos
        WHERE empresa_id=$1 AND colaborador_id=$2 AND activo=true
        ORDER BY matricula`,
      [token.empresa_id, token.colaborador_id]
    ).catch(() => ({ rows: [] })),
  ]);
  return {
    token,
    viajes: viajes.rows,
    facturas: facturas.rows,
    pagos: pagos.rows,
    documentos: documentos.rows,
    vehiculos: vehiculos.rows,
  };
}

async function getColaboradorOpsData(empresaId, colaboradorId, { referencia = "" } = {}) {
  const params = [empresaId, colaboradorId];
  const wherePedidos = ["p.empresa_id=$1", "p.colaborador_id=$2"];
  const ref = String(referencia || "").trim().toLowerCase();
  if (ref) {
    params.push(`%${ref}%`);
    wherePedidos.push(`(
      LOWER(COALESCE(p.numero,'')) LIKE $${params.length}
      OR LOWER(COALESCE(p.referencia_cliente,'')) LIKE $${params.length}
      OR LOWER(CAST(p.id AS TEXT)) LIKE $${params.length}
    )`);
  }
  const [colaborador, viajes, facturas, pagos, documentos, vehiculos] = await Promise.all([
    db.query(
      "SELECT id,nombre,cif,email,telefono FROM colaboradores WHERE empresa_id=$1 AND id=$2 AND activo=true LIMIT 1",
      [empresaId, colaboradorId]
    ),
    db.query(
      `SELECT p.*,
              c.nombre AS cliente_nombre,
              co.nombre AS colaborador_nombre,
              COALESCE(p.numero, p.referencia_cliente, CAST(p.id AS TEXT)) AS referencia_busqueda,
              p.precio_colaborador AS importe_colaborador,
              COALESCE(docs.albaranes_count,0)::int AS albaranes_count
         FROM pedidos p
         LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
         LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS albaranes_count
             FROM pedido_docs d
            WHERE d.pedido_id=p.id
              AND d.empresa_id=p.empresa_id
              AND (
                LOWER(COALESCE(d.tipo,'')) LIKE '%albaran%'
                OR LOWER(COALESCE(d.nombre,'')) LIKE '%albaran%'
                OR LOWER(COALESCE(d.tipo,'')) LIKE '%pod%'
                OR LOWER(COALESCE(d.nombre,'')) LIKE '%pod%'
                OR LOWER(COALESCE(d.tipo,'')) LIKE '%cmr%'
                OR LOWER(COALESCE(d.nombre,'')) LIKE '%cmr%'
              )
         ) docs ON true
        WHERE ${wherePedidos.join(" AND ")}
        ORDER BY p.fecha_carga DESC NULLS LAST, p.created_at DESC NULLS LAST
        LIMIT 500`,
      params
    ),
    db.query(
      `SELECT cf.*, p.numero, p.referencia_cliente
         FROM colaborador_facturas cf
         LEFT JOIN pedidos p ON p.id=cf.pedido_id AND p.empresa_id=cf.empresa_id
        WHERE cf.empresa_id=$1 AND cf.colaborador_id=$2
        ORDER BY cf.fecha DESC NULLS LAST, cf.created_at DESC NULLS LAST
        LIMIT 500`,
      [empresaId, colaboradorId]
    ),
    db.query(
      `SELECT *
         FROM colaborador_pagos
        WHERE empresa_id=$1 AND colaborador_id=$2
        ORDER BY fecha DESC, created_at DESC
        LIMIT 500`,
      [empresaId, colaboradorId]
    ),
    db.query(
      `SELECT id,tipo,nombre,caducidad,notas,created_at,file_base64,file_mime,file_size_kb
         FROM colaborador_documentos
        WHERE empresa_id=$1 AND colaborador_id=$2
        ORDER BY caducidad ASC NULLS LAST, created_at DESC
        LIMIT 200`,
      [empresaId, colaboradorId]
    ),
    db.query(
      `SELECT id,matricula,marca,modelo,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
              doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc
         FROM colaborador_vehiculos
        WHERE empresa_id=$1 AND colaborador_id=$2 AND activo=true
        ORDER BY matricula`,
      [empresaId, colaboradorId]
    ).catch(() => ({ rows: [] })),
  ]);
  const col = colaborador.rows[0];
  if (!col) return null;
  return {
    token: {
      colaborador_id: col.id,
      nombre: col.nombre,
      cif: col.cif,
      email: col.email,
      telefono: col.telefono,
    },
    viajes: viajes.rows,
    facturas: facturas.rows,
    pagos: pagos.rows,
    documentos: documentos.rows,
    vehiculos: vehiculos.rows,
  };
}

async function getPortalProveedorPedido(tokenValue, pedidoId) {
  const data = await getLiquidacionPublicData(tokenValue);
  if (!data?.token) return null;
  const { rows } = await db.query(
    `SELECT p.id, p.numero, p.empresa_id, p.colaborador_id, p.estado, p.origen, p.destino, p.fecha_carga,
            p.fecha_descarga, p.hora_carga, p.hora_descarga, p.mercancia, p.descripcion_carga, p.notas,
            p.peso_kg, p.bultos, p.km, p.km_ruta, p.precio_colaborador,
            c.nombre AS cliente_nombre,
            co.nombre AS colaborador_nombre
       FROM pedidos p
       LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
       LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
      WHERE p.id=$1
        AND p.empresa_id=$2
        AND p.colaborador_id=$3
      LIMIT 1`,
    [pedidoId, data.token.empresa_id, data.token.colaborador_id]
  );
  if (!rows[0]) return null;
  return { token: data.token, pedido: rows[0] };
}

function normalizePortalChoferPasosPayload(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const boolKeys = [
    "carga_iniciada",
    "carga_proceso",
    "carga_ok",
    "viaje_iniciado",
    "posicionado_descarga",
    "descarga_iniciada",
    "descarga_ok",
    "albaran_carga",
    "albaran_descarga",
  ];
  const next = {};
  for (const key of boolKeys) {
    if (source[key] !== undefined) next[key] = Boolean(source[key]);
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
  ].forEach((key) => {
    if (!source[key]) return;
    const d = new Date(source[key]);
    if (Number.isFinite(d.getTime())) next[key] = d.toISOString();
  });
  return next;
}

async function getPortalProveedorChoferPasos(pedidoId, empresaId) {
  const { rows } = await db.query(
    `SELECT data
       FROM pedido_chofer_pasos
      WHERE pedido_id=$1 AND empresa_id=$2
      LIMIT 1`,
    [pedidoId, empresaId]
  ).catch(() => ({ rows: [] }));
  return normalizePortalChoferPasosPayload(rows[0]?.data || {});
}

function buildPortalProveedorOperativa(pedido = {}, pasos = {}) {
  const items = [
    { key: "carga_iniciada", label: "Posicionado en carga", action: "posicionar_carga", help: "Confirma llegada al punto de carga." },
    { key: "carga_proceso", label: "Carga iniciada", action: "iniciar_carga", help: "Empieza la operacion de carga." },
    { key: "carga_ok", label: "Carga finalizada", action: "finalizar_carga", help: "Confirma que la mercancia esta cargada." },
    { key: "albaran_carga", label: "Albaran de carga", type: "upload", fase: "carga", help: "Adjunta el albaran de carga." },
    { key: "viaje_iniciado", label: "Viaje iniciado", action: "iniciar_viaje", help: "Confirma salida hacia destino." },
    { key: "posicionado_descarga", label: "Posicionado en descarga", action: "posicionar_descarga", help: "Confirma llegada o posicionamiento en destino." },
    { key: "descarga_iniciada", label: "Descarga iniciada", action: "iniciar_descarga", help: "Empieza la operacion de descarga." },
    { key: "descarga_ok", label: "Descarga finalizada", action: "finalizar_descarga", help: "Confirma descarga completa." },
    { key: "albaran_descarga", label: "Albaran de descarga", type: "upload", fase: "descarga", help: "Adjunta el albaran o POD de descarga." },
  ];
  const steps = items.map((item, idx) => ({
    ...item,
    order: idx + 1,
    done: Boolean(pasos[item.key]),
    at: pasos[`${item.key}_at`] || null,
  }));
  const next = steps.find((step) => !step.done) || null;
  let status = "pendiente";
  if (steps.every((step) => step.done)) status = "completa";
  else if (pasos.descarga_iniciada || String(pedido.estado || "") === "descarga") status = "descarga";
  else if (pasos.viaje_iniciado || pasos.carga_ok || String(pedido.estado || "") === "en_curso") status = "en_ruta";
  else if (pasos.carga_iniciada || pasos.carga_proceso) status = "carga";
  return {
    status,
    completed: steps.filter((step) => step.done).length,
    total: steps.length,
    next,
    steps,
  };
}

async function actualizarEstadoPedidoPortal(pedidoId, empresaId, nextEstado) {
  if (!nextEstado) return;
  await db.query(
    `UPDATE pedidos
        SET estado=$1,
            updated_at=NOW()
      WHERE id=$2 AND empresa_id=$3`,
    [nextEstado, pedidoId, empresaId]
  ).catch(() => {});
}

async function savePortalProveedorChoferPasos({ pedidoId, empresaId, patch = {}, colaboradorId = null }) {
  const current = await getPortalProveedorChoferPasos(pedidoId, empresaId);
  const nextData = {
    ...current,
    ...normalizePortalChoferPasosPayload(patch),
    updated_at: new Date().toISOString(),
  };
  await db.query(
    `INSERT INTO pedido_chofer_pasos (pedido_id, empresa_id, chofer_id, data, updated_at)
     VALUES ($1,$2,NULL,$3,NOW())
     ON CONFLICT (pedido_id) DO UPDATE
       SET data=EXCLUDED.data,
           updated_at=NOW()`,
    [pedidoId, empresaId, JSON.stringify(nextData)]
  );
  await logPedidoEventoPortal(pedidoId, empresaId, "colaborador_portal.operativa_actualizada", {
    colaborador_id: colaboradorId,
    pasos: nextData,
  });
  return normalizePortalChoferPasosPayload(nextData);
}

async function ejecutarPortalProveedorAccionOperativa(ctx, action) {
  const pedido = ctx?.pedido;
  if (!pedido?.id) {
    const err = new Error("Pedido no disponible");
    err.status = 404;
    throw err;
  }
  const pasos = await getPortalProveedorChoferPasos(pedido.id, pedido.empresa_id);
  const now = new Date().toISOString();
  let patch = null;
  let nextEstado = null;
  switch (String(action || "")) {
    case "posicionar_carga":
      patch = { carga_iniciada: true, carga_iniciada_at: now };
      if (!["en_curso", "descarga", "entregado"].includes(String(pedido.estado || "").toLowerCase())) nextEstado = "en_curso";
      break;
    case "iniciar_carga":
      if (!pasos.carga_iniciada) throw Object.assign(new Error("Primero marca posicionado en carga."), { status: 409 });
      patch = { carga_proceso: true, carga_proceso_at: now };
      break;
    case "finalizar_carga":
      if (!pasos.carga_proceso) throw Object.assign(new Error("Primero marca carga iniciada."), { status: 409 });
      patch = { carga_ok: true, carga_ok_at: now };
      break;
    case "iniciar_viaje":
      if (!pasos.albaran_carga) throw Object.assign(new Error("Sube el albaran de carga antes de iniciar el viaje."), { status: 409 });
      patch = { viaje_iniciado: true, viaje_iniciado_at: now };
      nextEstado = "en_curso";
      break;
    case "posicionar_descarga":
      if (!pasos.carga_ok) throw Object.assign(new Error("Primero finaliza la carga."), { status: 409 });
      patch = { posicionado_descarga: true, posicionado_descarga_at: now };
      break;
    case "iniciar_descarga":
      if (!pasos.posicionado_descarga) throw Object.assign(new Error("Marca antes el posicionamiento en descarga."), { status: 409 });
      patch = { descarga_iniciada: true, descarga_iniciada_at: now };
      nextEstado = "descarga";
      break;
    case "finalizar_descarga":
      if (!pasos.descarga_iniciada) throw Object.assign(new Error("Primero marca descarga iniciada."), { status: 409 });
      patch = { descarga_ok: true, descarga_ok_at: now };
      break;
    default:
      throw Object.assign(new Error("Accion operativa no valida"), { status: 400 });
  }
  if (nextEstado) await actualizarEstadoPedidoPortal(pedido.id, pedido.empresa_id, nextEstado);
  const saved = await savePortalProveedorChoferPasos({
    pedidoId: pedido.id,
    empresaId: pedido.empresa_id,
    patch,
    colaboradorId: ctx?.token?.colaborador_id || null,
  });
  return {
    pedido: {
      ...pedido,
      estado: nextEstado || pedido.estado,
    },
    pasos: saved,
    workflow: buildPortalProveedorOperativa(
      { ...pedido, estado: nextEstado || pedido.estado },
      saved
    ),
  };
}

async function getPortalProveedorDocumentoControlContext(tokenValue, pedidoId) {
  const data = await getLiquidacionPublicData(tokenValue);
  if (!data?.token) return null;
  const { rows } = await db.query(
    `SELECT p.*,
            c.id AS cliente_ref_id, c.nombre AS cliente_nombre, c.cif AS cliente_cif,
            c.direccion AS cliente_direccion, c.cp AS cliente_cp, c.ciudad AS cliente_ciudad,
            NULL::text AS cliente_provincia, c.pais AS cliente_pais,
            c.email AS cliente_email, c.email_facturacion AS cliente_email_facturacion,
            c.telefono AS cliente_telefono, c.contacto AS cliente_contacto,
            co.id AS colaborador_ref_id, co.nombre AS colaborador_nombre, co.cif AS colaborador_cif,
            co.email AS colaborador_email, co.telefono AS colaborador_telefono, co.contacto_nombre AS colaborador_contacto,
            TRIM(BOTH ' ' FROM CONCAT_WS(' ', co.calle, co.num_ext)) AS colaborador_direccion,
            co.codigo_postal AS colaborador_cp, co.ciudad AS colaborador_ciudad, co.provincia AS colaborador_provincia, co.pais AS colaborador_pais
       FROM pedidos p
       LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
       LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
      WHERE p.id=$1
        AND p.empresa_id=$2
        AND p.colaborador_id=$3
      LIMIT 1`,
    [pedidoId, data.token.empresa_id, data.token.colaborador_id]
  );
  const pedido = rows[0];
  if (!pedido) return null;
  const empresaRes = await db.query("SELECT cfg_precios FROM empresas WHERE id=$1 LIMIT 1", [data.token.empresa_id]);
  const perfil = empresaRes.rows[0]?.cfg_precios?.empresa_perfil || empresaRes.rows[0]?.cfg_precios || {};
  return {
    token: data.token,
    pedido,
    empresa: perfil || {},
    cliente: {
      id: pedido.cliente_ref_id,
      nombre: pedido.cliente_nombre,
      cif: pedido.cliente_cif,
      direccion: pedido.cliente_direccion,
      cp: pedido.cliente_cp,
      poblacion: pedido.cliente_ciudad,
      provincia: pedido.cliente_provincia,
      pais: pedido.cliente_pais,
      email: pedido.cliente_email,
      email_facturacion: pedido.cliente_email_facturacion,
      telefono: pedido.cliente_telefono,
      contacto: pedido.cliente_contacto,
    },
    colaborador: {
      id: pedido.colaborador_ref_id,
      nombre: pedido.colaborador_nombre,
      cif: pedido.colaborador_cif,
      email: pedido.colaborador_email,
      telefono: pedido.colaborador_telefono,
      contacto: pedido.colaborador_contacto,
      direccion: pedido.colaborador_direccion,
      cp: pedido.colaborador_cp,
      poblacion: pedido.colaborador_ciudad,
      provincia: pedido.colaborador_provincia,
      pais: pedido.colaborador_pais,
    },
  };
}

router.get("/public/liquidacion/:token", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El enlace ha caducado o no existe.</p>");
    const token = data.token;
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [token.id]).catch(()=>{});
    res.send(renderLiquidacionColaboradorHtml({
      colaborador: token,
      viajes: data.viajes,
      facturas: data.facturas,
      pagos: data.pagos,
      documentos: data.documentos,
      vehiculos: data.vehiculos,
      token: req.params.token,
    }));
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/public/portal/:token", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El enlace ha caducado o no existe.</p>");
    const token = data.token;
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [token.id]).catch(()=>{});
    res.send(renderLiquidacionColaboradorHtml({
      colaborador: token,
      viajes: data.viajes,
      facturas: data.facturas,
      pagos: data.pagos,
      documentos: data.documentos,
      vehiculos: data.vehiculos,
      token: req.params.token,
    }));
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/public/portal/:token/resumen", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    const resumen = buildPortalProveedorResumen(data);
    delete resumen._facturas_estado;
    res.json(resumen);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/informe-acciones", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El enlace ha caducado o no existe.</p>");
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`acciones-proveedor-${data.token.nombre || data.token.colaborador_id || "colaborador"}.html`)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(renderPortalProveedorAccionesHtml(data, req.params.token));
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/public/portal/:token/facturas", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    res.json((data.facturas || []).map(f => {
      const situacion = situacionFacturaProveedor(f);
      return {
        id: f.id,
        pedido_id: f.pedido_id || null,
        numero_factura: facturaNumero(f) || null,
        referencia_orden: f.referencia_orden || f.referencia_cliente || null,
        fecha: f.fecha || null,
        vencimiento: f.vencimiento || null,
        estado: f.estado || null,
        total: f.total || 0,
        situacion: situacion.label,
        situacion_color: situacion.cls,
        dias_vencimiento: situacion.dias_vencimiento,
        descargable: !!f.archivo_base64,
        download_url: f.archivo_base64
          ? `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/facturas/${encodeURIComponent(f.id)}/descargar`
          : null,
      };
    }));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/pagos", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    const resumen = resumenPagosProveedor(data.viajes || [], data.facturas || [], data.pagos || []);
    res.json({
      resumen,
      pagos: (data.pagos || []).map(p => ({
        id: p.id,
        fecha: p.fecha || null,
        concepto: p.concepto || "",
        importe: p.importe || 0,
        estado: p.estado || "",
        notas: p.notas || "",
      })),
      facturas_pendientes: (data.facturas || [])
        .filter(f => !["pagada", "pagado"].includes(String(f.estado || "").toLowerCase()))
        .map(f => ({
          id: f.id,
          numero_factura: facturaNumero(f) || null,
          referencia_orden: f.referencia_orden || f.referencia_cliente || null,
          vencimiento: f.vencimiento || null,
          total: f.total || 0,
          situacion: situacionFacturaProveedor(f).label,
        })),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/documentos", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    const documentos = data.documentos || [];
    res.json({
      resumen: resumenDocumentosProveedor(documentos),
      documentos: documentos.map(d => {
        const status = documentStatus(d);
        return {
          tipo: d.tipo || "otro",
          nombre: d.nombre || "",
          caducidad: d.caducidad || null,
          notas: d.notas || "",
          created_at: d.created_at || null,
          descargable: !!d.file_base64,
          download_url: d.file_base64
            ? `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/documentos/${encodeURIComponent(d.id)}/descargar`
            : null,
          estado: status.label,
          estado_color: status.cls,
          dias: status.days,
        };
      }),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/public/portal/:token/documentos", express.json({ limit: "6mb" }), async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    const { tipo, nombre, caducidad, notas, file_base64, file_mime, file_size_kb } = req.body || {};
    const upload = validateBase64Upload({ data: file_base64, mime: file_mime, filename: nombre });
    if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: "Nombre de documento obligatorio" });
    if (!upload.base64) return res.status(400).json({ error: "Archivo obligatorio" });
    const { rows } = await db.query(
      `INSERT INTO colaborador_documentos
        (empresa_id,colaborador_id,tipo,nombre,caducidad,notas,file_base64,file_mime,file_size_kb)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,tipo,nombre,caducidad,notas,created_at,file_mime,file_size_kb`,
      [
        data.token.empresa_id,
        data.token.colaborador_id,
        String(tipo || "otro").trim().slice(0, 40) || "otro",
        safeFilename(nombre, "documento-proveedor.pdf"),
        caducidad || null,
        notas || "Subido desde portal proveedor",
        upload.base64,
        file_mime || upload.mime || "application/octet-stream",
        Math.ceil(upload.sizeBytes / 1024),
      ]
    );
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    await notificarDocumentoProveedor(data.token.empresa_id, { id: data.token.colaborador_id, nombre: data.token.nombre }, { ...rows[0], skip_notificacion: isQaRequest(req) });
    const status = documentStatus(rows[0]);
    res.status(201).json({
      ...rows[0],
      estado: status.label,
      estado_color: status.cls,
      dias: status.days,
      download_url: `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/documentos/${encodeURIComponent(rows[0].id)}/descargar`,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/documentos/:docId/descargar", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("Enlace no disponible");
    const { rows } = await db.query(
      `SELECT id,nombre,file_base64,file_mime
         FROM colaborador_documentos
        WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3
        LIMIT 1`,
      [req.params.docId, data.token.empresa_id, data.token.colaborador_id]
    );
    const doc = rows[0];
    if (!doc?.file_base64) return res.status(404).send("Documento sin archivo disponible");
    res.setHeader("Content-Type", doc.file_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(doc.nombre || "documento-proveedor")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(String(doc.file_base64 || ""), "base64"));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

router.get("/public/portal/:token/vehiculos", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).json({ error: "Enlace no disponible" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(()=>{});
    const { rows } = await db.query(
      `SELECT id,matricula,marca,modelo,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
              doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc
         FROM colaborador_vehiculos
        WHERE empresa_id=$1 AND colaborador_id=$2 AND activo=true
        ORDER BY matricula`,
      [data.token.empresa_id, data.token.colaborador_id]
    );
    res.json({
      resumen: resumenVehiculosProveedor(rows),
      vehiculos: rows.map(v => ({
        id: v.id,
        matricula: v.matricula,
        marca: v.marca || "",
        modelo: v.modelo || "",
        tipo: v.tipo || "",
        tara_kg: v.tara_kg || null,
        carga_max_kg: v.carga_max_kg || null,
        bastidor: v.bastidor || "",
        documentos: docsVehiculoProveedor(v),
      })),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/pedidos/:pedidoId/documento-control", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorDocumentoControlContext(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(()=>{});
    const payload = buildDocumentoControlPayload({
      empresaId: ctx.token.empresa_id,
      pedido: ctx.pedido,
      empresa: ctx.empresa,
      cliente: ctx.cliente,
      colaborador: ctx.colaborador,
      appBaseUrl: publicBaseUrl(req),
    });
    await logPedidoEventoPortal(ctx.pedido.id, ctx.pedido.empresa_id, "documento_control.consultado", {
      source: "portal_proveedor",
      codigo_control: payload.documento?.codigo_control || "",
      ready: !!payload.status?.ready,
      colaborador_id: ctx.token.colaborador_id,
    });
    res.json({
      ...payload,
      source: "portal_proveedor",
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/liquidacion/:token/descargar", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El enlace ha caducado o no existe.</p>");
    const token = data.token;
    await db.query(
      `UPDATE colaborador_liquidacion_tokens
          SET downloaded_at=NOW(),
              download_count=COALESCE(download_count,0)+1,
              downloaded_ip=COALESCE(downloaded_ip,$2),
              downloaded_user_agent=COALESCE(downloaded_user_agent,$3),
              opened_at=COALESCE(opened_at,NOW())
        WHERE id=$1`,
      [token.id, String(req.ip || "").slice(0,80), String(req.get("user-agent") || "").slice(0,500)]
    ).catch(()=>{});
    const html = renderLiquidacionColaboradorHtml({
      colaborador: token,
      viajes: data.viajes,
      facturas: data.facturas,
      pagos: data.pagos,
      documentos: data.documentos,
      token: req.params.token,
    });
    const safeName = String(token.nombre || "colaborador").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w.-]+/g, "_").slice(0,60) || "colaborador";
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="liquidacion-${safeName}-${new Date().toISOString().slice(0,10)}.html"`);
    res.send(html);
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.post("/public/liquidacion/:token/ack", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const tokenHash = hashToken(req.params.token);
    const { rows } = await db.query(
      `UPDATE colaborador_liquidacion_tokens
          SET acknowledged_at=COALESCE(acknowledged_at,NOW()),
              acknowledged_ip=COALESCE(acknowledged_ip,$2),
              acknowledged_user_agent=COALESCE(acknowledged_user_agent,$3),
              opened_at=COALESCE(opened_at,NOW())
        WHERE token_hash=$1 AND expires_at > NOW()
        RETURNING acknowledged_at`,
      [tokenHash, String(req.ip || "").slice(0,80), String(req.get("user-agent") || "").slice(0,500)]
    );
    if (!rows[0]) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El enlace ha caducado o no existe.</p>");
    res.redirect(303, `/api/v1/colaboradores/public/liquidacion/${encodeURIComponent(req.params.token)}?ack=1`);
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/public/portal/:token/pedidos/:pedidoId/albaranes", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(()=>{});
    const { rows } = await db.query(
      `SELECT id,nombre,tipo,file_mime,file_size_kb,notas,created_at
         FROM pedido_docs
        WHERE pedido_id=$1 AND empresa_id=$2
        ORDER BY created_at DESC`,
      [ctx.pedido.id, ctx.pedido.empresa_id]
    );
    res.json(rows.filter(isAlbaranDoc).map(row => ({
      ...row,
      download_url: `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/pedidos/${encodeURIComponent(ctx.pedido.id)}/albaranes/${encodeURIComponent(row.id)}/descargar`,
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/pedidos/:pedidoId/operativa", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(() => {});
    const pasos = await getPortalProveedorChoferPasos(ctx.pedido.id, ctx.pedido.empresa_id);
    res.json({
      pedido: ctx.pedido,
      pasos,
      workflow: buildPortalProveedorOperativa(ctx.pedido, pasos),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/public/portal/:token/pedidos/:pedidoId/operativa", express.json({ limit: "1mb" }), async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(() => {});
    const result = await ejecutarPortalProveedorAccionOperativa(ctx, req.body?.action);
    res.json(result);
  } catch (e) {
    res.status(Number(e.status || 500)).json({ error: e.message || "No se pudo actualizar la operativa" });
  }
});

router.get("/public/portal/:token/pedidos/:pedidoId/albaranes/:docId/descargar", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).send("Pedido no disponible para este proveedor");
    const { rows } = await db.query(
      `SELECT id,nombre,tipo,file_mime,file_base64
         FROM pedido_docs
        WHERE id=$1 AND pedido_id=$2 AND empresa_id=$3
        LIMIT 1`,
      [req.params.docId, ctx.pedido.id, ctx.pedido.empresa_id]
    );
    const doc = rows[0];
    if (!doc || !isAlbaranDoc(doc) || !doc.file_base64) return res.status(404).send("Albaran no disponible");
    await logPedidoEventoPortal(ctx.pedido.id, ctx.pedido.empresa_id, "colaborador_portal.albaran_descargado", {
      documento_id: doc.id,
      nombre: doc.nombre || "",
    });
    res.setHeader("Content-Type", doc.file_mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(doc.nombre || "albaran.pdf")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(String(doc.file_base64 || ""), "base64"));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

router.post("/public/portal/:token/pedidos/:pedidoId/albaranes", express.json({ limit: "6mb" }), async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    const { nombre, tipo, file_base64, file_mime, file_size_kb, notas, fase } = req.body || {};
    const upload = validateBase64Upload({ data: file_base64, mime: file_mime, filename: nombre });
    const cleanBase64 = upload.base64;
    if (!nombre || !cleanBase64) return res.status(400).json({ error: "Faltan nombre o archivo" });
    const tipoDoc = String(tipo || "albaran_colaborador").toLowerCase();
    if (!isAlbaranDoc({ tipo: tipoDoc, nombre })) return res.status(400).json({ error: "El portal proveedor solo acepta albaranes, POD o CMR del viaje" });

    const { rows } = await db.query(
      `INSERT INTO pedido_docs (pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,file_size_kb,notas)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id,nombre,tipo,file_mime,file_size_kb,notas,created_at`,
      [
        ctx.pedido.id,
        ctx.pedido.empresa_id,
        safeFilename(nombre, `albaran-${ctx.pedido.numero || ctx.pedido.id}.pdf`),
        tipoDoc || "albaran_colaborador",
        cleanBase64,
        file_mime || upload.mime || "application/pdf",
        Math.ceil(upload.sizeBytes / 1024),
        notas || "Subido desde portal proveedor",
      ]
    );
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(()=>{});
    await logPedidoEventoPortal(ctx.pedido.id, ctx.pedido.empresa_id, "colaborador_portal.albaran_subido", {
      documento_id: rows[0].id,
      nombre: rows[0].nombre,
      tipo: rows[0].tipo,
      colaborador_id: ctx.token.colaborador_id,
    });
    const faseNormalizada = String(fase || "").trim().toLowerCase();
    if (faseNormalizada === "carga" || faseNormalizada === "descarga") {
      await savePortalProveedorChoferPasos({
        pedidoId: ctx.pedido.id,
        empresaId: ctx.pedido.empresa_id,
        colaboradorId: ctx.token.colaborador_id,
        patch: faseNormalizada === "descarga"
          ? { albaran_descarga: true, albaran_descarga_at: new Date().toISOString() }
          : { albaran_carga: true, albaran_carga_at: new Date().toISOString() },
      }).catch(() => null);
    }
    await notificarAlbaranProveedor(ctx.pedido.empresa_id, ctx.pedido, { id: ctx.token.colaborador_id, nombre: ctx.token.nombre }, { ...rows[0], skip_notificacion: isQaRequest(req) });
    res.status(201).json({
      ...rows[0],
      download_url: `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/pedidos/${encodeURIComponent(ctx.pedido.id)}/albaranes/${encodeURIComponent(rows[0].id)}/descargar`,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/public/portal/:token/pedidos/:pedidoId/factura", express.json({ limit: "6mb" }), async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const ctx = await getPortalProveedorPedido(req.params.token, req.params.pedidoId);
    if (!ctx?.pedido) return res.status(404).json({ error: "Pedido no disponible para este proveedor" });
    const { rows: colRows } = await db.query(
      "SELECT id,nombre,tipo_iva,iva_regimen FROM colaboradores WHERE id=$1 AND empresa_id=$2",
      [ctx.token.colaborador_id, ctx.token.empresa_id]
    );
    const colaborador = colRows[0] || { id: ctx.token.colaborador_id, nombre: ctx.token.nombre };
    const existing = await db.query(
      `SELECT id,numero_factura
         FROM colaborador_facturas
        WHERE empresa_id=$1 AND colaborador_id=$2 AND pedido_id=$3
        LIMIT 1`,
      [ctx.token.empresa_id, ctx.token.colaborador_id, ctx.pedido.id]
    );
    if (existing.rows[0]) return res.status(409).json({ error: "Ya existe una factura recibida para este viaje" });

    const soporte = await db.query(
      `SELECT COUNT(*)::int AS total
         FROM pedido_docs
        WHERE pedido_id=$1
          AND empresa_id=$2
          AND (
            LOWER(COALESCE(tipo,'')) LIKE '%albaran%'
            OR LOWER(COALESCE(nombre,'')) LIKE '%albaran%'
            OR LOWER(COALESCE(tipo,'')) LIKE '%pod%'
            OR LOWER(COALESCE(nombre,'')) LIKE '%pod%'
            OR LOWER(COALESCE(tipo,'')) LIKE '%cmr%'
            OR LOWER(COALESCE(nombre,'')) LIKE '%cmr%'
          )`,
      [ctx.pedido.id, ctx.pedido.empresa_id]
    );
    if (Number(soporte.rows[0]?.total || 0) <= 0) {
      return res.status(409).json({
        error: "Antes de subir la factura debe existir albaran, POD o CMR del viaje.",
        requiere_albaran: true,
      });
    }

    const { numero_factura, total, archivo_base64, archivo_mime, notas } = req.body || {};
    const upload = validateBase64Upload({ data: archivo_base64, mime: archivo_mime, filename: "factura.pdf" });
    if (!upload.base64) return res.status(400).json({ error: "Archivo de factura obligatorio" });
    const totalFactura = Number(total || ctx.pedido.precio_colaborador || 0);
    const iva = normalizeIva(colaborador.tipo_iva, colaborador.iva_regimen);
    const base = iva.tipo_iva > 0 ? totalFactura / (1 + iva.tipo_iva / 100) : totalFactura;
    const { rows } = await db.query(
      `INSERT INTO colaborador_facturas
        (empresa_id,colaborador_id,pedido_id,referencia_orden,numero_factura,fecha,vencimiento,
         base,iva_pct,iva_regimen,total,estado,archivo_base64,archivo_mime,notas)
       VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,NULL,$6,$7,$8,$9,'pendiente',$10,$11,$12)
       RETURNING id,referencia_orden,numero_factura,fecha,vencimiento,base,iva_pct,iva_regimen,total,estado,archivo_mime,created_at`,
      [
        ctx.token.empresa_id,
        ctx.token.colaborador_id,
        ctx.pedido.id,
        ctx.pedido.numero || ctx.pedido.id,
        String(numero_factura || "").trim() || null,
        Number.isFinite(base) ? base : 0,
        iva.tipo_iva,
        iva.iva_regimen,
        Number.isFinite(totalFactura) ? totalFactura : 0,
        upload.base64,
        archivo_mime || upload.mime || "application/pdf",
        notas || "Subida desde portal proveedor",
      ]
    );
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [ctx.token.id]).catch(()=>{});
    await logPedidoEventoPortal(ctx.pedido.id, ctx.pedido.empresa_id, "colaborador_portal.factura_subida", {
      factura_id: rows[0].id,
      numero_factura: rows[0].numero_factura || "",
      total: rows[0].total,
      colaborador_id: ctx.token.colaborador_id,
    });
    await notificarFacturaProveedor(ctx.pedido.empresa_id, ctx.pedido, colaborador, { ...rows[0], skip_notificacion: isQaRequest(req) });
    res.status(201).json({
      ...rows[0],
      download_url: `/api/v1/colaboradores/public/portal/${encodeURIComponent(req.params.token)}/facturas/${encodeURIComponent(rows[0].id)}/descargar`,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/public/portal/:token/operativa", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Enlace no disponible</h1><p>El acceso ha caducado o no existe.</p>");
    await db.query("UPDATE colaborador_liquidacion_tokens SET opened_at=COALESCE(opened_at,NOW()) WHERE id=$1", [data.token.id]).catch(() => {});
    res.send(renderPortalProveedorOperativaHtml({
      token: req.params.token,
      colaborador: data.token,
      viajes: data.viajes || [],
    }));
  } catch (e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/public/portal/:token/facturas/:facturaId/descargar", async (req, res) => {
  try {
    await ensureColaboradorOpsSchema();
    const data = await getLiquidacionPublicData(req.params.token);
    if (!data?.token) return res.status(404).send("Enlace no disponible");
    const { rows } = await db.query(
      `SELECT id,pedido_id,numero_factura,referencia_orden,archivo_base64,archivo_mime
         FROM colaborador_facturas
        WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3
        LIMIT 1`,
      [req.params.facturaId, data.token.empresa_id, data.token.colaborador_id]
    );
    const factura = rows[0];
    if (!factura?.archivo_base64) return res.status(404).send("Factura sin archivo disponible");
    if (factura.pedido_id) {
      await logPedidoEventoPortal(factura.pedido_id, data.token.empresa_id, "colaborador_portal.factura_descargada", {
        factura_id: factura.id,
        numero_factura: factura.numero_factura || "",
        referencia_orden: factura.referencia_orden || "",
      });
    }
    res.setHeader("Content-Type", factura.archivo_mime || "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(factura.numero_factura || factura.referencia_orden || "factura-proveedor.pdf")}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(Buffer.from(String(factura.archivo_base64 || ""), "base64"));
  } catch(e) {
    res.status(500).send(e.message);
  }
});

router.use(authenticate);

async function notificarColaboradorPendienteRevision(empresaId, colaborador, actorId = null) {
  if (!empresaId || !colaborador?.id) return;
  await ensureNotificacionesSchema().catch(() => null);
  const { rows } = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','admin','administracion','administrativo','contable','trafico','superadmin')
      LIMIT 30`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  await Promise.all(rows.map(async u => {
    try {
      const exists = await db.query(
        `SELECT id
           FROM notificaciones_internas
          WHERE empresa_id=$1
            AND usuario_id=$2
            AND tipo='colaborador_revision'
            AND leida=false
            AND data->>'colaborador_id'=$3
          LIMIT 1`,
        [empresaId, u.id, String(colaborador.id)]
      ).catch(() => ({ rows: [] }));
      if (exists.rows?.[0]) return null;
      return crearNotificacion({
        empresa_id: empresaId,
        usuario_id: u.id,
        tipo: "colaborador_revision",
        titulo: "Colaborador pendiente de revisar",
        mensaje: `${colaborador.nombre || "Colaborador"} requiere completar datos fiscales, contacto, pago y documentacion antes de operar sin avisos.`,
        data: {
          colaborador_id: colaborador.id,
          colaborador_nombre: colaborador.nombre || "",
          view: "colaboradores",
          destino_modulo: "colaboradores",
          origen: colaborador.origen_creacion || "manual",
          dedupe_key: `colaborador_revision:${colaborador.id}`,
        },
        created_by: actorId,
      });
    } catch {
      return null;
    }
  }));
}

async function limpiarNotificacionesColaboradorRevision(empresaId, colaboradorId) {
  if (!empresaId || !colaboradorId) return;
  await ensureNotificacionesSchema().catch(() => null);
  await db.query(
    `UPDATE notificaciones_internas
        SET leida=true, read_at=COALESCE(read_at, NOW())
      WHERE empresa_id=$1
        AND tipo='colaborador_revision'
        AND leida=false
        AND data->>'colaborador_id'=$2`,
    [empresaId, String(colaboradorId)]
  ).catch(() => null);
}

async function usuariosGestionColaboradores(empresaId) {
  const { rows } = await db.query(
    `SELECT id
       FROM usuarios
      WHERE empresa_id=$1
        AND activo IS DISTINCT FROM false
        AND rol::text IN ('gerente','admin','administracion','administrativo','contable','trafico','superadmin')
      LIMIT 40`,
    [empresaId]
  ).catch(() => ({ rows: [] }));
  return rows;
}

async function notificarLiquidacionColaborador(empresaId, tokenRow, tipoAviso, actorId = null) {
  const usuarios = await usuariosGestionColaboradores(empresaId);
  const nombre = tokenRow.colaborador_nombre || "Colaborador";
  const titulo = tipoAviso === "sin_abrir"
    ? "Liquidacion sin abrir"
    : "Liquidacion pendiente de confirmar";
  const mensaje = tipoAviso === "sin_abrir"
    ? `${nombre} no ha abierto la liquidacion enviada.`
    : `${nombre} ha abierto la liquidacion, pero aun no ha confirmado la revision.`;
  await Promise.all(usuarios.map(u => crearNotificacion({
    empresa_id: empresaId,
    usuario_id: u.id,
    tipo: "colaborador_liquidacion",
    titulo,
    mensaje,
    data: {
      colaborador_id: tokenRow.colaborador_id,
      liquidacion_token_id: tokenRow.id,
      tipo_aviso: tipoAviso,
      view: "colaboradores",
      dedupe_key: `colaborador_liquidacion:${tipoAviso}:${tokenRow.id}`,
    },
    created_by: actorId,
  }).catch(() => null)));
}

async function revisarLiquidacionesPendientes(empresaId, actorId = null) {
  await ensureColaboradorOpsSchema();
  const sinAbrir = await db.query(
    `UPDATE colaborador_liquidacion_tokens t
        SET opened_alerted_at=NOW()
       FROM colaboradores c
      WHERE c.id=t.colaborador_id
        AND c.empresa_id=t.empresa_id
        AND t.empresa_id=$1
        AND t.expires_at > NOW()
        AND t.opened_at IS NULL
        AND t.opened_alerted_at IS NULL
        AND t.created_at < NOW() - INTERVAL '48 hours'
      RETURNING t.id,t.colaborador_id,t.created_at,t.expires_at,c.nombre AS colaborador_nombre`,
    [empresaId]
  );
  const sinConfirmar = await db.query(
    `UPDATE colaborador_liquidacion_tokens t
        SET acknowledged_alerted_at=NOW()
       FROM colaboradores c
      WHERE c.id=t.colaborador_id
        AND c.empresa_id=t.empresa_id
        AND t.empresa_id=$1
        AND t.expires_at > NOW()
        AND t.opened_at IS NOT NULL
        AND t.acknowledged_at IS NULL
        AND t.acknowledged_alerted_at IS NULL
        AND t.opened_at < NOW() - INTERVAL '72 hours'
      RETURNING t.id,t.colaborador_id,t.opened_at,t.expires_at,c.nombre AS colaborador_nombre`,
    [empresaId]
  );
  await Promise.all([
    ...sinAbrir.rows.map(row => notificarLiquidacionColaborador(empresaId, row, "sin_abrir", actorId)),
    ...sinConfirmar.rows.map(row => notificarLiquidacionColaborador(empresaId, row, "sin_confirmar", actorId)),
  ]);
  return {
    sin_abrir: sinAbrir.rows.length,
    sin_confirmar: sinConfirmar.rows.length,
    total: sinAbrir.rows.length + sinConfirmar.rows.length,
  };
}

function normalizeIva(tipoIva, ivaRegimen) {
  const rawRegimen = String(ivaRegimen || "").trim().toLowerCase();
  const rawTipo = String(tipoIva ?? "").trim().toLowerCase();
  const key = rawRegimen || rawTipo;

  if (key === "exento") return { tipo_iva: 0, iva_regimen: "exento" };
  if (key === "cero" || key === "0") return { tipo_iva: 0, iva_regimen: "cero" };
  if (key === "reducido" || key === "10") return { tipo_iva: 10, iva_regimen: "reducido" };
  if (key === "superreducido" || key === "4") return { tipo_iva: 4, iva_regimen: "superreducido" };

  const pct = Number(tipoIva);
  if (Number.isFinite(pct)) {
    if (pct === 0) return { tipo_iva: 0, iva_regimen: rawRegimen === "exento" ? "exento" : "cero" };
    if (pct === 10) return { tipo_iva: 10, iva_regimen: "reducido" };
    if (pct === 4) return { tipo_iva: 4, iva_regimen: "superreducido" };
  }

  return { tipo_iva: 21, iva_regimen: "general" };
}

router.get("/", async (req,res)=>{
  const empresaId = req.empresaId || req.user?.empresa_id;
  try {
    await ensureColaboradorOpsSchema();
    const {rows}=await db.query(
      `SELECT * FROM colaboradores
       WHERE activo=true
         AND empresa_id=$1
         AND ${QA_COLABORADOR_SQL_FILTER}
       ORDER BY nombre`,
      [empresaId]
    );
    res.json(rows);
  } catch(e) {
    if (e.code === "42703") {
      return res.json([]);
    }
    res.status(500).json({error:e.message});
  }
});

router.get("/pendientes-revision", async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT COUNT(*) FROM colaboradores
       WHERE empresa_id=$1
         AND pendiente_revision=true
         AND activo=true
         AND ${QA_COLABORADOR_SQL_FILTER}`,
      [empresaId]
    );
    res.json({ count: parseInt(rows[0]?.count || 0, 10) });
  } catch(e) {
    res.json({ count: 0 });
  }
});

router.post("/liquidaciones/revisar-alertas", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const result = await revisarLiquidacionesPendientes(empresaId, req.user?.id || null);
    res.json({
      ok: true,
      ...result,
      mensaje: result.total
        ? `Se han generado ${result.total} aviso(s) de liquidaciones pendientes.`
        : "No hay liquidaciones pendientes de aviso.",
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const {tipo,nombre,cif,email,telefono,iban,valoracion,notas,tipo_iva,iva_regimen,
           calle,num_ext,codigo_postal,ciudad,provincia,pais,
           contacto_nombre,contacto_telefono,forma_pago,pendiente_revision,origen_creacion}=req.body;
    const empresaId=req.empresaId||req.user.empresa_id;
    const iva = normalizeIva(tipo_iva, iva_regimen);
    const revisionExplicita = pendiente_revision === false || String(pendiente_revision).toLowerCase() === "false";
    const requiereRevision = !revisionExplicita || String(origen_creacion || "").toLowerCase() === "pedidos";
    const {rows}=await db.query(
      `INSERT INTO colaboradores
        (tipo,nombre,cif,email,telefono,iban,valoracion,notas,tipo_iva,iva_regimen,
         calle,num_ext,codigo_postal,ciudad,provincia,pais,contacto_nombre,contacto_telefono,forma_pago,empresa_id,
         pendiente_revision,origen_creacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING *`,
      [
        tipo||"autonomo",nombre,cif||null,email||null,telefono||null,iban||null,valoracion||5,notas||null,
        iva.tipo_iva,iva.iva_regimen,
        calle||null,num_ext||null,codigo_postal||null,ciudad||null,provincia||null,pais||null,
        contacto_nombre||null,contacto_telefono||null,forma_pago||null,empresaId,
        requiereRevision, origen_creacion || (requiereRevision ? "pedidos" : null)
      ]
    );
    if (requiereRevision) {
      await notificarColaboradorPendienteRevision(empresaId, rows[0], req.user?.id || null).catch(() => null);
    }
    res.status(201).json(rows[0]);
  } catch(e) { res.status(500).json({error:e.message}); }
});
router.put("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  const {tipo,nombre,cif,email,telefono,iban,activo,notas,
         calle,num_ext,codigo_postal,ciudad,provincia,
         contacto_nombre,contacto_telefono,forma_pago,tipo_iva,iva_regimen,pendiente_revision}=req.body;
  const empresaId = req.empresaId || req.user.empresa_id;
  const iva = normalizeIva(tipo_iva, iva_regimen);
  try {
    await ensureColaboradorOpsSchema();
    const {rows}=await db.query(
      `UPDATE colaboradores SET
        tipo=$1,nombre=$2,cif=$3,email=$4,telefono=$5,iban=$6,activo=$7,notas=$8,
        calle=$9,num_ext=$10,codigo_postal=$11,ciudad=$12,provincia=$13,
        contacto_nombre=$14,contacto_telefono=$15,forma_pago=$16,tipo_iva=$17,iva_regimen=$18,
        pendiente_revision=$19
       WHERE id=$20 AND empresa_id=$21 RETURNING *`,
      [tipo,nombre,cif||null,email||null,telefono||null,iban||null,
       activo!==undefined?activo:true,notas||null,
       calle||null,num_ext||null,codigo_postal||null,ciudad||null,provincia||null,
       contacto_nombre||null,contacto_telefono||null,forma_pago||null,
       iva.tipo_iva,iva.iva_regimen,pendiente_revision !== undefined ? pendiente_revision : false,req.params.id,empresaId]);
    if(!rows[0])return res.status(404).json({error:"No encontrado"});
    if (rows[0].pendiente_revision) {
      await notificarColaboradorPendienteRevision(empresaId, rows[0], req.user?.id || null).catch(() => null);
    } else {
      await limpiarNotificacionesColaboradorRevision(empresaId, rows[0].id);
    }
    res.json(rows[0]);
  } catch(e) {
    // Fallback if new columns don't exist yet
    if(e.code==='42703') {
      const {rows}=await db.query(
        "UPDATE colaboradores SET tipo=$1,nombre=$2,cif=$3,email=$4,telefono=$5,iban=$6,activo=$7,notas=$8 WHERE id=$9 AND empresa_id=$10 RETURNING *",
        [tipo,nombre,cif||null,email||null,telefono||null,iban||null,activo!==undefined?activo:true,notas||null,req.params.id,empresaId]);
      return res.json(rows[0]);
    }
    throw e;
  }
});

// ── Vehículos de colaboradores ────────────────────────────────────────────
router.delete("/:id", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const { rows } = await db.query(
      "UPDATE colaboradores SET activo=false WHERE id=$1 AND empresa_id=$2 RETURNING id,nombre,activo",
      [req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Colaborador no encontrado" });
    res.json({ ok:true, colaborador: rows[0] });
  } catch(e) {
    res.status(500).json({ error:e.message || "No se pudo dar de baja el colaborador" });
  }
});

router.patch("/:id/revision", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      "UPDATE colaboradores SET pendiente_revision=false WHERE id=$1 AND empresa_id=$2 RETURNING *",
      [req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Colaborador no encontrado" });
    await limpiarNotificacionesColaboradorRevision(empresaId, req.params.id);
    res.json(rows[0]);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/liquidacion-token", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const col = await db.query(
      "SELECT id,nombre FROM colaboradores WHERE id=$1 AND empresa_id=$2 AND activo=true",
      [req.params.id, empresaId]
    );
    if (!col.rows[0]) return res.status(404).json({ error: "Colaborador no encontrado" });
    const dias = Math.min(Math.max(Number(req.body?.dias || 30), 1), 90);
    const token = crypto.randomBytes(32).toString("hex");
    const { rows } = await db.query(
      `INSERT INTO colaborador_liquidacion_tokens
        (empresa_id,colaborador_id,token_hash,expires_at,created_by)
       VALUES ($1,$2,$3,NOW() + ($4::text || ' days')::interval,$5)
       RETURNING id, expires_at, opened_at, created_at`,
      [empresaId, req.params.id, hashToken(token), String(dias), req.user?.id || null]
    );
    res.status(201).json({
      ...rows[0],
      colaborador_id: req.params.id,
      colaborador_nombre: col.rows[0].nombre,
      url: `${publicBaseUrl(req)}/api/v1/colaboradores/public/liquidacion/${token}`,
      portal_url: `${publicBaseUrl(req)}/api/v1/colaboradores/public/portal/${token}`,
      operativa_url: `${publicBaseUrl(req)}/api/v1/colaboradores/public/portal/${token}/operativa`,
      expires_in_days: dias,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/:id/liquidacion-email", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const col = await db.query(
      "SELECT id,nombre,email FROM colaboradores WHERE id=$1 AND empresa_id=$2 AND activo=true",
      [req.params.id, empresaId]
    );
    const colaborador = col.rows[0];
    if (!colaborador) return res.status(404).json({ error: "Colaborador no encontrado" });
    const destinatario = String(req.body?.destinatario || colaborador.email || "").trim();
    if (!destinatario) return res.status(400).json({ error: "El colaborador no tiene email configurado" });
    const dias = Math.min(Math.max(Number(req.body?.dias || 30), 1), 90);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenRes = await db.query(
      `INSERT INTO colaborador_liquidacion_tokens
        (empresa_id,colaborador_id,token_hash,expires_at,created_by)
       VALUES ($1,$2,$3,NOW() + ($4::text || ' days')::interval,$5)
       RETURNING id, expires_at, opened_at, created_at`,
      [empresaId, req.params.id, hashToken(token), String(dias), req.user?.id || null]
    );
    const empresaRes = await db.query("SELECT nombre, razon_social FROM empresas WHERE id=$1", [empresaId]).catch(() => ({ rows: [] }));
    const row = tokenRes.rows[0];
    const url = `${publicBaseUrl(req)}/api/v1/colaboradores/public/liquidacion/${token}`;
    const portalUrl = `${publicBaseUrl(req)}/api/v1/colaboradores/public/portal/${token}`;
    const operativaUrl = `${publicBaseUrl(req)}/api/v1/colaboradores/public/portal/${token}/operativa`;
    const result = await enviarEmail({
      trigger: "colaborador_liquidacion",
      destinatario,
      plantilla: "colaborador_liquidacion",
      empresa_id: empresaId,
      datos: {
        empresa: empresaRes.rows[0]?.razon_social || empresaRes.rows[0]?.nombre || "TransGest",
        colaborador: colaborador.nombre || "Colaborador",
        url: portalUrl,
        liquidacion_url: url,
        portal_url: portalUrl,
        operativa_url: operativaUrl,
        caducidad: row.expires_at ? new Date(row.expires_at).toLocaleDateString("es-ES") : "",
      },
      meta: {
        colaborador_id: req.params.id,
        liquidacion_token_id: row.id,
      },
    });
    res.status(201).json({
      ...row,
      colaborador_id: req.params.id,
      colaborador_nombre: colaborador.nombre,
      destinatario,
      url,
      portal_url: portalUrl,
      operativa_url: operativaUrl,
      simulado: !!result?.simulado,
      caducado: false,
      abierto: false,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/liquidacion-tokens", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT t.id,t.expires_at,t.opened_at,t.acknowledged_at,t.downloaded_at,t.download_count,t.created_at,u.nombre AS created_by_nombre
         FROM colaborador_liquidacion_tokens t
         LEFT JOIN usuarios u ON u.id=t.created_by
        WHERE t.empresa_id=$1 AND t.colaborador_id=$2
        ORDER BY t.created_at DESC
        LIMIT 12`,
      [empresaId, req.params.id]
    );
    res.json(rows.map(row => ({
      ...row,
      caducado: row.expires_at ? new Date(row.expires_at).getTime() < Date.now() : false,
      abierto: Boolean(row.opened_at),
      confirmado: Boolean(row.acknowledged_at),
      descargado: Boolean(row.downloaded_at),
    })));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete("/:id/liquidacion-tokens/:tokenId", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `UPDATE colaborador_liquidacion_tokens
          SET expires_at=NOW()
        WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3
        RETURNING id, expires_at, opened_at, acknowledged_at, downloaded_at, download_count, created_at`,
      [req.params.tokenId, req.params.id, empresaId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Enlace no encontrado" });
    res.json({
      ...rows[0],
      caducado: true,
      abierto: Boolean(rows[0].opened_at),
      confirmado: Boolean(rows[0].acknowledged_at),
      descargado: Boolean(rows[0].downloaded_at),
      mensaje: "Enlace revocado correctamente",
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/historial", async (req,res)=>{
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { referencia } = req.query;
    const params = [req.params.id, empresaId];
    const where = ["p.colaborador_id=$1", "p.empresa_id=$2"];
    if (referencia) {
      params.push(`%${String(referencia).trim().toLowerCase()}%`);
      where.push(`(
        LOWER(COALESCE(p.numero,'')) LIKE $${params.length}
        OR
        LOWER(COALESCE(p.referencia_cliente,'')) LIKE $${params.length}
        OR LOWER(CAST(p.id AS TEXT)) LIKE $${params.length}
      )`);
    }

    const { rows } = await db.query(
      `SELECT p.*,
              c.nombre AS cliente_nombre,
              co.nombre AS colaborador_nombre,
              COALESCE(p.numero, p.referencia_cliente, CAST(p.id AS TEXT)) AS referencia_busqueda,
              p.precio_colaborador AS importe_colaborador
         FROM pedidos p
         LEFT JOIN clientes c ON c.id=p.cliente_id
         LEFT JOIN colaboradores co ON co.id=p.colaborador_id
        WHERE ${where.join(" AND ")}
        ORDER BY p.fecha_carga DESC NULLS LAST, p.created_at DESC NULLS LAST
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.get("/:id/acciones-pendientes", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const data = await getColaboradorOpsData(empresaId, req.params.id, {
      referencia: req.query?.referencia || "",
    });
    if (!data) return res.status(404).json({ error: "Colaborador no encontrado" });
    const resumen = buildPortalProveedorResumen(data);
    delete resumen._facturas_estado;
    res.json({
      ...resumen,
      viajes_sin_soporte: (data.viajes || [])
        .filter(v => Number(v.albaranes_count || 0) <= 0)
        .slice(0, 80)
        .map(v => ({
          id: v.id,
          numero: v.numero || v.referencia_cliente || v.id,
          fecha_carga: v.fecha_carga || null,
          origen: v.origen || "",
          destino: v.destino || "",
          cliente_nombre: v.cliente_nombre || "",
          importe_colaborador: Number(v.importe_colaborador || v.precio_colaborador || 0),
        })),
      facturas_en_riesgo: (data.facturas || [])
        .filter(f => !["pagada", "pagado"].includes(String(f.estado || "").toLowerCase()))
        .slice(0, 80)
        .map(f => {
          const sit = situacionFacturaProveedor(f);
          return {
            id: f.id,
            pedido_id: f.pedido_id || null,
            numero_factura: facturaNumero(f) || "",
            referencia_orden: f.referencia_orden || f.referencia_cliente || "",
            vencimiento: f.vencimiento || null,
            estado: f.estado || "",
            total: Number(f.total || 0),
            situacion: sit.label,
            situacion_color: sit.cls,
          };
        }),
      documentos_en_riesgo: (data.documentos || [])
        .map(d => ({ ...d, estado_doc: documentStatus(d) }))
        .filter(d => d.estado_doc.days === null || d.estado_doc.days <= 30)
        .slice(0, 80)
        .map(d => ({
          id: d.id,
          tipo: d.tipo || "",
          nombre: d.nombre || "",
          caducidad: d.caducidad || null,
          estado: d.estado_doc.label,
          estado_color: d.estado_doc.cls,
        })),
      vehiculos_en_riesgo: (data.vehiculos || [])
        .flatMap(v => docsVehiculoProveedor(v)
          .filter(d => ["red", "amber"].includes(d.estado_color))
          .map(d => ({
            vehiculo_id: v.id,
            matricula: v.matricula || "",
            documento: d.nombre || "",
            caducidad: d.caducidad || null,
            estado: d.estado || "",
            estado_color: d.estado_color || "amber",
          })))
        .slice(0, 80),
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/:id/informe-acciones", GERENTE_O_TRAFICO, async (req,res) => {
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const data = await getColaboradorOpsData(empresaId, req.params.id, {
      referencia: req.query?.referencia || "",
    });
    if (!data) return res.status(404).send("<!doctype html><meta charset='utf-8'><h1>Colaborador no encontrado</h1>");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename(`acciones-proveedor-${data.token?.nombre || req.params.id}.html`)}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(renderPortalProveedorAccionesHtml(data, ""));
  } catch(e) {
    res.status(500).send(`<!doctype html><meta charset="utf-8"><h1>Error</h1><p>${htmlEscape(e.message)}</p>`);
  }
});

router.get("/:id/facturas", async (req,res)=>{
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { referencia } = req.query;
    const params = [req.params.id, empresaId];
    const where = ["cf.colaborador_id=$1", "cf.empresa_id=$2"];
    if (referencia) {
      params.push(`%${String(referencia).trim().toLowerCase()}%`);
      where.push(`(
        LOWER(COALESCE(cf.referencia_orden,'')) LIKE $${params.length}
        OR LOWER(COALESCE(cf.numero_factura,'')) LIKE $${params.length}
        OR LOWER(COALESCE(p.numero,'')) LIKE $${params.length}
        OR LOWER(COALESCE(p.referencia_cliente,'')) LIKE $${params.length}
      )`);
    }
    const { rows } = await db.query(
      `SELECT cf.*, p.numero, p.referencia_cliente, p.fecha_carga, p.fecha_descarga
         FROM colaborador_facturas cf
         LEFT JOIN pedidos p ON p.id=cf.pedido_id
        WHERE ${where.join(" AND ")}
        ORDER BY cf.fecha DESC, cf.created_at DESC
        LIMIT 500`,
      params
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.post("/:id/facturas", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const {
      pedido_id, referencia_orden, numero_factura, fecha, vencimiento,
      base, iva_pct, iva_regimen, total, estado, archivo_base64, archivo_mime, notas,
    } = req.body || {};
    const colaborador = await db.query(
      "SELECT id, tipo_iva, iva_regimen FROM colaboradores WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!colaborador.rows[0]) return res.status(404).json({ error: "Colaborador no encontrado" });
    const defaultIva = normalizeIva(colaborador.rows[0].tipo_iva, colaborador.rows[0].iva_regimen);
    const invoiceIva = normalizeIva(
      iva_pct === undefined || iva_pct === null || iva_pct === "" ? defaultIva.tipo_iva : iva_pct,
      iva_regimen || defaultIva.iva_regimen
    );
    const cleanBase = Number(base || 0);
    const cleanIva = Number(invoiceIva.tipo_iva);
    const cleanTotal = total !== undefined && total !== null && total !== ""
      ? Number(total)
      : cleanBase * (1 + cleanIva / 100);
    let refOrden = referencia_orden || null;
    if (pedido_id) {
      const pedido = await db.query(
        "SELECT numero, referencia_cliente FROM pedidos WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3",
        [pedido_id, empresaId, req.params.id]
      );
      if (!pedido.rows[0]) return res.status(404).json({ error: "Pedido del colaborador no encontrado" });
      refOrden = refOrden || pedido.rows[0].numero || pedido.rows[0].referencia_cliente || null;
    }

    if (pedido_id || numero_factura) {
      const dupParams = [empresaId, req.params.id];
      const dupWhere = [];
      if (pedido_id) {
        dupParams.push(pedido_id);
        dupWhere.push(`pedido_id=$${dupParams.length}`);
      }
      if (numero_factura) {
        dupParams.push(String(numero_factura).trim().toLowerCase());
        dupWhere.push(`LOWER(COALESCE(numero_factura,''))=$${dupParams.length}`);
      }
      const dup = await db.query(
        `SELECT id, numero_factura, referencia_orden
           FROM colaborador_facturas
          WHERE empresa_id=$1 AND colaborador_id=$2 AND (${dupWhere.join(" OR ")})
          LIMIT 1`,
        dupParams
      );
      if (dup.rows[0]) return res.status(409).json({ error: "Ya existe una factura recibida para ese viaje o numero de factura" });
    }

    const { rows } = await db.query(
      `INSERT INTO colaborador_facturas
        (empresa_id,colaborador_id,pedido_id,referencia_orden,numero_factura,fecha,vencimiento,
         base,iva_pct,iva_regimen,total,estado,archivo_base64,archivo_mime,notas,created_by)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6::date,CURRENT_DATE),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        empresaId,
        req.params.id,
        pedido_id || null,
        refOrden,
        numero_factura || null,
        fecha || null,
        vencimiento || null,
        Number.isFinite(cleanBase) ? cleanBase : 0,
        Number.isFinite(cleanIva) ? cleanIva : 21,
        invoiceIva.iva_regimen,
        Number.isFinite(cleanTotal) ? cleanTotal : 0,
        estado || "pendiente",
        archivo_base64 || null,
        archivo_mime || null,
        notas || null,
        req.user?.id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.put("/:id/facturas/:facturaId", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    const {
      referencia_orden, numero_factura, fecha, vencimiento,
      base, iva_pct, iva_regimen, total, estado, archivo_base64, archivo_mime, notas,
    } = req.body || {};

    const colaborador = await db.query(
      "SELECT id, tipo_iva, iva_regimen FROM colaboradores WHERE id=$1 AND empresa_id=$2",
      [req.params.id, empresaId]
    );
    if (!colaborador.rows[0]) return res.status(404).json({ error: "Colaborador no encontrado" });

    const actual = await db.query(
      "SELECT * FROM colaborador_facturas WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3",
      [req.params.facturaId, req.params.id, empresaId]
    );
    if (!actual.rows[0]) return res.status(404).json({ error: "Factura recibida no encontrada" });

    const defaultIva = normalizeIva(colaborador.rows[0].tipo_iva, colaborador.rows[0].iva_regimen);
    const invoiceIva = normalizeIva(
      iva_pct === undefined || iva_pct === null || iva_pct === "" ? defaultIva.tipo_iva : iva_pct,
      iva_regimen || defaultIva.iva_regimen
    );
    const cleanBase = Number(base || 0);
    const cleanIva = Number(invoiceIva.tipo_iva);
    const cleanTotal = total !== undefined && total !== null && total !== ""
      ? Number(total)
      : cleanBase * (1 + cleanIva / 100);

    if (numero_factura) {
      const dup = await db.query(
        `SELECT id
           FROM colaborador_facturas
          WHERE empresa_id=$1
            AND colaborador_id=$2
            AND id<>$3
            AND LOWER(COALESCE(numero_factura,''))=$4
          LIMIT 1`,
        [empresaId, req.params.id, req.params.facturaId, String(numero_factura).trim().toLowerCase()]
      );
      if (dup.rows[0]) return res.status(409).json({ error: "Ya existe otra factura recibida con ese numero" });
    }

    const { rows } = await db.query(
      `UPDATE colaborador_facturas
          SET referencia_orden=$1,
              numero_factura=$2,
              fecha=COALESCE($3::date, fecha),
              vencimiento=$4,
              base=$5,
              iva_pct=$6,
              iva_regimen=$7,
              total=$8,
              estado=$9,
              archivo_base64=COALESCE($10, archivo_base64),
              archivo_mime=COALESCE($11, archivo_mime),
              notas=$12,
              updated_at=NOW()
        WHERE id=$13 AND colaborador_id=$14 AND empresa_id=$15
        RETURNING *`,
      [
        referencia_orden || actual.rows[0].referencia_orden || null,
        numero_factura || null,
        fecha || null,
        vencimiento || null,
        Number.isFinite(cleanBase) ? cleanBase : Number(actual.rows[0].base || 0),
        Number.isFinite(cleanIva) ? cleanIva : Number(actual.rows[0].iva_pct || 21),
        invoiceIva.iva_regimen,
        Number.isFinite(cleanTotal) ? cleanTotal : Number(actual.rows[0].total || 0),
        estado || actual.rows[0].estado || "pendiente",
        archivo_base64 || null,
        archivo_mime || null,
        notas || null,
        req.params.facturaId,
        req.params.id,
        empresaId,
      ]
    );
    res.json(rows[0]);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.delete("/:id/facturas/:facturaId", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    const empresaId = req.empresaId || req.user?.empresa_id;
    await db.query(
      "DELETE FROM colaborador_facturas WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3",
      [req.params.facturaId, req.params.id, empresaId]
    );
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.get("/:id/pagos", async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT *
         FROM colaborador_pagos
        WHERE colaborador_id=$1 AND empresa_id=$2
        ORDER BY fecha DESC, created_at DESC`,
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.post("/:id/pagos", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { fecha, concepto, importe, estado, notas } = req.body || {};
    if (!fecha || !concepto || !String(concepto).trim()) {
      return res.status(400).json({ error: "Fecha y concepto obligatorios" });
    }
    const { rows } = await db.query(
      `INSERT INTO colaborador_pagos
        (empresa_id,colaborador_id,fecha,concepto,importe,estado,notas,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        empresaId,
        req.params.id,
        fecha,
        String(concepto).trim(),
        Number(importe || 0),
        estado || "pagado",
        notas || null,
        req.user?.id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.delete("/:id/pagos/:pagoId", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    await db.query(
      "DELETE FROM colaborador_pagos WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3",
      [req.params.pagoId, req.params.id, empresaId]
    );
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.get("/:id/documentos", async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { rows } = await db.query(
      `SELECT *
         FROM colaborador_documentos
        WHERE colaborador_id=$1 AND empresa_id=$2
        ORDER BY caducidad ASC NULLS LAST, created_at DESC`,
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.post("/:id/documentos", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const { tipo, nombre, caducidad, notas } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ error: "El nombre del documento es obligatorio" });
    }
    const { rows } = await db.query(
      `INSERT INTO colaborador_documentos
        (empresa_id,colaborador_id,tipo,nombre,caducidad,notas,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        empresaId,
        req.params.id,
        tipo || "otro",
        String(nombre).trim(),
        caducidad || null,
        notas || null,
        req.user?.id || null,
      ]
    );
    res.status(201).json(rows[0]);
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.delete("/:id/documentos/:docId", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    await db.query(
      "DELETE FROM colaborador_documentos WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3",
      [req.params.docId, req.params.id, empresaId]
    );
    res.json({ ok:true });
  } catch(e) {
    res.status(500).json({error:e.message});
  }
});

router.get("/:id/vehiculos", async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user?.empresa_id;
    const {rows}=await db.query(
      "SELECT * FROM colaborador_vehiculos WHERE colaborador_id=$1 AND empresa_id=$2 AND activo=true ORDER BY matricula",
      [req.params.id, empresaId]
    );
    res.json(rows);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.post("/:id/vehiculos", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId||req.user.empresa_id;
    const { rows: colRows } = await db.query("SELECT id FROM colaboradores WHERE id=$1 AND empresa_id=$2", [req.params.id, empresaId]);
    if (!colRows[0]) return res.status(404).json({error:"Colaborador no encontrado"});
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
           doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc}=req.body;
    if(!matricula) return res.status(400).json({error:"Matrícula obligatoria"});
    const {rows}=await db.query(
      `INSERT INTO colaborador_vehiculos
        (colaborador_id,empresa_id,matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,
         num_ejes,longitud_m,notas,doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [req.params.id,empresaId,matricula,marca||null,modelo||null,año||null,tipo||"Camión",
       tara_kg||null,carga_max_kg||null,bastidor||null,num_ejes||2,longitud_m||null,notas||null,
       doc_tarjeta_transp||null,doc_tarjeta_exp||null,doc_seguro_venc||null,doc_itv_venc||null,doc_tacografo_venc||null]
    );
    res.status(201).json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.put("/:id/vehiculos/:vid", GERENTE_O_TRAFICO, async (req,res)=>{
  try {
    await ensureColaboradorOpsSchema();
    const empresaId = req.empresaId || req.user.empresa_id;
    const {matricula,marca,modelo,año,tipo,tara_kg,carga_max_kg,bastidor,num_ejes,longitud_m,notas,
           doc_tarjeta_transp,doc_tarjeta_exp,doc_seguro_venc,doc_itv_venc,doc_tacografo_venc}=req.body;
    const {rows}=await db.query(
      `UPDATE colaborador_vehiculos SET
        matricula=$1,marca=$2,modelo=$3,año=$4,tipo=$5,tara_kg=$6,carga_max_kg=$7,bastidor=$8,
        num_ejes=$9,longitud_m=$10,notas=$11,doc_tarjeta_transp=$12,doc_tarjeta_exp=$13,
        doc_seguro_venc=$14,doc_itv_venc=$15,doc_tacografo_venc=$16
       WHERE id=$17 AND colaborador_id=$18 AND empresa_id=$19 RETURNING *`,
      [matricula,marca||null,modelo||null,año||null,tipo||"Camión",tara_kg||null,carga_max_kg||null,
       bastidor||null,num_ejes||2,longitud_m||null,notas||null,doc_tarjeta_transp||null,
       doc_tarjeta_exp||null,doc_seguro_venc||null,doc_itv_venc||null,doc_tacografo_venc||null,
       req.params.vid,req.params.id,empresaId]
    );
    if(!rows[0]) return res.status(404).json({error:"No encontrado"});
    res.json(rows[0]);
  } catch(e){ res.status(500).json({error:e.message}); }
});

router.delete("/:id/vehiculos/:vid", GERENTE_O_TRAFICO, async (req,res)=>{
  await ensureColaboradorOpsSchema();
  const empresaId = req.empresaId || req.user.empresa_id;
  await db.query("UPDATE colaborador_vehiculos SET activo=false WHERE id=$1 AND colaborador_id=$2 AND empresa_id=$3",
    [req.params.vid,req.params.id,empresaId]);
  res.json({ok:true});
});

module.exports = router;

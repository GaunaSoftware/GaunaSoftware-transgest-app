const nodemailer = require("nodemailer");
const db         = require("./db");
const logger     = require("./logger");
const { encryptSecret, decryptSecret, maskSecret } = require("./apiKeys");

// ── Transporter ───────────────────────────────────────
let transporter;
function getTransporter(config = null) {
  if (config) {
    return nodemailer.createTransport({
      host: config.smtp_host,
      port: parseInt(config.smtp_port || "587"),
      secure: !!config.smtp_secure || String(config.smtp_port) === "465",
      auth: config.smtp_user || config.smtp_pass ? {
        user: config.smtp_user || "",
        pass: config.smtp_pass || "",
      } : undefined,
      tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
    });
  }
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   process.env.SMTP_HOST,
      port:   parseInt(process.env.SMTP_PORT || "587"),
      secure: process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: { rejectUnauthorized: process.env.NODE_ENV === "production" },
    });
  }
  return transporter;
}

async function ensureEmailTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresa_smtp_config (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      smtp_host VARCHAR(200),
      smtp_port INTEGER NOT NULL DEFAULT 587,
      smtp_secure BOOLEAN NOT NULL DEFAULT false,
      smtp_user VARCHAR(255),
      smtp_pass_encrypted TEXT,
      smtp_from VARCHAR(255),
      smtp_from_nombre VARCHAR(150),
      reply_to VARCHAR(255),
      envio_facturas_auto BOOLEAN NOT NULL DEFAULT false,
      envio_avisos_carga_auto BOOLEAN NOT NULL DEFAULT false,
      asunto_factura TEXT,
      cuerpo_factura TEXT,
      asunto_carga TEXT,
      cuerpo_carga TEXT,
      activo BOOLEAN NOT NULL DEFAULT true,
      last_test_at TIMESTAMPTZ,
      last_test_ok BOOLEAN,
      last_error TEXT,
      updated_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID,
      trigger VARCHAR(100),
      destinatario TEXT,
      asunto TEXT,
      estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
      error TEXT,
      provider VARCHAR(40),
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("ALTER TABLE email_log ADD COLUMN IF NOT EXISTS adjuntos_count INTEGER NOT NULL DEFAULT 0").catch(() => {});
  await db.query("ALTER TABLE email_log ADD COLUMN IF NOT EXISTS message_id TEXT").catch(() => {});
  await db.query("ALTER TABLE email_log ADD COLUMN IF NOT EXISTS meta JSONB NOT NULL DEFAULT '{}'::jsonb").catch(() => {});
}

function publicEmailConfig(row = {}) {
  return {
    smtp_host: row.smtp_host || "",
    smtp_port: String(row.smtp_port || "587"),
    smtp_secure: !!row.smtp_secure,
    smtp_user: row.smtp_user || "",
    smtp_pass: "",
    smtp_pass_masked: row.smtp_pass_encrypted ? maskSecret("************") : "",
    smtp_from: row.smtp_from || "",
    smtp_from_nombre: row.smtp_from_nombre || "",
    reply_to: row.reply_to || "",
    envio_facturas_auto: !!row.envio_facturas_auto,
    envio_avisos_carga_auto: !!row.envio_avisos_carga_auto,
    asunto_factura: row.asunto_factura || "Factura {numero} - {empresa}",
    cuerpo_factura: row.cuerpo_factura || "",
    asunto_carga: row.asunto_carga || "Nuevo pedido asignado - {numero}",
    cuerpo_carga: row.cuerpo_carga || "",
    activo: row.activo !== false,
    last_test_at: row.last_test_at || null,
    last_test_ok: row.last_test_ok,
    last_error: row.last_error || "",
    updated_at: row.updated_at || null,
  };
}

async function getEmpresaEmailConfig(empresaId, includeSecret = false) {
  await ensureEmailTables();
  if (!empresaId) return null;
  const { rows } = await db.query("SELECT * FROM empresa_smtp_config WHERE empresa_id=$1 LIMIT 1", [empresaId]);
  const row = rows[0];
  if (!row) return null;
  const cfg = publicEmailConfig(row);
  if (includeSecret) cfg.smtp_pass = decryptSecret(row.smtp_pass_encrypted || "");
  return cfg;
}

async function saveEmpresaEmailConfig(empresaId, data = {}, userId = null) {
  await ensureEmailTables();
  const current = await db.query("SELECT smtp_pass_encrypted FROM empresa_smtp_config WHERE empresa_id=$1 LIMIT 1", [empresaId]);
  const newPass = String(data.smtp_pass || "").trim();
  const encryptedPass = newPass ? encryptSecret(newPass) : current.rows[0]?.smtp_pass_encrypted || null;
  const port = Number(data.smtp_port || 587);
  const secure = data.smtp_secure !== undefined ? !!data.smtp_secure : String(data.smtp_port) === "465";
  await db.query(`
    INSERT INTO empresa_smtp_config
      (empresa_id,smtp_host,smtp_port,smtp_secure,smtp_user,smtp_pass_encrypted,smtp_from,smtp_from_nombre,reply_to,
       envio_facturas_auto,envio_avisos_carga_auto,asunto_factura,cuerpo_factura,asunto_carga,cuerpo_carga,activo,updated_by,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW())
    ON CONFLICT (empresa_id) DO UPDATE SET
      smtp_host=$2,smtp_port=$3,smtp_secure=$4,smtp_user=$5,smtp_pass_encrypted=$6,smtp_from=$7,smtp_from_nombre=$8,reply_to=$9,
      envio_facturas_auto=$10,envio_avisos_carga_auto=$11,asunto_factura=$12,cuerpo_factura=$13,asunto_carga=$14,cuerpo_carga=$15,
      activo=$16,updated_by=$17,updated_at=NOW()
  `, [
    empresaId,
    String(data.smtp_host || "").trim(),
    Number.isFinite(port) ? port : 587,
    secure,
    String(data.smtp_user || "").trim(),
    encryptedPass,
    String(data.smtp_from || "").trim(),
    String(data.smtp_from_nombre || "").trim(),
    String(data.reply_to || data.smtp_from || "").trim(),
    !!data.envio_facturas_auto,
    !!data.envio_avisos_carga_auto,
    data.asunto_factura || "",
    data.cuerpo_factura || "",
    data.asunto_carga || "",
    data.cuerpo_carga || "",
    data.activo !== false,
    userId,
  ]);
  return getEmpresaEmailConfig(empresaId);
}

async function markEmailConfigTest(empresaId, ok, error = "") {
  await ensureEmailTables();
  await db.query(
    "UPDATE empresa_smtp_config SET last_test_at=NOW(), last_test_ok=$1, last_error=$2 WHERE empresa_id=$3",
    [!!ok, error || null, empresaId]
  );
}

async function resolveTransportConfig(empresaId) {
  const company = empresaId ? await getEmpresaEmailConfig(empresaId, true) : null;
  if (company?.activo && company.smtp_host) {
    const host = String(company.smtp_host || "").trim().toLowerCase();
    const looksPlaceholder = ["smtp.tuproveedor.com", "smtp.example.com", "example.com"].some(token => host.includes(token));
    if (!looksPlaceholder) return { cfg: company, source: "empresa" };
    logger.warn("SMTP de empresa con host de ejemplo - email simulado:", { empresaId, host });
  }
  if (!process.env.SMTP_HOST) return { cfg: null, source: "simulado" };
  const envHost = String(process.env.SMTP_HOST || "").trim().toLowerCase();
  if (["smtp.tuproveedor.com", "smtp.example.com", "example.com"].some(token => envHost.includes(token))) {
    logger.warn("SMTP global con host de ejemplo - email simulado:", { host: envHost });
    return { cfg: null, source: "simulado" };
  }
  return {
    cfg: {
      smtp_host: process.env.SMTP_HOST,
      smtp_port: process.env.SMTP_PORT || "587",
      smtp_secure: process.env.SMTP_PORT === "465",
      smtp_user: process.env.SMTP_USER,
      smtp_pass: process.env.SMTP_PASS,
      smtp_from: process.env.SMTP_FROM,
      smtp_from_nombre: process.env.SMTP_FROM_NAME || "TransGest TMS",
      reply_to: process.env.SMTP_REPLY_TO || process.env.SMTP_FROM,
    },
    source: "global",
  };
}

// ── Plantillas HTML ───────────────────────────────────
const BASE_STYLE = `
  font-family: 'Segoe UI', Arial, sans-serif;
  max-width: 600px; margin: 0 auto;
  background: #f8fafc; padding: 24px;
`;
const HEADER = (titulo) => `
  <div style="background:#1e3a6e;border-radius:10px 10px 0 0;padding:20px 28px;">
    <div style="color:#fff;font-size:20px;font-weight:700;">${titulo}</div>
    <div style="color:#93c5fd;font-size:12px;margin-top:4px;">TransGest TMS</div>
  </div>
`;
const FOOTER = `
  <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
    TransGest TMS · Mensaje automático · No responder a este email
  </div>
`;

function renderDcdEmailBox(data = {}) {
  if (!data?.dcd_url && !data?.dcd_codigo) return "";
  const estado = data.dcd_estado === "listo" ? "Listo" : "Pendiente";
  return `
    <div style="margin-top:18px;background:#f8fafc;border:1px solid #dbeafe;border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#1d4ed8;margin-bottom:8px;">Documento de control digital</div>
      <table style="width:100%;border-collapse:collapse;margin:0 0 10px 0;">
        <tr><td style="padding:4px 0;font-weight:600;width:140px;color:#334155;">Estado</td><td style="padding:4px 0;color:#0f172a;">${estado}</td></tr>
        ${data.dcd_canal ? `<tr><td style="padding:4px 0;font-weight:600;color:#334155;">Canal</td><td style="padding:4px 0;color:#0f172a;">${data.dcd_canal}</td></tr>` : ""}
        ${data.dcd_codigo ? `<tr><td style="padding:4px 0;font-weight:600;color:#334155;">Codigo</td><td style="padding:4px 0;color:#0f172a;font-family:'JetBrains Mono',monospace;">${data.dcd_codigo}</td></tr>` : ""}
      </table>
      ${data.dcd_url ? `<p style="margin:12px 0 10px 0;"><a href="${data.dcd_url}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:700;">Abrir documento digital</a></p>` : ""}
      ${data.dcd_instrucciones ? `<p style="font-size:12px;color:#64748b;margin:0;">${data.dcd_instrucciones}</p>` : ""}
    </div>
  `;
}

function renderMapsEmailBox(data = {}) {
  const links = Array.isArray(data.map_links) ? data.map_links.filter(x => x?.url || x?.direccion) : [];
  if (!links.length) return "";
  return `
    <div style="margin-top:18px;background:#f8fafc;border:1px solid #bfdbfe;border-radius:10px;padding:14px 16px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#1d4ed8;margin-bottom:8px;">Ubicaciones Google Maps</div>
      ${links.map((item) => `
        <div style="border-top:1px solid #e2e8f0;padding:10px 0 8px 0;">
          <div style="font-weight:800;color:#0f172a;">${item.tipo || "Punto"}</div>
          ${item.nombre ? `<div style="font-size:13px;color:#334155;">${item.nombre}</div>` : ""}
          ${item.direccion ? `<div style="font-size:12px;color:#64748b;">${item.direccion}</div>` : ""}
          ${item.url ? `<p style="margin:10px 0 0 0;"><a href="${item.url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:9px 14px;border-radius:8px;font-weight:700;">Abrir ${item.tipo || "punto"} en Google Maps</a></p>` : ""}
          ${item.url ? `<div style="font-size:11px;color:#64748b;word-break:break-all;margin-top:6px;">${item.url}</div>` : ""}
        </div>
      `).join("")}
    </div>
  `;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const PLANTILLAS = {
  pedido_confirmado: (data) => ({
    asunto: `✓ Pedido confirmado ${data.numero} — ${data.ruta}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Pedido Confirmado")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Estimado cliente,</p>
        <p>Su pedido ha sido confirmado con los siguientes datos:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:140px;">Nº Pedido</td><td style="padding:8px 12px;">${data.numero}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Ruta</td><td style="padding:8px 12px;">${data.ruta}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Fecha carga</td><td style="padding:8px 12px;">${data.fecha_carga}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Mercancía</td><td style="padding:8px 12px;">${data.mercancia}</td></tr>
        </table>
        <p>Le mantendremos informado del estado de su envío.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  pedido_entregado: (data) => ({
    asunto: `📦 Entrega completada — ${data.numero}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Entrega Completada")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Su pedido <strong>${data.numero}</strong> ha sido entregado correctamente en <strong>${data.destino}</strong>.</p>
        <p>Fecha de entrega: <strong>${data.fecha_entrega}</strong></p>
        ${data.incidencia ? `<p style="color:#dc2626;">⚠️ Incidencia registrada: ${data.incidencia}</p>` : ""}
        <p>Gracias por confiar en nosotros.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  taller_solicitud: (data) => ({
    asunto: `Solicitud de taller ${data.urgencia === "critica" ? "CRITICA" : data.urgencia || ""} - ${data.vehiculo || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Solicitud de Taller")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${data.destinatario || ""},</p>
        <p>Se ha registrado una solicitud de asistencia desde la app del chofer.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:140px;">Chofer</td><td style="padding:8px 12px;">${data.chofer || "-"}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Vehiculo</td><td style="padding:8px 12px;">${data.vehiculo || "-"}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Motivo</td><td style="padding:8px 12px;">${data.motivo || "-"}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Urgencia</td><td style="padding:8px 12px;font-weight:700;color:${data.urgencia === "critica" ? "#dc2626" : data.urgencia === "urgente" ? "#d97706" : "#2563eb"};">${data.urgencia || "normal"}</td></tr>
          ${data.pedido ? `<tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Pedido</td><td style="padding:8px 12px;">${data.pedido}</td></tr>` : ""}
          ${data.ubicacion ? `<tr><td style="padding:8px 12px;font-weight:600;">Ubicacion</td><td style="padding:8px 12px;">${data.ubicacion}</td></tr>` : ""}
        </table>
        ${data.observaciones ? `<p style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;color:#7c2d12;"><strong>Observaciones:</strong><br>${data.observaciones}</p>` : ""}
        <p style="color:#64748b;font-size:12px;">Revisa la pestana Taller para aceptar, crear OT o marcar como resuelto.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  factura_emitida: (data) => ({
    asunto: `Factura ${data.numero} — ${data.empresa}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Factura Emitida")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Adjuntamos la factura correspondiente a los servicios prestados.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:140px;">Nº Factura</td><td style="padding:8px 12px;">${data.numero}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Importe total</td><td style="padding:8px 12px;font-size:16px;font-weight:700;color:#1e3a6e;">${data.total} €</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Vencimiento</td><td style="padding:8px 12px;">${data.fecha_vencimiento}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Forma de pago</td><td style="padding:8px 12px;">${data.forma_pago}</td></tr>
        </table>
        <p style="color:#64748b;font-size:12px;">IBAN: ${data.iban}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  doc_proximo_vencer: (data) => ({
    asunto: `⚠️ Documento próximo a vencer — ${data.entidad}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("⚠️ Alerta Documental")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p style="color:#dc2626;font-weight:600;">El siguiente documento vence en ${data.dias_restantes} días:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#fef2f2"><td style="padding:8px 12px;font-weight:600;width:140px;">Entidad</td><td style="padding:8px 12px;">${data.entidad}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Documento</td><td style="padding:8px 12px;">${data.tipo}</td></tr>
          <tr style="background:#fef2f2"><td style="padding:8px 12px;font-weight:600;">Vencimiento</td><td style="padding:8px 12px;color:#dc2626;font-weight:700;">${data.fecha_vencimiento}</td></tr>
        </table>
        <p>Por favor, renueve la documentación antes de la fecha indicada.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  cobro_vencido: (data) => ({
    asunto: `🔴 Factura vencida sin cobrar — ${data.numero}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("🔴 Cobro Vencido")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>La siguiente factura ha vencido sin registrar el cobro:</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#fef2f2"><td style="padding:8px 12px;font-weight:600;width:140px;">Factura</td><td style="padding:8px 12px;font-weight:700;">${data.numero}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Cliente</td><td style="padding:8px 12px;">${data.cliente}</td></tr>
          <tr style="background:#fef2f2"><td style="padding:8px 12px;font-weight:600;">Importe</td><td style="padding:8px 12px;color:#dc2626;font-weight:700;">${data.total} €</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Venció el</td><td style="padding:8px 12px;">${data.fecha_vencimiento}</td></tr>
        </table>
        <p>Revisa el estado del cobro en el panel de facturación.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  invitacion_usuario: (data) => ({
    asunto: `Invitación a TransGestAdmin — ${data.empresa || "TransGest"}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Invitación a TransGest")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${data.nombre || ""},</p>
        <p>Se ha creado tu acceso para <strong>${data.empresa || "tu empresa"}</strong>.</p>
        <p>Este enlace caduca en <strong>72 horas</strong>:</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#1e3a6e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Crear contraseña</a>
        </p>
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_confirmar: (data) => ({
    asunto: `Confirmar transporte ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Confirmar transporte")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${data.colaborador || ""},</p>
        <p>${data.empresa || "La empresa"} te ha asignado el pedido <strong>${data.numero || ""}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:150px;">Ruta</td><td style="padding:8px 12px;">${data.ruta || ""}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Fecha carga</td><td style="padding:8px 12px;">${data.fecha_carga || ""}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Precio acordado</td><td style="padding:8px 12px;font-weight:700;">${data.precio || "0,00"} EUR</td></tr>
        </table>
        <p>Confirma el precio acordado e introduce las matriculas del conjunto.</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Confirmar datos</a>
        </p>
        ${renderMapsEmailBox(data)}
        ${renderDcdEmailBox(data)}
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_carga: (data) => ({
    asunto: `Marcar carga realizada ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Marcar carga realizada")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Cuando el camion este cargado, pulsa el enlace para actualizar el pedido <strong>${data.numero || ""}</strong>.</p>
        <p><strong>Ruta:</strong> ${data.ruta || ""}</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Marcar como cargado</a>
        </p>
        ${renderMapsEmailBox(data)}
        ${renderDcdEmailBox(data)}
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_camino: (data) => ({
    asunto: `Confirmar salida a destino ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Marcar en camino")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Cuando el viaje salga hacia destino, pulsa el enlace para actualizar el pedido <strong>${data.numero || ""}</strong>.</p>
        <p><strong>Ruta:</strong> ${data.ruta || ""}</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Marcar como en camino</a>
        </p>
        ${renderMapsEmailBox(data)}
        ${renderDcdEmailBox(data)}
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_descarga: (data) => ({
    asunto: `Confirmar descarga y albaranes ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Confirmar descarga")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Cuando el viaje este descargado, confirma la descarga y sube los albaranes firmados del pedido <strong>${data.numero || ""}</strong>.</p>
        <p><strong>Ruta:</strong> ${data.ruta || ""}</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Confirmar descarga</a>
        </p>
        ${renderMapsEmailBox(data)}
        ${renderDcdEmailBox(data)}
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_albaran_recordatorio: (data) => ({
    asunto: `Pendiente albaranes ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Albaranes pendientes")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${htmlEscape(data.colaborador || "")},</p>
        <p>Seguimos pendientes de recibir los albaranes/POD/CMR firmados del pedido <strong>${htmlEscape(data.numero || "")}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:150px;">Ruta</td><td style="padding:8px 12px;">${htmlEscape(data.ruta || "-")}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Descarga</td><td style="padding:8px 12px;">${htmlEscape(data.fecha_descarga || "-")}</td></tr>
        </table>
        <p>Sube los documentos firmados desde este enlace. Hasta recibirlos, el viaje quedara bloqueado para facturacion/liquidacion.</p>
        <p style="margin:20px 0;">
          <a href="${htmlEscape(data.url || "")}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Subir albaranes</a>
        </p>
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${htmlEscape(data.url || "")}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  colaborador_liquidacion: (data) => ({
    asunto: `Liquidacion disponible - ${data.empresa || "TransGest"}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Liquidacion disponible")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${data.colaborador || ""},</p>
        <p>${data.empresa || "La empresa"} ha preparado tu liquidacion de viajes, facturas y pagos registrados.</p>
        <p>El enlace caduca el <strong>${data.caducidad || "plazo indicado"}</strong>.</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Abrir liquidacion</a>
        </p>
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  ruta_recomendada: (data) => ({
    asunto: `Ruta recomendada ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Ruta recomendada")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Se ha preparado la ruta recomendada para el pedido <strong>${data.numero || ""}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:150px;">Criterio</td><td style="padding:8px 12px;">${data.preferencia || "Camion"}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Kilometros</td><td style="padding:8px 12px;">${data.km || "Pendiente"}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Tiempo estimado</td><td style="padding:8px 12px;">${data.tiempo || "Pendiente"}</td></tr>
        </table>
        <p>Abre el enlace para revisar la ruta y marcarla como aceptada.</p>
        <p style="margin:20px 0;">
          <a href="${data.url}" style="display:inline-block;background:#0f766e;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Abrir ruta</a>
        </p>
        <p style="font-size:12px;color:#64748b;word-break:break-all;">${data.url}</p>
        <p style="font-size:12px;color:#64748b;">Revisar restricciones de camion, galibo, MMA, ADR si aplica y accesos al muelle antes de salir.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  retorno_carrier_solicitud: (data) => ({
    asunto: data.asunto || `Solicitud disponibilidad retorno ${data.numero || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Solicitud de Retorno")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Hola ${htmlEscape(data.carrier || "")},</p>
        <p>Se solicita revisar disponibilidad para una posible carga de retorno.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:150px;">Pedido</td><td style="padding:8px 12px;">${htmlEscape(data.numero || "-")}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Ruta</td><td style="padding:8px 12px;">${htmlEscape(data.ruta || "-")}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Fecha carga</td><td style="padding:8px 12px;">${htmlEscape(data.fecha_carga || "-")}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Precio colaborador</td><td style="padding:8px 12px;font-weight:700;">${htmlEscape(data.precio || "pendiente de acordar")}</td></tr>
        </table>
        <div style="background:#f8fafc;border:1px solid #dbeafe;border-radius:10px;padding:14px 16px;color:#0f172a;line-height:1.5;">
          ${htmlEscape(data.cuerpo || "").replace(/\n/g, "<br>")}
        </div>
        <p style="color:#64748b;font-size:12px;margin-top:16px;">Esta solicitud queda registrada en TransGest para trazabilidad de trafico y subcontratacion.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),

  pedido_aviso_cliente: (data) => ({
    asunto: `Aviso operativo ${data.numero || ""} - ${data.ruta || ""}`,
    html: `<div style="${BASE_STYLE}">
      ${HEADER("Aviso operativo")}
      <div style="background:#fff;border-radius:0 0 10px 10px;padding:24px 28px;border:1px solid #e2e8f0;border-top:none;">
        <p>Estimado cliente,</p>
        <p>Le informamos sobre el estado del transporte <strong>${htmlEscape(data.numero || "")}</strong>.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0;">
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;width:150px;">Ruta</td><td style="padding:8px 12px;">${htmlEscape(data.ruta || "-")}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Carga</td><td style="padding:8px 12px;">${htmlEscape(data.fecha_carga || "-")}</td></tr>
          <tr style="background:#f1f5f9"><td style="padding:8px 12px;font-weight:600;">Descarga</td><td style="padding:8px 12px;">${htmlEscape(data.fecha_descarga || "-")}</td></tr>
          <tr><td style="padding:8px 12px;font-weight:600;">Estado</td><td style="padding:8px 12px;">${htmlEscape(data.estado || "-")}</td></tr>
        </table>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:12px;color:#7c2d12;margin:14px 0;">
          <strong>${htmlEscape(data.motivo || "Seguimiento operativo")}</strong><br>
          ${htmlEscape(data.mensaje || "Nuestro equipo de trafico esta revisando el transporte y le mantendra informado.")}
        </div>
        ${data.portal_url ? `<p style="margin:20px 0;"><a href="${htmlEscape(data.portal_url)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;">Abrir portal cliente</a></p>` : ""}
        <p style="color:#64748b;font-size:12px;">Este aviso queda registrado en TransGest para seguimiento de trafico y administracion.</p>
      </div>
      ${FOOTER}
    </div>`,
  }),
};

// ── Función principal de envío ────────────────────────
async function enviarEmail({ trigger, destinatario, plantilla, datos, empresa_id, attachments = [], meta = {} }) {
  const { cfg, source } = await resolveTransportConfig(empresa_id);
  const adjuntosCount = Array.isArray(attachments) ? attachments.length : 0;
  if (!cfg?.smtp_host) {
    logger.warn("SMTP no configurado - email simulado:", { trigger, destinatario });
    await ensureEmailTables();
    await db.query(
      `INSERT INTO email_log (empresa_id, trigger, destinatario, asunto, estado, provider, adjuntos_count, meta)
       VALUES ($1,$2,$3,$4,'simulado',$5,$6,$7::jsonb)`,
      [empresa_id || null, trigger || plantilla, destinatario, plantilla || "", "simulado", adjuntosCount, JSON.stringify(meta || {})]
    ).catch(() => {});
    return { simulado: true };
  }
  if (false && !process.env.SMTP_HOST) {
    logger.warn("SMTP no configurado — email simulado:", { trigger, destinatario });
    return { simulado: true };
  }

  const tmpl = PLANTILLAS[plantilla]?.(datos);
  if (!tmpl) throw new Error(`Plantilla '${plantilla}' no encontrada`);

  try {
    const fromAddress = cfg.smtp_from || cfg.smtp_user;
    const fromName = cfg.smtp_from_nombre || datos?.empresa || "TransGest TMS";
    const info = await getTransporter(cfg).sendMail({
      from:    fromName ? `"${fromName}" <${fromAddress}>` : fromAddress,
      replyTo: cfg.reply_to || fromAddress,
      to:      destinatario,
      subject: tmpl.asunto,
      html:    tmpl.html,
      attachments: Array.isArray(attachments) ? attachments : [],
    });

    // Log en BD
    await ensureEmailTables();
    await db.query(
      `INSERT INTO email_log (empresa_id, trigger, destinatario, asunto, estado, provider, adjuntos_count, message_id, meta)
       VALUES ($1,$2,$3,$4,'enviado',$5,$6,$7,$8::jsonb)`,
      [empresa_id || null, trigger || plantilla, destinatario, tmpl.asunto, source, adjuntosCount, info.messageId || null, JSON.stringify(meta || {})]
    );

    logger.info(`Email enviado: ${tmpl.asunto} → ${destinatario}`);
    return { messageId: info.messageId };

  } catch (err) {
    logger.error(`Error enviando email a ${destinatario}:`, err.message);

    await ensureEmailTables();
    await db.query(
      `INSERT INTO email_log (empresa_id, trigger, destinatario, asunto, estado, error, provider, adjuntos_count, meta)
       VALUES ($1,$2,$3,$4,'error',$5,$6,$7,$8::jsonb)`,
      [empresa_id || null, trigger || plantilla, destinatario, tmpl?.asunto || "", err.message, source, adjuntosCount, JSON.stringify(meta || {})]
    ).catch(() => {});

    throw err;
  }
}

module.exports = {
  enviarEmail,
  PLANTILLAS,
  ensureEmailTables,
  getEmpresaEmailConfig,
  saveEmpresaEmailConfig,
  markEmailConfigTest,
};

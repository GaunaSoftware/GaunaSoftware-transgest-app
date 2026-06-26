const crypto = require("crypto");
const db = require("./db");
const logger = require("./logger");
const { encryptSecret, decryptSecret, maskSecret } = require("./apiKeys");

const DEFAULT_TEMPLATES = {
  pedido_cliente: "pedido_confirmacion_cliente",
  orden_colaborador: "orden_carga_colaborador",
  docs_pendientes: "documentacion_pendiente",
  entrega_recordatorio: "recordatorio_entrega_albaran",
};

function hashValue(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

async function ensureWhatsappTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresa_whatsapp_config (
      empresa_id UUID PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
      phone_number_id VARCHAR(80),
      waba_id VARCHAR(80),
      access_token_encrypted TEXT,
      access_token_mask VARCHAR(80),
      app_secret_encrypted TEXT,
      app_secret_mask VARCHAR(80),
      verify_token_hash VARCHAR(100),
      verify_token_mask VARCHAR(80),
      templates JSONB NOT NULL DEFAULT '{}'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT true,
      simular_sin_credenciales BOOLEAN NOT NULL DEFAULT true,
      last_test_at TIMESTAMPTZ,
      last_test_ok BOOLEAN,
      last_error TEXT,
      updated_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL,
      pedido_id UUID,
      destinatario_tipo VARCHAR(40),
      destinatario TEXT,
      template_name VARCHAR(120),
      mensaje TEXT,
      estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
      provider VARCHAR(40) NOT NULL DEFAULT 'meta_cloud',
      message_id TEXT,
      error TEXT,
      meta JSONB NOT NULL DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_whatsapp_log_empresa_fecha ON whatsapp_log(empresa_id, sent_at DESC)").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_whatsapp_log_pedido_fecha ON whatsapp_log(pedido_id, sent_at DESC)").catch(() => {});
}

function publicWhatsappConfig(row = {}) {
  const templates = row.templates && typeof row.templates === "object" && !Array.isArray(row.templates)
    ? row.templates
    : {};
  return {
    phone_number_id: row.phone_number_id || "",
    waba_id: row.waba_id || "",
    access_token: "",
    access_token_masked: row.access_token_mask || "",
    app_secret: "",
    app_secret_masked: row.app_secret_mask || "",
    verify_token: "",
    verify_token_masked: row.verify_token_mask || "",
    templates: { ...DEFAULT_TEMPLATES, ...templates },
    activo: row.activo !== false,
    simular_sin_credenciales: row.simular_sin_credenciales !== false,
    last_test_at: row.last_test_at || null,
    last_test_ok: row.last_test_ok,
    last_error: row.last_error || "",
    updated_at: row.updated_at || null,
  };
}

async function getEmpresaWhatsappConfig(empresaId, includeSecret = false) {
  await ensureWhatsappTables();
  if (!empresaId) return null;
  const { rows } = await db.query("SELECT * FROM empresa_whatsapp_config WHERE empresa_id=$1 LIMIT 1", [empresaId]);
  const row = rows[0];
  if (!row) return null;
  const cfg = publicWhatsappConfig(row);
  if (includeSecret) {
    cfg.access_token = decryptSecret(row.access_token_encrypted || "");
    cfg.app_secret = decryptSecret(row.app_secret_encrypted || "");
  }
  return cfg;
}

async function saveEmpresaWhatsappConfig(empresaId, data = {}, userId = null) {
  await ensureWhatsappTables();
  const current = await db.query(
    "SELECT access_token_encrypted, access_token_mask, app_secret_encrypted, app_secret_mask, verify_token_hash, verify_token_mask FROM empresa_whatsapp_config WHERE empresa_id=$1 LIMIT 1",
    [empresaId]
  );
  const currentRow = current.rows[0] || {};
  const accessToken = String(data.access_token || "").trim();
  const appSecret = String(data.app_secret || "").trim();
  const verifyToken = String(data.verify_token || "").trim();
  const clearSecrets = data.clear_secrets === true;
  const templates = data.templates && typeof data.templates === "object" && !Array.isArray(data.templates)
    ? { ...DEFAULT_TEMPLATES, ...data.templates }
    : DEFAULT_TEMPLATES;
  await db.query(`
    INSERT INTO empresa_whatsapp_config
      (empresa_id,phone_number_id,waba_id,access_token_encrypted,access_token_mask,app_secret_encrypted,app_secret_mask,
       verify_token_hash,verify_token_mask,templates,activo,simular_sin_credenciales,updated_by,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    ON CONFLICT (empresa_id) DO UPDATE SET
      phone_number_id=$2,
      waba_id=$3,
      access_token_encrypted=$4,
      access_token_mask=$5,
      app_secret_encrypted=$6,
      app_secret_mask=$7,
      verify_token_hash=$8,
      verify_token_mask=$9,
      templates=$10,
      activo=$11,
      simular_sin_credenciales=$12,
      updated_by=$13,
      updated_at=NOW()
  `, [
    empresaId,
    String(data.phone_number_id || "").trim(),
    String(data.waba_id || "").trim(),
    clearSecrets ? null : (accessToken ? encryptSecret(accessToken) : currentRow.access_token_encrypted || null),
    clearSecrets ? null : (accessToken ? maskSecret(accessToken) : currentRow.access_token_mask || null),
    clearSecrets ? null : (appSecret ? encryptSecret(appSecret) : currentRow.app_secret_encrypted || null),
    clearSecrets ? null : (appSecret ? maskSecret(appSecret) : currentRow.app_secret_mask || null),
    clearSecrets ? null : (verifyToken ? hashValue(verifyToken) : currentRow.verify_token_hash || null),
    clearSecrets ? null : (verifyToken ? maskSecret(verifyToken) : currentRow.verify_token_mask || null),
    JSON.stringify(templates),
    data.activo !== false,
    data.simular_sin_credenciales !== false,
    userId,
  ]);
  return getEmpresaWhatsappConfig(empresaId);
}

function normalizePhone(value, defaultCountryCode = "34") {
  let clean = String(value || "").replace(/[^0-9+]/g, "");
  if (clean.startsWith("+")) clean = clean.slice(1);
  if (clean.startsWith("00")) clean = clean.slice(2);
  if (/^[6789]\d{8}$/.test(clean) && defaultCountryCode) clean = `${defaultCountryCode}${clean}`;
  return clean;
}

function formatDateEs(value) {
  if (!value) return "pendiente";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value).slice(0, 10);
  return parsed.toLocaleDateString("es-ES");
}

function buildPedidoWhatsappText(pedido = {}, target = "cliente") {
  const ruta = `${pedido.origen || "-"} -> ${pedido.destino || "-"}`;
  if (target === "colaborador") {
    return [
      `Orden de carga ${pedido.numero || ""}`,
      `Ruta: ${ruta}`,
      `Carga: ${formatDateEs(pedido.fecha_carga)} ${pedido.hora_carga || ""}`.trim(),
      `Descarga: ${formatDateEs(pedido.fecha_descarga || pedido.fecha_entrega)} ${pedido.hora_descarga || ""}`.trim(),
      pedido.mercancia ? `Mercancia: ${pedido.mercancia}` : "",
      pedido.matricula_colaborador || pedido.vehiculo_matricula ? `Tractora: ${pedido.matricula_colaborador || pedido.vehiculo_matricula}` : "",
    ].filter(Boolean).join("\n");
  }
  return [
    `Le confirmamos el pedido ${pedido.numero || ""}.`,
    `Ruta: ${ruta}`,
    `Carga: ${formatDateEs(pedido.fecha_carga)} ${pedido.hora_carga || ""}`.trim(),
    `Descarga: ${formatDateEs(pedido.fecha_descarga || pedido.fecha_entrega)} ${pedido.hora_descarga || ""}`.trim(),
    "Atentamente, TransGest TMS",
  ].filter(Boolean).join("\n");
}

async function loadPedidoWhatsappContext(pedidoId, empresaId) {
  const { rows } = await db.query(`
    SELECT p.*,
           c.nombre AS cliente_nombre, c.telefono AS cliente_telefono, c.contacto AS cliente_contacto,
           co.nombre AS colaborador_nombre, co.telefono AS colaborador_telefono, co.contacto_nombre AS colaborador_contacto,
           v.matricula AS vehiculo_matricula
      FROM pedidos p
      JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
      LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
      LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
     WHERE p.id=$1 AND p.empresa_id=$2
     LIMIT 1
  `, [pedidoId, empresaId]);
  return rows[0] || null;
}

function buildPedidoWhatsappPreflight(pedido = {}, cfg = {}, target = "cliente", overridePhone = "") {
  const rawPhone = overridePhone || (target === "colaborador" ? pedido.colaborador_telefono : pedido.cliente_telefono);
  const phone = normalizePhone(rawPhone);
  const bloqueantes = [];
  const avisos = [];
  if (!phone) bloqueantes.push(target === "colaborador" ? "El colaborador no tiene telefono valido." : "El cliente no tiene telefono valido.");
  if (!cfg?.activo) bloqueantes.push("La integracion de WhatsApp esta desactivada para esta empresa.");
  const hasCredentials = !!(cfg?.phone_number_id && cfg?.access_token);
  if (!hasCredentials) avisos.push("WhatsApp Cloud API no tiene credenciales completas; se registrara como envio simulado.");
  if (!cfg?.waba_id) avisos.push("Falta WABA ID; no bloquea simulacion, pero sera necesario para gobierno de plantillas/webhook.");
  return {
    ok: bloqueantes.length === 0,
    bloqueantes,
    avisos,
    destinatario: phone,
    destinatario_tipo: target,
    has_credentials: hasCredentials,
    modo: hasCredentials ? "meta_cloud" : "simulado",
  };
}

async function logWhatsappEvent({ empresaId, pedidoId = null, target = "", phone = "", templateName = "", message = "", estado = "pendiente", messageId = "", error = "", meta = {} }) {
  await ensureWhatsappTables();
  const { rows } = await db.query(`
    INSERT INTO whatsapp_log
      (empresa_id,pedido_id,destinatario_tipo,destinatario,template_name,mensaje,estado,message_id,error,meta)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [
    empresaId,
    pedidoId || null,
    target || null,
    phone || null,
    templateName || null,
    message || null,
    estado,
    messageId || null,
    error || null,
    JSON.stringify(meta || {}),
  ]);
  return rows[0];
}

async function logPedidoEvento(pedidoId, empresaId, tipo, detalle = {}, actorId = null) {
  if (!pedidoId || !empresaId) return;
  await db.query(
    `INSERT INTO pedido_eventos (pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
     VALUES ($1,$2,$3,'usuario',$4,$5)`,
    [pedidoId, empresaId, tipo, actorId || null, JSON.stringify(detalle || {})]
  ).catch(e => logger.warn("No se pudo registrar evento WhatsApp en pedido:", e.message));
}

function templateParamsFromPedido(pedido = {}) {
  return [
    pedido.numero || "",
    pedido.origen || "",
    pedido.destino || "",
    formatDateEs(pedido.fecha_carga),
    pedido.hora_carga || "",
  ].filter(value => String(value || "").trim()).map(text => ({
    type: "text",
    text: String(text).slice(0, 900),
  }));
}

async function sendMetaCloudMessage({ cfg, phone, templateName, message, pedido }) {
  const graphVersion = process.env.WHATSAPP_GRAPH_VERSION || "v20.0";
  const url = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(cfg.phone_number_id)}/messages`;
  const payload = templateName
    ? {
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: templateName,
          language: { code: "es" },
          components: [{ type: "body", parameters: templateParamsFromPedido(pedido) }],
        },
      }
    : {
        messaging_product: "whatsapp",
        to: phone,
        type: "text",
        text: { preview_url: false, body: message },
      };
  const controller = new AbortController();
  const timeoutMs = Number(process.env.WHATSAPP_TIMEOUT_MS || 10000);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${cfg.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    const err = new Error(e.name === "AbortError" ? "Meta WhatsApp no respondio a tiempo" : e.message);
    err.code = e.name === "AbortError" ? "whatsapp_timeout" : "whatsapp_request_error";
    throw err;
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error?.message || `Meta WhatsApp respondio HTTP ${res.status}`);
    err.payload = data;
    err.http_status = res.status;
    throw err;
  }
  return {
    message_id: data?.messages?.[0]?.id || "",
    payload,
    response: data,
  };
}

async function sendPedidoWhatsapp({ empresaId, pedidoId, target = "cliente", phoneOverride = "", templateName = "", message = "", force = false, actorId = null }) {
  await ensureWhatsappTables();
  const pedido = await loadPedidoWhatsappContext(pedidoId, empresaId);
  if (!pedido) {
    const err = new Error("Pedido no encontrado.");
    err.status = 404;
    throw err;
  }
  const cfg = await getEmpresaWhatsappConfig(empresaId, true) || publicWhatsappConfig({});
  const selectedTemplate = templateName || (target === "colaborador" ? cfg.templates?.orden_colaborador : cfg.templates?.pedido_cliente) || "";
  const finalMessage = message || buildPedidoWhatsappText(pedido, target);
  const preflight = buildPedidoWhatsappPreflight(pedido, cfg, target, phoneOverride);
  if (!preflight.ok) {
    const err = new Error(preflight.bloqueantes.join(" "));
    err.status = 409;
    err.preflight = preflight;
    throw err;
  }
  if (preflight.avisos.length && !force && preflight.has_credentials) {
    const err = new Error("El envio necesita revision antes de enviarse.");
    err.status = 409;
    err.preflight = preflight;
    throw err;
  }
  let estado = "simulado";
  let messageId = "";
  let providerResponse = null;
  let error = "";
  if (preflight.has_credentials) {
    try {
      const sent = await sendMetaCloudMessage({
        cfg,
        phone: preflight.destinatario,
        templateName: selectedTemplate,
        message: finalMessage,
        pedido,
      });
      estado = "enviado";
      messageId = sent.message_id || "";
      providerResponse = sent.response || null;
    } catch (e) {
      estado = "error";
      error = e.message || "Error enviando WhatsApp.";
      providerResponse = e.payload || null;
    }
  }
  const log = await logWhatsappEvent({
    empresaId,
    pedidoId,
    target,
    phone: preflight.destinatario,
    templateName: selectedTemplate,
    message: finalMessage,
    estado,
    messageId,
    error,
    meta: {
      pedido_numero: pedido.numero || "",
      provider_response: providerResponse,
      mode: preflight.modo,
      simulated: estado === "simulado",
    },
  });
  await logPedidoEvento(pedidoId, empresaId, "whatsapp.envio", {
    estado,
    destinatario_tipo: target,
    destinatario: preflight.destinatario,
    template_name: selectedTemplate,
    whatsapp_log_id: log.id,
    message_id: messageId || null,
    simulado: estado === "simulado",
    error: error || null,
  }, actorId);
  if (estado === "error") {
    const err = new Error(error);
    err.status = 502;
    err.log = log;
    throw err;
  }
  return { ok: true, estado, simulado: estado === "simulado", message_id: messageId, log, preflight };
}

async function getWhatsappStatus(empresaId) {
  const cfg = await getEmpresaWhatsappConfig(empresaId) || publicWhatsappConfig({});
  const configured = !!(cfg.phone_number_id && cfg.access_token_masked);
  return {
    provider: "meta_cloud",
    configured,
    ready: configured && cfg.activo,
    activo: cfg.activo,
    phone_number_id_configured: !!cfg.phone_number_id,
    waba_id_configured: !!cfg.waba_id,
    access_token_masked: cfg.access_token_masked,
    app_secret_masked: cfg.app_secret_masked,
    verify_token_masked: cfg.verify_token_masked,
    simular_sin_credenciales: cfg.simular_sin_credenciales,
    templates: cfg.templates,
    mode: configured ? "meta_cloud" : "simulado",
    next_action: configured
      ? "Probar envio con una plantilla aprobada y validar webhooks de estado."
      : "Configurar WABA ID, Phone Number ID, token permanente y plantillas aprobadas.",
  };
}

module.exports = {
  DEFAULT_TEMPLATES,
  ensureWhatsappTables,
  getEmpresaWhatsappConfig,
  saveEmpresaWhatsappConfig,
  getWhatsappStatus,
  loadPedidoWhatsappContext,
  buildPedidoWhatsappPreflight,
  buildPedidoWhatsappText,
  sendPedidoWhatsapp,
  normalizePhone,
  hashValue,
};

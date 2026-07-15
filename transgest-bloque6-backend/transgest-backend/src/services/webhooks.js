// Webhooks salientes: TransGest notifica a sistemas externos cuando ocurren
// eventos (pedido creado, factura emitida, etc.). Cada suscripcion lleva un
// secreto para firmar el cuerpo con HMAC-SHA256 (cabecera X-TransGest-Signature),
// de modo que el receptor pueda verificar la autenticidad. Entrega best-effort.
const crypto = require("crypto");
const db = require("./db");
const logger = require("./logger");
const { encryptSecret, decryptSecret } = require("./apiKeys");

const WEBHOOK_EVENTS = [
  "pedido.creado",
  "pedido.estado_cambiado",
  "factura.emitida",
  "cliente.creado",
];

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresa_webhooks (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      secret_encrypted TEXT NOT NULL,
      secret_mask VARCHAR(40),
      events JSONB NOT NULL DEFAULT '[]'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT true,
      created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_delivery_at TIMESTAMPTZ,
      last_status INTEGER,
      failure_count INTEGER NOT NULL DEFAULT 0
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_empresa_webhooks_empresa ON empresa_webhooks(empresa_id, activo)").catch(() => {});
  schemaReady = true;
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!/^https:\/\/[^\s]+$/i.test(url)) {
    const err = new Error("La URL del webhook debe ser https://");
    err.status = 400;
    throw err;
  }
  return url.slice(0, 500);
}

function normalizeEvents(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const out = [...new Set(list.map(e => String(e || "").trim()).filter(e => WEBHOOK_EVENTS.includes(e)))];
  if (!out.length) {
    const err = new Error("Indica al menos un evento valido.");
    err.status = 400;
    throw err;
  }
  return out;
}

async function createWebhook(empresaId, { url, events } = {}, actorId = null) {
  await ensureSchema();
  const cleanUrl = normalizeUrl(url);
  const eventList = normalizeEvents(events);
  const secret = `whsec_${crypto.randomBytes(24).toString("base64url")}`;
  const mask = `${secret.slice(0, 12)}...`;
  const { rows } = await db.query(
    `INSERT INTO empresa_webhooks (empresa_id, url, secret_encrypted, secret_mask, events, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     RETURNING id, url, secret_mask, events, activo, created_at, last_delivery_at, last_status, failure_count`,
    [empresaId, cleanUrl, encryptSecret(secret), mask, JSON.stringify(eventList), actorId]
  );
  return { secret, webhook: rows[0] };
}

async function listWebhooks(empresaId) {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT id, url, secret_mask, events, activo, created_at, last_delivery_at, last_status, failure_count
       FROM empresa_webhooks WHERE empresa_id=$1 ORDER BY activo DESC, created_at DESC LIMIT 100`,
    [empresaId]
  );
  return rows;
}

async function revokeWebhook(empresaId, id) {
  await ensureSchema();
  const { rows } = await db.query(
    `UPDATE empresa_webhooks SET activo=false, updated_at=NOW() WHERE id=$1 AND empresa_id=$2 RETURNING id`,
    [id, empresaId]
  );
  return rows[0] || null;
}

async function deliverOne(sub, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.WEBHOOK_TIMEOUT_MS || 8000));
  let status = 0;
  try {
    const secret = decryptSecret(sub.secret_encrypted);
    const signature = crypto.createHmac("sha256", secret).update(body).digest("hex");
    const res = await fetch(sub.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-TransGest-Signature": `sha256=${signature}`,
        "X-TransGest-Event": sub._event || "",
      },
      body,
      signal: controller.signal,
    });
    status = res.status;
  } catch (e) {
    logger.debug(`webhook ${sub.id} fallo: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }
  const ok = status >= 200 && status < 300;
  await db.query(
    `UPDATE empresa_webhooks
        SET last_delivery_at=NOW(), last_status=$2,
            failure_count=CASE WHEN $3 THEN 0 ELSE failure_count + 1 END,
            updated_at=NOW()
      WHERE id=$1`,
    [sub.id, status || null, ok]
  ).catch(() => {});
}

// Notifica un evento a todas las suscripciones activas de la empresa. No bloquea
// ni lanza: si falla, se registra y se cuenta el fallo en la suscripcion.
async function dispatch(empresaId, event, data) {
  try {
    if (!empresaId || !WEBHOOK_EVENTS.includes(event)) return;
    await ensureSchema();
    const { rows } = await db.query(
      `SELECT id, url, secret_encrypted FROM empresa_webhooks
        WHERE empresa_id=$1 AND activo=true AND events ? $2`,
      [empresaId, event]
    );
    if (!rows.length) return;
    const body = JSON.stringify({ event, empresa_id: empresaId, sent_at: new Date().toISOString(), data });
    for (const sub of rows) {
      deliverOne({ ...sub, _event: event }, body).catch(() => {});
    }
  } catch (e) {
    logger.debug("webhook dispatch: " + e.message);
  }
}

module.exports = {
  WEBHOOK_EVENTS,
  ensureSchema,
  createWebhook,
  listWebhooks,
  revokeWebhook,
  dispatch,
};

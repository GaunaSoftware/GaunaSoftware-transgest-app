// API keys a nivel de empresa (prefijo tgk_) para integrar programas externos
// con la API de TransGest. Cada clave lleva scopes por modulo (read/write),
// caducidad y limite de peticiones por hora. El token en claro solo se muestra
// al crearlo; en BD se guarda su hash SHA-256.
const crypto = require("crypto");
const db = require("./db");

// Modulos que una integracion externa puede consumir por API key.
const API_SCOPE_MODULES = [
  "pedidos", "clientes", "vehiculos", "choferes", "colaboradores",
  "facturacion", "rutas", "palets", "agenda", "documentos", "informes",
  "control_horario", "plan_diario",
];

const TOKEN_PREFIX = "tgk_";

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresa_api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      nombre VARCHAR(120) NOT NULL DEFAULT 'Integracion API',
      token_hash VARCHAR(80) NOT NULL UNIQUE,
      token_mask VARCHAR(80) NOT NULL,
      scopes JSONB NOT NULL DEFAULT '[]'::jsonb,
      activo BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ,
      rate_limit_per_hour INTEGER NOT NULL DEFAULT 1000,
      usage_count INTEGER NOT NULL DEFAULT 0,
      window_started_at TIMESTAMPTZ,
      window_count INTEGER NOT NULL DEFAULT 0,
      last_rate_limit_at TIMESTAMPTZ,
      created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      last_used_ip VARCHAR(80)
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_empresa_api_keys_empresa ON empresa_api_keys(empresa_id, activo)").catch(() => {});
  await db.query("CREATE INDEX IF NOT EXISTS idx_empresa_api_keys_hash ON empresa_api_keys(token_hash)").catch(() => {});
  schemaReady = true;
}

function hashKey(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}
function maskKey(token) {
  const t = String(token || "");
  return t.length > 16 ? `${t.slice(0, 12)}...${t.slice(-4)}` : t;
}

function normalizeScopes(input) {
  const list = Array.isArray(input) ? input : String(input || "").split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const s = String(raw || "").trim().toLowerCase();
    if (!s) continue;
    const [mod, action = ""] = s.split(":");
    if (!API_SCOPE_MODULES.includes(mod)) continue;
    if (action && !["read", "write"].includes(action)) continue;
    const canonical = action ? `${mod}:${action}` : mod;
    if (!seen.has(canonical)) { seen.add(canonical); out.push(canonical); }
  }
  return out;
}

// Convierte los scopes en la estructura de permisos por modulo que entiende el
// middleware RBAC (requireModulePermission).
function permisosFromScopes(scopes = []) {
  const modulos = {};
  for (const s of scopes) {
    const [mod, action] = String(s).split(":");
    if (!API_SCOPE_MODULES.includes(mod)) continue;
    const cur = modulos[mod] || { ver: false, editar: false };
    if (action === "read") cur.ver = true;
    else if (action === "write") { cur.ver = true; cur.editar = true; }
    else { cur.ver = true; cur.editar = true; }
    modulos[mod] = cur;
  }
  return { modulos };
}

function normalizeRateLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1000;
  return Math.min(Math.max(Math.round(n), 10), 100000);
}

async function createKey(empresaId, { nombre, scopes, dias, rate_limit_per_hour } = {}, actorId = null, ip = null) {
  await ensureSchema();
  const name = String(nombre || "Integracion API").trim().slice(0, 120) || "Integracion API";
  const scopeList = normalizeScopes(scopes);
  if (!scopeList.length) {
    const err = new Error("Indica al menos un scope valido (p.ej. pedidos, clientes:read).");
    err.status = 400;
    throw err;
  }
  const days = Math.min(Math.max(Number(dias || 365) || 365, 1), 1095);
  const rate = normalizeRateLimit(rate_limit_per_hour);
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
  const { rows } = await db.query(
    `INSERT INTO empresa_api_keys
       (empresa_id, nombre, token_hash, token_mask, scopes, expires_at, rate_limit_per_hour, created_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)
     RETURNING id, nombre, token_mask, scopes, activo, expires_at, rate_limit_per_hour, created_at, last_used_at`,
    [empresaId, name, hashKey(token), maskKey(token), JSON.stringify(scopeList), expiresAt, rate, actorId]
  );
  await db.query(
    `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
     VALUES ('usuario', $1, NULL, $2, 'empresa.api_key.creada', $3::jsonb, $4)`,
    [actorId, empresaId, JSON.stringify({ key_id: rows[0].id, token_mask: rows[0].token_mask, scopes: scopeList }), ip]
  ).catch(() => {});
  return { token, credencial: rows[0] };
}

async function listKeys(empresaId) {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT id, nombre, token_mask, scopes, activo, expires_at, rate_limit_per_hour,
            usage_count, last_used_at, last_used_ip, created_at
       FROM empresa_api_keys
      WHERE empresa_id=$1
      ORDER BY activo DESC, created_at DESC
      LIMIT 100`,
    [empresaId]
  );
  return rows;
}

// Listado global (todas las empresas) para el panel de superadmin.
async function listAllKeys() {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT k.id, k.empresa_id, e.nombre AS empresa_nombre, k.nombre, k.token_mask, k.scopes,
            k.activo, k.expires_at, k.rate_limit_per_hour, k.usage_count, k.last_used_at, k.created_at
       FROM empresa_api_keys k
       LEFT JOIN empresas e ON e.id=k.empresa_id
      ORDER BY k.activo DESC, k.created_at DESC
      LIMIT 500`
  );
  return rows;
}

// Revocacion por id sin exigir empresa (uso de superadmin/soporte).
async function revokeById(keyId) {
  await ensureSchema();
  const { rows } = await db.query(
    `UPDATE empresa_api_keys SET activo=false, updated_at=NOW() WHERE id=$1
     RETURNING id, empresa_id, token_mask`,
    [keyId]
  );
  return rows[0] || null;
}

async function revokeKey(empresaId, keyId, actorId = null, ip = null) {
  await ensureSchema();
  const { rows } = await db.query(
    `UPDATE empresa_api_keys SET activo=false, updated_at=NOW()
      WHERE id=$1 AND empresa_id=$2 RETURNING id, token_mask`,
    [keyId, empresaId]
  );
  if (!rows[0]) return null;
  await db.query(
    `INSERT INTO audit_log_saas (actor_tipo, actor_id, actor_email, empresa_id, accion, detalle, ip)
     VALUES ('usuario', $1, NULL, $2, 'empresa.api_key.revocada', $3::jsonb, $4)`,
    [actorId, empresaId, JSON.stringify({ key_id: rows[0].id, token_mask: rows[0].token_mask }), ip]
  ).catch(() => {});
  return rows[0];
}

// Resuelve una API key entrante: valida, aplica limite por hora y devuelve el
// contexto para el middleware de autenticacion. Lanza error con .status.
async function resolveKey(token, ip = null) {
  await ensureSchema();
  const { rows } = await db.query(
    `SELECT k.id, k.empresa_id, k.nombre, k.scopes, k.rate_limit_per_hour,
            k.window_started_at, k.window_count,
            e.plan, e.estado AS empresa_estado
       FROM empresa_api_keys k
       JOIN empresas e ON e.id=k.empresa_id
      WHERE k.token_hash=$1 AND k.activo=true
        AND (k.expires_at IS NULL OR k.expires_at > NOW())
      LIMIT 1`,
    [hashKey(token)]
  );
  const row = rows[0];
  if (!row) {
    const err = new Error("API key invalida, revocada o caducada");
    err.status = 401;
    throw err;
  }
  if (["cancelado", "suspendido"].includes(String(row.empresa_estado || ""))) {
    const err = new Error("La cuenta de la empresa no esta activa");
    err.status = 402;
    throw err;
  }

  const limit = normalizeRateLimit(row.rate_limit_per_hour);
  const windowStarted = row.window_started_at ? new Date(row.window_started_at) : null;
  const windowMs = windowStarted && !Number.isNaN(windowStarted.getTime()) ? Date.now() - windowStarted.getTime() : Infinity;
  const resetWindow = windowMs >= 3600000;
  const usedInWindow = resetWindow ? 0 : Math.max(Number(row.window_count || 0) || 0, 0);
  if (usedInWindow >= limit) {
    await db.query("UPDATE empresa_api_keys SET last_rate_limit_at=NOW(), updated_at=NOW() WHERE id=$1", [row.id]).catch(() => {});
    const err = new Error("Limite horario de la API key superado");
    err.status = 429;
    err.retry_after_seconds = Math.max(60, Math.ceil((3600000 - windowMs) / 1000));
    throw err;
  }
  const nextWindowCount = usedInWindow + 1;
  await db.query(
    `UPDATE empresa_api_keys
        SET last_used_at=NOW(), last_used_ip=$2, usage_count=COALESCE(usage_count,0)+1,
            window_started_at=CASE WHEN $3::boolean THEN NOW() ELSE COALESCE(window_started_at, NOW()) END,
            window_count=$4, updated_at=NOW()
      WHERE id=$1`,
    [row.id, ip, resetWindow, nextWindowCount]
  ).catch(() => {});

  const scopes = Array.isArray(row.scopes) ? row.scopes : [];
  return {
    key_id: row.id,
    empresa_id: row.empresa_id,
    nombre: row.nombre,
    plan: row.plan,
    scopes,
    permisos: permisosFromScopes(scopes),
    rate_limit_per_hour: limit,
    rate_limit_remaining: Math.max(0, limit - nextWindowCount),
  };
}

module.exports = {
  API_SCOPE_MODULES,
  TOKEN_PREFIX,
  ensureSchema,
  normalizeScopes,
  permisosFromScopes,
  createKey,
  listKeys,
  listAllKeys,
  revokeKey,
  revokeById,
  resolveKey,
};

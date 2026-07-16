const crypto = require("crypto");
const db = require("./db");

const PROVIDER_ENV = {
  here: "HERE_API_KEY",
  ors: "ORS_API_KEY",
  google: "GOOGLE_MAPS_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  ai_generic: "AI_API_KEY",
  locatel: "LOCATEL_API_KEY",
  tacogest: "TACOGEST_API_KEY",
  movildata: "MOVILDATA_API_KEY",
  gps_generic: "GPS_API_KEY",
};

function encryptionKey(seed = process.env.API_KEYS_ENCRYPTION_SECRET || process.env.JWT_SECRET || "transgest-local-dev-key") {
  return crypto.createHash("sha256").update(seed).digest();
}

function decryptionKeys() {
  return [...new Set([
    process.env.API_KEYS_ENCRYPTION_SECRET || process.env.JWT_SECRET || "transgest-local-dev-key",
    process.env.API_KEYS_ENCRYPTION_LEGACY_SECRET,
  ].map(value => String(value || "").trim()).filter(Boolean))].map(encryptionKey);
}

function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(value) {
  if (!value) return "";
  if (!String(value).startsWith("v1:")) return value;
  const [, ivB64, tagB64, dataB64] = String(value).split(":");
  let lastError = null;
  for (const key of decryptionKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64"));
      decipher.setAuthTag(Buffer.from(tagB64, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(dataB64, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error("No se pudo descifrar la clave API con las claves activa o legacy", { cause: lastError });
}

function maskSecret(value) {
  if (!value) return "";
  const clean = String(value);
  if (clean.length <= 10) return clean.slice(0, 2) + "...";
  return clean.slice(0, 8) + "..." + clean.slice(-4);
}

async function ensureTables() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS empresa_api_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      provider VARCHAR(40) NOT NULL,
      encrypted_key TEXT,
      key_mask VARCHAR(80),
      use_global BOOLEAN NOT NULL DEFAULT true,
      activo BOOLEAN NOT NULL DEFAULT true,
      limite_mensual INTEGER DEFAULT 0,
      usos_mes INTEGER DEFAULT 0,
      periodo_mes VARCHAR(7),
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, provider)
    )
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS gps_webhook_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      provider VARCHAR(40) NOT NULL,
      token_hash VARCHAR(100) NOT NULL,
      token_mask VARCHAR(80),
      activo BOOLEAN NOT NULL DEFAULT true,
      created_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      UNIQUE (empresa_id, provider)
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_gps_webhook_tokens_lookup ON gps_webhook_tokens(empresa_id, provider, activo)").catch(() => {});
}

async function getGlobalApiKey(provider) {
  await ensureTables();
  const keyName = `${provider}_api_key`;
  const { rows } = await db.query("SELECT value FROM system_config WHERE key=$1 LIMIT 1", [keyName]);
  const dbValue = rows[0]?.value || "";
  if (dbValue) return { key: decryptSecret(dbValue), source: "global" };
  const envName = PROVIDER_ENV[provider];
  const envValue = envName ? process.env[envName] : "";
  return { key: envValue || "", source: envValue ? "env" : "none" };
}

async function getGlobalSetting(key, fallback = "") {
  await ensureTables();
  const { rows } = await db.query("SELECT value FROM system_config WHERE key=$1 LIMIT 1", [key]);
  return rows[0]?.value ?? fallback;
}

async function setGlobalSetting(key, value) {
  await ensureTables();
  await db.query(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
  `, [key, value == null ? "" : String(value)]);
}

async function setGlobalApiKey(provider, apiKey) {
  await ensureTables();
  const keyName = `${provider}_api_key`;
  const encrypted = encryptSecret(apiKey);
  await db.query(`
    INSERT INTO system_config (key, value, updated_at)
    VALUES ($1,$2,NOW())
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()
  `, [keyName, encrypted]);
  const envName = PROVIDER_ENV[provider];
  if (envName) process.env[envName] = apiKey;
}

async function deleteGlobalApiKey(provider) {
  await ensureTables();
  await db.query("DELETE FROM system_config WHERE key=$1", [`${provider}_api_key`]);
  const envName = PROVIDER_ENV[provider];
  if (envName) delete process.env[envName];
}

async function getCompanyApiConfig(empresaId, provider) {
  await ensureTables();
  const { rows } = await db.query(
    "SELECT * FROM empresa_api_configs WHERE empresa_id=$1 AND provider=$2 LIMIT 1",
    [empresaId, provider]
  );
  return rows[0] || null;
}

async function setCompanyApiConfig(empresaId, provider, data, actorId = null) {
  await ensureTables();
  const apiKey = data.api_key ? String(data.api_key).trim() : "";
  const encrypted = apiKey ? encryptSecret(apiKey) : null;
  const keyMask = apiKey ? maskSecret(apiKey) : null;
  const clearKey = data.clear_key === true;
  const useGlobal = clearKey ? true : (data.use_global !== undefined ? Boolean(data.use_global) : !apiKey);
  if (!useGlobal && !apiKey && !clearKey) {
    const current = await getCompanyApiConfig(empresaId, provider);
    if (!current?.encrypted_key) {
      const err = new Error("Para usar una clave propia de empresa debes pegar una clave API.");
      err.status = 400;
      throw err;
    }
  }
  const activo = data.activo !== undefined ? Boolean(data.activo) : true;
  const limite = Number(data.limite_mensual || 0);
  await db.query(`
    INSERT INTO empresa_api_configs
      (empresa_id,provider,encrypted_key,key_mask,use_global,activo,limite_mensual,updated_by,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
    ON CONFLICT (empresa_id, provider) DO UPDATE SET
      encrypted_key=CASE
        WHEN $9 THEN NULL
        WHEN EXCLUDED.encrypted_key IS NOT NULL THEN EXCLUDED.encrypted_key
        ELSE empresa_api_configs.encrypted_key
      END,
      key_mask=CASE
        WHEN $9 THEN NULL
        WHEN EXCLUDED.key_mask IS NOT NULL THEN EXCLUDED.key_mask
        ELSE empresa_api_configs.key_mask
      END,
      use_global=EXCLUDED.use_global,
      activo=EXCLUDED.activo,
      limite_mensual=EXCLUDED.limite_mensual,
      updated_by=EXCLUDED.updated_by,
      updated_at=NOW()
  `, [empresaId, provider, encrypted, keyMask, useGlobal, activo, Number.isFinite(limite) ? limite : 0, actorId, clearKey]);
}

async function ensureMonthlyUsageRow(empresaId, provider) {
  const periodo = new Date().toISOString().slice(0, 7);
  await ensureTables();
  await db.query(`
    INSERT INTO empresa_api_configs
      (empresa_id,provider,use_global,activo,limite_mensual,usos_mes,periodo_mes,updated_at)
    VALUES ($1,$2,true,true,0,0,$3,NOW())
    ON CONFLICT (empresa_id, provider) DO UPDATE SET
      periodo_mes=CASE WHEN empresa_api_configs.periodo_mes=$3 THEN empresa_api_configs.periodo_mes ELSE $3 END,
      usos_mes=CASE WHEN empresa_api_configs.periodo_mes=$3 THEN empresa_api_configs.usos_mes ELSE 0 END
  `, [empresaId, provider, periodo]);
  const { rows } = await db.query(
    "SELECT * FROM empresa_api_configs WHERE empresa_id=$1 AND provider=$2 LIMIT 1",
    [empresaId, provider]
  );
  return rows[0];
}

async function assertApiUsageAllowed(empresaId, provider) {
  if (!empresaId || !provider) return;
  const cfg = await ensureMonthlyUsageRow(empresaId, provider);
  if (cfg.activo === false) {
    const err = new Error(`Integracion ${provider} bloqueada para esta empresa.`);
    err.status = 403;
    throw err;
  }
  const limite = Number(cfg.limite_mensual || 0);
  const usos = Number(cfg.usos_mes || 0);
  if (limite > 0 && usos >= limite) {
    const err = new Error(`Limite mensual de ${provider} alcanzado (${limite} usos).`);
    err.status = 429;
    throw err;
  }
}

async function recordApiUsage(empresaId, provider, amount = 1) {
  if (!empresaId || !provider || provider === "local") return;
  const periodo = new Date().toISOString().slice(0, 7);
  await ensureTables();
  await db.query(`
    INSERT INTO empresa_api_configs
      (empresa_id,provider,use_global,activo,limite_mensual,usos_mes,periodo_mes,updated_at)
    VALUES ($1,$2,true,true,0,$3,$4,NOW())
    ON CONFLICT (empresa_id, provider) DO UPDATE SET
      periodo_mes=$4,
      usos_mes=CASE
        WHEN empresa_api_configs.periodo_mes=$4 THEN empresa_api_configs.usos_mes + $3
        ELSE $3
      END,
      updated_at=NOW()
  `, [empresaId, provider, Math.max(1, Number(amount || 1)), periodo]);
}

async function resolveApiKey(empresaId, provider) {
  const company = empresaId ? await getCompanyApiConfig(empresaId, provider) : null;
  if (company && company.activo === false) return { key: "", source: "disabled", config: company };
  // La clave propia de la empresa manda siempre, exista o no clave global y sea
  // cual sea el flag use_global. La global queda solo como respaldo.
  if (company && company.encrypted_key) {
    return { key: decryptSecret(company.encrypted_key), source: "company", config: company };
  }
  // Sin clave propia y con use_global desactivado: la empresa ha optado
  // explicitamente por no usar la global (queda bloqueada hasta poner clave).
  if (company && !company.use_global) {
    return { key: "", source: "company_missing", config: company };
  }
  const global = await getGlobalApiKey(provider);
  return { ...global, config: company };
}

async function resolveBestApiKey(empresaId, preferredProvider, candidates = []) {
  const safe = [...new Set([preferredProvider, ...candidates].filter(Boolean))];
  for (const provider of safe) {
    const resolved = await resolveApiKey(empresaId, provider);
    if (resolved.key) return { ...resolved, provider };
    if (resolved.source === "disabled" || resolved.source === "company_missing") {
      continue;
    }
  }
  const provider = safe[0] || preferredProvider;
  const resolved = provider ? await resolveApiKey(empresaId, provider) : { key: "", source: "none" };
  return { ...resolved, provider };
}

async function publicStatusForProvider(provider, empresaId = null) {
  const global = await getGlobalApiKey(provider);
  const company = empresaId ? await getCompanyApiConfig(empresaId, provider) : null;
  return {
    provider,
    global_configured: !!global.key,
    global_source: global.source,
    company_configured: !!company?.encrypted_key,
    company_masked: company?.key_mask || "",
    use_global: company ? company.use_global : true,
    activo: company ? company.activo : true,
    limite_mensual: company?.limite_mensual || 0,
    usos_mes: company?.usos_mes || 0,
  };
}

module.exports = {
  PROVIDER_ENV,
  encryptSecret,
  decryptSecret,
  maskSecret,
  ensureTables,
  getGlobalApiKey,
  getGlobalSetting,
  setGlobalSetting,
  setGlobalApiKey,
  deleteGlobalApiKey,
  getCompanyApiConfig,
  setCompanyApiConfig,
  assertApiUsageAllowed,
  recordApiUsage,
  resolveApiKey,
  resolveBestApiKey,
  publicStatusForProvider,
};

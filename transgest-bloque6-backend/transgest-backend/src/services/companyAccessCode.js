const db = require('./db');

let schemaPromise;

function normalizeCompanyCode(value) {
  return String(value || '').trim().toUpperCase();
}

function validCompanyCode(value) {
  return /^[A-Z0-9][A-Z0-9-]{2,19}$/.test(normalizeCompanyCode(value));
}

async function applyCompanyAccessCodes(database) {
      await database.query('ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo_acceso VARCHAR(20)');
      // Preserve every issued code; only companies without one receive a random code.
      // 64 random bits leave enough room for the TG- prefix within VARCHAR(20).
      await database.query(`ALTER TABLE empresas ALTER COLUMN codigo_acceso SET DEFAULT ('TG-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 16)))`);
      await database.query(`UPDATE empresas SET codigo_acceso='TG-' || UPPER(SUBSTRING(REPLACE(gen_random_uuid()::text, '-', ''), 1, 16)) WHERE codigo_acceso IS NULL OR BTRIM(codigo_acceso)=''`);
      await database.query('ALTER TABLE empresas ALTER COLUMN codigo_acceso SET NOT NULL');
      await database.query('CREATE UNIQUE INDEX IF NOT EXISTS empresas_codigo_acceso_unique ON empresas (UPPER(codigo_acceso))');
}

async function ensureCompanyAccessCodes(database = db) {
  if (database !== db) return applyCompanyAccessCodes(database);
  if (!schemaPromise) {
    schemaPromise = applyCompanyAccessCodes(database).catch(error => { schemaPromise = null; throw error; });
  }
  return schemaPromise;
}

module.exports = { ensureCompanyAccessCodes, normalizeCompanyCode, validCompanyCode };

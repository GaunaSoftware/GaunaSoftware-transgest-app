const db = require('./db');

let schemaPromise;

function normalizeCompanyCode(value) {
  return String(value || '').trim().toUpperCase();
}

function validCompanyCode(value) {
  return /^[A-Z0-9][A-Z0-9-]{2,19}$/.test(normalizeCompanyCode(value));
}

async function applyCompanyAccessCodes(database) {
      await database.query('CREATE SEQUENCE IF NOT EXISTS empresas_codigo_acceso_seq');
      await database.query('ALTER TABLE empresas ADD COLUMN IF NOT EXISTS codigo_acceso VARCHAR(20)');
      await database.query(`ALTER TABLE empresas ALTER COLUMN codigo_acceso SET DEFAULT ('TG-' || LPAD(nextval('empresas_codigo_acceso_seq')::text, 8, '0'))`);
      // Existing companies keep a stable code. The sequence also supplies every new company.
      await database.query(`UPDATE empresas SET codigo_acceso='TG-' || LPAD(nextval('empresas_codigo_acceso_seq')::text, 8, '0') WHERE codigo_acceso IS NULL OR BTRIM(codigo_acceso)=''`);
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

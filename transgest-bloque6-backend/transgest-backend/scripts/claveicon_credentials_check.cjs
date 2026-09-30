const assert = require('node:assert/strict');

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const configs = new Map();
const db = {
  async query(sql, params = []) {
    if (/^\s*CREATE /i.test(sql)) return { rows: [] };
    if (/SELECT \* FROM empresa_api_configs/i.test(sql)) return { rows: configs.has(params[0]) ? [configs.get(params[0])] : [] };
    if (/SELECT value FROM system_config/i.test(sql)) return { rows: [] };
    if (/SELECT id FROM empresas/i.test(sql)) return { rows: [a, b].includes(params[0]) ? [{ id: params[0] }] : [] };
    if (/INSERT INTO empresa_api_configs/i.test(sql)) {
      const [empresa_id, provider, encrypted_key, key_mask, use_global, activo] = params;
      const current = configs.get(empresa_id) || {};
      configs.set(empresa_id, {
        ...current, empresa_id, provider,
        encrypted_key: encrypted_key || current.encrypted_key || null,
        key_mask: key_mask || current.key_mask || null,
        use_global, activo,
      });
      return { rows: [] };
    }
    throw new Error(`Consulta no simulada: ${sql.slice(0, 70)}`);
  },
  async transaction(callback) { return callback({ query: (...args) => db.query(...args) }); },
};
const dbPath = require.resolve('../src/services/db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
const keys = require('../src/services/apiKeys');

async function main() {
  const saved = process.env.CLAVEICON_API_KEY;
  process.env.CLAVEICON_API_KEY = 'qa-fake-global-not-to-use';
  try {
    await assert.rejects(keys.setGlobalApiKey('claveicon', 'qa-fake-global-not-to-use'), { status: 400 });
    await keys.setCompanyApiConfig(a, 'claveicon', { api_key: 'qa-fake-tlm-only', use_global: true });
    assert.equal(configs.get(a).use_global, false);
    assert.ok(configs.get(a).encrypted_key.startsWith('v1:'));
    assert.ok(!configs.get(a).encrypted_key.includes('qa-fake-tlm-only'));
    assert.equal((await keys.resolveApiKey(a, 'claveicon')).key, 'qa-fake-tlm-only');
    assert.equal((await keys.resolveApiKey(b, 'claveicon')).key, '');
    assert.equal((await keys.publicStatusForProvider('claveicon', b)).company_configured, false);
    console.log('OK ClaveiCon: credencial cifrada por empresa y sin herencia global.');
  } finally {
    if (saved === undefined) delete process.env.CLAVEICON_API_KEY;
    else process.env.CLAVEICON_API_KEY = saved;
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

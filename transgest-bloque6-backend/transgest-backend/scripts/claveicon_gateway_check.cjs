const assert = require('node:assert/strict');
const { listCompanies, send } = require('../src/services/claveicon/transport');

async function main() {
  let called;
  const fetchImpl = async (url, options) => {
    called = { url, options };
    return { ok: true, status: 200, json: async () => [{ companyCode: 'PRUEB' }] };
  };
  const found = await listCompanies({ apiKey: 'qa-fake-tlm-clavei', expectedCode: 'PRUEB', fetchImpl });
  assert.equal(called.url, 'https://gateway.claveicowork.com/api/v1/config/companies');
  assert.equal(called.options.method, 'GET');
  assert.equal(called.options.headers.apikey, 'qa-fake-tlm-clavei');
  assert.deepEqual(found, { ok: true, http_status: 200, company_list_recognized: true, company_visible: true });
  assert.ok(!JSON.stringify(found).includes('qa-fake-tlm-clavei'));
  const missing = await listCompanies({ apiKey: 'qa-fake-tlm-clavei', expectedCode: 'OTRA', fetchImpl });
  assert.equal(missing.company_visible, false);
  const denied = await listCompanies({ apiKey: 'qa-fake-tlm-clavei', expectedCode: 'PRUEB', fetchImpl: async () => ({ ok: false, status: 401 }) });
  assert.equal(denied.http_status, 401);
  await assert.rejects(listCompanies({ apiKey: 'bad\nkey', expectedCode: 'PRUEB', fetchImpl }), { status: 422 });
  await assert.rejects(send(), { code: 'CLAVEICON_IMPORT_NOT_VALIDATED' });
  console.log('OK ClaveiCon: prueba de solo lectura, aislamiento por código, fallo de autenticación e importación bloqueada.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

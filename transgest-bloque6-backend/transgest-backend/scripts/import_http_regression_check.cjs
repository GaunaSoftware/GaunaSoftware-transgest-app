const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { createImportBatches } = require('../src/services/importBatches');
const { createImportRouter } = require('../src/routes/importacion');
const { parseFile } = require('../src/services/importParser');

async function main() {
  const pg = new PGlite();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  let server;
  try {
    await pg.exec('CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);');
    await pg.query('INSERT INTO empresas(id) VALUES ($1),($2)', [companyA, companyB]);
    await pg.exec(fs.readFileSync(path.join(__dirname, 'migrations/20260924_import_batches.sql'), 'utf8'));
    const db = { query: (...args) => pg.query(...args), transaction: async fn => {
      await pg.exec('BEGIN');
      try { const result = await fn(pg); await pg.exec('COMMIT'); return result; }
      catch (error) { await pg.exec('ROLLBACK'); throw error; }
    } };
    const app = express();
    app.use((req, _res, next) => { req.empresaId = req.get('x-test-company'); req.user = { id: null }; next(); });
    app.use('/importacion', createImportRouter(createImportBatches(db)));
    server = await new Promise(resolve => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
    const base = `http://127.0.0.1:${server.address().port}/importacion`;
    const packResponse = await fetch(`${base}/templates/pack.xlsx`, { headers: { 'x-test-company': companyA } });
    assert.equal(packResponse.status, 200);
    const packBuffer = Buffer.from(await packResponse.arrayBuffer());
    const pack = await parseFile(packBuffer, 'pack.xlsx', 'Pack_TransGest');
    assert.equal(pack.length, 15);
    const csvResponse = await fetch(`${base}/templates/Conductores.csv`, { headers: { 'x-test-company': companyA } });
    assert.equal(csvResponse.status, 200);
    assert.match(await csvResponse.text(), /source_id,nombre,apellidos/);
    const csv = Buffer.from('source_id,nombre,apellidos,dni,estado\nold-1,Ana,López,12345678Z,activo\n');
    const upload = await fetch(`${base}/upload`, { method: 'POST', headers: {
      'x-test-company': companyA, 'x-import-filename': 'conductores.csv',
      'x-import-type': 'Conductores', 'x-import-source-system': 'legacy',
      'content-type': 'text/csv',
    }, body: csv });
    assert.equal(upload.status, 201, await upload.clone().text());
    const { batch } = await upload.json();
    assert.equal(batch.status, 'review');
    assert.equal(batch.valid_rows, 1);
    const rows = await fetch(`${base}/batches/${batch.id}/rows`, { headers: { 'x-test-company': companyA } });
    assert.equal((await rows.json()).rows[0].normalized_data.nombre, 'Ana');
    const forbidden = await fetch(`${base}/batches/${batch.id}`, { headers: { 'x-test-company': companyB } });
    assert.equal(forbidden.status, 404);
    const bad = await fetch(`${base}/upload`, { method: 'POST', headers: {
      'x-test-company': companyA, 'x-import-filename': 'conductores.csv',
      'x-import-type': 'Conductores', 'x-import-source-system': 'legacy',
      'content-type': 'text/csv',
    }, body: Buffer.from('source_id,NOMBRE RARO\nx,a\n') });
    assert.equal(bad.status, 422);
    assert.equal((await createImportBatches(db).listBatches(companyA)).length, 1);
    console.log('PASS: HTTP templates, upload/preview, batch/rows, invalid header and A/B isolation. Synthetic PGlite only.');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

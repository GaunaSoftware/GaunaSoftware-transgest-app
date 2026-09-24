const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { createImportBatches, normalizeFilename } = require('../src/services/importBatches');

async function main() {
  const pg = new PGlite();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  try {
    await pg.exec('CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);');
    await pg.query('INSERT INTO empresas(id) VALUES ($1),($2)', [companyA, companyB]);
    await pg.exec(fs.readFileSync(path.join(__dirname, 'migrations/20260924_import_batches.sql'), 'utf8'));
    const db = {
      query: (...args) => pg.query(...args),
      transaction: async (fn) => {
        await pg.exec('BEGIN');
        try { const result = await fn(pg); await pg.exec('COMMIT'); return result; }
        catch (error) { await pg.exec('ROLLBACK'); throw error; }
      },
    };
    const service = createImportBatches(db);
    assert.equal(normalizeFilename('../../cliente.csv'), 'cliente.csv');
    const batch = await service.createBatch({ empresaId: companyA, tipo: 'Conductores', filename: '../conductores.csv', fileBuffer: Buffer.from('source_id,nombre\na,Test'), sourceSystem: 'anterior' });
    assert.match(batch.file_hash_sha256, /^[0-9a-f]{64}$/);
    assert.equal(batch.filename, 'conductores.csv');
    assert.equal((await service.listBatches(companyA)).length, 1);
    assert.equal((await service.listBatches(companyB)).length, 0);
    await assert.rejects(service.getBatch(companyB, batch.id), { status: 404 });
    await assert.rejects(service.listRows(companyB, batch.id), { status: 404 });
    await assert.rejects(service.createBatch({ empresaId: companyA, tipo: 'Unknown', filename: 'x.csv', fileBuffer: Buffer.from('x'), sourceSystem: 'a' }), { status: 400 });
    let inserted = 0;
    for (let start = 2; start < 1202; start += 400) {
      const rows = Array.from({ length: Math.min(400, 1202 - start) }, (_, index) => {
        const rowNumber = start + index;
        return { entity_type: 'Conductores', row_number: rowNumber, source_data: { source_id: `old-${rowNumber}`, nombre: `Conductor ${rowNumber}` } };
      });
      inserted += (await service.stageRows(companyA, batch.id, rows)).inserted;
    }
    assert.equal(inserted, 1200);
    const repeated = await service.stageRows(companyA, batch.id, [{ entity_type: 'Conductores', row_number: 2, source_data: { source_id: 'old-2', nombre: 'Conductor 2' } }]);
    assert.deepEqual(repeated, { inserted: 0, duplicate_rows: 1 });
    await assert.rejects(service.stageRows(companyA, batch.id, [{ entity_type: 'Conductores', row_number: 2, source_data: { source_id: 'old-2', nombre: 'Modificado' } }]), { status: 409, code: 'ROW_CONFLICT' });
    assert.equal((await service.getBatch(companyA, batch.id)).total_rows, 1200);
    assert.equal((await service.listRows(companyA, batch.id, { limit: 100 })).length, 100);
    await assert.rejects(service.stageRows(companyB, batch.id, [{ entity_type: 'Conductores', row_number: 1202, source_data: { source_id: 'evil' } }]), { status: 404 });
    await assert.rejects(service.stageRows(companyA, batch.id, [{ entity_type: 'Conductores', row_number: 2, source_data: {} }, { entity_type: 'Conductores', row_number: 2, source_data: {} }]), { status: 400 });
    console.log('PASS: additive schema, 1,200 staged rows, repeated row, pagination and A/B tenant isolation. Synthetic PGlite only.');
  } finally { await pg.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

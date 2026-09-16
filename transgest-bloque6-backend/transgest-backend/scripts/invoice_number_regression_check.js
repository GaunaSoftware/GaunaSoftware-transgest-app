const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { nextInvoiceNumber } = require('../src/services/invoiceNumber');

async function main() {
  const pg = new PGlite();
  const locks = [];
  // PGlite has one connection; verify the requested transaction lock separately.
  const client = { query: (sql, args) => {
    if (sql.includes('pg_advisory_xact_lock')) { locks.push(args[0]); return { rows: [] }; }
    return pg.query(sql, args);
  } };
  try {
    await pg.exec('CREATE TABLE facturas(numero text NOT NULL UNIQUE, empresa_id text NOT NULL, fecha date)');
    await pg.query('INSERT INTO facturas VALUES ($1,$2,$3)', ['A-2026-0001', 'A', '2026-09-15']);
    const migration = fs.readFileSync(path.join(__dirname, 'migrations/016_facturas_numero_por_empresa.sql'), 'utf8');
    await pg.exec(migration);
    await pg.exec(migration);
    assert.equal(await nextInvoiceNumber(client, 'B', 'A', 2026), 'A-2026-0001');
    await pg.query('INSERT INTO facturas VALUES ($1,$2,$3)', ['A-2026-0001', 'B', '2026-09-15']);
    await assert.rejects(pg.query('INSERT INTO facturas VALUES ($1,$2,$3)', ['A-2026-0001', 'A', '2026-09-15']), e => e.code === '23505');
    // Numeric ordering and a changed invoice date must not reuse an existing number.
    for (const number of ['A-2026-9999', 'A-2026-10000', 'A-2026-010001']) {
      await pg.query('INSERT INTO facturas VALUES ($1,$2,$3)', [number, 'A', '2025-12-31']);
    }
    assert.equal(await nextInvoiceNumber(client, 'A', 'A', 2026), 'A-2026-10002');
    assert.equal(await nextInvoiceNumber(client, 'A', 'R', 2026), 'R-2026-0001');
    assert.equal(await nextInvoiceNumber(client, 'A', 'A', 2027), 'A-2027-0001');
    assert.ok(locks.includes('facturas:A:A:2026'));
    for (const file of ['facturas.js', 'palets.js']) {
      assert.ok(fs.readFileSync(path.join(__dirname, '../src/routes', file), 'utf8').includes('nextInvoiceNumber(client,'));
    }
    console.log('PASS invoice numbering: tenant isolation, existing duplicates, numeric sequence, dates and shared writer lock');
  } finally { await pg.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });

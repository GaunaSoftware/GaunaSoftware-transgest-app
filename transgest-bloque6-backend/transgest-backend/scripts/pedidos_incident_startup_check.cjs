const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

async function main() {
  const pg = new PGlite();
  try {
    await pg.exec('CREATE TABLE pedidos(id uuid PRIMARY KEY)');
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/20260924_pedidos_incident_startup.sql'), 'utf8');
    await pg.exec(sql);
    await pg.exec(sql);
    const { rows } = await pg.query(`SELECT column_name FROM information_schema.columns
      WHERE table_name='pedidos' AND column_name LIKE 'incidencia_%'`);
    assert.equal(rows.length, 6);
    console.log('PASS: incident fields exist before the overdue scheduler; migration is idempotent.');
  } finally {
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

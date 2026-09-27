const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE pedidos (id text PRIMARY KEY, empresa_id text, metros_lineales numeric);
      INSERT INTO pedidos VALUES ('legacy','company-a',7.25);`);
    const migration = fs.readFileSync(path.join(__dirname, 'migrations/20260925_cargo_length_mode.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const legacy = (await db.query("SELECT metros_lineales, longitud_ocupada_mode FROM pedidos WHERE id='legacy'")).rows[0];
    assert.equal(Number(legacy.metros_lineales), 7.25);
    assert.equal(legacy.longitud_ocupada_mode, null, 'historic length must not become automatic');
    await db.query('INSERT INTO pedidos VALUES ($1,$2,$3,$4)', ['new', 'company-b', 12.5, 'auto']);
    await db.query('UPDATE pedidos SET longitud_ocupada_mode=$1 WHERE id=$2', ['manual', 'new']);
    assert.equal((await db.query("SELECT longitud_ocupada_mode FROM pedidos WHERE id='new'")).rows[0].longitud_ocupada_mode, 'manual');
    await assert.rejects(db.query('UPDATE pedidos SET longitud_ocupada_mode=$1 WHERE id=$2', ['unknown', 'new']), /check constraint/i);
    console.log('PASS cargo length mode: versioned migration repeat, legacy preservation and allowed modes');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

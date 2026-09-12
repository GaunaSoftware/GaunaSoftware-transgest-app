const assert = require('node:assert/strict');
const { normalizeClientImage, MAX_CLIENT_IMAGE_BYTES } = require('../src/services/clientImage');
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=';
assert.equal(normalizeClientImage(undefined), undefined);
assert.equal(normalizeClientImage(null), null);
assert.equal(normalizeClientImage(''), null);
assert.equal(normalizeClientImage(png), png);
for (const value of ['https://example.test/logo.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,YmFk', {}, 'data:image/png;base64,' + Buffer.alloc(MAX_CLIENT_IMAGE_BYTES + 1).toString('base64')]) {
  assert.throws(() => normalizeClientImage(value), error => error.status === 400);
}
(async () => {
  const { PGlite } = require('@electric-sql/pglite');
  const fs = require('node:fs');
  const path = require('node:path');
  const db = new PGlite();
  await db.exec('CREATE TABLE clientes (id INTEGER PRIMARY KEY, empresa_id INTEGER, nombre TEXT); INSERT INTO clientes VALUES (1,1,\'Cliente sin imagen\'), (2,2,\'Otra empresa\');');
  const sql = fs.readFileSync(path.join(__dirname,'migrations/013_clientes_imagen_opcional.sql'),'utf8');
  await db.exec(sql); await db.exec(sql);
  assert.ok((await db.query('SELECT imagen_data FROM clientes')).rows.every(row=>row.imagen_data === null));
  await db.query('UPDATE clientes SET imagen_data=$1 WHERE id=$2 AND empresa_id=$3',[png,1,1]);
  assert.equal((await db.query('SELECT imagen_data FROM clientes WHERE id=1')).rows[0].imagen_data,png);
  assert.equal((await db.query('SELECT imagen_data FROM clientes WHERE id=2')).rows[0].imagen_data,null);
  await db.query('UPDATE clientes SET imagen_data=$1 WHERE id=$2 AND empresa_id=$3',[null,1,1]);
  assert.equal((await db.query('SELECT imagen_data FROM clientes WHERE id=1')).rows[0].imagen_data,null);
  await db.close();
  console.log('Client image: validation, optional migration, persistence and removal OK');
})().catch(e=>{console.error(e);process.exitCode=1;});

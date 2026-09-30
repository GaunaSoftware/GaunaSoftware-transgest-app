const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { _test: { pedidoListSearch } } = require('../src/routes/pedidos');

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE pedidos(id text, empresa_id text, numero text, origen text, destino text,
        referencia_cliente text, cliente_id text, colaborador_id text, vehiculo_id text,
        remolque_id text, matricula_manual text, remolque_matricula_manual text,
        matricula_colaborador text, remolque_matricula_colaborador text);
      CREATE TABLE vehiculos(id text, empresa_id text, matricula text);
      CREATE TABLE clientes(id text, empresa_id text, nombre text);
      CREATE TABLE colaboradores(id text, empresa_id text, nombre text);
      INSERT INTO vehiculos VALUES ('tractor-a','a','1234-ABC'),('trailer-a','a','R-5678-DEF'),('tractor-b','b','9999-XYZ');
      INSERT INTO clientes VALUES ('client-a','a','Cliente Uno'),('client-b','b','Cliente Privado');
      INSERT INTO pedidos(id,empresa_id,numero,cliente_id,vehiculo_id,remolque_id) VALUES
        ('own','a','PED-001','client-a','tractor-a','trailer-a'),
        ('other','b','PED-002','client-b','tractor-b',NULL);
      INSERT INTO pedidos(id,empresa_id,numero,matricula_manual,remolque_matricula_manual) VALUES
        ('manual','a','PED-003','2222-JKL','R-3333-MNO');
      INSERT INTO pedidos(id,empresa_id,numero,matricula_colaborador,remolque_matricula_colaborador) VALUES
        ('supplier','a','PED-004','4444-PQR','R-5555-STU');
    `);
    const search = async (company, q) => {
      const filter = pedidoListSearch(q, 2);
      const { rows } = await db.query(`SELECT p.id FROM pedidos p WHERE p.empresa_id=$1 AND ${filter.sql} ORDER BY p.id`, [company, ...filter.values]);
      return rows.map(row => row.id);
    };
    for (const [q, expected] of [
      ['1234-ABC', 'own'], ['1234abc', 'own'], ['5678def', 'own'],
      ['2222-JKL', 'manual'], ['3333mno', 'manual'],
      ['4444pqr', 'supplier'], ['5555-STU', 'supplier'],
      ['Cliente Uno', 'own'], ['PED-004', 'supplier'],
    ]) assert.deepEqual(await search('a', q), [expected], q);
    assert.deepEqual(await search('a', '9999-XYZ'), [], 'A company cannot search another company’s plates');
    assert.deepEqual(await search('b', '1234-ABC'), [], 'The reverse isolation also applies');
    assert.deepEqual(await search('a', '-'), [], 'A punctuation-only query must not match every assigned vehicle');
    console.log('PASS pedido plate search: tractor, trailer, manual, supplier, normalized input and tenant isolation');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

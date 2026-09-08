const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { pedidoDateFilter } = require('../src/services/pedidoDateFilter');

async function main() {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE pedidos(id TEXT, empresa_id TEXT, cliente_id TEXT, estado TEXT, fecha_carga DATE, fecha_descarga DATE, fecha_entrega DATE);
      INSERT INTO pedidos VALUES
      ('actual','empresa','cliente','confirmado','2026-09-08',NULL,NULL),
      ('incidencia-antigua','empresa','cliente','incidencia','2026-07-01',NULL,NULL),
      ('antiguo','empresa','cliente','entregado','2026-07-01',NULL,NULL),
      ('otro-cliente','empresa','otro','incidencia','2026-07-01',NULL,NULL),
      ('otra-empresa','otra','cliente','incidencia','2026-07-01',NULL,NULL)`);
    const read = async (options, estado) => {
      const params = ['empresa','cliente'];
      const range = pedidoDateFilter(options, params);
      let sql = 'SELECT id FROM pedidos p WHERE empresa_id=$1 AND cliente_id=$2';
      if (range) sql += ' AND ' + range;
      if (estado) { params.push(estado); sql += ` AND estado=$${params.length}`; }
      return (await pg.query(sql+' ORDER BY id',params)).rows.map(row=>row.id);
    };
    const options = {desde:'2026-09-01',hasta:'2026-09-30',incluir_incidencias:'true'};
    assert.deepEqual(await read(options),['actual','incidencia-antigua']);
    assert.deepEqual(await read({...options,incluir_incidencias:'false'}),['actual']);
    assert.deepEqual(await read(options,'confirmado'),['actual']);
    assert.deepEqual(await read(options,'incidencia'),['incidencia-antigua']);
    assert.deepEqual(await read({desde:options.desde,incluir_incidencias:'true'}),['actual','incidencia-antigua']);
    assert.equal(pedidoDateFilter({},[]),'');
    console.log('OK: incidencias fuera del periodo, limites de fecha y aislamiento por cliente/empresa/estado');
  } finally { await pg.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

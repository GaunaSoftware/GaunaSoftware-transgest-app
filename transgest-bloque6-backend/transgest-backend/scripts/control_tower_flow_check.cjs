const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { readFlowPopulation, summarizeFlow, readFlowPage } = require('../src/services/controlTowerFlow');

async function main() {
  const pg = new PGlite();
  const company='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
  try {
    await pg.exec(`CREATE TABLE pedidos(id uuid PRIMARY KEY, empresa_id uuid,numero text,estado text,
      origen text,destino text,puntos_carga jsonb,puntos_descarga jsonb,fecha_carga date,fecha_descarga date,
      fecha_pedido date,created_at timestamptz,factura_id uuid,cliente_id uuid,vehiculo_id uuid,colaborador_id uuid);
      CREATE TABLE pedido_chofer_pasos(pedido_id uuid,empresa_id uuid,data jsonb);
      CREATE TABLE clientes(id uuid,empresa_id uuid,nombre text);
      CREATE TABLE vehiculos(id uuid,empresa_id uuid,matricula text);
      CREATE TABLE colaboradores(id uuid,empresa_id uuid,nombre text);`);
    await pg.query(`INSERT INTO pedidos(id,empresa_id,numero,estado,fecha_carga,origen,destino)
      SELECT md5(i::text)::uuid,$1,'QA-'||lpad(i::text,5,'0'),'en_curso',
        (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date,'A','B' FROM generate_series(1,1501) i`,[company]);
    await pg.query(`INSERT INTO pedido_chofer_pasos SELECT id,empresa_id,'{"carga_ok":true}'::jsonb FROM pedidos`);
    await pg.query(`INSERT INTO pedidos(id,empresa_id,numero,estado,fecha_carga) VALUES
      (md5('other')::uuid,$1,'PRIVATE','espera_carga',CURRENT_DATE),
      (md5('wait')::uuid,$2,'QA-WAIT','espera_carga',CURRENT_DATE),
      (md5('unload')::uuid,$2,'QA-UNLOAD','espera_descarga',CURRENT_DATE),
      (md5('unknown')::uuid,$2,'QA-UNKNOWN','en_curso',CURRENT_DATE),
      (md5('cancel')::uuid,$2,'QA-CANCEL','cancelado',CURRENT_DATE),
      (md5('old')::uuid,$2,'QA-OLD','en_curso',CURRENT_DATE-20)`,[other,company]);
    // Foreign master and same step id must not leak even with inconsistent legacy references.
    await pg.query(`INSERT INTO clientes VALUES(md5('client')::uuid,$1,'PRIVATE CLIENT');
      `,[other]);
    await pg.query("UPDATE pedidos SET cliente_id=md5('client')::uuid WHERE empresa_id=$1",[company]);
    await pg.query(`INSERT INTO pedido_chofer_pasos VALUES(md5('1')::uuid,$1,'{"carga_ok":true,"viaje_iniciado":true,"firma":"PRIVATE"}')`,[other]);
    let queries=0;
    const db={query:(sql,args)=>{queries++;return pg.query(sql,args);}};
    const start=performance.now();
    const population=await readFlowPopulation(db,company), summary=summarizeFlow(population);
    assert.equal(summary.alcance.total,1504);
    assert.equal(summary.estados.some(row=>row.key==='cargado'),true);
    assert.equal(summary.alcance.cargas_finalizadas_sin_salida,1501);
    assert.equal(summary.estados.reduce((sum,row)=>sum+row.total,0),1504);
    assert.equal(summary.estados.find(row=>row.key==='espera_carga').total,1);
    assert.equal(summary.estados.find(row=>row.key==='espera_descarga').total,1);
    assert.equal(summary.alcance.sin_desglose,1);
    assert.equal(queries,2);
    const first=await readFlowPage(db,company,{estado:'cargado',page:1,pageSize:100});
    const last=await readFlowPage(db,company,{estado:'cargado',page:16,pageSize:100});
    assert.equal(first.items.length,100);assert.equal(last.items.length,1);
    assert.equal(first.total,1501);assert.equal(last.total,1501);
    assert.equal(last.items[0].numero,'QA-01501');
    assert.equal(first.items[0].estado,'en_curso');assert.equal(first.items[0].estado_operativo.codigo,'cargado');
    assert.equal(JSON.stringify(first).includes('PRIVATE'),false);
    assert.equal(JSON.stringify(first).includes('firma'),false);
    assert.equal((await readFlowPage(db,other,{estado:'cargado'})).total,0);
    for(const args of [{estado:'not-a-state'},{estado:'cargado',page:0},{estado:'cargado',pageSize:1000}]) await assert.rejects(readFlowPage(db,company,args),{status:400});
    await assert.rejects(readFlowPopulation(db,null),{status:401});
    await assert.rejects(readFlowPopulation({query:async()=>{throw Error('connection lost');}},company),/connection lost/);
    console.log(`PASS Control Tower: 1504 authorized orders, loaded/departed/unknown, waiting states, complete totals, paginated detail, tenant isolation and error propagation. Synthetic PGlite elapsed ${Math.round(performance.now()-start)} ms; ${queries} queries including all scenarios.`);
  } finally { await pg.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

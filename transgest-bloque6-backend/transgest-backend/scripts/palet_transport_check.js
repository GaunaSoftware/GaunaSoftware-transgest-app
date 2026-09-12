const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {linkPaletTransport}=require('../src/services/paletTransport');
async function main(){const db=new PGlite();try{
  const empresa='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',movement='33333333-3333-4333-8333-333333333333',order='44444444-4444-4444-8444-444444444444',foreign='55555555-5555-4555-8555-555555555555';
  await db.exec('CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,estado text); CREATE TABLE palets_movimientos(id uuid PRIMARY KEY,empresa_id uuid,tipo text,cantidad int,estado_salida text);');
  await db.query("INSERT INTO pedidos VALUES($1,$2,'pendiente'),($3,$4,'pendiente')",[order,empresa,foreign,other]);
  await db.query("INSERT INTO palets_movimientos VALUES($1,$2,'devolucion',12,'pendiente')",[movement,empresa]);
  const sql=fs.readFileSync(path.join(__dirname,'migrations/014_palets_transporte.sql'),'utf8');await db.exec(sql);await db.exec(sql);
  const link=(pedidoId,tenant=empresa)=>db.transaction(tx=>linkPaletTransport(tx,{empresa:tenant,movimientoId:movement,pedidoId}));
  await assert.rejects(link(foreign),e=>e.status===404);await assert.rejects(link(order,other),e=>e.status===404);await assert.rejects(link('bad-id'),e=>e.status===400);
  const result=await link(order);assert.equal(result.pedido_transporte_id,order);assert.equal(result.cantidad,12);assert.equal(result.estado_salida,'pendiente');
  await link(order);assert.equal((await db.query('SELECT count(*) FROM pedidos')).rows[0].count,2);
  await db.query("UPDATE pedidos SET estado='cancelado' WHERE id=$1",[order]);await assert.rejects(link(order),e=>e.status===409);
  await db.query("UPDATE palets_movimientos SET tipo='entrega' WHERE id=$1",[movement]);await assert.rejects(link(order),e=>e.status===400);
  console.log('PASS migration idempotence, tenant isolation, return-only link, cancelled order guard, no stock confirmation, no duplicate transport.');
}finally{await db.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});

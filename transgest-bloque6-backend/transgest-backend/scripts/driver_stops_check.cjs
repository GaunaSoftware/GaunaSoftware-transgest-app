const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {driverStops,mergeStop,activeDriverStop,stopData,saveStop}=require('../src/services/driverStops');
async function main(){
 const order={id:'11111111-1111-4111-8111-111111111111',empresa_id:'22222222-2222-4222-8222-222222222222',estado:'confirmado',puntos_carga:[{id:'a',direccion:'A'},{id:'b',direccion:'B'}],puntos_descarga:[{id:'c',direccion:'C'},{id:'d',direccion:'D'}]};
 let all={};const stops=driverStops(order);
 const apply=(i,patch)=>{const result=mergeStop(order,all,{...patch,parada_id:stops[i].id});all=result.data;order.estado=result.state;return result;};
 assert.throws(()=>apply(1,{carga_iniciada:true}),/anterior/);
 assert.throws(()=>apply(0,{carga_ok:true}),/Confirma/);
 for(let i=0;i<2;i++){
  apply(i,{carga_iniciada:true});apply(i,{carga_proceso:true});
  apply(i,{mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:'2',mercancia_peso_kg:'100'});
  apply(i,{albaran_carga:true});apply(i,{firma_cargador:true});const loaded=apply(i,{carga_ok:true});
  assert.equal(loaded.goods.peso_kg,(i+1)*100);assert.equal(all.carga_ok,i===1);
 }
 assert.equal(activeDriverStop(order,all).id,stops[2].id);
 assert.throws(()=>apply(0,{mercancia_peso_kg:'999'}),/confirmada/);
 assert.equal(apply(0,{carga_ok:true}).state,'en_curso','completed stop retry cannot move trip backwards');
 for(let i=2;i<4;i++){
  apply(i,{viaje_iniciado:true});assert.equal(order.estado,'en_curso');
  apply(i,{posicionado_descarga:true});apply(i,{descarga_iniciada:true});
  assert.throws(()=>apply(i,{descarga_ok:true}),/mercancía/);
  assert.throws(()=>apply(i,{mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:'99',mercancia_peso_kg:'999'}),/supera/);
  apply(i,{mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:'2',mercancia_peso_kg:'100'});
  apply(i,{descarga_ok:true});assert.notEqual(order.estado,'entregado');
  apply(i,{albaran_descarga:true});apply(i,{firma_entrega:true});assert.equal(order.estado,i===3?'entregado':'en_curso');
 }
 assert.equal(activeDriverStop(order,all),null);
 assert.equal(Object.keys(all.paradas).length,4);
 assert.deepEqual(driverStops({...order,puntos_carga:[...order.puntos_carga].reverse()}).slice(0,2).map(s=>s.id),[stops[1].id,stops[0].id]);
 const single={origen:'A',destino:'B'},legacy={carga_ok:true,mercancia_confirmada:true,mercancia_peso_kg:100};
 assert.equal(stopData(driverStops(single)[1],legacy,driverStops(single)).mercancia_confirmada,undefined);
 const pg=new PGlite();let fail=false;
 const db={transaction:fn=>pg.transaction(tx=>fn({query:(sql,args)=>{if(fail&&sql.startsWith('UPDATE pedidos SET mercancia'))throw Error('injected write failure');return tx.query(sql,args);}}))};
 try{
  await pg.exec(`CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,numero text,estado text,vehiculo_id uuid,chofer_id uuid,chofer2_id uuid,puntos_carga jsonb,puntos_descarga jsonb,firma_evidencia jsonb,mercancia text,bultos numeric,peso_kg numeric,updated_at timestamptz);CREATE TABLE pedido_chofer_pasos(pedido_id uuid PRIMARY KEY,empresa_id uuid,chofer_id uuid,data jsonb,updated_at timestamptz);CREATE TABLE choferes(id uuid,empresa_id uuid,estado text);`);
  await pg.query('INSERT INTO pedidos(id,empresa_id,estado,puntos_carga,puntos_descarga) VALUES($1,$2,$3,$4,$5)',[order.id,order.empresa_id,'confirmado',JSON.stringify(order.puntos_carga),JSON.stringify(order.puntos_descarga)]);
  const truck='44444444-4444-4444-8444-444444444444';
  await pg.query('UPDATE pedidos SET vehiculo_id=$1',[truck]);
  await pg.query("INSERT INTO pedidos(id,empresa_id,estado,vehiculo_id) VALUES('55555555-5555-4555-8555-555555555555',$1,'en_curso',$2)",[order.empresa_id,truck]);
  const send=patch=>saveStop(db,{pedidoId:order.id,empresaId:order.empresa_id,patch:{parada_id:stops[0].id,...patch}});
  await assert.rejects(send({carga_iniciada:true}),/otro viaje activo/);
  await pg.query("UPDATE pedidos SET estado='entregado' WHERE id='55555555-5555-4555-8555-555555555555'");
  await send({carga_iniciada:true});await send({carga_proceso:true});
  fail=true;await assert.rejects(send({mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:2,mercancia_peso_kg:100}),/injected/);fail=false;
  assert.equal((await pg.query('SELECT data FROM pedido_chofer_pasos')).rows[0].data.paradas[stops[0].id].mercancia_confirmada,undefined);
  await send({mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:2,mercancia_peso_kg:100});await send({albaran_carga:true});
  await assert.rejects(send({firma_cargador:true}),/firma/);
  await assert.rejects(saveStop(db,{pedidoId:order.id,empresaId:'33333333-3333-4333-8333-333333333333',patch:{parada_id:stops[0].id,carga_ok:true}}),/encontrado/);
  assert.equal(Number((await pg.query('SELECT peso_kg FROM pedidos WHERE id=$1',[order.id])).rows[0].peso_kg),100);
 }finally{await pg.close();}
 console.log('PASS multi-stop sequencing, independent goods, delivery after final signature, stable stop IDs, legacy progress, retry, tenant ownership and transactional rollback.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

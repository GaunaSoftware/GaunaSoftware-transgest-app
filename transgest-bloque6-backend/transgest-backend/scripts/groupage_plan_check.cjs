const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {saveGroupagePlan,readGroupagePlan}=require('../src/services/groupagePlan');
async function main(){
 const pg=new PGlite(),company=crypto.randomUUID(),group=crypto.randomUUID(),a=crypto.randomUUID(),b=crypto.randomUUID();
 const db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(fn)};
 const save=extra=>pg.transaction(tx=>saveGroupagePlan(tx,{empresaId:company,grupajeId:group,operationId:crypto.randomUUID(),...extra}));
 try{
  await pg.exec(`CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,grupaje_id uuid,grupaje_borrador boolean,estado text,origen text,destino text,importe numeric,factura_id uuid,mercancia text,peso_kg numeric,bultos numeric);
   CREATE TABLE pedido_chofer_pasos(pedido_id uuid,empresa_id uuid,data jsonb);`);
  for(const file of ['20260926_operational_model.sql','20260926_operational_model_groupage.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260926_operational_model_groupage.sql'),'utf8'));
  for(const id of [a,b])await pg.query("INSERT INTO pedidos VALUES($1,$2,$3,true,'pendiente','A','B',250,NULL,'Sacos',1000,10)",[id,company,group]);
  const before=(await pg.query('SELECT id,importe,estado,factura_id FROM pedidos ORDER BY id')).rows;
  const operation=crypto.randomUUID(),first=await save({operationId:operation,confirm:true}),retry=await save({operationId:operation,confirm:true});
  assert.equal(first.viaje_id,retry.viaje_id);assert.equal(retry.replayed,true);
  let model=await readGroupagePlan(db,company,group),trip=model.viajes[0];
  assert.equal(trip.pedidos.length,2);assert.equal(trip.envios.length,2);assert.equal(trip.paradas.length,4);assert.equal(trip.km_cargados,null,'Commercial kilometres are not summed as physical route');
  assert.equal((await pg.query('SELECT COUNT(*)::int n FROM pedidos')).rows[0].n,2,'No duplicate commercial order');
  assert.deepEqual((await pg.query('SELECT id,importe,estado,factura_id FROM pedidos ORDER BY id')).rows,before);
  const seq=trip.paradas.map(s=>s.legacy_key),layout=trip.pedidos.slice().reverse();
  const second=await save({version:1,layout,route:{distance_km:100,duration_min:90,provider:'test'}});
  trip=(await readGroupagePlan(db,company,group)).viajes[0];
  assert.deepEqual(trip.paradas.map(s=>s.legacy_key),seq,'Physical layout does not reorder route');
  assert.equal(trip.ruta_calculada.distance_km,100);
  await assert.rejects(save({version:1}),{code:'GROUPAGE_VERSION'});
  await assert.rejects(save({version:second.version,sequence:[...seq].reverse()}),{code:'GROUPAGE_SEQUENCE'});
  const seq2=[seq[1],seq[0],seq[2],seq[3]];
  await save({version:second.version,sequence:seq2});
  trip=(await readGroupagePlan(db,company,group)).viajes[0];assert.deepEqual(trip.paradas.map(s=>s.legacy_key),seq2);assert.equal(trip.ruta_calculada,null,'Changing route invalidates obsolete estimate');assert.deepEqual(trip.disposicion_carga,layout);
  assert.equal((await pg.query('SELECT count(*)::int n FROM viaje_plan_versiones')).rows[0].n,3);
  await assert.rejects(save({empresaId:crypto.randomUUID()}),{status:404});
  await assert.rejects(save({operationId:operation,confirm:false}),{code:'OPERATION_CONFLICT'});
  await pg.query("UPDATE pedidos SET estado='en_curso' WHERE id=$1",[a]);await assert.rejects(save({version:3}),{code:'GROUPAGE_CONFLICT'});
  console.log('PASS groupage plan: one parent/two commercial orders, complete shipments/stops, immutable plan history, sequence/layout independence, route invalidation, idempotence and tenant/version guards.');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

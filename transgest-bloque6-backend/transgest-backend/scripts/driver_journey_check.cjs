const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {saveGroupagePlan}=require('../src/services/groupagePlan');
const {saveStop}=require('../src/services/driverStops');
const {driverJourneyContext}=require('../src/services/driverJourney');
async function main(){
 const pg=new PGlite(),company=crypto.randomUUID(),group=crypto.randomUUID(),driver=crypto.randomUUID(),truck=crypto.randomUUID(),ids=[crypto.randomUUID(),crypto.randomUUID()];
 let injected=false;
 const db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(tx=>fn({query:(sql,args)=>{if(injected&&sql.startsWith('UPDATE choferes'))throw Error('injected');return tx.query(sql,args);}}))};
 try{
  await pg.exec(`CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,numero text,grupaje_id uuid,grupaje_borrador boolean,estado text,origen text,destino text,importe numeric,factura_id uuid,mercancia text,peso_kg numeric,bultos numeric,
    vehiculo_id uuid,chofer_id uuid,chofer2_id uuid,puntos_carga jsonb,puntos_descarga jsonb,firma_evidencia jsonb,carga_real_at timestamptz,descarga_real_at timestamptz,updated_at timestamptz,
    incidencia_descripcion text,incidencia_tipo text,incidencia_origen text,incidencia_creada_at timestamptz,incidencia_creada_por uuid);
    CREATE TABLE pedido_docs(id uuid,empresa_id uuid,pedido_id uuid,nombre text,tipo text,metadata jsonb,created_at timestamptz DEFAULT NOW());
    CREATE TABLE pedido_chofer_pasos(pedido_id uuid PRIMARY KEY,empresa_id uuid,chofer_id uuid,data jsonb,updated_at timestamptz);
    CREATE TABLE choferes(id uuid,empresa_id uuid,estado text); CREATE TABLE vehiculos(id uuid,empresa_id uuid);`);
  for(const file of ['20260926_operational_model.sql','20260926_operational_model_groupage.sql','20260926_operational_stop_events.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',file),'utf8'));
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260926_operational_stop_events.sql'),'utf8'));
  await pg.query("INSERT INTO choferes VALUES($1,$2,'disponible')",[driver,company]);
  await pg.query('INSERT INTO vehiculos VALUES($1,$2)',[truck,company]);
  for(const id of ids)await pg.query("INSERT INTO pedidos(id,empresa_id,numero,grupaje_id,estado,origen,destino,importe,mercancia,peso_kg,bultos,vehiculo_id,chofer_id) VALUES($1,$2,'SINTETICO',$3,'confirmado','A','B',250,'Sacos',100,2,$4,$5)",[id,company,group,truck,driver]);
  await pg.transaction(tx=>saveGroupagePlan(tx,{empresaId:company,grupajeId:group,operationId:crypto.randomUUID(),confirm:true}));
  const context=await driverJourneyContext(db,company,ids[0]),stops=context.paradas;
  assert.equal(stops.length,4);assert.equal(context.proxima_parada.id,stops[0].id);
  const send=(stop,patch,extra={})=>saveStop(db,{empresaId:company,pedidoId:stop.pedido_id,choferId:driver,actorId:driver,authorize:o=>o.chofer_id===driver,patch:{parada_id:stop.parada_legacy_id,client_operation_uuid:crypto.randomUUID(),...patch},...extra});
  await assert.rejects(send(stops[1],{carga_iniciada:true}),{code:'JOURNEY_STOP_SEQUENCE'});
  await assert.rejects(driverJourneyContext(db,company,ids[0],o=>o.id===ids[0]),{code:'JOURNEY_FORBIDDEN'});
  assert.equal(await driverJourneyContext(db,crypto.randomUUID(),ids[0]),null);
  const op=crypto.randomUUID(),arrival={carga_iniciada:true,carga_iniciada_at:'1999-01-01T00:00:00Z',observed_at:'2026-09-26T08:00:00Z',event_location:{lat:39.5,lng:-0.4},client_operation_uuid:op};
  injected=true;await assert.rejects(send(stops[0],arrival),/injected/);injected=false;
  assert.equal((await pg.query('SELECT count(*)::int n FROM chofer_parada_operaciones')).rows[0].n,0);
  const first=await send(stops[0],arrival),retry=await send(stops[0],arrival);
  assert.equal(retry.idempotent,true);assert.deepEqual(first.data,retry.data);
  assert.notEqual(first.data.paradas[stops[0].parada_legacy_id].carga_iniciada_at,arrival.carga_iniciada_at,'The device cannot write server timestamps');
  await assert.rejects(send(stops[0],{...arrival,carga_proceso:true}),{code:'OPERATION_CONFLICT'});
  await assert.rejects(send(stops[0],{carga_proceso:true,event_location:{lat:100,lng:0}}),{code:'STOP_LOCATION_INVALID'});
  const incident={incidencia_parada:'Muelle ocupado sintético',client_operation_uuid:crypto.randomUUID()};
  await send(stops[0],incident);await send(stops[0],incident);
  assert.equal((await pg.query('SELECT incidencias FROM viaje_paradas WHERE id=$1',[stops[0].id])).rows[0].incidencias.length,1);
  await pg.query("INSERT INTO pedido_docs(id,empresa_id,pedido_id,nombre,tipo,metadata) VALUES($1,$2,$3,'Albarán sintético','albaran_carga',$4)",[crypto.randomUUID(),company,stops[0].pedido_id,JSON.stringify({parada_id:stops[0].parada_legacy_id})]);
  for(const [i,stop] of stops.entries()){
   const load=stop.tipo==='carga';
   if(i!==0)await send(stop,{[load?'carga_iniciada':'posicionado_descarga']:true});
   await send(stop,{[load?'carga_proceso':'descarga_iniciada']:true});
   await send(stop,{mercancia_confirmada:true,mercancia_cargada:'Sacos',mercancia_palets:2,mercancia_peso_kg:100});
   if(!load)await send(stop,{descarga_ok:true});
   await send(stop,{[load?'albaran_carga':'albaran_descarga']:true});
   await pg.query("UPDATE pedidos SET firma_evidencia=jsonb_set(COALESCE(firma_evidencia,'{}'),'{paradas}',COALESCE(firma_evidencia->'paradas','{}')||$2::jsonb) WHERE id=$1",[stop.pedido_id,JSON.stringify({[stop.parada_legacy_id]:{firma:{hash:'synthetic-signature-'+i}}})]);
   await send(stop,{[load?'firma_cargador':'firma_entrega']:true});
   if(load)await send(stop,{carga_ok:true});
   const updated=await driverJourneyContext(db,company,ids[0]);
   assert.equal(updated.paradas[i].completa,true);assert.equal(updated.proxima_parada?.id,stops[i+1]?.id);
   assert.ok(updated.paradas[i].espera_min>=0&&updated.paradas[i].duracion_min>=0);
   assert.equal((await pg.query('SELECT estado FROM choferes WHERE id=$1',[driver])).rows[0].estado,i===3?'disponible':load?'carga':'en_ruta');
   if(load)assert.equal((await pg.query('SELECT estado FROM pedidos WHERE id=$1',[stop.pedido_id])).rows[0].estado,'cargado','loading does not imply departure');
  }
  assert.equal((await pg.query('SELECT estado FROM viajes_operativos')).rows[0].estado,'entregado');
  assert.equal((await pg.query("SELECT count(*)::int n FROM viaje_paradas WHERE estado='finalizada'")).rows[0].n,4);
  assert.equal((await pg.query('SELECT documentos FROM viaje_paradas WHERE id=$1',[stops[0].id])).rows[0].documentos.length,1);
  assert.ok((await pg.query('SELECT evidencias FROM viaje_paradas WHERE id=$1',[stops[0].id])).rows[0].evidencias[0].firma_hash);
  assert.equal((await pg.query('SELECT count(*)::int n FROM pedidos WHERE estado=\'entregado\'')).rows[0].n,2);
  assert.equal((await pg.query('SELECT count(*)::int n FROM chofer_parada_operaciones WHERE client_operation_uuid=$1',[op])).rows[0].n,1);
  await assert.rejects(send(stops[0],{carga_iniciada:true},{authorize:()=>false}),{code:'DRIVER_ASSIGNMENT_CHANGED'});
  console.log('PASS journey driver: 4 ordered stops, same-trip siblings, independent goods/events/signatures, server timestamps/GPS, waits/duration, UUID replay/conflict, rollback and tenant/driver isolation.');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

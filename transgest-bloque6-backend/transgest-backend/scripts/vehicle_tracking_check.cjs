const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite'),tracking=require('../src/services/vehicleTracking');
async function main(){
 const pg=new PGlite(),company=crypto.randomUUID(),id=crypto.randomUUID(),vehicle=crypto.randomUUID();
 const db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(fn)};
 try{
  await pg.exec(`CREATE TABLE pedidos(id UUID PRIMARY KEY,empresa_id UUID,vehiculo_id UUID,estado text,fecha_carga date,origen text,destino text,puntos_carga jsonb,puntos_descarga jsonb);
   CREATE TABLE vehiculos(id UUID PRIMARY KEY,empresa_id UUID,ubicacion_actual text,ubicacion_fuente text,ubicacion_ts timestamptz,gps_lat numeric,gps_lng numeric,km_actuales numeric);
   CREATE TABLE pedido_chofer_pasos(empresa_id UUID,pedido_id UUID,data jsonb);`);
  for(const name of ['20260926_operational_model.sql','20260926_operational_model_groupage.sql','20260926_vehicle_tracking.sql'])await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260926_vehicle_tracking.sql'),'utf8'));
  await pg.query("INSERT INTO pedidos VALUES($1,$2,$3,'confirmado',CURRENT_DATE,'Madrid','Valencia',$4,'[]')",[id,company,vehicle,JSON.stringify([{id:'load',nombre:'Almacén sintético',lat:40,lng:-3}])]);
  await pg.query('INSERT INTO vehiculos(id,empresa_id) VALUES($1,$2)',[vehicle,company]);
  const order=(await pg.query('SELECT * FROM pedidos')).rows[0],now=Date.now();
  const input=(offset,lat)=>({lat,lng:-3,recorded_at:new Date(now+offset).toISOString(),accuracy_m:5,heading:90,velocidad_kmh:30});
  const args={empresaId:company,vehiculoId:vehicle,provider:'app_chofer'};
  for(const invalid of [{lat:null,lng:0},{lat:'',lng:0},{lat:91,lng:0},{...input(360000,40)},{...input(0,40),recorded_at:'bad'}])assert.throws(()=>tracking.position(invalid),{code:'TRACKING_INVALID'});
  await assert.rejects(tracking.record(db,{...args,empresaId:crypto.randomUUID(),input:input(0,40)}),{code:'VEHICLE_NOT_FOUND'});
  const outside=input(-4000,40.005),inside=input(-3000,40.0001),jitter=input(-2000,40.0014),exit=input(-1000,40.003);
  await tracking.record(db,{...args,input:outside});await tracking.record(db,{...args,input:inside});
  const arrival=await tracking.snapshot(db,company,order);assert.equal(arrival.status,'reciente');assert.equal(arrival.arrival.event,'entrada');assert.equal(arrival.position.heading,90);
  assert.equal((await tracking.record(db,{...args,input:inside})).idempotent,true);
  await tracking.record(db,{...args,input:jitter});await tracking.record(db,{...args,input:exit});await tracking.record(db,{...args,input:input(-3500,40.0001)});
  const events=(await pg.query('SELECT event FROM tracking_geofence_events ORDER BY observed_at')).rows;assert.deepEqual(events.map(e=>e.event),['entrada','salida']);
  assert.equal((await pg.query('SELECT gps_lat FROM vehiculos')).rows[0].gps_lat,'40.003');
  assert.equal((await pg.query('SELECT estado FROM pedidos')).rows[0].estado,'confirmado');
  const after=await tracking.snapshot(db,company,order);assert.equal(after.arrival,null);
  const stale=await tracking.snapshot(db,company,order,now+360000);assert.equal(stale.status,'obsoleta');assert.equal(stale.position,null);assert.equal(stale.distance_straight_m,null);
  await assert.rejects(tracking.snapshot(db,crypto.randomUUID(),order),{code:'ORDER_NOT_FOUND'});
  const missing=await tracking.snapshot(db,company,{...order,vehiculo_id:crypto.randomUUID()});assert.equal(missing.status,'sin_datos');assert.equal(missing.position,null);
  const stopped=await tracking.snapshot(db,company,{...order,estado:'entregado'});assert.equal(stopped.position,null);
  assert.throws(()=>tracking.configuration({stale_seconds:1}),{code:'TRACKING_INVALID'});
  await assert.rejects(tracking.saveConfiguration(db,company,id,{stops:{bad:{radius_m:100,hysteresis_m:30}}},null),{code:'TRACKING_INVALID'});
  const stop=require('../src/services/driverStops').driverStops(order)[0];
  await tracking.saveConfiguration(db,company,id,{stale_seconds:90,stops:{[stop.id]:{radius_m:200,hysteresis_m:75}}},null);
  assert.equal((await tracking.snapshot(db,company,order)).stale_seconds,90);
  const eta=tracking.roadEta({...after,next_stop:{window_end_at:new Date(now+1000000).toISOString()}},{provider:'ors_hgv',duration_min:30,km:20,truck_aware:true});assert.equal(eta.status,'estimado');assert.ok(eta.delay_minutes>0);
  assert.equal(tracking.roadEta(after,{provider:'estimated',duration_min:30,km:20}).value,null);
  assert.equal(tracking.roadEta(stale,{provider:'osrm',duration_min:30,km:20}).value,null);
  assert.equal(tracking.transition(null,10,150,50,null),null);assert.equal(tracking.transition(null,10,150,50,500),null);
  await tracking.record(db,{...args,input:{lat:40,lng:-3}});
  const unknownCapture=await tracking.snapshot(db,company,order);assert.equal(unknownCapture.status,'captura_sin_fecha');assert.equal(unknownCapture.position,null);assert.equal(unknownCapture.arrival,null);
  console.log('PASS tracking: coordinate/time validation, no stale overwrite, deduplication, tenant, vehicle changes, stale/missing data, road-only ETA, explicit windows, geofence hysteresis/accuracy and audit without completing stops.');
 }finally{await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

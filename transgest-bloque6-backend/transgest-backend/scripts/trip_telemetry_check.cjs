const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const telemetry=require('../src/services/vehicleTelemetry'),math=require('../src/services/tripTelemetryMath'),trips=require('../src/services/tripTelemetry');
const company='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',vehicle='33333333-3333-4333-8333-333333333333';
const previous='44444444-4444-4444-8444-444444444444',orderId='55555555-5555-4555-8555-555555555555';
const clock=Date.now();
const stamp=n=>new Date(clock-86400000+n*60000).toISOString();
async function httpAccess(db){
 const express=require('express'),sharedDb=require('../src/services/db'),auth=require('../src/middleware/auth');
 const original={query:sharedDb.query,transaction:sharedDb.transaction,authenticate:auth.authenticate};
 let server,driverAssigned=true;
 sharedDb.query=async(sql,params)=>{
  if(sql.includes('FROM choferes'))return {rows:[{id:'driver',vehiculo_id:driverAssigned?vehicle:null}]};
  return db.query(sql,params);
 };
 sharedDb.transaction=db.transaction;
 auth.authenticate=(req,res,next)=>{
  if(!req.headers['x-fixture-role'])return res.status(401).json({error:'Local fixture unauthenticated'});
  req.user={rol:req.headers['x-fixture-role'],id:'user',chofer_id:'driver',empresa_id:req.headers['x-fixture-company']||company};next();
 };
 try{
  const app=express();app.use(express.json());app.use('/pedidos',require('../src/routes/pedidos'));
  server=await new Promise(resolve=>{const service=app.listen(0,'127.0.0.1',()=>resolve(service));});
  const base=`http://127.0.0.1:${server.address().port}/pedidos/${orderId}/telemetry`;
  const request=(role,tenant=company,method='GET')=>fetch(base+'?empresa_id='+other,{method,headers:{...(role?{'x-fixture-role':role}:{}),'x-fixture-company':tenant,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify({empresa_id:other})}:{})});
  assert.equal((await request(null)).status,401);
  assert.equal((await request('gerente',other)).status,404);
  assert.equal((await request('cliente')).status,403);
  assert.equal((await request('chofer',company,'POST')).status,403);
  const own=await request('gerente');assert.equal(own.status,200);assert.match(own.headers.get('cache-control'),/no-store/);
  assert.equal((await own.json()).can_request,true);
  assert.equal((await request('chofer')).status,200);
  driverAssigned=false;assert.equal((await request('chofer')).status,403);
  assert.equal((await request('trafico',other,'POST')).status,404);
  assert.equal((await request('trafico',company,'POST')).status,202);
 }finally{
  sharedDb.query=original.query;sharedDb.transaction=original.transaction;auth.authenticate=original.authenticate;
  if(server)await new Promise(resolve=>server.close(resolve));
 }
}
async function main(){
 const pg=new PGlite(),db={query:(...args)=>pg.query(...args),transaction:fn=>pg.transaction(fn)};
 try{
  assert.equal(telemetry.classify({id:'DiagnosticOdometerId'}).scale,.001);
  assert.equal(telemetry.classify({id:'DiagnosticOutsideTemperatureId',name:'Outside temperature',unitOfMeasure:{id:'UnitOfMeasureDegreesCelsiusId'}}),null);
  assert.equal(telemetry.classify({id:'ThermographTemperature1Id',unitOfMeasure:{id:'UnitOfMeasureDegreesCelsiusId'}}).metric,'frigo_temperature_c');
  assert.equal(telemetry.classify({id:'unknown',name:'Engine temperature',controller:{id:'ControllerCargoRefrigerationHeatingTrailerId'},unitOfMeasure:{id:'UnitOfMeasureDegreesCelsiusId'}}),null);
  const samples=telemetry.geotabSamples([{device:{id:'b1'},statusData:[{data:500000000,dateTime:stamp(0),diagnostic:{id:'DiagnosticOdometerId'}},{data:null,dateTime:stamp(0),diagnostic:{id:'DiagnosticTotalFuelUsedId'}}]}]);
  assert.equal(samples.length,1);assert.equal(samples[0].value,500000);assert.equal(samples[0].quality,'measured');
  assert.equal(telemetry.geotabSamples([{device:{id:'b1'},statusData:[{data:1,dateTime:stamp(0),diagnostic:{id:'DiagnosticOdometerId'}}]}],[],Date.now(),true)[0].quality,'interpolated');
  const readings=[0,60,120].flatMap((n,i)=>[
   {metric:'odometer_km',sensor:'odo',provider:'geotab',unit:'km',value:1000+i*50,recorded_at:stamp(n),quality:'measured'},
   {metric:'fuel_total_l',sensor:'fuel',provider:'geotab',unit:'l',value:500+i*15,recorded_at:stamp(n),quality:'measured'}]);
  assert.equal(math.counterDelta(readings,'odometer_km',Date.parse(stamp(0)),Date.parse(stamp(60))).value,50);
  assert.equal(math.counterDelta(readings.map(r=>({...r,quality:'interpolated'})),'odometer_km',Date.parse(stamp(0)),Date.parse(stamp(60))).quality,'estimated');
  assert.equal(math.counterDelta(readings.filter(r=>r.metric==='odometer_km').map((r,i)=>({...r,value:i===1?0:r.value})),'odometer_km',Date.parse(stamp(0)),Date.parse(stamp(120))),null,'Counter resets are never summed');
  const gap=math.trace([{lat:38,lng:-1,recorded_at:stamp(60)},{lat:38.01,lng:-1,recorded_at:stamp(61)},{lat:39,lng:-1,recorded_at:stamp(120)}],Date.parse(stamp(60)),Date.parse(stamp(120)));
  assert.equal(gap.gaps,1);assert.equal(gap.distance.quality,'partial');assert.equal(gap.segments[0].length,2);
  const data={order:{},context:{vehicle_id:vehicle,provider:'geotab',load_at:stamp(60),unload_at:stamp(120)},previous:{id:previous,descarga_real_at:stamp(0)},samples:readings};
  assert.equal(math.summarize(data).empty.distance.value,50);
  assert.equal(math.summarize({...data,overlap:true}).empty,null);
  assert.equal(math.summarize({...data,shared:true}).empty,null);
  await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);
   CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,gps_provider text,gps_external_id text,km_actuales numeric,updated_at timestamptz);
   CREATE TABLE pedidos(id uuid,empresa_id uuid,vehiculo_id uuid,colaborador_id uuid,estado text,carga_real_at timestamptz,descarga_real_at timestamptz,km_vacio numeric DEFAULT 0,origen text,destino text,remolque_id uuid,PRIMARY KEY(empresa_id,id));
   CREATE TABLE vehiculo_km_vacio(empresa_id uuid,vehiculo_id uuid,fecha date,km_vacio numeric,origen text,destino text,motivo text,notas text);
   CREATE TABLE empresa_api_configs(empresa_id uuid,provider text,activo boolean);
   CREATE TABLE gps_position_log(id uuid DEFAULT gen_random_uuid(),empresa_id uuid,vehiculo_id uuid,provider text,external_id text,lat numeric,lng numeric,velocidad_kmh numeric,raw jsonb,recorded_at timestamptz,ingestion_key text);
   CREATE UNIQUE INDEX gps_position_ingestion ON gps_position_log(empresa_id,ingestion_key) WHERE ingestion_key IS NOT NULL;`);
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20261003_gps_trip_telemetry.sql'),'utf8'));
  await pg.query('INSERT INTO empresas VALUES($1)',[company]);
  await pg.query("INSERT INTO vehiculos VALUES($1,$2,'geotab','b1',NULL,NOW())",[vehicle,company]);
  await pg.query("INSERT INTO empresa_api_configs VALUES($1,'geotab',true)",[company]);
  await pg.query("INSERT INTO pedidos(id,empresa_id,vehiculo_id,colaborador_id,estado,carga_real_at,descarga_real_at,km_vacio) VALUES($1,$2,$3,NULL,'confirmado',$4,$5,0)",[previous,company,vehicle,stamp(-60),stamp(0)]);
  await pg.query("UPDATE pedidos SET estado='entregado' WHERE id=$1",[previous]);
  await pg.query("DELETE FROM pedido_telemetry_reports WHERE pedido_id=$1",[previous]); // disposable local fixture
  await pg.query("INSERT INTO pedidos(id,empresa_id,vehiculo_id,colaborador_id,estado,carga_real_at,descarga_real_at,km_vacio) VALUES($1,$2,$3,NULL,'confirmado',$4,$5,0)",[orderId,company,vehicle,stamp(60),stamp(120)]);
  await pg.query("UPDATE pedidos SET estado='entregado' WHERE id=$1",[orderId]);
  const queued=(await trips.read(db,company,orderId));assert.equal(queued.status,'pending');assert.equal(queued.data.context.external_id,'b1');
  const dependencies={resolveKey:async()=>({key:'synthetic'}),assertUsage:async()=>{},recordUsage:async()=>{},fetchHistory:async()=>({positions:[{id:'gps1',latitude:38,longitude:-1,dateTime:stamp(60),speed:0},{id:'gps2',latitude:38.01,longitude:-1,dateTime:stamp(61),speed:20}],samples:readings,warnings:[],requests:4})};
  assert.equal(await trips.drain(db,dependencies),true);
  const report=await trips.read(db,company,orderId);assert.equal(report.status,'ready');assert.equal(report.data.loaded.distance.value,50);assert.equal(report.data.loaded.fuel.value,15);assert.equal(report.data.empty.applied,true);
  assert.equal(Number((await pg.query('SELECT km_vacio FROM pedidos WHERE id=$1',[orderId])).rows[0].km_vacio),50);
  assert.equal((await pg.query('SELECT * FROM vehiculo_km_vacio')).rows.length,1,'Empty km registered in vehicle ledger');
  assert.equal((await trips.read(db,other,orderId)).status,'not_requested');
  await assert.rejects(trips.request(db,other,orderId),{status:404});
  assert.equal(await trips.drain(db,dependencies),false,'Idempotent close job');
  await pg.query("UPDATE pedidos SET estado='facturado' WHERE id=$1",[orderId]);assert.equal((await trips.read(db,company,orderId)).status,'ready','Billing does not duplicate a completed report');
  await pg.query('UPDATE pedidos SET km_vacio=75 WHERE id=$1',[orderId]);await trips.request(db,company,orderId);await trips.drain(db,dependencies);
  assert.equal(Number((await pg.query('SELECT km_vacio FROM pedidos WHERE id=$1',[orderId])).rows[0].km_vacio),75,'Manual empty kilometres preserved');
  await telemetry.store(db,{empresaId:company,vehiculoId:vehicle,provider:'geotab',externalId:'b1',samples:[{metric:'odometer_km',sensor:'odo',value:999,unit:'km',recorded_at:stamp(-1),quality:'measured'}]});
  assert.equal(Number((await pg.query('SELECT km_actuales FROM vehiculos WHERE id=$1',[vehicle])).rows[0].km_actuales),1100,'Old odometer never lowers vehicle mileage');
  assert.equal((await pg.query('SELECT * FROM vehiculo_km_vacio')).rows.length,1,'Repeated report does not duplicate empty km ledger');
  await pg.query("UPDATE vehiculos SET gps_provider='locatel',gps_external_id='changed' WHERE id=$1",[vehicle]);
  await trips.request(db,company,orderId);
  assert.equal((await trips.read(db,company,orderId)).data.context.external_id,'b1','A recovered report retains the GPS assigned at closing');
  await trips.drain(db,dependencies);
  await httpAccess(db);
  await trips.drain(db,dependencies);
  await pg.query("UPDATE vehiculos SET gps_provider='geotab',gps_external_id='b1' WHERE id=$1",[vehicle]);
  const trailerId='66666666-6666-4666-8666-666666666666';
  await pg.query("INSERT INTO vehiculos VALUES($1,$2,'geotab','frigo',NULL,NOW())",[trailerId,company]);
  await pg.query('UPDATE pedidos SET remolque_id=$2 WHERE id=$1',[orderId,trailerId]);
  await trips.drain(db,{...dependencies,fetchHistory:async(secret,deviceId,...args)=>deviceId==='frigo'?{positions:[],warnings:[],samples:[{metric:'frigo_temperature_c',sensor:'probe',unit:'°C',value:-18,quality:'measured',recorded_at:stamp(90)}]}:dependencies.fetchHistory(secret,deviceId,...args)});
  const coldReport=await trips.read(db,company,orderId);
  assert.equal(coldReport.data.temperatures[0].min_c,-18,'Assigned trailer contributes cargo temperature');
  assert.equal(coldReport.data.loaded.distance.value,50,'Trailer sensors cannot replace tractor mileage');
  await telemetry.store(db,{empresaId:company,vehiculoId:vehicle,provider:'geotab',externalId:'b1',samples:[{...readings[0],value:1,quality:'interpolated'}]});
  assert.equal(Number((await pg.query("SELECT value FROM vehicle_telemetry_log WHERE vehiculo_id=$1 AND metric='odometer_km' AND recorded_at=$2",[vehicle,stamp(0)])).rows[0].value),1000,'Interpolation never overwrites an actual reading');
  await trips.request(db,company,orderId);await trips.drain(db,{...dependencies,fetchHistory:async()=>{throw Error('Synthetic provider offline');}});
  assert.equal((await trips.read(db,company,orderId)).status,'retry');assert.equal((await pg.query('SELECT estado FROM pedidos WHERE id=$1',[orderId])).rows[0].estado,'facturado','GPS errors do not prevent closing/billing');
  await pg.query('DELETE FROM pedidos WHERE id=$1',[orderId]);assert.equal((await trips.read(db,company,orderId)).status,'not_requested','Deleting an order removes its report');
  await pg.query('DELETE FROM empresas WHERE id=$1',[company]);assert.equal((await pg.query('SELECT * FROM vehicle_telemetry_log')).rows.length,0,'Deleting a company removes its telemetry');
  console.log('Telemetría: unidades, sensores frigo, huecos, contadores, SQL, cierre automático, aislamiento, idempotencia y reintentos correctos.');
 }finally{await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

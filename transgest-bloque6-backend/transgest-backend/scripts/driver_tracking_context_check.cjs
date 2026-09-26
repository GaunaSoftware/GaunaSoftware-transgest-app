const assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {driverTrackingContext}=require('../src/services/driverTrackingContext');
(async()=>{
 const db=new PGlite();try{
  await db.exec(`CREATE TABLE chofer_jornadas(id text,empresa_id text,chofer_id text,estado text,actividad_actual text,inicio_at timestamptz);
   CREATE TABLE vehiculos(id text,empresa_id text,activo boolean);
   CREATE TABLE gps_position_log(empresa_id text,vehiculo_id text,provider text,raw jsonb,lat numeric,lng numeric,recorded_at timestamptz);
   CREATE TABLE pedidos(id text,empresa_id text,chofer_id text,vehiculo_id text,estado text);
   INSERT INTO vehiculos VALUES('truck','a',true),('foreign','b',true);
   INSERT INTO chofer_jornadas VALUES('day','a','driver','abierta','conduccion',NOW());
   INSERT INTO pedidos VALUES('own','a','driver','truck','en_curso'),('foreign','b','driver','truck','en_curso'),('done','a','driver','truck','entregado');`);
  const args={empresaId:'a',chofer:{id:'driver',vehiculo_id:'truck'}};
  let context=await driverTrackingContext(db,args);assert.equal(context.allowed,true);assert.equal(context.lease_seconds,120);assert.deepEqual(context.active_trip_ids,['own']);
  assert.equal((await driverTrackingContext(db,{...args,empresaId:'b'})).allowed,false);
  assert.equal((await driverTrackingContext(db,{...args,chofer:{...args.chofer,vehiculo_id:'foreign'}})).allowed,false);
  assert.equal((await driverTrackingContext(db,{...args,chofer:{...args.chofer,activo:false}})).allowed,false);
  await db.exec("UPDATE chofer_jornadas SET actividad_actual='pausa'");assert.equal((await driverTrackingContext(db,args)).reason,'jornada_pausada');
  await db.exec("UPDATE chofer_jornadas SET actividad_actual='conduccion'; INSERT INTO gps_position_log VALUES('a','truck','external','{}',40,-3,NOW())");assert.equal((await driverTrackingContext(db,args)).allowed,true,'Receipt time alone must not suppress the mobile GPS');
  await db.exec(`UPDATE gps_position_log SET raw='{"timestamp_source":"device"}'`);assert.equal((await driverTrackingContext(db,args)).reason,'gps_externo_reciente');
  await db.exec("UPDATE gps_position_log SET recorded_at=NOW()-INTERVAL '10 minutes'");assert.equal((await driverTrackingContext(db,args)).allowed,true);
  await db.exec("UPDATE chofer_jornadas SET estado='cerrada'");assert.equal((await driverTrackingContext(db,args)).reason,'jornada_cerrada');
  console.log('PASS native tracking context: tenant/vehicle/driver isolation, workday pause/closure, short lease, completed trips and verified external GPS.');
 }finally{await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

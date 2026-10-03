const {positionSource}=require('./gpsSource');
const {summarize}=require('./tripTelemetryMath');
const {hash,canonical}=require('./transportDocumentVersions');
const closed=order=>['entregado','facturado'].includes(order.estado)&&order.vehiculo_id&&!order.colaborador_id;
const time=value=>value==null?NaN:value instanceof Date?value.getTime():Date.parse(value);
async function request(db,company,orderId) {
 const order=(await db.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2',[company,orderId])).rows[0];
 if(!order)throw Object.assign(Error('Pedido no encontrado.'),{status:404});
 if(!closed(order))throw Object.assign(Error('El resumen se recupera al cerrar un viaje propio con vehículo asignado.'),{status:409});
 const vehicle=(await db.query('SELECT * FROM vehiculos WHERE empresa_id=$1 AND id=$2',[company,order.vehiculo_id])).rows[0];
 if(!vehicle)throw Object.assign(Error('Vehículo no encontrado.'),{status:404});
 const captured=(await read(db,company,orderId)).data?.context;
 const sameWindow=captured?.vehicle_id===vehicle.id&&(captured.trailer_id||null)===(order.remolque_id||null)&&time(captured.load_at)===time(order.carga_real_at)&&time(captured.unload_at)===time(order.descarga_real_at);
 const trailer=order.remolque_id?(await db.query('SELECT id,gps_provider,gps_external_id FROM vehiculos WHERE empresa_id=$1 AND id=$2',[company,order.remolque_id])).rows[0]:null;
 const context=sameWindow?captured:{vehicle_id:vehicle.id,provider:positionSource(vehicle),external_id:vehicle.gps_external_id,
  load_at:order.carga_real_at,unload_at:order.descarga_real_at,trailer_id:order.remolque_id||null,
  trailer:trailer&&positionSource(trailer)!=='app_chofer'?{vehicle_id:trailer.id,provider:positionSource(trailer),external_id:trailer.gps_external_id}:null};
 await db.query(`INSERT INTO pedido_telemetry_reports(empresa_id,pedido_id,data) VALUES($1,$2,$3)
  ON CONFLICT(empresa_id,pedido_id) DO UPDATE SET data=EXCLUDED.data,status='pending',attempts=0,available_at=NOW(),requested_at=NOW(),updated_at=NOW()
  WHERE pedido_telemetry_reports.status NOT IN ('processing','pending')`,[company,orderId,JSON.stringify({context})]);
 return {status:'pending'};
}
async function read(db,company,orderId) {
 const row=(await db.query('SELECT status,data,updated_at FROM pedido_telemetry_reports WHERE empresa_id=$1 AND pedido_id=$2',[company,orderId])).rows[0];
 return row||{status:'not_requested',data:null};
}
async function calculate(db,job,{fetchHistory,resolveKey,recordUsage,assertUsage}={}) {
 const company=job.empresa_id,order=(await db.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2',[company,job.pedido_id])).rows[0];
 if(!order||!closed(order))return {warnings:['El pedido ya no está cerrado o no tiene vehículo propio.'],loaded:null};
 const context={...job.data?.context,provider:job.data?.context?.provider||'app_chofer'};
 if(!context?.vehicle_id)throw Error('Falta la asignación del vehículo en el cierre. Solicita recuperar de nuevo.');
 const provider=context.provider||'app_chofer',end=time(context.unload_at),start=time(context.load_at);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>=end)return summarize({order,context});
 const previous=(await db.query(`SELECT id,destino,descarga_real_at FROM pedidos WHERE empresa_id=$1 AND vehiculo_id=$2 AND id<>$3
  AND estado::text IN ('entregado','facturado') AND descarga_real_at<$4 AND colaborador_id IS NULL
  ORDER BY descarga_real_at DESC LIMIT 1`,[company,context.vehicle_id,order.id,context.load_at])).rows[0];
 const from=previous&&end-time(previous.descarga_real_at)<=31*86400000-600000?time(previous.descarga_real_at):start;
 const overlap=(await db.query(`SELECT id FROM pedidos WHERE empresa_id=$1 AND vehiculo_id=$2 AND id<>$3 AND id<>COALESCE($4::uuid,$3)
   AND estado::text<>'cancelado' AND carga_real_at<$5 AND (descarga_real_at IS NULL OR descarga_real_at>$6) LIMIT 1`,
   [company,context.vehicle_id,order.id,previous?.id||null,context.load_at,new Date(from).toISOString()])).rows.length>0;
 const hasGraph=(await db.query("SELECT to_regclass('public.viaje_pedidos') AS name")).rows[0]?.name;
 const shared=hasGraph?(await db.query(`SELECT 1 FROM viaje_pedidos a JOIN viaje_pedidos b ON b.empresa_id=a.empresa_id AND b.viaje_id=a.viaje_id
   WHERE a.empresa_id=$1 AND a.pedido_id=$2 AND b.pedido_id<>a.pedido_id LIMIT 1`,[company,order.id])).rows.length>0:false;
 const warnings=[];
 if(provider==='geotab'&&context.external_id){
  const {resolveApiKey,recordApiUsage,assertApiUsageAllowed}=require('./apiKeys');
  const resolved=await (resolveKey||resolveApiKey)(company,'geotab');
  if(!resolved.key)throw Error('No se puede recuperar Geotab: conector desactivado, sin credencial o sin cuota.');
  const enabled=(await db.query("SELECT activo FROM empresa_api_configs WHERE empresa_id=$1 AND provider='geotab'",[company])).rows[0]?.activo;
  if(!enabled)throw Error('El conector Geotab está desactivado para esta empresa.');
  const beforeCall=async()=>{await (assertUsage||assertApiUsageAllowed)(company,'geotab');await (recordUsage||recordApiUsage)(company,'geotab',1);};
  const history=await (fetchHistory||require('./geotabGps').history)(resolved.key,context.external_id,new Date(from-300000).toISOString(),new Date(Math.min(end+300000,Date.now())).toISOString(),undefined,beforeCall);
  if(history.positions.length>100000||history.samples.length>100000)throw Error('Historial demasiado extenso para calcularlo sin truncar.');
  const logs=[];
  for(const p of history.positions){
   const lat=p.latitude==null?NaN:Number(p.latitude),lng=p.longitude==null?NaN:Number(p.longitude),at=Date.parse(p.dateTime);
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(at)||at>Date.now()+60000)continue;
   const key=hash(canonical({company,vehicle:context.vehicle_id,provider,external:context.external_id,id:p.id}));
   logs.push({lat,lng,velocidad_kmh:p.speed!=null&&Number.isFinite(Number(p.speed))?Number(p.speed):null,
     recorded_at:new Date(at).toISOString(),ingestion_key:key});
  }
  for(let offset=0;offset<logs.length;offset+=1000)await db.query(`INSERT INTO gps_position_log(empresa_id,vehiculo_id,provider,external_id,lat,lng,velocidad_kmh,raw,recorded_at,ingestion_key)
    SELECT $1,$2,$3,$4,lat,lng,velocidad_kmh,'{"source":"geotab_history","timestamp_source":"device"}'::jsonb,recorded_at,ingestion_key
    FROM jsonb_to_recordset($5::jsonb) AS captures(lat numeric,lng numeric,velocidad_kmh numeric,recorded_at timestamptz,ingestion_key text)
    ON CONFLICT(empresa_id,ingestion_key) WHERE ingestion_key IS NOT NULL DO NOTHING`,
    [company,context.vehicle_id,provider,context.external_id,JSON.stringify(logs.slice(offset,offset+1000))]);
  await require('./vehicleTelemetry').store(db,{empresaId:company,vehiculoId:context.vehicle_id,provider,externalId:context.external_id,samples:history.samples});
  warnings.push(...history.warnings||[]);
 }
 const [positions,samples]=await Promise.all([
  db.query(`SELECT lat,lng,recorded_at,raw FROM gps_position_log WHERE empresa_id=$1 AND vehiculo_id=$2 AND provider=$3
    AND (external_id=$4 OR $3='app_chofer') AND recorded_at BETWEEN $5 AND $6 AND raw->>'timestamp_source'='device'
    ORDER BY recorded_at LIMIT 100001`,[company,context.vehicle_id,provider,context.external_id,new Date(from-300000).toISOString(),new Date(end+300000).toISOString()]),
  db.query(`SELECT metric,sensor,value,unit,recorded_at,quality,label,provider FROM vehicle_telemetry_log WHERE empresa_id=$1 AND vehiculo_id=$2
    AND provider=$3 AND external_id IS NOT DISTINCT FROM $4 AND recorded_at BETWEEN $5 AND $6 ORDER BY recorded_at LIMIT 100001`,
   [company,context.vehicle_id,provider,context.external_id||'',new Date(from-300000).toISOString(),new Date(end+300000).toISOString()])]);
 if(positions.rows.length>100000||samples.rows.length>100000)throw Error('Historial demasiado extenso: no se ha calculado un resumen truncado.');
 const report=summarize({order,context,previous:from===start?null:previous,positions:positions.rows,samples:samples.rows,overlap,shared});
 // A refrigerator's own GPS may be attached to the assigned trailer. Its
 // sensors supplement cargo temperatures, never the tractor's distance/fuel.
 if(context.trailer?.vehicle_id&&context.trailer.vehicle_id!==context.vehicle_id){
  const trailer=context.trailer;
  try{
   if(trailer.provider==='geotab'&&trailer.external_id){
    const keys=require('./apiKeys'),resolved=await (resolveKey||keys.resolveApiKey)(company,'geotab');
    const enabled=(await db.query("SELECT activo FROM empresa_api_configs WHERE empresa_id=$1 AND provider='geotab'",[company])).rows[0]?.activo;
    if(!enabled||!resolved.key)throw Error('Conector del remolque no disponible');
    const beforeCall=async()=>{await (assertUsage||keys.assertApiUsageAllowed)(company,'geotab');await (recordUsage||keys.recordApiUsage)(company,'geotab',1);};
    const history=await (fetchHistory||require('./geotabGps').history)(resolved.key,trailer.external_id,new Date(start).toISOString(),new Date(end).toISOString(),undefined,beforeCall,{metrics:['frigo_temperature_c'],includePositions:false});
    await require('./vehicleTelemetry').store(db,{empresaId:company,vehiculoId:trailer.vehicle_id,provider:trailer.provider,externalId:trailer.external_id,samples:history.samples.filter(s=>s.metric==='frigo_temperature_c')});
    warnings.push(...history.warnings||[]);
   }
   const temps=(await db.query(`SELECT * FROM vehicle_telemetry_log WHERE empresa_id=$1 AND vehiculo_id=$2 AND provider=$3
     AND external_id IS NOT DISTINCT FROM $4 AND metric='frigo_temperature_c' AND recorded_at BETWEEN $5 AND $6 ORDER BY recorded_at LIMIT 100001`,
    [company,trailer.vehicle_id,trailer.provider,trailer.external_id||'',context.load_at,context.unload_at])).rows;
   if(temps.length>100000)throw Error('Historial de temperaturas demasiado extenso');
   const supplemental=summarize({order,context,samples:temps});
   report.temperatures.push(...supplemental.temperatures.map(t=>({...t,sensor:`trailer:${t.sensor}`,label:`Remolque · ${t.label}`})));
  }catch(error){warnings.push('No se pudo recuperar la temperatura del remolque. Puedes volver a solicitar el resumen.');}
 }
 report.warnings.push(...warnings);
 // Preserve planned route kilometres and any manually entered empty kilometres.
 if(report.empty?.distance?.quality==='measured'&&report.empty.distance.method==='odometer'){
  report.empty.applied=await db.transaction(async tx=>{
  const result=await tx.query(`UPDATE pedidos SET km_vacio=$3 WHERE empresa_id=$1 AND id=$2 AND COALESCE(km_vacio,0)=0
   AND vehiculo_id=$4 AND carga_real_at=$5 AND descarga_real_at=$6 RETURNING id`,
   [company,order.id,report.empty.distance.value,context.vehicle_id,context.load_at,context.unload_at]);
  if(result.rows.length)await tx.query(`INSERT INTO vehiculo_km_vacio(empresa_id,vehiculo_id,fecha,km_vacio,origen,destino,motivo,notas)
   VALUES($1,$2,($3::timestamptz AT TIME ZONE 'Europe/Madrid')::date,$4,$5,$6,'Entre descarga y siguiente carga',$7)`,
   [company,context.vehicle_id,context.load_at,report.empty.distance.value,String(previous?.destino||'Descarga anterior').slice(0,180),String(order.origen||'Carga siguiente').slice(0,180),`gps:pedido:${order.id}`]);
  return result.rows.length>0;
  });
 }
 return report;
}
async function drain(db,deps={}) {
 // Keep the generation token as PostgreSQL text: pg's Date parser drops
 // microseconds, so comparing a parsed Date would leave a live job processing.
 const job=await db.transaction(async tx=>(await tx.query(`UPDATE pedido_telemetry_reports SET status='processing',locked_at=NOW(),attempts=attempts+1
  WHERE (empresa_id,pedido_id)=(SELECT empresa_id,pedido_id FROM pedido_telemetry_reports
   WHERE (status IN ('pending','retry') AND available_at<=NOW()) OR (status='processing' AND locked_at<NOW()-INTERVAL '30 minutes')
   ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *,requested_at::text AS request_token`)).rows[0]);
 if(!job)return false;
 try{const data=await calculate(db,job,deps);
  await db.query(`UPDATE pedido_telemetry_reports SET status='ready',data=$3,locked_at=NULL,updated_at=NOW()
   WHERE empresa_id=$1 AND pedido_id=$2 AND requested_at=$4::timestamptz`,[job.empresa_id,job.pedido_id,JSON.stringify(data),job.request_token]);
 }catch(error){require('./logger').warn('No se pudo recuperar el resumen GPS del viaje',{empresa_id:job.empresa_id,pedido_id:job.pedido_id,attempt:job.attempts,error:error.message});
 await db.query(`UPDATE pedido_telemetry_reports SET status=$3,locked_at=NULL,available_at=NOW()+INTERVAL '5 minutes',
   data=jsonb_set(data,'{error}',$4::jsonb),updated_at=NOW() WHERE empresa_id=$1 AND pedido_id=$2 AND requested_at=$5::timestamptz`,
   [job.empresa_id,job.pedido_id,job.attempts<5?'retry':'error',JSON.stringify('No se ha podido recuperar el historial GPS. Revisa el conector y vuelve a solicitarlo.'),job.request_token]);}
 return true;
}
let timer,running=false;
function startScheduler(){if(timer)return;const db=require('./db');timer=setInterval(async()=>{if(running)return;running=true;
 try{await drain(db);}catch(error){require('./logger').warn('Resumen GPS de viaje: '+error.message);}finally{running=false;}},30000);timer.unref();}
module.exports={request,read,calculate,drain,startScheduler};

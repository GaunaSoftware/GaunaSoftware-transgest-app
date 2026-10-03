const {hash,canonical}=require('./transportDocumentVersions');
const {activeDriverStop,driverStops}=require('./driverStops');
const {loadJourney,ownerOf}=require('./driverJourney');
const {positionSource,assignedGps,GPS_PROVIDERS}=require('./gpsSource');
const fail=(message,code='TRACKING_INVALID',status=422)=>{throw Object.assign(Error(message),{code,status});};
const number=v=>v===null||v===undefined||v===''?null:Number(v);
function position(input,now=Date.now()){
 const lat=number(input.lat),lng=number(input.lng);
 if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail('Coordenadas GPS no válidas');
 const supplied=input.recorded_at||input.captured_at;
 const stamp=supplied?Date.parse(supplied):now;
 if(!Number.isFinite(stamp)||stamp>now+60000)fail('Fecha GPS inválida o futura');
 const optional=(value,min,max)=>{const n=number(value);if(n===null)return null;if(!Number.isFinite(n)||n<min||n>max)fail('Velocidad, rumbo o precisión GPS no válidos');return n;};
 return {lat,lng,recorded_at:new Date(stamp).toISOString(),timestamp_source:supplied?'device':'received',
  velocidad_kmh:optional(input.velocidad_kmh??input.velocidad,0,400),heading:optional(input.heading,0,360),accuracy_m:optional(input.accuracy_m,0,100000),odometro_km:optional(input.odometro_km,0,100000000)};
}
function configuration(raw={}){
 const stale=raw.stale_seconds??300;if(!Number.isInteger(stale)||stale<30||stale>3600)fail('La antigüedad máxima debe ser de 30 a 3600 segundos');
 const stops=raw.stops||{};
 if(typeof stops!=='object'||Array.isArray(stops)||Object.keys(stops).length>100)fail('Configuración de paradas inválida');
 for(const s of Object.values(stops))if(!s||!Number.isFinite(s.radius_m)||s.radius_m<30||s.radius_m>3000||!Number.isFinite(s.hysteresis_m)||s.hysteresis_m<10||s.hysteresis_m>1000)fail('Radio entre 30 y 3000 m; histéresis entre 10 y 1000 m');
 return {stale_seconds:stale,stops};
}
const rad=n=>n*Math.PI/180;
function distance(a,b){const x=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;return 6371000*2*Math.asin(Math.min(1,Math.sqrt(x)));}
function coordinate(stop){const lat=number(stop?.lat??stop?.latitude??stop?.latitud),lng=number(stop?.lng??stop?.lon??stop?.longitude??stop?.longitud);return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;}
function transition(previous,meters,radius,hysteresis,accuracy){
 if(accuracy===null||accuracy>radius)return null;
 if(!previous?.inside && meters+accuracy<=radius)return 'entrada';
 if(previous?.inside && meters-accuracy>=radius+hysteresis)return 'salida';
 return null;
}
async function nextStop(db,company,order){
 const journey=await loadJourney(db,company,order.id);
 if(journey){const stop=journey.stops.find(s=>s.estado!=='finalizada');if(!stop)return null;const owner=ownerOf(stop,journey);if(owner.pedido_id!==order.id)return null;
  const original=driverStops(order).find(s=>s.id===owner.parada_legacy_id);
  return original?{...original,...stop.ubicacion,id:original.id,tipo:stop.tipo}:null;
 }
 const steps=(await db.query('SELECT data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=$2',[company,order.id])).rows[0]?.data||{};
 return activeDriverStop(order,steps);
}
async function config(db,company,orderId){return configuration((await db.query('SELECT * FROM tracking_configuration WHERE empresa_id=$1 AND pedido_id=$2',[company,orderId])).rows[0]);}
async function evaluateGeofences(tx,company,vehicle,p,logId,now=Date.now()){
 // Never infer an arrival from a server receipt timestamp or uncertain old fix.
 if(p.timestamp_source!=='device'||p.accuracy_m===null)return;
 const orders=(await tx.query("SELECT * FROM pedidos WHERE empresa_id=$1 AND vehiculo_id=$2 AND estado::text NOT IN ('entregado','facturado','cancelado','borrador') AND fecha_carga<=(NOW() AT TIME ZONE 'Europe/Madrid')::date",[company,vehicle])).rows;
 for(const order of orders){const cfg=await config(tx,company,order.id);if(now-Date.parse(p.recorded_at)>cfg.stale_seconds*1000)continue;
  const stop=await nextStop(tx,company,order),coords=coordinate(stop);if(!coords)continue;
  const previous=(await tx.query(`SELECT s.* FROM tracking_geofence_state s JOIN gps_position_log l ON l.id=s.position_id AND l.empresa_id=s.empresa_id
    WHERE s.empresa_id=$1 AND s.pedido_id=$2 AND s.parada_id=$3 AND l.provider=$4 FOR UPDATE OF s`,[company,order.id,stop.id,p.provider])).rows[0];
  if(previous&&Date.parse(previous.observed_at)>=Date.parse(p.recorded_at))continue;
  const {radius_m=150,hysteresis_m=50}=cfg.stops[stop.id]||{},meters=distance(p,coords);
  const event=transition(previous,meters,radius_m,hysteresis_m,p.accuracy_m);
  await tx.query(`INSERT INTO tracking_geofence_state(empresa_id,pedido_id,parada_id,inside,observed_at,position_id) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(empresa_id,pedido_id,parada_id) DO UPDATE SET inside=EXCLUDED.inside,observed_at=EXCLUDED.observed_at,position_id=EXCLUDED.position_id`,[company,order.id,stop.id,event?event==='entrada':previous?.inside||false,p.recorded_at,logId]);
  if(event)await tx.query('INSERT INTO tracking_geofence_events(empresa_id,pedido_id,parada_id,position_id,event,observed_at,distance_m,radius_m,hysteresis_m) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[company,order.id,stop.id,logId,event,p.recorded_at,meters,radius_m,hysteresis_m]);
 }
}
async function record(db,{empresaId,vehiculoId,provider,input,externalId,raw={},authorize}){
 const p=position(input),key=hash(canonical({empresaId,vehiculoId,provider,p}));
 return db.transaction(async tx=>{
  if(authorize)await authorize(tx);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:gps:${vehiculoId}`]);
  const vehicle=(await tx.query('SELECT id,gps_provider FROM vehiculos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[empresaId,vehiculoId])).rows[0];
  if(!vehicle)fail('Vehículo no encontrado','VEHICLE_NOT_FOUND',404);
  const row=(await tx.query(`INSERT INTO gps_position_log(empresa_id,vehiculo_id,provider,external_id,lat,lng,velocidad_kmh,odometro_km,raw,recorded_at,ingestion_key)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(empresa_id,ingestion_key) WHERE ingestion_key IS NOT NULL DO NOTHING RETURNING id`,[empresaId,vehiculoId,provider,externalId||null,p.lat,p.lng,p.velocidad_kmh,p.odometro_km,JSON.stringify({...raw,accuracy_m:p.accuracy_m,heading:p.heading,timestamp_source:p.timestamp_source}),p.recorded_at,key])).rows[0];
  if(!row)return {ok:true,idempotent:true};
  // Keep both sources in history, but only the selected source publishes the
  // vehicle position and drives operational geofence observations.
  const selected=provider===positionSource(vehicle)||(provider==='manual'&&!assignedGps(vehicle));
  if(!selected)return {ok:true,id:row.id,idempotent:false,recorded_at:p.recorded_at,selected_source:false};
  await tx.query(`UPDATE vehiculos SET ubicacion_actual=$3,ubicacion_fuente=$4,ubicacion_ts=$5,gps_lat=$6,gps_lng=$7,km_actuales=COALESCE($8,km_actuales)
   WHERE empresa_id=$1 AND id=$2 AND (ubicacion_fuente IS DISTINCT FROM $4 OR ubicacion_ts IS NULL OR ubicacion_ts<=$5::timestamptz)`,[empresaId,vehiculoId,`${p.lat}, ${p.lng}`,provider,p.recorded_at,p.lat,p.lng,p.odometro_km]);
  await evaluateGeofences(tx,empresaId,vehiculoId,{...p,provider},row.id);
  return {ok:true,id:row.id,idempotent:false,recorded_at:p.recorded_at};
 });
}
async function snapshot(db,company,order,now=Date.now()){
 if(order.empresa_id!==company)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);
 const cfg=await config(db,company,order.id),stop=await nextStop(db,company,order);
 const closed=['entregado','facturado','cancelado'].includes(order.estado);
 const row=!closed&&order.vehiculo_id?(await db.query(`SELECT p.* FROM gps_position_log p JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
   WHERE p.empresa_id=$1 AND p.vehiculo_id=$2 AND p.recorded_at<=$3
   AND p.provider=CASE WHEN v.gps_provider=ANY($4::varchar[]) THEN v.gps_provider ELSE 'app_chofer' END
   ORDER BY p.recorded_at DESC,p.id DESC LIMIT 1`,[company,order.vehiculo_id,new Date(now+60000).toISOString(),GPS_PROVIDERS])).rows[0]:null;
 const age=row?Math.max(0,(now-Date.parse(row.recorded_at))/1000):null;
 const timestampSource=row?.raw?.timestamp_source||'legacy';
 const fresh=timestampSource==='device'&&age!==null&&age<=cfg.stale_seconds,coords=row&&coordinate(row),target=coordinate(stop);
 const event=stop&&row?(await db.query(`SELECT e.id,e.event,e.observed_at FROM tracking_geofence_events e JOIN gps_position_log l ON l.id=e.position_id AND l.empresa_id=e.empresa_id
   WHERE e.empresa_id=$1 AND e.pedido_id=$2 AND e.parada_id=$3 AND l.provider=$4 ORDER BY e.observed_at DESC,e.id DESC LIMIT 1`,[company,order.id,stop.id,row.provider])).rows[0]:null;
 return {pedido_id:order.id,status:closed?'finalizado':!row?'sin_datos':timestampSource!=='device'?'captura_sin_fecha':fresh&&coords?'reciente':'obsoleta',stale_seconds:cfg.stale_seconds,
  last_recorded_at:row?.recorded_at||null,age_seconds:age,provider:row?.provider||null,timestamp_source:timestampSource,
  position:fresh&&coords?{...coords,heading:number(row.raw?.heading),accuracy_m:number(row.raw?.accuracy_m),speed_kmh:number(row.velocidad_kmh)}:null,
  next_stop:stop?{id:stop.id,tipo:stop.tipo,label:stop.label||stop.nombre||stop.direccion,coordinates:target,window_end_at:stop.ventana_fin_at||null,...(cfg.stops[stop.id]||{radius_m:150,hysteresis_m:50})}:null,
  distance_straight_m:fresh&&coords&&target?distance(coords,target):null,
  eta:{value:null,status:'sin_datos',reason:'Requiere una duración de ruta por carretera vigente hasta la próxima parada; la distancia en línea recta no es una ETA.'},
  arrival:fresh&&event?.event==='entrada'&&Date.parse(event.observed_at)>=now-cfg.stale_seconds*1000?event:null,configuration:cfg};
}
function roadEta(state,route,now=Date.now()){
 const arrival=Date.parse(state.last_recorded_at)+Number(route?.duration_min)*60000;
 if(state.status!=='reciente'||!state.position||!['ors_hgv','osrm'].includes(route?.provider)||!Number.isFinite(route?.duration_min)||route.duration_min<=0||arrival<now)return {...state.eta,reason:'Sin duración por carretera válida desde una posición reciente.'};
 const end=state.next_stop?.window_end_at;
 const limit=typeof end==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(end)?Date.parse(end):NaN;
 return {value:new Date(arrival).toISOString(),status:'estimado',provider:route.provider,distance_road_km:route.km,delay_minutes:Number.isFinite(limit)?Math.max(0,(arrival-limit)/60000):null,
  definition:'Estimación por carretera desde la hora del GPS; no incluye futuras pausas ni operaciones.',warning:route.warning||'',truck_aware:route.truck_aware===true};
}
async function saveConfiguration(db,company,orderId,value,actorId){
 const cfg=configuration(value),order=(await db.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2',[company,orderId])).rows[0];
 if(!order)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);
 const ids=new Set(driverStops(order).map(s=>s.id));if(Object.keys(cfg.stops).some(id=>!ids.has(id)))fail('La parada no pertenece al pedido');
 await db.query(`INSERT INTO tracking_configuration(empresa_id,pedido_id,stale_seconds,stops,updated_by) VALUES($1,$2,$3,$4,$5)
  ON CONFLICT(empresa_id,pedido_id) DO UPDATE SET stale_seconds=EXCLUDED.stale_seconds,stops=EXCLUDED.stops,updated_by=EXCLUDED.updated_by,updated_at=NOW()`,[company,orderId,cfg.stale_seconds,JSON.stringify(cfg.stops),actorId]);return cfg;
}
module.exports={position,configuration,coordinate,distance,transition,record,snapshot,saveConfiguration,evaluateGeofences,roadEta};

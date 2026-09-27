const crypto = require('node:crypto');
const fail = (message,code,status=409) => { throw Object.assign(new Error(message),{code,status}); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const uuid = value => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value||''));

// Optional while old installations migrate. Do not catch a failed SQL query
// inside a transaction (PostgreSQL would leave it aborted).
async function hasGraph(db) {
  return !!(await db.query("SELECT to_regclass('public.viaje_paradas') AS name")).rows[0]?.name;
}
async function loadJourney(db,empresaId,pedidoId,{lock=false}={}) {
  if(!await hasGraph(db))return null;
  const trip=(await db.query(`SELECT v.* FROM viajes_operativos v JOIN viaje_pedidos vp ON vp.empresa_id=v.empresa_id AND vp.viaje_id=v.id
    WHERE vp.empresa_id=$1 AND vp.pedido_id=$2 AND v.estado<>'cancelado' ORDER BY v.created_at DESC LIMIT 1${lock?' FOR UPDATE OF v':''}`,[empresaId,pedidoId])).rows[0];
  if(!trip)return null;
  const orders=(await db.query(`SELECT p.* FROM pedidos p JOIN viaje_pedidos vp ON vp.empresa_id=p.empresa_id AND vp.pedido_id=p.id
    WHERE vp.empresa_id=$1 AND vp.viaje_id=$2 ORDER BY p.id`,[empresaId,trip.id])).rows;
  const stops=(await db.query('SELECT * FROM viaje_paradas WHERE empresa_id=$1 AND viaje_id=$2 ORDER BY orden',[empresaId,trip.id])).rows;
  return {trip,orders,stops};
}
function ownerOf(stop,journey) {
  const prefixed=journey.orders.find(order=>stop.legacy_key?.startsWith(order.id+':'));
  return {pedido_id:prefixed?.id||journey.trip.legacy_pedido_id,parada_legacy_id:prefixed?stop.legacy_key.slice(prefixed.id.length+1):stop.legacy_key};
}
const complete = stop => stop.estado==='finalizada';
const minutes = (start,end) => start&&end ? Math.max(0,(new Date(end)-new Date(start))/60000) : null;
async function driverJourneyContext(db,empresaId,pedidoId,authorize) {
  const journey=await loadJourney(db,empresaId,pedidoId);
  if(!journey)return null;
  // A saved shared plan never grants permission to its other orders.
  for(const order of journey.orders)if(authorize&&!await authorize(order)){
    // The current driver may consult completed stops of the journey taken over,
    // while the completed commercial order retains its historical assignment.
    if(!journey.trip.relevos?.length||!['entregado','facturado'].includes(order.estado)||!await authorize({...order,...journey.trip.asignacion_snapshot}))fail('No puedes acceder a todos los servicios de este viaje.','JOURNEY_FORBIDDEN',403);
  }
  const paradas=journey.stops.map(stop=>({id:stop.id,...ownerOf(stop,journey),orden:stop.orden,tipo:stop.tipo,
    label:stop.ubicacion.nombre||stop.ubicacion.direccion||stop.ubicacion.ciudad||stop.ubicacion.poblacion||'Ubicación pendiente',
    estado:stop.estado,completa:complete(stop),llegada_real_at:stop.llegada_real_at,inicio_real_at:stop.inicio_real_at,fin_real_at:stop.fin_real_at,
    espera_min:minutes(stop.llegada_real_at,stop.inicio_real_at),duracion_min:minutes(stop.inicio_real_at,stop.fin_real_at)}));
  return {id:journey.trip.id,version:journey.trip.version,estado:journey.trip.estado,paradas,
    proxima_parada:paradas.find(stop=>!stop.completa)||null,fuente_tiempos:'Recepción de las confirmaciones en el servidor; el momento indicado por el dispositivo se conserva en el registro de eventos.'};
}
async function beginOperation(tx,{empresaId,pedidoId,operationId,patch}) {
  if(!operationId)return null; // Older clients retain stop-level monotonic validation.
  if(!uuid(operationId))fail('Identificador de operación no válido.','OPERATION_ID_INVALID',400);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:driver-operation:${operationId}`]);
  const requestHash=hash({pedidoId,patch});
  const receipt=(await tx.query('SELECT request_hash,resultado FROM chofer_parada_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,operationId])).rows[0];
  if(receipt&&receipt.request_hash!==requestHash)fail('El identificador ya pertenece a otra acción.','OPERATION_CONFLICT');
  return {operationId,requestHash,result:receipt?.resultado};
}
function serverPatch(patch,current,now) {
  const {client_operation_uuid,observed_at,event_location,...next}=patch;
  for(const key of Object.keys(next))if(key.endsWith('_at'))delete next[key];
  for(const [key,value] of Object.entries(next))if(value===true&&!current[key])next[`${key}_at`]=now;
  if(event_location){
    const lat=event_location.lat,lng=event_location.lng;
    if(typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)fail('Coordenadas no válidas.','STOP_LOCATION_INVALID',400);
    next.event_location={lat,lng,accuracy_m:Number.isFinite(event_location.accuracy_m)&&event_location.accuracy_m>=0?event_location.accuracy_m:null,captured_at:event_location.captured_at||observed_at||null};
  }
  return next;
}
function assertNextStop(journey,pedidoId,legacyId) {
  if(!journey)return null;
  const target=journey.stops.find(stop=>{const owner=ownerOf(stop,journey);return owner.pedido_id===pedidoId&&owner.parada_legacy_id===legacyId;});
  if(!target)fail('La parada no pertenece al plan vigente. Actualiza el viaje.','JOURNEY_STOP_CHANGED');
  if(!complete(target)&&journey.stops.find(stop=>!complete(stop))?.id!==target.id)fail('Completa primero la próxima parada del viaje completo.','JOURNEY_STOP_SEQUENCE');
  return target;
}
async function recordStop(tx,{empresaId,pedidoId,actorId,journey,target,operation,patch,merged,order,now}) {
  if(journey&&target){
    const progress=merged.data.paradas[patch.parada_id],load=target.tipo==='carga';
    const finished=load?progress.carga_ok:progress.firma_entrega;
    const arrived=progress[load?'carga_iniciada_at':'posicionado_descarga_at']||null;
    const started=progress[load?'carga_proceso_at':'descarga_iniciada_at']||null;
    const ended=progress[load?'carga_ok_at':'descarga_ok_at']||null;
    const evidence=order.firma_evidencia?.paradas?.[patch.parada_id];
    await tx.query(`UPDATE viaje_paradas SET llegada_real_at=COALESCE(llegada_real_at,$4),inicio_real_at=COALESCE(inicio_real_at,$5),
      fin_real_at=COALESCE(fin_real_at,$6),estado=$7,progreso=$8,evidencias=$9 WHERE empresa_id=$1 AND viaje_id=$2 AND id=$3`,
      [empresaId,journey.trip.id,target.id,arrived,started,ended,finished?'finalizada':ended?'pendiente_firma':started?'en_operacion':arrived?'posicionada':'pendiente',
        JSON.stringify(progress),JSON.stringify(evidence?[{pedido_id:pedidoId,parada_id:patch.parada_id,firma_hash:evidence.firma?.hash||null}]:[])]);
    if(patch.incidencia_parada)await tx.query('UPDATE viaje_paradas SET incidencias=incidencias||$4::jsonb WHERE empresa_id=$1 AND viaje_id=$2 AND id=$3',
      [empresaId,journey.trip.id,target.id,JSON.stringify([{descripcion:patch.incidencia_parada,actor_id:actorId||null,received_at:now,client_operation_uuid:operation?.operationId||null}])]);
    if((await tx.query("SELECT to_regclass('public.pedido_docs') AS name")).rows[0]?.name){
      const docs=(await tx.query("SELECT id,nombre,tipo,created_at FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 AND metadata->>'parada_id'=$3 ORDER BY created_at,id",[empresaId,pedidoId,patch.parada_id])).rows;
      await tx.query('UPDATE viaje_paradas SET documentos=$4 WHERE empresa_id=$1 AND viaje_id=$2 AND id=$3',[empresaId,journey.trip.id,target.id,JSON.stringify(docs)]);
    }
    // Preserve per-stop quantities. No redistribution between ambiguous shipments.
    if(progress.mercancia_confirmada)await tx.query(`UPDATE parada_envios SET peso_kg=$4,bultos=$5,mercancia=$6 WHERE empresa_id=$1 AND viaje_id=$2 AND parada_id=$3
      AND (SELECT COUNT(*) FROM parada_envios WHERE empresa_id=$1 AND parada_id=$3)=1`,[empresaId,journey.trip.id,target.id,Number(String(progress.mercancia_peso_kg).replace(',','.')),Number(String(progress.mercancia_palets).replace(',','.')),progress.mercancia_cargada]);
    const allDone=finished&&journey.stops.every(stop=>stop.id===target.id||complete(stop));
    await tx.query('UPDATE viajes_operativos SET estado=$3,updated_at=NOW() WHERE empresa_id=$1 AND id=$2',[empresaId,journey.trip.id,allDone?'entregado':merged.state==='entregado'?'en_curso':merged.state]);
    merged.journeyComplete=allDone;
  }
  if(operation)await tx.query(`INSERT INTO chofer_parada_operaciones(empresa_id,client_operation_uuid,pedido_id,parada_legacy_id,viaje_id,parada_id,actor_id,request_hash,solicitud,resultado,received_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[empresaId,operation.operationId,pedidoId,patch.parada_id,journey?.trip.id||null,target?.id||null,actorId||null,operation.requestHash,JSON.stringify(patch),JSON.stringify(merged),now]);
}
module.exports={loadJourney,ownerOf,driverJourneyContext,beginOperation,serverPatch,assertNextStop,recordStop};

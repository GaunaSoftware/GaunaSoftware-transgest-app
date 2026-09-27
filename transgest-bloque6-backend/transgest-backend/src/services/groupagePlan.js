const crypto=require('node:crypto');
const {legacyOperationalModel,readOperationalModel}=require('./operationalModel');
const fail=(message,code='GROUPAGE_CONFLICT',status=409)=>{throw Object.assign(new Error(message),{status,code});};
const uuid=value=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(value||''));
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
function sequenceKeys(models){return models.flatMap(model=>model.viajes[0].paradas.map(stop=>({key:`${model.pedido_id}:${stop.legacy_key}`,pedido_id:model.pedido_id,stop})));}
function validateSequence(all,sequence){
 if(!Array.isArray(sequence)||sequence.length!==all.length||new Set(sequence).size!==all.length||sequence.some(key=>!all.some(s=>s.key===key)))fail('Incluye cada parada una sola vez.','GROUPAGE_SEQUENCE',400);
 const loaded=new Set();
 for(const key of sequence){const item=all.find(s=>s.key===key);if(item.stop.tipo==='carga')loaded.add(item.pedido_id);else if(!loaded.has(item.pedido_id))fail('La descarga debe ir después de la carga del mismo envío.','GROUPAGE_SEQUENCE',400);}
 return sequence;
}
async function graphSnapshot(tx,empresaId,viajeId){
 const trip=(await tx.query('SELECT * FROM viajes_operativos WHERE empresa_id=$1 AND id=$2',[empresaId,viajeId])).rows[0];
 const stops=(await tx.query('SELECT id,legacy_key,orden,tipo,ubicacion,planificacion FROM viaje_paradas WHERE empresa_id=$1 AND viaje_id=$2 ORDER BY orden',[empresaId,viajeId])).rows;
 const shipments=(await tx.query('SELECT e.* FROM pedidos_envios e JOIN viaje_envios ve ON ve.empresa_id=e.empresa_id AND ve.envio_id=e.id WHERE ve.empresa_id=$1 AND ve.viaje_id=$2',[empresaId,viajeId])).rows;
 return {...trip,paradas:stops,envios:shipments};
}
async function saveGroupagePlan(tx,{empresaId,grupajeId,operationId,actorId,version,sequence,layout,route,confirm=false}){
 if(!uuid(grupajeId)||!uuid(operationId))fail('Identificador de grupaje u operación no válido.','GROUPAGE_ID',400);
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:groupage-write`]);
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:groupage:${grupajeId}`]);
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:journey-operation:${operationId}`]);
 const requestHash=hash({grupajeId,version,sequence,layout,route,confirm});
 const previousOperation=(await tx.query('SELECT request_hash,resultado FROM viaje_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,operationId])).rows[0];
 if(previousOperation){if(previousOperation.request_hash!==requestHash)fail('La operación se reutilizó con otros datos.','OPERATION_CONFLICT');return {...previousOperation.resultado,replayed:true};}
 const orders=(await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND grupaje_id=$2::uuid ORDER BY id FOR UPDATE',[empresaId,grupajeId])).rows;
 if(!orders.length)fail('Grupaje no encontrado.','GROUPAGE_NOT_FOUND',404);
 if(orders.some(p=>!['pendiente','confirmado'].includes(p.estado)||p.factura_id||p.carga_real_at||p.descarga_real_at))fail('No se cambia el plan de un grupaje iniciado o facturado.');
 const ids=orders.map(p=>p.id),steps=(await tx.query('SELECT pedido_id,data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])',[empresaId,ids])).rows;
 const models=orders.map(order=>legacyOperationalModel({...order,grupaje_id:null},steps.find(row=>row.pedido_id===order.id)?.data||{}));
 if(models.some(m=>m.cobertura!=='compatible_simple'))fail('Identifica primero los envíos de los pedidos con varias cargas o descargas.','SHIPMENT_MAPPING_REQUIRED');
 if(models.some(m=>m.viajes[0].paradas.some(stop=>stop.estado!=='pendiente')))fail('Hay eventos reales registrados; el plan ya no es editable.');
 const assignment=models[0].viajes[0].asignacion_snapshot;
 if(models.some(m=>JSON.stringify(m.viajes[0].asignacion_snapshot)!==JSON.stringify(assignment)))fail('Los pedidos tienen asignaciones diferentes. Unifica vehículo, conductor y remolque antes de confirmar.','GROUPAGE_ASSIGNMENT');
 for(const [field,table] of [['vehiculo_id','vehiculos'],['remolque_id_manual','vehiculos'],['remolque_id','vehiculos'],['chofer_id','choferes'],['chofer2_id','choferes'],['colaborador_id','colaboradores']])if(assignment[field]&&!(await tx.query(`SELECT id FROM ${table} WHERE empresa_id=$1 AND id=$2`,[empresaId,assignment[field]])).rows.length)fail('Recurso no disponible en esta empresa.','ASSIGNMENT_SCOPE');
 let trip=(await tx.query('SELECT * FROM viajes_operativos WHERE empresa_id=$1 AND legacy_grupaje_id=$2 FOR UPDATE',[empresaId,grupajeId])).rows[0];
 if(trip&&!['borrador','pendiente','confirmado'].includes(trip.estado))fail('El viaje ya ha comenzado.');
 if(trip&&(await tx.query("SELECT id FROM viaje_paradas WHERE empresa_id=$1 AND viaje_id=$2 AND (estado<>'pendiente' OR llegada_real_at IS NOT NULL OR inicio_real_at IS NOT NULL OR fin_real_at IS NOT NULL) LIMIT 1",[empresaId,trip.id])).rows.length)fail('Hay eventos reales registrados; el plan ya no es editable.');
 if(trip&&Number(version)!==trip.version)fail('El grupaje ha cambiado. Actualiza antes de guardar.','GROUPAGE_VERSION');
 const linked=(await tx.query('SELECT viaje_id,pedido_id FROM viaje_pedidos WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[]) AND activo',[empresaId,ids])).rows;
 if(linked.some(row=>row.viaje_id!==trip?.id))fail('Un pedido ya pertenece a otro viaje operativo.');
 const all=sequenceKeys(models);
 const storedStops=trip?(await tx.query('SELECT legacy_key,ubicacion FROM viaje_paradas WHERE empresa_id=$1 AND viaje_id=$2 ORDER BY orden',[empresaId,trip.id])).rows:[];
 const ordered=validateSequence(all,sequence||storedStops.length&&storedStops.map(s=>s.legacy_key)||[...all.filter(s=>s.stop.tipo==='carga'),...all.filter(s=>s.stop.tipo==='descarga')].map(s=>s.key));
 const cargo=layout||trip?.disposicion_carga||ids;
 if(!Array.isArray(cargo)||cargo.length!==ids.length||new Set(cargo).size!==ids.length||cargo.some(id=>!ids.includes(id)))fail('La disposición debe incluir cada pedido una sola vez.','GROUPAGE_LAYOUT',400);
 const locationsChanged=storedStops.some(s=>hash(s.ubicacion)!==hash(all.find(item=>item.key===s.legacy_key)?.stop.ubicacion));
 const calculated=locationsChanged?null:route===undefined?(JSON.stringify(trip?.ruta_calculada?.paradas)===JSON.stringify(ordered)?trip.ruta_calculada:null):route===null?null:{distance_km:Number(route.distance_km)>0?Number(route.distance_km):null,duration_min:Number(route.duration_min)>0?Number(route.duration_min):null,provider:String(route.provider||'').slice(0,60),truck_aware:!!route.truck_aware,warning:String(route.warning||'').slice(0,2000),constraint_review:require('./routeConstraints').proposalSnapshot(route.constraint_review,ordered),geometry:JSON.stringify(route.geometry||null).length<1000000?(route.geometry||null):null,waypoint_coordinates:Array.isArray(route.waypoint_coordinates)?route.waypoint_coordinates.slice(0,ordered.length).map(p=>({lat:Number(p.lat),lon:Number(p.lon),address:String(p.address||'').slice(0,400)})):[],origen:'calculo_plan_estimado',paradas:ordered};
 if(!trip){
  trip=(await tx.query(`INSERT INTO viajes_operativos(empresa_id,legacy_grupaje_id,client_operation_uuid,estado,ejecucion,asignacion_snapshot,disposicion_carga,ruta_calculada,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[empresaId,grupajeId,operationId,confirm?'confirmado':'borrador',models[0].viajes[0].ejecucion,JSON.stringify(assignment),JSON.stringify(cargo),calculated?JSON.stringify(calculated):null,actorId||null])).rows[0];
  for(const model of models){
   await tx.query('INSERT INTO viaje_pedidos(empresa_id,viaje_id,pedido_id) VALUES($1,$2,$3)',[empresaId,trip.id,model.pedido_id]);
   const original=model.viajes[0].envios[0];
   const shipment=(await tx.query('INSERT INTO pedidos_envios(empresa_id,pedido_id,referencia,snapshot) VALUES($1,$2,$3,$4) RETURNING id',[empresaId,model.pedido_id,original.referencia,JSON.stringify(original.snapshot)])).rows[0];
   await tx.query('INSERT INTO viaje_envios(empresa_id,viaje_id,envio_id,pedido_id) VALUES($1,$2,$3,$4)',[empresaId,trip.id,shipment.id,model.pedido_id]);
   for(const stop of model.viajes[0].paradas){
    const key=`${model.pedido_id}:${stop.legacy_key}`;
    const stored=(await tx.query(`INSERT INTO viaje_paradas(empresa_id,viaje_id,orden,tipo,legacy_key,ubicacion,planificacion) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id`,[empresaId,trip.id,ordered.indexOf(key)+1,stop.tipo,key,JSON.stringify(stop.ubicacion),JSON.stringify(stop.planificacion)])).rows[0];
    await tx.query('INSERT INTO parada_envios(empresa_id,viaje_id,parada_id,envio_id,peso_kg,bultos,mercancia) VALUES($1,$2,$3,$4,$5,$6,$7)',[empresaId,trip.id,stored.id,shipment.id,original.snapshot.peso_kg,original.snapshot.bultos,original.snapshot.mercancia]);
   }
  }
 }else{
  // Move to a disjoint positive range before swapping unique positions.
  await tx.query('UPDATE viaje_paradas SET orden=orden+$3 WHERE empresa_id=$1 AND viaje_id=$2',[empresaId,trip.id,ordered.length]);
  for(let i=0;i<ordered.length;i++){
   const current=all.find(item=>item.key===ordered[i]).stop;
   await tx.query('UPDATE viaje_paradas SET orden=$4,ubicacion=$5,planificacion=$6 WHERE empresa_id=$1 AND viaje_id=$2 AND legacy_key=$3',[empresaId,trip.id,ordered[i],i+1,JSON.stringify(current.ubicacion),JSON.stringify(current.planificacion)]);
  }
  for(const model of models){
   const goods=model.viajes[0].envios[0];
   await tx.query('UPDATE pedidos_envios e SET snapshot=$4,referencia=$5,version=version+1 FROM viaje_envios ve WHERE ve.empresa_id=$1 AND ve.viaje_id=$2 AND ve.pedido_id=$3 AND e.empresa_id=ve.empresa_id AND e.id=ve.envio_id',[empresaId,trip.id,model.pedido_id,JSON.stringify(goods.snapshot),goods.referencia]);
   await tx.query('UPDATE parada_envios pe SET peso_kg=$4,bultos=$5,mercancia=$6 FROM viaje_envios ve WHERE ve.empresa_id=$1 AND ve.viaje_id=$2 AND ve.pedido_id=$3 AND pe.empresa_id=ve.empresa_id AND pe.viaje_id=ve.viaje_id AND pe.envio_id=ve.envio_id',[empresaId,trip.id,model.pedido_id,goods.snapshot.peso_kg,goods.snapshot.bultos,goods.snapshot.mercancia]);
  }
  trip=(await tx.query(`UPDATE viajes_operativos SET version=version+1,estado=CASE WHEN $3 THEN 'confirmado' ELSE estado END,disposicion_carga=$4,ruta_calculada=$5,asignacion_snapshot=$6,ejecucion=$7,updated_at=NOW() WHERE empresa_id=$1 AND id=$2 RETURNING *`,[empresaId,trip.id,confirm,JSON.stringify(cargo),calculated?JSON.stringify(calculated):null,JSON.stringify(assignment),models[0].viajes[0].ejecucion])).rows[0];
 }
 if(confirm)await tx.query('UPDATE pedidos SET grupaje_borrador=false WHERE empresa_id=$1 AND id=ANY($2::uuid[])',[empresaId,ids]);
 const snapshot=await graphSnapshot(tx,empresaId,trip.id);
 await tx.query('INSERT INTO viaje_plan_versiones(empresa_id,viaje_id,version,snapshot,motivo,actor_id) VALUES($1,$2,$3,$4,$5,$6)',[empresaId,trip.id,trip.version,JSON.stringify(snapshot),confirm?'Confirmación de grupaje':'Edición de planificación',actorId||null]);
 const result={ok:true,viaje_id:trip.id,grupaje_id:grupajeId,version:trip.version,count:ids.length,borrador:trip.estado==='borrador'};
 await tx.query('INSERT INTO viaje_operaciones(empresa_id,client_operation_uuid,viaje_id,request_hash,resultado) VALUES($1,$2,$3,$4,$5)',[empresaId,operationId,trip.id,requestHash,JSON.stringify(result)]);
 return result;
}
async function readGroupagePlan(db,empresaId,grupajeId){
 const order=(await db.query('SELECT id FROM pedidos WHERE empresa_id=$1 AND grupaje_id=$2::uuid ORDER BY id LIMIT 1',[empresaId,grupajeId])).rows[0];
 if(!order)fail('Grupaje no encontrado.','GROUPAGE_NOT_FOUND',404);
 return readOperationalModel(db,empresaId,order.id);
}
module.exports={saveGroupagePlan,readGroupagePlan,validateSequence};

const { driverStops, stopData } = require('./driverStops');
const { transportProgress } = require('./transportProgress');
const fail=(message,code,status=409)=>{throw Object.assign(new Error(message),{code,status});};
const numeric=value=>value==null||value===''||!Number.isFinite(Number(value))||Number(value)<0?null:Number(value);
const iso=value=>{if(!value)return null;const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null;};
const date=value=>{const raw=value instanceof Date?iso(value)?.slice(0,10):String(value||'');return /^\d{4}-\d{2}-\d{2}$/.test(raw||'')&&iso(raw)?.slice(0,10)===raw?raw:null;};
const time=value=>/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value||''))?String(value):null;
const pick=(source,keys)=>Object.fromEntries(keys.filter(key=>source[key]!=null).map(key=>[key,source[key]]));

function legacyOperationalModel(order, progress={}) {
  const stops=driverStops(order);
  const loads=stops.filter(stop=>stop.tipo==='carga'),unloads=stops.filter(stop=>stop.tipo==='descarga');
  const simple=loads.length===1&&unloads.length===1&&!order.grupaje_id;
  const goods={mercancia:order.mercancia||null,peso_kg:numeric(order.peso_kg),bultos:numeric(order.bultos)};
  const envios=simple?[{id:`legacy-envio:${order.id}`,pedido_id:order.id,referencia:order.referencia_cliente||null,
    snapshot:{origen:pick(loads[0],['nombre','direccion','ciudad','poblacion','cp','pais','lat','lng']),
      destino:pick(unloads[0],['nombre','direccion','ciudad','poblacion','cp','pais','lat','lng']),...goods,
      origen_dato:'pedido_legacy',verificacion_juridica:'pendiente'}}]:[];
  const paradas=stops.map((stop,index)=>{
    const data=stopData(stop,progress,stops),load=stop.tipo==='carga';
    const arrived=iso(data[load?'carga_iniciada_at':'posicionado_descarga_at']);
    const started=iso(data[load?'carga_proceso_at':'descarga_iniciada_at']);
    const finished=iso(data[load?'carga_ok_at':'descarga_ok_at']);
    return {id:`legacy-parada:${order.id}:${stop.id}`,legacy_key:stop.id,orden:index+1,tipo:stop.tipo,
      ubicacion:pick(stop,['nombre','direccion','direccion_normalizada','ciudad','poblacion','localidad','municipio','cp','codigo_postal','provincia','pais','lat','lng','location_incomplete']),
      planificacion:{fecha:date(stop.fecha||order[load?'fecha_carga_planificada':'fecha_descarga_planificada']||order[load?'fecha_carga':'fecha_descarga']),
        hora:time(stop.hora||order[load?'hora_carga':'hora_descarga']),ventana_inicio:time(stop.hora_desde||stop.hora_inicio),ventana_fin:time(stop.hora_hasta||stop.hora_fin),zona_horaria:'Europe/Madrid'},
      llegada_real_at:arrived,inicio_real_at:started,fin_real_at:finished,
      estado:finished||data[load?'carga_ok':'descarga_ok']?'finalizada':started||data[load?'carga_proceso':'descarga_iniciada']?'en_operacion':arrived||data[load?'carga_iniciada':'posicionado_descarga']?'posicionada':'pendiente',
      incidencias:[],documentos:[],evidencias:[],
      referencias_legacy:{pedido_id:order.id,parada_id:stop.id,evidencia_disponible:!!order.firma_evidencia?.paradas?.[stop.id]},
      envios:simple?[{envio_id:envios[0].id,...goods}]:[]};
  });
  return {version_contrato:1,origen:'legacy',pedido_id:order.id,empresa_id:order.empresa_id,
    cobertura:simple?'compatible_simple':'requiere_identificar_envios',
    advertencias:simple?['Representación compatible del pedido; no implica revisión jurídica del envío.']:['Las paradas no determinan qué mercancía va de cada origen a cada destino. Identifica los envíos antes de materializar.'],
    viajes:[{id:`legacy-viaje:${order.grupaje_id||order.id}`,estado:order.estado,estado_operativo:transportProgress(order,progress),
      ejecucion:order.colaborador_id?'subcontratada':order.vehiculo_id||order.chofer_id?'propia':'sin_asignar',
      asignacion_snapshot:pick(order,['vehiculo_id','chofer_id','chofer2_id','remolque_id','remolque_id_manual','matricula_manual','colaborador_id','matricula_colaborador','remolque_matricula_colaborador']),
      km_cargados:order.grupaje_id?null:numeric(order.km_ruta),km_vacios:order.grupaje_id?null:numeric(order.km_vacio),
      pedidos:[order.id],envios,paradas}]};
}

async function loadOrder(db,empresaId,pedidoId,lock=false) {
  if(!empresaId)fail('Sin empresa','TENANT_REQUIRED',401);
  const order=(await db.query(`SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2${lock?' FOR UPDATE':''}`,[pedidoId,empresaId])).rows[0];
  if(!order)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);
  return order;
}
async function loadProgress(db,empresaId,pedidoId) {
  try{return (await db.query('SELECT data FROM pedido_chofer_pasos WHERE pedido_id=$1 AND empresa_id=$2',[pedidoId,empresaId])).rows[0]?.data||{};}
  catch(error){if(error.code==='42P01')return {};throw error;}
}

async function readOperationalModel(db,empresaId,pedidoId) {
  const order=await loadOrder(db,empresaId,pedidoId);
  let trips;
  try {trips=(await db.query(`SELECT v.* FROM viajes_operativos v JOIN viaje_pedidos vp ON vp.empresa_id=v.empresa_id AND vp.viaje_id=v.id
    WHERE vp.empresa_id=$1 AND vp.pedido_id=$2 AND v.estado<>'cancelado' ORDER BY v.created_at,v.id`,[empresaId,pedidoId])).rows;}
  catch(error){if(error.code!=='42P01')throw error;trips=[];}
  if(!trips.length)return legacyOperationalModel(order,await loadProgress(db,empresaId,pedidoId));
  const ids=trips.map(trip=>trip.id);
  const [orders,shipments,stops,goods]=await Promise.all([
    db.query('SELECT viaje_id,pedido_id FROM viaje_pedidos WHERE empresa_id=$1 AND viaje_id=ANY($2::uuid[])',[empresaId,ids]),
    db.query('SELECT ve.viaje_id,e.* FROM viaje_envios ve JOIN pedidos_envios e ON e.empresa_id=ve.empresa_id AND e.id=ve.envio_id WHERE ve.empresa_id=$1 AND ve.viaje_id=ANY($2::uuid[])',[empresaId,ids]),
    db.query('SELECT * FROM viaje_paradas WHERE empresa_id=$1 AND viaje_id=ANY($2::uuid[]) ORDER BY orden',[empresaId,ids]),
    db.query('SELECT * FROM parada_envios WHERE empresa_id=$1 AND viaje_id=ANY($2::uuid[])',[empresaId,ids]),
  ]);
  return {version_contrato:1,origen:'materializado',empresa_id:empresaId,pedido_id:pedidoId,
    cobertura:'snapshot_operativo',advertencias:['Plan operativo con confirmaciones por parada de la app del chófer; se conserva la proyección compatible en Pedidos. No se reconstruyen asignaciones históricas.'],
    viajes:trips.map(trip=>({...trip,pedidos:orders.rows.filter(row=>row.viaje_id===trip.id).map(row=>row.pedido_id),
      envios:shipments.rows.filter(row=>row.viaje_id===trip.id),
      paradas:stops.rows.filter(row=>row.viaje_id===trip.id).map(stop=>({...stop,envios:goods.rows.filter(row=>row.parada_id===stop.id)}))}))};
}

async function materializeSimpleOrder(db,{empresaId,pedidoId,operationId,actorId}) {
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(operationId||'')))fail('Falta un identificador de operación válido','OPERATION_ID_REQUIRED',400);
  return db.transaction(async client=>{
    const order=await loadOrder(client,empresaId,pedidoId,true);
    // Lock operation identity too: two different orders may receive the same UUID.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:operativa:${operationId}`]);
    const byOperation=(await client.query('SELECT id,legacy_pedido_id FROM viajes_operativos WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,operationId])).rows[0];
    if(byOperation&&byOperation.legacy_pedido_id!==pedidoId)fail('El identificador de operación ya se usó para otro pedido','OPERATION_CONFLICT');
    const existing=(await client.query("SELECT vp.viaje_id FROM viaje_pedidos vp JOIN viajes_operativos v ON v.id=vp.viaje_id AND v.empresa_id=vp.empresa_id WHERE vp.empresa_id=$1 AND vp.pedido_id=$2 AND v.estado<>'cancelado'",[empresaId,pedidoId])).rows[0];
    if(existing)return {viaje_id:existing.viaje_id,created:false};
    if(!['pendiente','confirmado'].includes(order.estado))fail('Solo se materializan pedidos aún no iniciados','ORDER_ALREADY_STARTED');
    const model=legacyOperationalModel(order,await loadProgress(client,empresaId,pedidoId));
    if(model.cobertura!=='compatible_simple')fail(model.advertencias[0],'SHIPMENT_MAPPING_REQUIRED');
    if(model.viajes[0].paradas.some(stop=>stop.estado!=='pendiente')||order.carga_real_at||order.descarga_real_at)fail('El pedido contiene actividad registrada; revisa su estado antes de materializar','ORDER_ALREADY_STARTED');
    for(const [field,table] of [['vehiculo_id','vehiculos'],['remolque_id_manual','vehiculos'],['chofer_id','choferes'],['chofer2_id','choferes'],['colaborador_id','colaboradores']]) {
      if(order[field]&&!(await client.query(`SELECT id FROM ${table} WHERE empresa_id=$1 AND id=$2`,[empresaId,order[field]])).rows[0])fail('La asignación contiene un recurso no disponible en esta empresa','ASSIGNMENT_SCOPE');
    }
    const trip=model.viajes[0],envio=trip.envios[0];
    const journey=(await client.query(`INSERT INTO viajes_operativos(empresa_id,legacy_pedido_id,client_operation_uuid,estado,ejecucion,asignacion_snapshot,km_cargados,km_vacios,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[empresaId,pedidoId,operationId,order.estado,trip.ejecucion,JSON.stringify(trip.asignacion_snapshot),trip.km_cargados,trip.km_vacios,actorId||null])).rows[0];
    await client.query('INSERT INTO viaje_pedidos(empresa_id,viaje_id,pedido_id) VALUES($1,$2,$3)',[empresaId,journey.id,pedidoId]);
    const shipment=(await client.query('INSERT INTO pedidos_envios(empresa_id,pedido_id,referencia,snapshot) VALUES($1,$2,$3,$4) RETURNING id',[empresaId,pedidoId,envio.referencia,JSON.stringify(envio.snapshot)])).rows[0];
    await client.query('INSERT INTO viaje_envios(empresa_id,viaje_id,envio_id,pedido_id) VALUES($1,$2,$3,$4)',[empresaId,journey.id,shipment.id,pedidoId]);
    for(const stop of trip.paradas){
      const stored=(await client.query(`INSERT INTO viaje_paradas(empresa_id,viaje_id,orden,tipo,legacy_key,ubicacion,planificacion,llegada_real_at,inicio_real_at,fin_real_at,estado)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,[empresaId,journey.id,stop.orden,stop.tipo,stop.legacy_key,JSON.stringify(stop.ubicacion),JSON.stringify(stop.planificacion),stop.llegada_real_at,stop.inicio_real_at,stop.fin_real_at,stop.estado])).rows[0];
      await client.query('INSERT INTO parada_envios(empresa_id,viaje_id,parada_id,envio_id,peso_kg,bultos,mercancia) VALUES($1,$2,$3,$4,$5,$6,$7)',[empresaId,journey.id,stored.id,shipment.id,envio.snapshot.peso_kg,envio.snapshot.bultos,envio.snapshot.mercancia]);
    }
    await client.query(`INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle)
      VALUES($1,$2,'operativa.materializada','usuario',$3,$4)`,[pedidoId,empresaId,actorId||null,JSON.stringify({viaje_id:journey.id,client_operation_uuid:operationId,origen:'pedido_simple_legacy'})]);
    return {viaje_id:journey.id,created:true};
  });
}
module.exports={legacyOperationalModel,readOperationalModel,materializeSimpleOrder};

const crypto = require('node:crypto');
const {driverStops} = require('./driverStops');
const {canonical, hash} = require('./transportDocumentVersions');
const fail = (message, code, status=409) => { throw Object.assign(Error(message),{code,status}); };
const text = value => String(value ?? '').trim();
const list=value=>{try{const rows=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(rows)?rows.filter(row=>row&&typeof row==='object'):[];}catch{return [];}};
function stableStopUids(value,previousValue=[]) {
  const points=list(value),previous=list(previousValue),used=new Set();
  const identity=point=>String(point.id||point.punto_id||point.punto_interes_id||[point.direccion,point.nombre,point.cliente_nombre].filter(Boolean).join('|'));
  return points.map((point,index)=>{
    let uid=point.pedido_stop_uid;
    if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(uid||''))||used.has(uid)){
      const match=previous.find(old=>old.pedido_stop_uid&&!used.has(old.pedido_stop_uid)&&identity(old)===identity(point));
      const fallback=points.length===previous.length?previous[index]:null;
      uid=match?.pedido_stop_uid||(fallback?.pedido_stop_uid&&!used.has(fallback.pedido_stop_uid)?fallback.pedido_stop_uid:crypto.randomUUID());
    }
    used.add(uid);return {...point,pedido_stop_uid:uid};
  });
}

// El desglose documental se obtiene exclusivamente de las paradas del pedido.
// Cuando hay varias cargas y descargas, la asociación se confirma en cada
// descarga del pedido; nunca se adivina por el orden del itinerario.
function fromOrder(order) {
  const stops=driverStops(order),loads=stops.filter(stop=>stop.tipo==='carga'),unloads=stops.filter(stop=>stop.tipo==='descarga');
  if(!loads.length||!unloads.length)fail('Completa los puntos de carga y descarga en el pedido.','ORDER_STOPS_REQUIRED',422);
  const manyLoads=loads.length>1,manyUnloads=unloads.length>1;
  const rows=(manyUnloads?unloads:manyLoads?loads:[unloads[0]]).map((point,index)=>{
    const destination=manyUnloads?point:unloads[0];
    const rawIndex=destination.origen_carga_indice;
    if(manyLoads&&manyUnloads&&(rawIndex==null||rawIndex===''))
      fail(`Descarga ${index+1}: selecciona su carga de origen en el pedido.`, 'ORDER_SHIPMENT_ORIGIN',422);
    const origin=manyUnloads?loads[manyLoads?Number(rawIndex):0]:manyLoads?point:loads[0];
    if(!origin||manyLoads&&manyUnloads&&!Number.isInteger(Number(rawIndex)))
      fail(`Descarga ${index+1}: revisa la carga de origen en el pedido.`, 'ORDER_SHIPMENT_ORIGIN',422);
    if(!text(origin.direccion||origin.ciudad||origin.nombre||order.origen)||!text(destination.direccion||destination.ciudad||destination.nombre||order.destino))
      fail('Completa los puntos de carga y descarga en el pedido.','ORDER_STOPS_REQUIRED',422);
    const source=manyUnloads?destination:origin;
    const weight=Number(source.peso_kg||(manyLoads||manyUnloads?NaN:order.peso_kg));
    if(!Number.isFinite(weight)||weight<=0)
      fail(`${manyUnloads?'Descarga':'Carga'} ${index+1}: indica el peso en el pedido.`, 'ORDER_SHIPMENT_WEIGHT',422);
    const goods=text(source.mercancia||origin.mercancia||destination.mercancia||order.mercancia);
    if(!goods)fail(`${manyUnloads?'Descarga':'Carga'} ${index+1}: indica la mercancía en el pedido.`, 'ORDER_SHIPMENT_GOODS',422);
    return {
      origen_id:origin.id,destino_id:destination.id,
      pedido_envio_uid:(manyUnloads?destination:manyLoads?origin:destination).pedido_stop_uid||null,
      referencia:text(destination.referencia||origin.referencia||order.referencia_cliente||order.numero),
      destinatario:text(destination.destinatario||destination.cliente_nombre||destination.nombre||destination.label),
      mercancia:goods,peso_kg:weight,
      bultos:source.bultos||source.unidades||(!manyLoads&&!manyUnloads?order.bultos:null),
      embalaje:text(source.embalaje||origin.embalaje||order.embalaje),
    };
  });
  validate(order,rows);
  return rows;
}

async function ensureFromOrder(db,{empresaId,pedidoId,actorId,reason}) {
  return db.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:groupage-write`]);
    const order=(await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[empresaId,pedidoId])).rows[0];
    if(!order)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);
    if(order.estado==='cancelado')fail('El pedido está cancelado.','SHIPMENT_HISTORY');
    const existing=(await tx.query('SELECT id,referencia,snapshot FROM pedidos_envios WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at,id',[empresaId,pedidoId])).rows;
    existing.sort((a,b)=>(a.snapshot?.pedido_envio_indice??1000)-(b.snapshot?.pedido_envio_indice??1000));
    const manualManifest=existing.length&&existing.every(row=>row.snapshot?.origen_dato==='revision_trafico');
    if(existing.length&&!manualManifest&&existing.some(row=>row.snapshot?.origen_dato!=='pedido'))return {envioIds:existing.map(row=>row.id),updatedAt:order.updated_at};
    const documents=(await tx.query('SELECT id FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 LIMIT 1',[empresaId,pedidoId])).rows;
    if(!existing.length&&documents.length)fail('El pedido conserva originales sin desglose. No se cambia su estructura histórica.','SHIPMENTS_EXIST');
    const parse=list;
    const stable=(value,fallback)=>{
      const points=parse(value);
      return stableStopUids(points.length?points:[{direccion:fallback}]);
    };
    const nextOrder={...order,puntos_carga:stable(order.puntos_carga,order.origen),puntos_descarga:stable(order.puntos_descarga,order.destino)};
    const actualOrder={...nextOrder};
    if((await tx.query("SELECT to_regclass('public.pedido_chofer_pasos') AS name")).rows[0]?.name){
      const progress=(await tx.query('SELECT data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,pedidoId])).rows[0]?.data?.paradas||{};
      for(const type of ['carga','descarga']){
        const key=type==='carga'?'puntos_carga':'puntos_descarga';
        actualOrder[key]=driverStops(nextOrder).filter(stop=>stop.tipo===type).map(stop=>{
          const real=progress[stop.id];
          const source=nextOrder[key][stop.index];
          return real?.mercancia_confirmada?{...source,mercancia:real.mercancia_cargada,peso_kg:real.mercancia_peso_kg,bultos:real.mercancia_palets}:source;
        });
      }
    }
    const rows=fromOrder(actualOrder),shipments=validate(actualOrder,rows),ids=[];
    if(!existing.length&&(['entregado','facturado','cancelado'].includes(order.estado)||order.descarga_real_at))
      fail('No se reconstruyen envíos de servicios cerrados.','SHIPMENT_HISTORY');
    if(existing.length&&existing.length!==shipments.length)
      fail('El número de envíos cambió después de prepararlos. Conserva el expediente y revisa el pedido con tráfico.','SHIPMENTS_STRUCTURE_CHANGED',422);
    const orderedExisting=shipments.map(shipment=>{
      const matches=existing.filter(row=>manualManifest
        ? row.snapshot?.origen_stop_id===shipment.snapshot.origen_stop_id&&row.snapshot?.destino_stop_id===shipment.snapshot.destino_stop_id
        : row.snapshot?.pedido_envio_uid===shipment.snapshot.pedido_envio_uid);
      return matches.length===1?matches[0]:null;
    });
    if(existing.length&&orderedExisting.some(row=>!row))fail('La estructura de envíos cambió. Revisa las cargas y descargas del pedido antes de corregir sus originales.','SHIPMENTS_STRUCTURE_CHANGED',422);
    const snapshots=shipments.map((shipment,index)=>({...shipment.snapshot,origen_dato:'pedido',pedido_envio_indice:index}));
    const changed=existing.length&&shipments.some((shipment,index)=>canonical(orderedExisting[index].snapshot)!==canonical(snapshots[index])||orderedExisting[index].referencia!==shipment.referencia);
    if(documents.length&&changed&&!text(reason))
      fail('Indica el motivo de la nueva versión después de corregir el pedido.','VERSION_REASON_REQUIRED',422);
    let updatedAt=order.updated_at;
    if(canonical(parse(order.puntos_carga))!==canonical(nextOrder.puntos_carga)||canonical(parse(order.puntos_descarga))!==canonical(nextOrder.puntos_descarga))
      updatedAt=(await tx.query('UPDATE pedidos SET puntos_carga=$3,puntos_descarga=$4,updated_at=NOW() WHERE empresa_id=$1 AND id=$2 RETURNING updated_at',[empresaId,pedidoId,JSON.stringify(nextOrder.puntos_carga),JSON.stringify(nextOrder.puntos_descarga)])).rows[0].updated_at;
    for(const [index,shipment] of shipments.entries()){
      const snapshot=snapshots[index],previous=orderedExisting[index];
      if(previous){
        if(canonical(previous.snapshot)!==canonical(snapshot)||previous.referencia!==shipment.referencia)
          await tx.query('UPDATE pedidos_envios SET referencia=$3,snapshot=$4,version=version+1 WHERE empresa_id=$1 AND id=$2',[empresaId,previous.id,shipment.referencia,JSON.stringify(snapshot)]);
        ids.push(previous.id);
        continue;
      }
      const id=crypto.randomUUID();
      await tx.query('INSERT INTO pedidos_envios(id,empresa_id,pedido_id,referencia,snapshot) VALUES($1,$2,$3,$4,$5)',[id,empresaId,pedidoId,shipment.referencia,JSON.stringify(snapshot)]);
      ids.push(id);
    }
    if(!existing.length)await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'envios.declarados_desde_pedido','usuario',$3,$4)",[pedidoId,empresaId,actorId||null,JSON.stringify({envio_ids:ids})]);
    else if(changed)await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'envios.actualizados_desde_pedido','usuario',$3,$4)",[pedidoId,empresaId,actorId||null,JSON.stringify({envio_ids:ids,motivo:text(reason)||null})]);
    return {envioIds:ids,updatedAt};
  });
}

function validate(order, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length>100) fail('Identifica entre 1 y 100 envíos.','SHIPMENTS_REQUIRED',422);
  const stops = driverStops(order);
  const shipments = rows.map((row,index) => {
    const origin=stops.find(p=>p.id===row.origen_id && p.tipo==='carga');
    const destination=stops.find(p=>p.id===row.destino_id && p.tipo==='descarga');
    if(!origin || !destination) fail(`Envío ${index+1}: selecciona sus puntos de carga y descarga.`, 'SHIPMENT_STOPS',422);
    if(!text(row.mercancia) || text(row.mercancia).length>500 || text(row.destinatario).length>300) fail(`Envío ${index+1}: indica la naturaleza de la mercancía.`, 'SHIPMENT_PARTIES',422);
    const weight=Number(row.peso_kg),units=row.bultos==null||row.bultos===''?null:Number(row.bultos);
    if(!Number.isFinite(weight)||weight<=0||weight>1000000||units!==null&&(!Number.isFinite(units)||units<0||units>1000000))fail(`Envío ${index+1}: revisa peso y bultos.`, 'SHIPMENT_GOODS',422);
    const point=p=>({nombre:p.nombre||p.label,direccion:p.direccion||p.label,ciudad:p.ciudad||p.poblacion||null,pais:p.pais||null});
    return {referencia:text(row.referencia).slice(0,200)||null,snapshot:{origen:point(origin),destino:{...point(destination),destinatario:text(row.destinatario)},origen_stop_id:origin.id,destino_stop_id:destination.id,...(row.pedido_envio_uid?{pedido_envio_uid:row.pedido_envio_uid}:{}),mercancia:text(row.mercancia),peso_kg:weight,bultos:units,embalaje:text(row.embalaje).slice(0,200),origen_dato:'revision_trafico'}};
  });
  if(Number(order.peso_kg)>0 && Math.abs(shipments.reduce((n,s)=>n+s.snapshot.peso_kg,0)-Number(order.peso_kg))>.01)fail('La suma de los pesos debe coincidir con el peso del pedido. Corrige el pedido o el desglose.','SHIPMENT_WEIGHT_TOTAL',422);
  return shipments;
}

async function declare(db,{empresaId,pedidoId,operationId,rows,actorId}) {
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(operationId||'')))fail('Falta el identificador de la operación.','OPERATION_REQUIRED',422);
  return db.transaction(async tx=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:groupage-write`]);
    const order=(await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[empresaId,pedidoId])).rows[0];
    if(!order)fail('Pedido no encontrado','ORDER_NOT_FOUND',404);
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:shipment:${operationId}`]);
    const requestHash=hash(canonical({pedidoId,rows}));
    const prior=(await tx.query('SELECT * FROM pedido_envios_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2',[empresaId,operationId])).rows[0];
    if(prior){if(prior.request_hash!==requestHash)fail('La operación ya corresponde a otro desglose.','OPERATION_CONFLICT');return prior.resultado;}
    if(['entregado','facturado','cancelado'].includes(order.estado)||order.descarga_real_at)fail('No se reconstruyen envíos de servicios cerrados.','SHIPMENT_HISTORY');
    const existing=(await tx.query('SELECT id FROM pedidos_envios WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,pedidoId])).rows;
    const documents=(await tx.query('SELECT id FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 LIMIT 1',[empresaId,pedidoId])).rows;
    if(existing.length||documents.length)fail('El pedido ya tiene envíos o documentos emitidos. No se sustituye su estructura histórica.','SHIPMENTS_EXIST');
    const shipmentRows=validate(order,rows),ids=[];
    for(const shipment of shipmentRows){const id=crypto.randomUUID();await tx.query('INSERT INTO pedidos_envios(id,empresa_id,pedido_id,referencia,snapshot) VALUES($1,$2,$3,$4,$5)',[id,empresaId,pedidoId,shipment.referencia,JSON.stringify(shipment.snapshot)]);ids.push(id);}
    const result={envio_ids:ids};
    await tx.query('INSERT INTO pedido_envios_operaciones(empresa_id,client_operation_uuid,pedido_id,request_hash,resultado,created_by) VALUES($1,$2,$3,$4,$5,$6)',[empresaId,operationId,pedidoId,requestHash,JSON.stringify(result),actorId||null]);
    await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'envios.declarados','usuario',$3,$4)",[pedidoId,empresaId,actorId||null,JSON.stringify({envio_ids:ids,client_operation_uuid:operationId})]);
    return result;
  });
}
module.exports={declare,validate,fromOrder,ensureFromOrder,stableStopUids};

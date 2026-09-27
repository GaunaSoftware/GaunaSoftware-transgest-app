const crypto = require('node:crypto');
const {driverStops} = require('./driverStops');
const {canonical, hash} = require('./transportDocumentVersions');
const fail = (message, code, status=409) => { throw Object.assign(Error(message),{code,status}); };
const text = value => String(value ?? '').trim();

function validate(order, rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length>100) fail('Identifica entre 1 y 100 envíos.','SHIPMENTS_REQUIRED',422);
  const stops = driverStops(order);
  const shipments = rows.map((row,index) => {
    const origin=stops.find(p=>p.id===row.origen_id && p.tipo==='carga');
    const destination=stops.find(p=>p.id===row.destino_id && p.tipo==='descarga');
    if(!origin || !destination) fail(`Envío ${index+1}: selecciona sus puntos de carga y descarga.`, 'SHIPMENT_STOPS',422);
    if(!text(row.mercancia) || !text(row.destinatario) || text(row.mercancia).length>500 || text(row.destinatario).length>300) fail(`Envío ${index+1}: indica naturaleza de mercancía y destinatario.`, 'SHIPMENT_PARTIES',422);
    const weight=Number(row.peso_kg),units=row.bultos==null||row.bultos===''?null:Number(row.bultos);
    if(!Number.isFinite(weight)||weight<=0||weight>1000000||units!==null&&(!Number.isFinite(units)||units<0||units>1000000))fail(`Envío ${index+1}: revisa peso y bultos.`, 'SHIPMENT_GOODS',422);
    const point=p=>({nombre:p.nombre||p.label,direccion:p.direccion||p.label,ciudad:p.ciudad||p.poblacion||null,pais:p.pais||null});
    return {referencia:text(row.referencia).slice(0,200)||null,snapshot:{origen:point(origin),destino:{...point(destination),destinatario:text(row.destinatario)},origen_stop_id:origin.id,destino_stop_id:destination.id,mercancia:text(row.mercancia),peso_kg:weight,bultos:units,embalaje:text(row.embalaje).slice(0,200),origen_dato:'revision_trafico'}};
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
module.exports={declare,validate};

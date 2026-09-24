const { compact } = require('./importMasterData');

const TABLES = Object.freeze({
  Facturas_Historicas:'import_facturas_historicas',
  Facturas_Lineas:'import_factura_lineas_historicas',
  Facturas_Pendientes:'import_saldos_pendientes',
});
function text(value) { return String(value ?? '').trim() || null; }
function review(reason) { return { action:'review', reason }; }
function money(value) { return value == null || value === '' ? null : Number(value); }
function boolean(value) {
  if (value == null || value === '') return false;
  const normalized=String(value).trim().toLowerCase();
  return ['true','1','si','sí','s','yes'].includes(normalized) ? true
    : ['false','0','no','n'].includes(normalized) ? false : null;
}
async function unique(client,sql,params,label) {
  const {rows}=await client.query(`${sql} LIMIT 2`,params);
  if (rows.length > 1) return { error:`${label}: varias coincidencias` };
  return rows[0] || null;
}
async function evaluateHistory(client,empresaId,sourceSystem,type,data,sourceId,fingerprint) {
  if (!TABLES[type]) return {action:'unsupported',reason:'Tipo no admitido'};
  if (!data || typeof data !== 'object' || !text(sourceId)) return review('El histórico requiere source_id estable');
  const identity=(await client.query(`SELECT target_id FROM import_identities WHERE empresa_id=$1 AND entity_type=$2 AND source_system=$3 AND source_id=$4 LIMIT 1`,
    [empresaId,type,sourceSystem,sourceId])).rows[0];
  if (identity) return {action:'skip',identityExisting:true,targetId:identity.target_id,reason:'Origen ya importado'};
  const amount=money(type==='Facturas_Lineas'?data.importe:data.total);
  if (amount===null || !Number.isFinite(amount)) return review('Importe de factura no válido');
  const result={action:'create',table:TABLES[type]};
  if (type==='Facturas_Historicas' || type==='Facturas_Pendientes') {
    if (!text(data.numero_origen) || !text(data.cliente_nombre)) return review('Número y cliente de origen obligatorios');
    if (type==='Facturas_Historicas' && !data.fecha) return review('Factura histórica sin fecha');
    if (type==='Facturas_Historicas' && boolean(data.rectificativa)===null) return review('Valor de rectificativa no reconocido');
    const table=TABLES[type];
    const existing=await unique(client,`SELECT id,total${type==='Facturas_Pendientes'?',saldo_pendiente':''} FROM ${table}
      WHERE empresa_id=$1 AND source_system=$2 AND numero_origen=$3 AND COALESCE(serie_origen,'')=$4`,
    [empresaId,sourceSystem,text(data.numero_origen),text(data.serie_origen)||''],'Número de origen');
    if (existing?.error) return review(existing.error);
    if (existing) {
      if (Number(existing.total)!==amount) return review('Número de origen existente con importe diferente');
      if (type==='Facturas_Pendientes' && data.saldo_pendiente != null && Number(existing.saldo_pendiente)!==Number(data.saldo_pendiente)) return review('Saldo de origen existente diferente');
      return {action:'skip',targetId:existing.id,reason:'Documento histórico existente; no se sobrescribe'};
    }
    if (type==='Facturas_Pendientes') {
      const collected=money(data.cobrado),outstanding=money(data.saldo_pendiente);
      if (outstanding===null && collected===null) return review('Indica saldo pendiente o importe cobrado de origen');
      if (outstanding!==null && collected!==null && Math.abs(amount-collected-outstanding)>0.011) return review('Total, cobrado y saldo no concilian');
      result.outstanding=outstanding!==null?outstanding:Math.round((amount-collected)*100)/100;
    }
    if (text(data.cliente_cif)) {
      const customer=await unique(client,'SELECT id FROM clientes WHERE empresa_id=$1 AND UPPER(TRIM(cif))=$2',
        [empresaId,text(data.cliente_cif).toUpperCase()],'Cliente');
      if (customer?.error) return review(customer.error);
      if (!customer) return review('Cliente con CIF no localizado');
      result.customerId=customer.id;
    }
    return result;
  }
  if (!Number.isInteger(Number(data.linea)) || Number(data.linea)<=0 || !text(data.factura_source_id)) return review('Línea o factura_source_id inválidos');
  const invoice=await unique(client,`SELECT id FROM import_facturas_historicas WHERE empresa_id=$1 AND source_system=$2 AND source_id=$3`,
    [empresaId,sourceSystem,text(data.factura_source_id)],'Factura histórica');
  if (invoice?.error) return review(invoice.error);
  if (!invoice) return review('Factura histórica no localizada');
  result.invoiceId=invoice.id;
  const previous=await unique(client,'SELECT id,importe FROM import_factura_lineas_historicas WHERE empresa_id=$1 AND factura_id=$2 AND linea=$3',
    [empresaId,invoice.id,Number(data.linea)],'Línea histórica');
  if (previous?.error) return review(previous.error);
  if (previous) return Number(previous.importe)===amount
    ? {action:'skip',targetId:previous.id,reason:'Línea histórica existente'}
    : review('Línea histórica existente con importe diferente');
  if (text(data.vehiculo_matricula)) {
    const vehicle=await unique(client,"SELECT id FROM vehiculos WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g')=$2",
      [empresaId,compact(data.vehiculo_matricula)],'Vehículo');
    if (vehicle?.error) return review(vehicle.error);
    if (!vehicle) return review('Vehículo de línea no localizado');
    result.vehicleId=vehicle.id;
  }
  return result;
}
async function createHistory(client,empresaId,batchId,sourceSystem,type,data,decision) {
  if (decision.action!=='create') throw new Error('El histórico no está autorizado para crear');
  let sql,params;
  if (type==='Facturas_Historicas') {
    sql=`INSERT INTO import_facturas_historicas(empresa_id,cliente_id,source_system,source_id,numero_origen,serie_origen,fecha,
      cliente_nombre,cliente_cif,total,tipo_operacion,rectificativa,rectifica_referencia,estado_historico,origen,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`;
    params=[empresaId,decision.customerId||null,sourceSystem,text(data.source_id),text(data.numero_origen),text(data.serie_origen),data.fecha,
      text(data.cliente_nombre),text(data.cliente_cif),data.total,text(data.tipo_operacion),boolean(data.rectificativa),text(data.rectifica_referencia),
      text(data.estado_historico),text(data.origen),text(data.notas),batchId];
  } else if (type==='Facturas_Lineas') {
    sql=`INSERT INTO import_factura_lineas_historicas(empresa_id,factura_id,source_system,source_id,linea,importe,vehiculo_id,vehiculo_matricula,
      tipo_operacion,fecha_factura_proveedor,proveedor,factura_proveedor,coste_proveedor,beneficio_origen,observaciones,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`;
    params=[empresaId,decision.invoiceId,sourceSystem,text(data.source_id),data.linea,data.importe,decision.vehicleId||null,
      text(data.vehiculo_matricula),text(data.tipo_operacion),data.fecha_factura_proveedor||null,text(data.proveedor),text(data.factura_proveedor),
      data.coste_proveedor??null,data.beneficio_origen??null,text(data.observaciones),batchId];
  } else if (type==='Facturas_Pendientes') {
    sql=`INSERT INTO import_saldos_pendientes(empresa_id,cliente_id,source_system,source_id,numero_origen,serie_origen,fecha,
      fecha_vencimiento,cliente_cif,cliente_nombre,total,cobrado_origen,saldo_pendiente,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`;
    params=[empresaId,decision.customerId||null,sourceSystem,text(data.source_id),text(data.numero_origen),text(data.serie_origen),
      data.fecha||null,data.fecha_vencimiento||null,text(data.cliente_cif),text(data.cliente_nombre),data.total,data.cobrado??null,
      decision.outstanding,text(data.notas),batchId];
  } else throw new Error('Tipo histórico no implementado');
  const {rows}=await client.query(sql,params);
  return {table:TABLES[type],id:rows[0].id};
}
module.exports={TABLES,evaluateHistory,createHistory};

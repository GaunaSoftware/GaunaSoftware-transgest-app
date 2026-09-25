const { compact } = require('./importMasterData');
const { canonicalCostType } = require('./importCatalog');

const TABLES = Object.freeze({
  Gastos_Operativos: 'gastos_operativos',
  Repostajes: 'vehiculo_repostajes',
  Gastos_Estructura: 'gastos_estructura_movimientos',
});
function text(value) { return String(value ?? '').trim() || null; }
function review(reason) { return { action:'review', reason }; }
async function resolveOne(client, sql, params, label) {
  const { rows } = await client.query(`${sql} LIMIT 2`, params);
  if (rows.length !== 1) return { error: rows.length ? `${label}: varias coincidencias` : `${label} no localizado` };
  return { id: rows[0].id };
}
async function evaluateCost(client, empresaId, sourceSystem, type, data, sourceId, fingerprint) {
  if (!TABLES[type]) return { action:'unsupported', reason:'Tipo no admitido' };
  if (!data || typeof data !== 'object') return review('Datos de coste no válidos');
  const identity = (await client.query(`SELECT target_id FROM import_identities WHERE empresa_id=$1 AND entity_type=$2 AND source_system=$3
    AND (($4::text IS NOT NULL AND source_id=$4) OR ($4::text IS NULL AND source_id IS NULL AND fingerprint=$5)) LIMIT 1`,
  [empresaId,type,sourceSystem,sourceId||null,fingerprint||null])).rows[0];
  if (identity) return { action:'skip', identityExisting:true, targetId:identity.target_id, reason:'Origen ya importado' };
  const amount = Number(data.importe);
  if (data.importe == null || data.importe === '' || !Number.isFinite(amount)) return review('Importe no válido');
  const result = { action:'create', table:TABLES[type] };
  if (type === 'Gastos_Estructura') {
    if (!text(data.nombre) || !data.fecha) return review('Indica nombre y fecha reales del movimiento');
    return result;
  }
  if (type === 'Gastos_Operativos') {
    if (!canonicalCostType(data.tipo, data.subtipo)) return review('Tipo de gasto operativo no reconocido');
    if (data.periodo_desde && data.periodo_hasta && data.periodo_desde > data.periodo_hasta) return review('Periodo invertido');
    if (!data.fecha && !data.periodo_desde && !data.periodo_hasta) return review('Indica fecha o periodo real del gasto');
  }
  if (type === 'Repostajes') {
    if (!data.fecha || !Number.isFinite(Number(data.litros)) || Number(data.litros) <= 0 || !text(data.matricula)) return review('El repostaje necesita fecha, matrícula y litros positivos');
  }
  if (text(data.matricula)) {
    const vehicle = await resolveOne(client,
      "SELECT id FROM vehiculos WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g')=$2",
      [empresaId,compact(data.matricula)],'Vehículo');
    if (vehicle.error) return review(vehicle.error);
    result.vehicleId=vehicle.id;
  }
  if (text(data.chofer_dni)) {
    const driver = await resolveOne(client,
      "SELECT id FROM choferes WHERE empresa_id=$1 AND REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g')=$2",
      [empresaId,compact(data.chofer_dni)],'Conductor');
    if (driver.error) return review(driver.error);
    result.driverId=driver.id;
  }
  if (text(data.pedido_source_id)) {
    const order = await resolveOne(client,
      `SELECT target_id AS id FROM import_identities WHERE empresa_id=$1 AND entity_type='Viajes_Pendientes'
       AND source_system=$2 AND source_id=$3`,[empresaId,sourceSystem,text(data.pedido_source_id)],'Pedido de origen');
    if (order.error) return review(order.error);
    result.orderId=order.id;
  }
  return result;
}
async function createCost(client, empresaId, batchId, sourceSystem, type, data, decision) {
  if (decision.action !== 'create') throw new Error('El coste no está autorizado para crear');
  let sql, params;
  if (type === 'Gastos_Operativos') {
    sql = `INSERT INTO gastos_operativos(empresa_id,tipo,subtipo,proveedor,vehiculo_id,pedido_id,chofer_id,periodo_desde,periodo_hasta,fecha,
      pais,importe,iva_pct,referencia,notas,source_system,source_id,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`;
    params = [empresaId,canonicalCostType(data.tipo, data.subtipo),String(data.tipo||'').toLowerCase()==='coste_flota'?null:text(data.subtipo),text(data.proveedor),decision.vehicleId||null,decision.orderId||null,
      decision.driverId||null,data.periodo_desde||null,data.periodo_hasta||null,data.fecha||null,text(data.pais),data.importe,
      data.iva_pct??null,text(data.referencia),text(data.notas),sourceSystem,text(data.source_id),batchId];
  } else if (type === 'Repostajes') {
    sql = `INSERT INTO vehiculo_repostajes(empresa_id,vehiculo_id,fecha,hora,litros,precio_litro,importe,km_odometro,proveedor,referencia,notas,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`;
    params = [empresaId,decision.vehicleId,data.fecha||null,text(data.hora),data.litros,data.precio_litro??null,data.importe,
      data.km_odometro??null,text(data.proveedor),text(data.referencia),text(data.notas),batchId];
  } else if (type === 'Gastos_Estructura') {
    sql = `INSERT INTO gastos_estructura_movimientos(empresa_id,nombre,tipo,importe,periodo,fecha,notas,source_system,source_id,import_batch_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`;
    params = [empresaId,text(data.nombre),text(data.tipo),data.importe,text(data.periodo),data.fecha,text(data.notas),sourceSystem,text(data.source_id),batchId];
  } else throw new Error('Tipo de coste no implementado');
  const { rows } = await client.query(sql,params);
  return { table:TABLES[type], id:rows[0].id };
}
module.exports = { TABLES, evaluateCost, createCost };

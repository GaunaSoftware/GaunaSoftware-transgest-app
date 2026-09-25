const dbDefault=require('./db');

// Proyección informativa de origen. No alimenta los KPI fiscales/netos actuales:
// el contrato histórico solo garantiza totales, no bases ni movimientos de cobro.
function createImportHistoricalOverview(db=dbDefault){
  async function overview(empresaId,batchId=null){
    const filter=batchId?' AND import_batch_id=$2':'';
    const args=batchId?[empresaId,batchId]:[empresaId];
    const [invoices,lines,balances,trips]=await Promise.all([
      db.query(`SELECT count(*)::int AS documentos,COALESCE(sum(total),0) AS total_origen,
        count(*) FILTER(WHERE rectificativa)::int AS rectificativas
        FROM import_facturas_historicas WHERE empresa_id=$1${filter}`,args),
      db.query(`SELECT count(*)::int AS lineas,COALESCE(sum(importe),0) AS importe_lineas_origen,
        count(*) FILTER(WHERE coste_proveedor IS NOT NULL)::int AS lineas_con_coste,
        COALESCE(sum(coste_proveedor) FILTER(WHERE coste_proveedor IS NOT NULL),0) AS coste_proveedor_informado,
        count(*) FILTER(WHERE beneficio_origen IS NOT NULL)::int AS lineas_con_beneficio
        FROM import_factura_lineas_historicas WHERE empresa_id=$1${filter}`,args),
      db.query(`SELECT count(*)::int AS documentos,COALESCE(sum(saldo_pendiente),0) AS saldo_de_origen
        FROM import_saldos_pendientes WHERE empresa_id=$1${filter}`,args),
      db.query(`SELECT count(*)::int AS viajes,count(*) FILTER(WHERE importe IS NOT NULL)::int AS viajes_con_importe,
        COALESCE(sum(importe) FILTER(WHERE importe IS NOT NULL),0) AS ingreso_origen
        FROM import_viajes_historicos WHERE empresa_id=$1${filter}`,args),
    ]);
    return{
      definicion:'Datos históricos de origen; no reconciliados con facturas fiscales ni cobros actuales',
      alcance:{empresa_id:empresaId,batch_id:batchId},
      advertencias:['total_origen puede incluir IVA; no se suma a ingresos netos',
        'saldo_de_origen es un saldo inicial; no descuenta cobros registrados después de la migración',
        'viajes e invoices pueden representar los mismos servicios; no se suman entre sí'],
      facturas:invoices.rows[0],lineas:lines.rows[0],saldos:balances.rows[0],viajes:trips.rows[0],
    };
  }
  return{overview};
}
module.exports={createImportHistoricalOverview};

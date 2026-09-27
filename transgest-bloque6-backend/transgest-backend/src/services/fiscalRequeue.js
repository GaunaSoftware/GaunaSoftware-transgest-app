// Caller supplies a transaction. Preserve the immutable record, UUID and retry key.
async function requeueFiscalRecord(client, record) {
  await client.query('SELECT id FROM factura_registros_fiscales WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [record.id, record.empresa_id]);
  const { rows } = await client.query(`SELECT * FROM factura_envios_fiscales WHERE registro_id=$1 AND empresa_id=$2 ORDER BY created_at DESC,id DESC FOR UPDATE`, [record.id, record.empresa_id]);
  if (rows.some(row => row.estado === 'aceptado') || record.estado_envio === 'aceptado') return { reused_pending: true, already_accepted: true };
  if (rows[0]) {
    // A live lease cannot be reset by a click while the provider is processing.
    await client.query(`UPDATE factura_envios_fiscales SET estado='pendiente',retryable=true,next_retry_at=now(),updated_at=now()
      WHERE id=$1 AND NOT (estado='procesando' AND lease_until>now())`, [rows[0].id]);
    return { reused_pending: true };
  }
  await client.query(`INSERT INTO factura_envios_fiscales(registro_id,factura_id,empresa_id,sistema,entorno,estado,payload,next_retry_at)
    VALUES($1,$2,$3,$4,$5,'pendiente',$6::jsonb,now())`, [record.id,record.factura_id,record.empresa_id,record.modo,record.entorno,JSON.stringify(record.payload)]);
  return { reused_pending: false };
}
module.exports={requeueFiscalRecord};

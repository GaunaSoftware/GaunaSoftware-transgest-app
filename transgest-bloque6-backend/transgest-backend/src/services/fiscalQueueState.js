async function persistProviderMetadata(client,item,response) {
  if(!response || response.provider!=='verifacti')return;
  const {officialQrUrl}=require('./fiscalProviderVerifacti');
  const qrUrl=officialQrUrl(response.qr_url);
  const qrImage=await require('./fiscalQr').officialQrImage(qrUrl,response.qr_value);
  const qrBase64=qrImage ? qrImage.toString('base64') : null;
  await client.query(`UPDATE factura_envios_fiscales SET provider_uuid=COALESCE(provider_uuid,$1) WHERE id=$2 AND empresa_id=$3`,[response.provider_uuid || null,item.id,item.empresa_id]);
  await client.query(`UPDATE factura_registros_fiscales SET official_qr_url=COALESCE($1,official_qr_url),official_qr_base64=COALESCE($2,official_qr_base64),provider_hash=COALESCE($3,provider_hash) WHERE id=$4 AND empresa_id=$5`,[qrUrl,qrBase64,response.provider_hash || null,item.registro_id,item.empresa_id]);
}
async function lockQueue(client,item) {
  const {rows}=await client.query('SELECT estado FROM factura_envios_fiscales WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[item.id,item.empresa_id]);
  return rows[0];
}
async function logFiscalEvent(client, recordId, facturaId, empresaId, eventoTipo, detalle = {}) {
  await client.query(
    `INSERT INTO factura_eventos_fiscales
      (registro_id, factura_id, empresa_id, evento_tipo, detalle)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [recordId, facturaId, empresaId, eventoTipo, JSON.stringify(detalle || {})]
  );
}

async function markQueueAccepted(client, item, responsePayload, actorUserId) {
  const current=await lockQueue(client,item);
  if(!current || current.estado==='aceptado')return;
  await persistProviderMetadata(client,item,responsePayload);
  await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='aceptado',
            response=$1::jsonb,
            error=NULL,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$2`,
    [JSON.stringify(responsePayload), item.id]
  );
  await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='omitido',
            error='Sustituido por un envio mas reciente ya aceptado',
            processed_at=NOW(),
            updated_at=NOW()
      WHERE factura_id=$1
        AND sistema=$2
        AND id<>$3
        AND estado IN ('pendiente','procesando','error')`,
    [item.factura_id, item.sistema, item.id]
  );
  await client.query(
    `UPDATE factura_registros_fiscales
        SET estado_envio='aceptado', accepted_at=COALESCE(accepted_at,NOW()),
            ultimo_error=NULL,
            ultimo_envio_at=NOW(),
            updated_by=$1,
            updated_at=NOW()
      WHERE id=$2`,
    [actorUserId || null, item.registro_id]
  );
  await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "queue.accepted", responsePayload);
  // Accounting is recovered from accepted records by the scheduler after this
  // transaction commits. A downstream error must never roll back AEAT acceptance.
}

async function markQueuePending(client, item, responsePayload, actorUserId, retryInMs = 2 * 60 * 1000, detail = "Pendiente de confirmacion externa") {
  const current=await lockQueue(client,item);
  if(!current || current.estado==='aceptado' || current.estado==='omitido')return;
  await persistProviderMetadata(client,item,responsePayload);
  await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='pendiente',
            response=$1::jsonb,
            error=NULL,
            next_retry_at=$2,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$3`,
    [JSON.stringify(responsePayload), new Date(Date.now() + retryInMs).toISOString(), item.id]
  );
  await client.query(
    `UPDATE factura_registros_fiscales
        SET estado_envio='pendiente',
            ultimo_error=NULL,
            ultimo_envio_at=NOW(),
            updated_by=$1,
            updated_at=NOW()
      WHERE id=$2`,
    [actorUserId || null, item.registro_id]
  );
  await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "queue.pending", {
    detail,
    ...(responsePayload || {}),
  });
}

async function markQueueError(client, item, message, actorUserId, retryable = true, responsePayload = null) {
  const current=await lockQueue(client,item);
  if(!current || current.estado==='aceptado' || current.estado==='omitido')return;
  await persistProviderMetadata(client,item,responsePayload);
  await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='error', retryable=$5,
            response=COALESCE(response,'{}'::jsonb) || COALESCE($1::jsonb,'{}'::jsonb),
            error=$2,
            next_retry_at=$3,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$4`,
    [responsePayload ? JSON.stringify(responsePayload) : null, message, retryable ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null, item.id, retryable]
  );
  await client.query(
    `UPDATE factura_registros_fiscales
        SET estado_envio='error',
            ultimo_error=$1,
            updated_by=$2,
            updated_at=NOW()
      WHERE id=$3`,
    [message, actorUserId || null, item.registro_id]
  );
  await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "queue.error", {
    message,
    retryable,
    ...(responsePayload ? { response: responsePayload } : {}),
  });
}

async function findLatestQueueItemByProviderUuid(client, empresaId, sistema, providerUuid) {
  if (!empresaId || !sistema || !providerUuid) return null;
  const { rows } = await client.query(
    `SELECT q.*
       FROM factura_envios_fiscales q
      WHERE q.empresa_id=$1
        AND q.sistema=$2
        AND COALESCE(
          to_jsonb(q)->>'provider_uuid',
          q.response->>'provider_uuid',
          q.response->>'uuid',
          q.response->'response'->>'uuid',
          q.response->'response'->'data'->>'uuid',
          q.response->'response'->'registro'->>'uuid'
        ) = $3
      ORDER BY q.created_at DESC
      LIMIT 1`,
    [empresaId, sistema, String(providerUuid)]
  );
  return rows[0] || null;
}

module.exports = {
  logFiscalEvent,
  markQueueAccepted,
  markQueuePending,
  markQueueError,
  findLatestQueueItemByProviderUuid,
};

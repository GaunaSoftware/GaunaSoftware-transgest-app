async function logFiscalEvent(client, recordId, facturaId, empresaId, eventoTipo, detalle = {}) {
  await client.query(
    `INSERT INTO factura_eventos_fiscales
      (registro_id, factura_id, empresa_id, evento_tipo, detalle)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [recordId, facturaId, empresaId, eventoTipo, JSON.stringify(detalle || {})]
  );
}

async function markQueueAccepted(client, item, responsePayload, actorUserId) {
  if (client.transaction) return client.transaction(tx => markQueueAccepted(tx, item, responsePayload, actorUserId));
  const transition = await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='aceptado', retryable=false,
            response=COALESCE(response,'{}'::jsonb) || $1::jsonb,
            lease_until=NULL,
            error=NULL,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$2 AND estado NOT IN ('aceptado','omitido') RETURNING id`,
    [JSON.stringify(responsePayload), item.id]
  );
  if (!transition.rowCount) return;
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
        SET estado_envio='aceptado',
            ultimo_error=NULL,
            ultimo_envio_at=NOW(),
            updated_by=$1,
            updated_at=NOW()
      WHERE id=$2`,
    [actorUserId || null, item.registro_id]
  );
  await logFiscalEvent(client, item.registro_id, item.factura_id, item.empresa_id, "queue.accepted", responsePayload);
}

async function markQueuePending(client, item, responsePayload, actorUserId, retryInMs = 2 * 60 * 1000, detail = "Pendiente de confirmacion externa") {
  if (client.transaction) return client.transaction(tx => markQueuePending(tx, item, responsePayload, actorUserId, retryInMs, detail));
  const transition = await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='pendiente', retryable=true,
            response=COALESCE(response,'{}'::jsonb) || $1::jsonb,
            lease_until=NULL,
            error=NULL,
            next_retry_at=$2,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$3 AND estado NOT IN ('aceptado','omitido') RETURNING id`,
    [JSON.stringify(responsePayload), new Date(Date.now() + retryInMs).toISOString(), item.id]
  );
  if (!transition.rowCount) return;
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
  if (client.transaction) return client.transaction(tx => markQueueError(tx, item, message, actorUserId, retryable, responsePayload));
  const transition = await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='error', retryable=$5, lease_until=NULL,
            response=COALESCE(response,'{}'::jsonb) || COALESCE($1::jsonb,'{}'::jsonb),
            error=$2,
            next_retry_at=$3,
            processed_at=NOW(),
            updated_at=NOW()
      WHERE id=$4 AND estado NOT IN ('aceptado','omitido') RETURNING id`,
    [responsePayload ? JSON.stringify(responsePayload) : null, message, retryable ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null, item.id, retryable]
  );
  if (!transition.rowCount) return;
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

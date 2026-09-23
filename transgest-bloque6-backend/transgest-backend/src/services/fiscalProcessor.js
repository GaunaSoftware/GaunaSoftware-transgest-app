const crypto = require("crypto");
const db = require("./db");
const { getEmpresaFiscalConfig } = require("./fiscal");
const { createVerifactiRecord, getVerifactiRecordStatus, findVerifactiInvoice, mapInternalPayloadToVerifacti } = require("./fiscalProviderVerifacti");
const {
  markQueueAccepted,
  markQueuePending,
  markQueueError,
} = require("./fiscalQueueState");

function makeSimulatedReference(prefix) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `${prefix}-${stamp}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function processSingleQueueItem(client, item, config, actorUserId) {
  const claimed = await client.query(
    `UPDATE factura_envios_fiscales
        SET estado='procesando',
            intento=intento+1,
            updated_at=NOW()
      WHERE id=$1 AND updated_at=$2 AND estado IN ('pendiente','error')
      RETURNING id`,
    [item.id,item.claim_version]
  );
  if(!claimed.rows.length) return {status:"deferred",reason:"claimed_elsewhere"};

  if (config.modo === "ninguno") {
    await markQueueError(client, item, "La empresa no tiene modo fiscal activo.", actorUserId, false);
    return { status: "error", reason: "modo_inactivo" };
  }

  if (item.sistema === "verifactu" && config?.verifactu?.proveedor === "verifacti") {
    try {
      require("./fiscalEmission").assertRepresentation(config);
      if(item.payload?.emisor?.nif!==config.nif_declarante || item.entorno!==config.entorno)throw Object.assign(new Error("La empresa o el entorno del envío no coincide con la configuración actual."),{retryable:false});
      const request=mapInternalPayloadToVerifacti(item.payload || {});
      const hash=require('./fiscalIdentity').digest(request);
      if(item.request_hash && item.request_hash!==hash) throw Object.assign(new Error('La misma identidad fiscal contiene datos distintos. Revisa la factura; no se ha reenviado.'),{retryable:false});
      const hadIdentity=!!item.idempotency_key;
      item.idempotency_key=item.idempotency_key || `transgest:${item.empresa_id}:${item.factura_id}:${item.registro_id}`;
      item.request_payload=item.request_payload || request;
      await client.query(`UPDATE factura_envios_fiscales SET idempotency_key=$1,request_payload=$2::jsonb,request_hash=$3,first_attempt_at=COALESCE(first_attempt_at,NOW()) WHERE id=$4 AND empresa_id=$5`,[item.idempotency_key,JSON.stringify(item.request_payload),hash,item.id,item.empresa_id]);
      let providerUuid = item.provider_uuid || item?.response?.provider_uuid || item?.response?.uuid || null;
      let providerResult;
      if(!providerUuid && (!hadIdentity || Number(item.intento)>0 || (item.first_attempt_at && Date.now()-new Date(item.first_attempt_at).getTime()>23*60*60*1000))) {
        try {const found=await findVerifactiInvoice(config,item.request_payload);providerUuid=found.provider_uuid;}catch { /* An ambiguous lookup is not proof of absence. */ }
        if(!providerUuid && (!hadIdentity || !item.first_attempt_at || Date.now()-new Date(item.first_attempt_at).getTime()>23*60*60*1000)) {
          throw Object.assign(new Error('Resultado fiscal desconocido. Conciliar en Verifacti antes de reenviar: la ventana de idempotencia no está disponible.'),{retryable:false});
        }
      }
      providerResult=providerUuid ? await getVerifactiRecordStatus(config,providerUuid) : await createVerifactiRecord(config,item);

      if (providerResult.provider_status === "accepted") {
        await markQueueAccepted(client, item, providerResult, actorUserId);
        return { status: "accepted", provider: "verifacti", provider_uuid: providerResult.provider_uuid };
      }

      if (providerResult.provider_status === "pending") {
        await markQueuePending(
          client,
          item,
          providerResult,
          actorUserId,
          2 * 60 * 1000,
          providerUuid ? "Pendiente en Verifacti" : "Factura encolada en Verifacti"
        );
        return { status: "deferred", provider: "verifacti", provider_uuid: providerResult.provider_uuid };
      }

      await markQueueError(
        client,
        item,
        providerResult.provider_status==='accepted_with_errors' ? "Aceptada con errores por AEAT: requiere subsanación antes de contabilizar." : providerResult?.response?.mensaje_error || providerResult?.response?.error || providerResult?.response?.message || "Error devuelto por Verifacti.",
        actorUserId,
        false,
        providerResult
      );
      return { status: "error", reason: "verifacti_provider_error" };
    } catch (error) {
      const retryable=error.retryable!==false && (!error.status || error.status===409 || error.status===429 || error.status>=500);
      await markQueueError(client, item, `Verifacti: ${error.message}`, actorUserId, retryable, error?.data ? {error_response:error.data} : null);
      return { status: "error", reason: "verifacti_transport_error" };
    }
  }

  if (config.entorno === "pruebas") {
    const responsePayload = item.sistema === "sii"
      ? {
          simulado: true,
          sistema: "sii",
          entorno: "pruebas",
          csv: makeSimulatedReference("SII"),
          accepted_at: new Date().toISOString(),
          detalle: "Aceptacion simulada en entorno de pruebas",
        }
      : {
          simulado: true,
          sistema: "verifactu",
          entorno: "pruebas",
          registro_aeat: makeSimulatedReference("VF"),
          accepted_at: new Date().toISOString(),
          detalle: "Aceptacion simulada en entorno de pruebas",
        };
    await markQueueAccepted(client, item, responsePayload, actorUserId);
    return { status: "accepted", simulated: true };
  }

  const endpointUrl = item.sistema === "sii"
    ? config?.sii?.endpoint_url
    : config?.verifactu?.endpoint_url;

  if (!endpointUrl) {
    await markQueueError(
      client,
      item,
      `Falta endpoint configurado para ${String(item.sistema || "").toUpperCase()} en entorno de produccion.`,
      actorUserId,
      false
    );
    return { status: "error", reason: "missing_endpoint" };
  }

  await markQueueError(
    client,
    item,
    `Conector real ${String(item.sistema || "").toUpperCase()} pendiente de activar con certificado y transporte AEAT.`,
    actorUserId,
    false
  );
  return { status: "error", reason: "real_connector_pending" };
}

async function processPendingFiscalQueue({ empresaId, actorUserId = null, limit = 10, facturaId = null, client = db }) {
  if(client===db)return db.transaction(tx=>processPendingFiscalQueue({empresaId,actorUserId,limit,facturaId,client:tx}));
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const config = await getEmpresaFiscalConfig(empresaId, client);
  const params = [empresaId];
  let where = `empresa_id=$1`;
  if (facturaId) {
    params.push(facturaId);
    where += ` AND factura_id=$${params.length}`;
  }
  params.push(normalizedLimit);

  const { rows } = await client.query(
    `SELECT *
       FROM (
         SELECT DISTINCT ON (factura_id, sistema)
                id, registro_id, factura_id, empresa_id, sistema, entorno, estado, intento, payload, response, created_at, updated_at, updated_at::text AS claim_version, idempotency_key, request_payload, request_hash, provider_uuid, first_attempt_at, retryable, next_retry_at
           FROM factura_envios_fiscales
          WHERE ${where}
          ORDER BY factura_id, sistema, created_at DESC
       ) cola
      WHERE (estado='pendiente' OR (estado='error' AND retryable=true AND next_retry_at IS NOT NULL))
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY
        CASE estado WHEN 'error' THEN 0 ELSE 1 END,
        created_at ASC
      LIMIT $${params.length}`,
    params
  );

  const result = {
    total: rows.length,
    accepted: 0,
    errors: 0,
    simulated: 0,
    deferred: 0,
    items: [],
  };

  if(rows.length && config.modo==='verifactu' && config.verifactu.proveedor==='verifacti') {
    const health=await require('./fiscalProviderVerifacti').probeVerifactiConnection(config);
    if(!health.ok)throw Object.assign(new Error(health.message),{status:503});
  }

  for (const item of rows) {
    const out = await processSingleQueueItem(client, item, config, actorUserId);
    result.items.push({ factura_id: item.factura_id, sistema: item.sistema, ...out });
    if (out.status === "accepted") {
      result.accepted += 1;
      if (out.simulated) result.simulated += 1;
    } else if (out.status === "deferred") {
      result.deferred += 1;
    } else {
      result.errors += 1;
    }
  }

  return result;
}

module.exports = {
  processPendingFiscalQueue,
};

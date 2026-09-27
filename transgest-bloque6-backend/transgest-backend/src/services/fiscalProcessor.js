const crypto = require("crypto");
const db = require("./db");
const { getEmpresaFiscalConfig } = require("./fiscal");
const { fiscalProvider } = require("./fiscalProviders");
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

  if (item.entorno !== config.entorno || item.sistema !== config.modo) {
    await markQueueError(client, item, "El entorno o sistema actual no coincide con el registro original. No se enviará en otro entorno.", actorUserId, false);
    return { status: "error", reason: "scope_changed" };
  }
  if (config.modo === "ninguno") {
    await markQueueError(client, item, "La empresa no tiene modo fiscal activo.", actorUserId, false);
    return { status: "error", reason: "modo_inactivo" };
  }

  if (item.sistema === "verifactu" && config?.verifactu?.proveedor === "verifacti") {
    try {
      const providerUuid = item?.response?.provider_uuid || item?.response?.uuid || null;
      if (!providerUuid && (!item.first_attempt_at || Date.now() - new Date(item.first_attempt_at).getTime() > 23 * 60 * 60 * 1000)) {
        await markQueueError(client, item, "Envío sin UUID fuera de la ventana segura de idempotencia. Conciliar con el proveedor antes de reenviar.", actorUserId, false);
        return { status: "error", reason: "reconciliation_required" };
      }
      const provider = fiscalProvider(config);
      const providerResult = providerUuid ? await provider.getStatus(providerUuid) : await provider.sendRecord(item);

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
        providerResult?.response?.error || providerResult?.response?.message || "Error devuelto por Verifacti.",
        actorUserId,
        false,
        providerResult
      );
      return { status: "error", reason: "verifacti_provider_error" };
    } catch (error) {
      await markQueueError(client, item, `Verifacti: ${error.message}`, actorUserId, !error.status || [408, 409, 429].includes(error.status) || error.status >= 500, error?.data ? { last_error_response: error.data } : null);
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
  const normalizedLimit = Math.max(1, Math.min(Number(limit) || 10, 50));
  const config = await getEmpresaFiscalConfig(empresaId, client);
  // One committed atomic claim before external I/O. Do not call inside an outer transaction.
  // Select the latest row across ALL states, so a newer accepted row hides old errors.
  async function claim() {
    const { rows } = await client.query(`WITH latest AS (
      SELECT DISTINCT ON (factura_id,sistema) id FROM factura_envios_fiscales
      WHERE empresa_id=$1 AND ($2::uuid IS NULL OR factura_id=$2)
      ORDER BY factura_id,sistema,created_at DESC,id DESC
    ), candidate AS (
      SELECT q.id FROM factura_envios_fiscales q JOIN latest l ON l.id=q.id
      WHERE ((q.estado IN ('pendiente','error') AND q.retryable AND (q.next_retry_at IS NULL OR q.next_retry_at<=now()))
        OR (q.estado='procesando' AND q.lease_until<now()))
      AND NOT EXISTS (SELECT 1 FROM factura_envios_fiscales accepted WHERE accepted.empresa_id=q.empresa_id
        AND accepted.registro_id=q.registro_id AND accepted.estado='aceptado')
      ORDER BY q.created_at,q.id FOR UPDATE OF q SKIP LOCKED LIMIT 1
    ) UPDATE factura_envios_fiscales q SET estado='procesando', intento=q.intento+1,
      first_attempt_at=CASE WHEN q.intento=0 THEN now() ELSE q.first_attempt_at END,
      lease_until=now()+interval '2 minutes',updated_at=now()
      FROM candidate c WHERE q.id=c.id RETURNING q.*`, [empresaId, facturaId]);
    return rows[0];
  }

  const result = {
    total: 0,
    accepted: 0,
    errors: 0,
    simulated: 0,
    deferred: 0,
    items: [],
  };

  for (let index = 0; index < normalizedLimit; index++) {
    const item = await claim();
    if (!item) break;
    result.total++;
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

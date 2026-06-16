const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const { getEmpresaFiscalConfig } = require("../services/fiscal");
const { extractVerifactiWebhookPayload } = require("../services/fiscalProviderVerifacti");
const {
  markQueueAccepted,
  markQueuePending,
  markQueueError,
  logFiscalEvent,
  findLatestQueueItemByProviderUuid,
} = require("../services/fiscalQueueState");

const router = express.Router();

function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}

function pickWebhookSecret(req) {
  const bearer = String(req.headers.authorization || "").startsWith("Bearer ")
    ? String(req.headers.authorization || "").slice(7)
    : "";
  return String(
    req.headers["x-verifacti-secret"]
    || req.headers["x-transgest-fiscal-secret"]
    || req.query.secret
    || bearer
    || ""
  ).trim();
}

router.post("/webhook/verifacti/:empresaId", async (req, res) => {
  try {
    const empresaId = req.params.empresaId;
    const config = await getEmpresaFiscalConfig(empresaId);
    if (config?.modo !== "verifactu" || config?.verifactu?.proveedor !== "verifacti") {
      return res.status(409).json({ error: "La empresa no tiene Verifacti activo." });
    }

    const expectedSecret = String(config?.verifactu?.provider_webhook_secret || "").trim();
    if (!expectedSecret) {
      return res.status(409).json({ error: "Webhook secret de Verifacti no configurado en la empresa." });
    }

    const receivedSecret = pickWebhookSecret(req);
    if (!receivedSecret || !safeEqual(expectedSecret, receivedSecret)) {
      return res.status(401).json({ error: "Webhook secret invalido." });
    }

    const payload = extractVerifactiWebhookPayload(req.body || {});
    if (!payload.provider_uuid) {
      return res.status(400).json({ error: "Webhook sin UUID de proveedor." });
    }

    const queueItem = await findLatestQueueItemByProviderUuid(db, empresaId, "verifactu", payload.provider_uuid);
    if (!queueItem) {
      return res.status(404).json({ error: "No se encontro envio fiscal asociado a ese UUID." });
    }

    await db.transaction(async (client) => {
      if (payload.provider_status === "accepted") {
        await markQueueAccepted(client, queueItem, payload, null);
      } else if (payload.provider_status === "pending") {
        await markQueuePending(client, queueItem, payload, null, 2 * 60 * 1000, "Pendiente confirmado por webhook Verifacti");
      } else {
        await markQueueError(
          client,
          queueItem,
          payload?.response?.error || payload?.response?.message || "Error notificado por webhook Verifacti.",
          null,
          false,
          payload
        );
      }
      await logFiscalEvent(client, queueItem.registro_id, queueItem.factura_id, queueItem.empresa_id, "webhook.verifacti.recibido", payload);
    });

    res.json({
      ok: true,
      provider: "verifacti",
      provider_uuid: payload.provider_uuid,
      provider_status: payload.provider_status,
      factura_id: queueItem.factura_id,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;

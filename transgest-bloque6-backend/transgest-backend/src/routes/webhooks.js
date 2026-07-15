// Gestion de webhooks salientes (solo gerencia). Permite a una empresa recibir
// notificaciones push en su sistema cuando ocurren eventos en TransGest.
const express = require("express");
const webhooks = require("../services/webhooks");

const router = express.Router();

function empresaId(req) {
  return req.empresaId || req.user?.empresa_id || null;
}

router.get("/events", (req, res) => {
  res.json({
    events: webhooks.WEBHOOK_EVENTS,
    signature: "Cada envio incluye la cabecera X-TransGest-Signature: sha256=HMAC(secret, cuerpo).",
    verify: "Calcula HMAC-SHA256 del cuerpo con el secreto de la suscripcion y comparalo con la firma.",
  });
});

router.get("/", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    res.json({ data: await webhooks.listWebhooks(eid) });
  } catch (err) { next(err); }
});

router.post("/", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    const result = await webhooks.createWebhook(eid, { url: req.body?.url, events: req.body?.events }, req.user?.id || null);
    res.status(201).json({
      secret: result.secret,
      message: "Guarda este secreto ahora para verificar las firmas. No se volvera a mostrar completo.",
      webhook: result.webhook,
    });
  } catch (err) { next(err); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    const eid = empresaId(req);
    if (!eid) return res.status(403).json({ error: "Usuario sin empresa" });
    const revoked = await webhooks.revokeWebhook(eid, req.params.id);
    if (!revoked) return res.status(404).json({ error: "Webhook no encontrado" });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

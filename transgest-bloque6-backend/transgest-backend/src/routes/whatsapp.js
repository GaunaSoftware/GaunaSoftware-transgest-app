const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { authenticate, SOLO_GERENTE, GERENTE_O_TRAFICO } = require("../middleware/auth");
const {
  ensureWhatsappTables,
  getEmpresaWhatsappConfig,
  saveEmpresaWhatsappConfig,
  getWhatsappStatus,
  loadPedidoWhatsappContext,
  buildPedidoWhatsappPreflight,
  sendPedidoWhatsapp,
  hashValue,
} = require("../services/whatsapp");

const router = express.Router();
const EID = req => req.empresaId || req.user?.empresa_id;

function verifyMetaSignature(req, appSecret) {
  if (!appSecret) return { checked: false, ok: true };
  const signature = String(req.get("x-hub-signature-256") || "");
  if (!signature.startsWith("sha256=")) return { checked: true, ok: false };
  const raw = JSON.stringify(req.body || {});
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(raw).digest("hex");
  try {
    return {
      checked: true,
      ok: crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)),
    };
  } catch {
    return { checked: true, ok: false };
  }
}

router.get("/webhook", async (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode !== "subscribe" || !token) return res.sendStatus(403);
  try {
    await ensureWhatsappTables();
    const tokenHash = hashValue(token);
    const { rows } = await db.query(
      "SELECT empresa_id FROM empresa_whatsapp_config WHERE verify_token_hash=$1 AND activo=true LIMIT 1",
      [tokenHash]
    );
    if (!rows[0]) return res.sendStatus(403);
    return res.status(200).send(String(challenge || ""));
  } catch {
    return res.sendStatus(403);
  }
});

router.post("/webhook", async (req, res) => {
  try {
    await ensureWhatsappTables();
    const entries = Array.isArray(req.body?.entry) ? req.body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value || {};
        const phoneNumberId = value?.metadata?.phone_number_id || "";
        if (!phoneNumberId) continue;
        const cfgRows = await db.query(
          "SELECT empresa_id, app_secret_encrypted FROM empresa_whatsapp_config WHERE phone_number_id=$1 AND activo=true LIMIT 1",
          [phoneNumberId]
        );
        const cfg = cfgRows.rows[0];
        if (!cfg) continue;
        const statuses = Array.isArray(value.statuses) ? value.statuses : [];
        const messages = Array.isArray(value.messages) ? value.messages : [];
        for (const status of statuses) {
          await db.query(`
            INSERT INTO whatsapp_log (empresa_id,destinatario_tipo,destinatario,estado,provider,message_id,meta)
            VALUES ($1,'webhook',$2,$3,'meta_cloud',$4,$5)
          `, [
            cfg.empresa_id,
            status.recipient_id || "",
            status.status || "webhook",
            status.id || "",
            JSON.stringify({ webhook_type: "status", payload: status }),
          ]).catch(() => {});
        }
        for (const message of messages) {
          await db.query(`
            INSERT INTO whatsapp_log (empresa_id,destinatario_tipo,destinatario,estado,provider,message_id,mensaje,meta)
            VALUES ($1,'inbound',$2,'recibido','meta_cloud',$3,$4,$5)
          `, [
            cfg.empresa_id,
            message.from || "",
            message.id || "",
            message.text?.body || "",
            JSON.stringify({ webhook_type: "message", payload: message }),
          ]).catch(() => {});
        }
      }
    }
    res.sendStatus(200);
  } catch {
    res.sendStatus(200);
  }
});

router.use(authenticate);

router.get("/status", SOLO_GERENTE, async (req, res) => {
  try {
    res.json(await getWhatsappStatus(EID(req)));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/config", SOLO_GERENTE, async (req, res) => {
  try {
    res.json(await getEmpresaWhatsappConfig(EID(req)) || (await getWhatsappStatus(EID(req))));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.put("/config", SOLO_GERENTE, async (req, res) => {
  try {
    const config = await saveEmpresaWhatsappConfig(EID(req), req.body || {}, req.user?.id || null);
    res.json({ ok: true, config });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/log", SOLO_GERENTE, async (req, res) => {
  try {
    await ensureWhatsappTables();
    const { rows } = await db.query(
      "SELECT * FROM whatsapp_log WHERE empresa_id=$1 ORDER BY sent_at DESC LIMIT 200",
      [EID(req)]
    );
    res.json(rows);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/pedido/:id/preflight", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const empresaId = EID(req);
    const pedido = await loadPedidoWhatsappContext(req.params.id, empresaId);
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado" });
    const cfg = await getEmpresaWhatsappConfig(empresaId, true) || {};
    const target = String(req.query.target || req.query.destinatario_tipo || "cliente").toLowerCase() === "colaborador" ? "colaborador" : "cliente";
    res.json(buildPedidoWhatsappPreflight(pedido, cfg, target, req.query.destinatario || ""));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

router.post("/pedido/:id", GERENTE_O_TRAFICO, async (req, res) => {
  try {
    const result = await sendPedidoWhatsapp({
      empresaId: EID(req),
      pedidoId: req.params.id,
      target: String(req.body?.target || req.body?.destinatario_tipo || "cliente").toLowerCase() === "colaborador" ? "colaborador" : "cliente",
      phoneOverride: req.body?.destinatario || "",
      templateName: req.body?.template_name || "",
      message: req.body?.mensaje || "",
      force: req.body?.force === true,
      actorId: req.user?.id || null,
    });
    res.json(result);
  } catch(e) {
    res.status(e.status || 500).json({ error: e.message, preflight: e.preflight || null, log: e.log || null });
  }
});

module.exports = router;

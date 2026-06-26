const crypto = require("crypto");
const express = require("express");
const db = require("../services/db");
const logger = require("../services/logger");

const router = express.Router();

function safeJson(raw) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "{}");
  return JSON.parse(text);
}

function verifySignature(raw, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  if (!header) return false;

  const parts = header.split(",").reduce((acc, part) => {
    const [k, v] = part.split("=");
    if (!k || !v) return acc;
    if (k === "v1") acc.v1.push(v);
    else acc[k] = v;
    return acc;
  }, { v1: [] });
  if (!parts.t || !parts.v1.length) return false;
  const timestamp = Number(parts.t);
  const tolerance = Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SEC || 300);
  if (!Number.isFinite(timestamp) || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > tolerance) return false;

  const payload = `${parts.t}.${Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw)}`;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  return parts.v1.some(sig => {
    try {
      return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(sig, "hex"));
    } catch {
      return false;
    }
  });
}

async function nextNumeroFactura() {
  const last = await db.query("SELECT numero FROM facturas_suscripcion ORDER BY created_at DESC LIMIT 1").catch(() => ({ rows: [] }));
  const lastN = last.rows[0] ? parseInt(String(last.rows[0].numero).replace(/[^0-9]/g, ""), 10) : 0;
  return "FTMS-" + String(new Date().getFullYear()) + "-" + String((Number.isFinite(lastN) ? lastN : 0) + 1).padStart(4, "0");
}

async function empresaFromStripeObject(obj) {
  const empresaId = obj?.metadata?.empresa_id || obj?.client_reference_id || obj?.subscription_details?.metadata?.empresa_id;
  if (empresaId) {
    const found = await db.query("SELECT * FROM empresas WHERE id=$1", [empresaId]);
    if (found.rows[0]) return found.rows[0];
  }
  const customer = obj?.customer;
  if (customer) {
    const found = await db.query("SELECT * FROM empresas WHERE stripe_customer_id=$1", [customer]);
    if (found.rows[0]) return found.rows[0];
  }
  return null;
}

async function registrarFacturaSuscripcion(empresa, invoice) {
  if (invoice.id) {
    const existing = await db.query(
      "SELECT id FROM facturas_suscripcion WHERE stripe_invoice_id=$1 LIMIT 1",
      [invoice.id]
    ).catch(() => ({ rows: [] }));
    if (existing.rows[0]) return;
  }
  const total = Number(invoice.amount_paid || invoice.total || 0) / 100;
  const line = invoice.lines?.data?.[0];
  const desde = line?.period?.start ? new Date(line.period.start * 1000) : new Date();
  const hasta = line?.period?.end ? new Date(line.period.end * 1000) : new Date();
  const numero = await nextNumeroFactura();

  await db.query(`
    INSERT INTO facturas_suscripcion
      (empresa_id, numero, concepto, plan, periodo_desde, periodo_hasta, importe, estado, fecha_vencimiento, fecha_pago, stripe_invoice_id, notas)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'pagada',$6,CURRENT_DATE,$8,$9)
    ON CONFLICT DO NOTHING
  `, [
    empresa.id,
    numero,
    "Suscripcion TransGest",
    empresa.plan || null,
    desde,
    hasta,
    total,
    invoice.id || null,
    invoice.id ? `Stripe invoice ${invoice.id}` : null,
  ]);
}

router.post("/", async (req, res) => {
  if (!verifySignature(req.body, req.headers["stripe-signature"])) {
    return res.status(400).json({ error: "Firma de Stripe no valida" });
  }

  let event;
  try {
    event = safeJson(req.body);
  } catch {
    return res.status(400).json({ error: "Payload no valido" });
  }

  const obj = event.data?.object || {};
  try {
    if (event.type === "checkout.session.completed") {
      const empresa = await empresaFromStripeObject(obj);
      if (empresa) {
        await db.query(
          `UPDATE empresas
           SET estado='activo', bloqueo_manual=false, bloqueo_motivo=NULL,
               stripe_customer_id=COALESCE(stripe_customer_id,$1),
               stripe_subscription_id=COALESCE($2,stripe_subscription_id)
           WHERE id=$3`,
          [obj.customer || null, obj.subscription || null, empresa.id]
        );
      }
    }

    if (event.type === "invoice.paid") {
      const empresa = await empresaFromStripeObject(obj);
      if (empresa) {
        const line = obj.lines?.data?.[0];
        const hasta = line?.period?.end ? new Date(line.period.end * 1000) : null;
        await db.query(
          `UPDATE empresas
           SET estado='activo', bloqueo_manual=false, bloqueo_motivo=NULL,
               fecha_vencimiento=COALESCE($1, fecha_vencimiento),
               stripe_customer_id=COALESCE(stripe_customer_id,$2),
               stripe_subscription_id=COALESCE($3,stripe_subscription_id)
           WHERE id=$4`,
          [hasta, obj.customer || null, obj.subscription || null, empresa.id]
        );
        await registrarFacturaSuscripcion(empresa, obj);
      }
    }

    if (event.type === "invoice.payment_failed") {
      const empresa = await empresaFromStripeObject(obj);
      if (empresa) {
        await db.query(
          `UPDATE empresas
           SET bloqueo_motivo='impago',
               fecha_vencimiento=COALESCE(fecha_vencimiento, CURRENT_DATE)
           WHERE id=$1`,
          [empresa.id]
        );
      }
    }

    if (event.type === "customer.subscription.deleted") {
      const empresa = await empresaFromStripeObject(obj);
      if (empresa) {
        await db.query(
          "UPDATE empresas SET estado='suspendido', bloqueo_motivo='impago' WHERE id=$1",
          [empresa.id]
        );
      }
    }

    res.json({ received: true });
  } catch (err) {
    logger.error("Stripe webhook error: " + err.message);
    res.status(500).json({ error: "Error procesando webhook" });
  }
});

module.exports = router;

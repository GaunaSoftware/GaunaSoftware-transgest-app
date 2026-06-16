const db = require("./db");
const logger = require("./logger");
const { enviarEmail } = require("./email");
const stripe = require("./stripe");

let started = false;

function formatDateEs(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("es-ES");
}

function billingEmail(empresa = {}) {
  return String(empresa.email_facturacion || empresa.email_admin || "").trim().toLowerCase();
}

async function checkoutUrl(empresa) {
  if (!stripe.configured() || !stripe.planPriceId(empresa.plan, empresa.ciclo_facturacion)) return "";
  try {
    let customerId = empresa.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.createCustomer({
        email: billingEmail(empresa),
        name: empresa.nombre,
        empresaId: empresa.id,
      });
      customerId = customer.id;
      await db.query("UPDATE empresas SET stripe_customer_id=$1 WHERE id=$2", [customerId, empresa.id]);
    }
    const session = await stripe.createCheckoutSession({
      customerId,
      priceId: stripe.planPriceId(empresa.plan, empresa.ciclo_facturacion),
      empresaId: empresa.id,
      plan: empresa.plan,
      ciclo: empresa.ciclo_facturacion,
      userId: null,
      metodoPago: empresa.metodo_pago || "auto",
    });
    return session.url || "";
  } catch (err) {
    logger.warn(`[Billing] No se pudo crear checkout para ${empresa.id}: ${err.message}`);
    return "";
  }
}

async function processBillingReminders() {
  const { rows } = await db.query(`
    SELECT *
    FROM empresas
    WHERE estado='activo'
      AND fecha_vencimiento IS NOT NULL
      AND email_admin IS NOT NULL
      AND (
        (fecha_vencimiento::date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
          AND (ultimo_aviso_pago_at IS NULL OR ultimo_aviso_pago_at::date < CURRENT_DATE))
        OR
        (fecha_vencimiento::date < CURRENT_DATE
          AND (ultimo_aviso_vencido_at IS NULL OR ultimo_aviso_vencido_at::date < CURRENT_DATE))
      )
    ORDER BY fecha_vencimiento ASC
    LIMIT 100
  `).catch(() => ({ rows: [] }));

  let enviados = 0;
  for (const empresa of rows) {
    const to = billingEmail(empresa);
    if (!to) continue;
    const vencido = new Date(empresa.fecha_vencimiento) < new Date();
    const plantilla = vencido ? "suscripcion_pago_vencido" : "suscripcion_proximo_vencimiento";
    const url = await checkoutUrl(empresa);
    try {
      await enviarEmail({
        trigger: plantilla,
        destinatario: to,
        plantilla,
        datos: {
          nombre: empresa.nombre,
          empresa: empresa.nombre,
          fecha_vencimiento: formatDateEs(empresa.fecha_vencimiento),
          checkout_url: url,
        },
        empresa_id: empresa.id,
        force_platform: true,
        meta: { empresa_id: empresa.id, auto: true },
      });
      await db.query(
        `UPDATE empresas
         SET ultimo_aviso_pago_at=CASE WHEN $2::boolean THEN ultimo_aviso_pago_at ELSE NOW() END,
             ultimo_aviso_vencido_at=CASE WHEN $2::boolean THEN NOW() ELSE ultimo_aviso_vencido_at END
         WHERE id=$1`,
        [empresa.id, vencido]
      );
      enviados += 1;
    } catch (err) {
      logger.warn(`[Billing] No se pudo enviar aviso a ${to}: ${err.message}`);
    }
  }
  if (enviados) logger.info(`[Billing] Avisos de pago enviados: ${enviados}`);
  return { revisadas: rows.length, enviados };
}

function startScheduler() {
  if (started) return;
  started = true;
  try {
    const cron = require("node-cron");
    cron.schedule("15 9 * * *", () => {
      processBillingReminders().catch(err => logger.warn("[Billing] Scheduler: " + err.message));
    });
    logger.info("[Billing] Scheduler iniciado - avisos diarios a las 09:15");
  } catch (err) {
    setInterval(() => {
      processBillingReminders().catch(e => logger.warn("[Billing] Scheduler: " + e.message));
    }, 24 * 60 * 60 * 1000);
    logger.info("[Billing] Scheduler iniciado - avisos cada 24h");
  }
  setTimeout(() => processBillingReminders().catch(err => logger.warn("[Billing] Inicial: " + err.message)), 15000);
}

module.exports = {
  startScheduler,
  processBillingReminders,
};

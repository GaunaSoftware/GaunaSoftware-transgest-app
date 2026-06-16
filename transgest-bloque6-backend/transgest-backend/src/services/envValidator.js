const logger = require("./logger");

function hasPlaceholder(value) {
  return !value || /CAMBIA|xxx|tudominio|TU_|PASSWORD/i.test(String(value));
}

function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const warnings = [];
  const critical = [];

  if (hasPlaceholder(process.env.JWT_SECRET) || String(process.env.JWT_SECRET || "").length < 32) {
    critical.push("JWT_SECRET debe ser una clave larga y aleatoria.");
  }
  if (hasPlaceholder(process.env.DB_PASSWORD)) {
    warnings.push("DB_PASSWORD no parece configurado con un valor real.");
  }
  if (isProd && !process.env.CORS_ORIGINS) {
    critical.push("CORS_ORIGINS debe estar configurado en produccion.");
  }
  if (isProd && !process.env.PUBLIC_APP_URL && !process.env.APP_PUBLIC_URL && !process.env.APP_URL) {
    critical.push("PUBLIC_APP_URL o APP_URL debe estar configurado en produccion.");
  }

  const smtpFields = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
  const smtpConfigured = smtpFields.some(key => process.env[key]);
  if (smtpConfigured) {
    const missing = smtpFields.filter(key => !process.env[key]);
    if (missing.length) warnings.push(`SMTP incompleto: faltan ${missing.join(", ")}.`);
  }

  const stripeConfigured = !!process.env.STRIPE_SECRET_KEY;
  if (stripeConfigured && !process.env.STRIPE_WEBHOOK_SECRET) {
    warnings.push("Stripe configurado sin STRIPE_WEBHOOK_SECRET.");
  }

  warnings.forEach(msg => logger.warn("[env] " + msg));
  if (critical.length) {
    const message = critical.join(" ");
    if (isProd) throw new Error("[env] Configuracion critica incompleta: " + message);
    logger.warn("[env] " + message);
  }

  return { warnings, critical };
}

module.exports = { validateEnv };

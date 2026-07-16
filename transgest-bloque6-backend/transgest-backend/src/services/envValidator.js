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
  if (isProd) {
    const secretDomains = [
      ["USER_JWT_SECRET", process.env.USER_JWT_SECRET],
      ["SUPERADMIN_JWT_SECRET", process.env.SUPERADMIN_JWT_SECRET],
      ["ACCOUNTING_SSO_JWT_SECRET", process.env.ACCOUNTING_SSO_JWT_SECRET],
      ["API_KEYS_ENCRYPTION_SECRET", process.env.API_KEYS_ENCRYPTION_SECRET],
      ["DOC_CONTROL_SECRET", process.env.DOC_CONTROL_SECRET],
    ];
    for (const [name, value] of secretDomains) {
      if (hasPlaceholder(value) || String(value || "").length < 32) {
        critical.push(`${name} debe ser una clave larga, aleatoria y exclusiva.`);
      }
    }
    const configuredSecrets = secretDomains.map(([, value]) => String(value || ""));
    if (new Set(configuredSecrets).size !== configuredSecrets.length) {
      critical.push("Los secretos de usuario, superadmin, SSO contable, claves API y documentos publicos deben ser distintos entre si.");
    }
    if (configuredSecrets.some(value => value && value === String(process.env.JWT_SECRET || ""))) {
      critical.push("Los secretos especializados no pueden reutilizar JWT_SECRET.");
    }
  }
  if (hasPlaceholder(process.env.DB_PASSWORD) || String(process.env.DB_PASSWORD || "").length < 20) {
    const message = "DB_PASSWORD debe ser una clave real de al menos 20 caracteres.";
    if (isProd) critical.push(message);
    else warnings.push(message);
  }
  if (isProd && !process.env.CORS_ORIGINS) {
    critical.push("CORS_ORIGINS debe estar configurado en produccion.");
  }
  const corsOrigins = String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  const secureOrigin = value => /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(value)
    || /^http:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(value);
  if (isProd && corsOrigins.some(value => value === "*" || !secureOrigin(value))) {
    critical.push("CORS_ORIGINS solo puede contener origenes HTTPS concretos en produccion.");
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

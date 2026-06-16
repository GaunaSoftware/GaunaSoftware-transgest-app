require("../resolveWorkspaceModules");
require("dotenv").config();

function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null || value === "" ? fallback : value;
}

module.exports = {
  env,
  port: Number(env("ACCOUNTING_PORT", env("PORT", "3011"))),
  jwtSecret: env("ACCOUNTING_JWT_SECRET", env("JWT_SECRET", "dev-accounting-secret")),
  ssoJwtSecret: env("ACCOUNTING_SSO_JWT_SECRET", env("JWT_SECRET", "dev-accounting-secret")),
  jwtExpiresIn: env("ACCOUNTING_JWT_EXPIRES_IN", "8h"),
  schema: env("ACCOUNTING_DB_SCHEMA", "accounting"),
  outbox: {
    consumerName: env("ACCOUNTING_OUTBOX_CONSUMER_NAME", "accounting-internal-v1"),
    pollIntervalMs: Number(env("ACCOUNTING_OUTBOX_POLL_INTERVAL_MS", "1000")),
    leaseSeconds: Number(env("ACCOUNTING_OUTBOX_LEASE_SECONDS", "60")),
    maxAttempts: Number(env("ACCOUNTING_OUTBOX_MAX_ATTEMPTS", "5")),
  },
  corsOrigins: env("ACCOUNTING_CORS_ORIGINS", "http://localhost,http://127.0.0.1,http://localhost:8080,http://127.0.0.1:8080")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
  db: {
    host: env("ACCOUNTING_DB_HOST", env("DB_HOST", "localhost")),
    port: Number(env("ACCOUNTING_DB_PORT", env("DB_PORT", "5432"))),
    database: env("ACCOUNTING_DB_NAME", env("DB_NAME", "transgest")),
    user: env("ACCOUNTING_DB_USER", env("DB_USER", "transgest_user")),
    password: env("ACCOUNTING_DB_PASSWORD", env("DB_PASSWORD", "")),
    ssl: env("ACCOUNTING_DB_SSL", env("DB_SSL", "false")) === "true",
  },
};

require("../resolveWorkspaceModules");
const { Pool } = require("pg");
const config = require("./config");
const logger = require("./logger");

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  database: config.db.database,
  user: config.db.user,
  password: config.db.password,
  max: Number(process.env.ACCOUNTING_DB_POOL_MAX || "10"),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  options: "-c statement_timeout=20000 -c lock_timeout=5000 -c idle_in_transaction_session_timeout=15000",
  ssl: config.db.ssl ? { rejectUnauthorized: false } : false,
});

pool.on("error", err => logger.error({ msg: "accounting_db_pool_error", error: err.message }));

async function query(text, params = []) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const elapsedMs = Date.now() - start;
    if (elapsedMs > 500) logger.warn({ msg: "accounting_slow_query", elapsed_ms: elapsedMs, sql: text.slice(0, 120) });
    return result;
  } catch (err) {
    logger.error({ msg: "accounting_db_error", error: err.message, sql: text.slice(0, 120) });
    throw err;
  }
}

async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, transaction };

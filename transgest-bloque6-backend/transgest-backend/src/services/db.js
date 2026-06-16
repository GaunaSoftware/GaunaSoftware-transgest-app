const { Pool } = require("pg");
const logger   = require("./logger");

const DB_STATEMENT_TIMEOUT_MS = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || "20000", 10);
const DB_LOCK_TIMEOUT_MS = parseInt(process.env.DB_LOCK_TIMEOUT_MS || "5000", 10);
const DB_IDLE_IN_TX_TIMEOUT_MS = parseInt(process.env.DB_IDLE_IN_TX_TIMEOUT_MS || "15000", 10);

const pool = new Pool({
  host:     process.env.DB_HOST     || "localhost",
  port:     parseInt(process.env.DB_PORT || "5432"),
  database: process.env.DB_NAME     || "transgest",
  user:     process.env.DB_USER     || "transgest_user",
  password: process.env.DB_PASSWORD,
  max:      parseInt(process.env.DB_POOL_MAX || "20"),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  options: `-c statement_timeout=${DB_STATEMENT_TIMEOUT_MS} -c lock_timeout=${DB_LOCK_TIMEOUT_MS} -c idle_in_transaction_session_timeout=${DB_IDLE_IN_TX_TIMEOUT_MS}`,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

pool.on("error", (err) => {
  logger.error("PostgreSQL pool error: " + err.message);
});

// Helper: query
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const ms  = Date.now() - start;
    if (ms > 500) logger.warn("Query lenta (" + ms + "ms): " + text.slice(0, 80));
    return res;
  } catch (err) {
    logger.error("DB error: " + err.message + " | query: " + text.slice(0, 80));
    throw err;
  }
}

// Helper: transacción
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

module.exports = { query, transaction, pool };

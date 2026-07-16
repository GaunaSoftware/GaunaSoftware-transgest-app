const db = require("./db");
const logger = require("./logger");

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_FLUSH_MS = 250;
const DEFAULT_MAX_QUEUE = 5000;

const queue = [];
let timer = null;
let flushing = null;
let dropped = 0;

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function config() {
  return {
    batchSize: positiveInt(process.env.AUDIT_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    flushMs: positiveInt(process.env.AUDIT_FLUSH_MS, DEFAULT_FLUSH_MS),
    maxQueue: positiveInt(process.env.AUDIT_MAX_QUEUE, DEFAULT_MAX_QUEUE),
  };
}

function scheduleFlush() {
  if (timer || flushing || !queue.length) return;
  timer = setTimeout(() => {
    timer = null;
    flush().catch(error => logger.error("Audit queue flush: " + error.message));
  }, config().flushMs);
  timer.unref?.();
}

function enqueue(entry) {
  if (!entry) return;
  const { maxQueue, batchSize } = config();
  if (queue.length >= maxQueue) {
    dropped += 1;
    if (dropped === 1 || dropped % 100 === 0) {
      logger.error(`Audit queue saturada: ${dropped} evento(s) descartado(s)`);
    }
    return;
  }
  queue.push(entry);
  if (queue.length >= batchSize) {
    if (timer) clearTimeout(timer);
    timer = null;
    setImmediate(() => flush().catch(error => logger.error("Audit queue flush: " + error.message)));
    return;
  }
  scheduleFlush();
}

async function writeBatch(batch) {
  if (!batch.length) return;
  const params = [];
  const values = batch.map((entry, index) => {
    const offset = index * 7;
    params.push(
      entry.actor_tipo || "usuario",
      entry.actor_id || null,
      entry.actor_email || null,
      entry.empresa_id || null,
      entry.accion,
      JSON.stringify(entry.detalle || {}),
      entry.ip || null
    );
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6}::jsonb,$${offset + 7})`;
  });
  await db.query(
    `INSERT INTO audit_log_saas
      (actor_tipo,actor_id,actor_email,empresa_id,accion,detalle,ip)
     VALUES ${values.join(",")}`,
    params
  );
}

async function flush() {
  if (flushing) return flushing;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!queue.length) return;

  flushing = (async () => {
    const { batchSize } = config();
    while (queue.length) {
      const batch = queue.splice(0, batchSize);
      try {
        await writeBatch(batch);
      } catch (error) {
        queue.unshift(...batch);
        throw error;
      }
    }
  })();

  try {
    await flushing;
  } finally {
    flushing = null;
    scheduleFlush();
  }
}

function stats() {
  return { queued: queue.length, dropped, flushing: Boolean(flushing) };
}

module.exports = { enqueue, flush, stats };

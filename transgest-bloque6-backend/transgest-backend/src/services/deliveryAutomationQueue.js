const db = require("./db");
const logger = require("./logger");
let schema;
let processing;
let timer;
let handler;

function ensureSchema() {
  if (!schema) schema = db.query(`CREATE TABLE IF NOT EXISTS pedido_entrega_jobs (
    empresa_id UUID NOT NULL, pedido_id UUID NOT NULL, usuario_id TEXT, options JSONB NOT NULL DEFAULT '{}',
    disponible_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), intentos INTEGER NOT NULL DEFAULT 0,
    completado_at TIMESTAMPTZ, error TEXT, PRIMARY KEY (empresa_id,pedido_id)
  )`).then(() => db.query("ALTER TABLE pedido_entrega_jobs ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1"))
    .catch(error => { schema = null; throw error; });
  return schema;
}

async function enqueue(pedidoId, empresaId, usuarioId, options) {
  await ensureSchema();
  await db.query(`INSERT INTO pedido_entrega_jobs (empresa_id,pedido_id,usuario_id,options)
    VALUES ($1,$2,$3,$4) ON CONFLICT (empresa_id,pedido_id) DO UPDATE
    SET completado_at=NULL, disponible_at=CASE WHEN pedido_entrega_jobs.completado_at IS NOT NULL THEN NOW() ELSE pedido_entrega_jobs.disponible_at END,
        usuario_id=EXCLUDED.usuario_id, options=EXCLUDED.options, revision=pedido_entrega_jobs.revision+1`, [empresaId, pedidoId, usuarioId, options || {}]);
  if (handler) setImmediate(() => drain().catch(error => logger.warn("Cola entrega:", error.message)));
}

function drain() {
  if (processing) return processing;
  if (!handler) return Promise.resolve();
  processing = processJobs(handler).finally(() => { processing = null; });
  return processing;
}

async function processJobs(processJob) {
    await ensureSchema();
    for (let index = 0; index < 10; index += 1) {
      const job = await db.transaction(async client => {
        const { rows } = await client.query(`SELECT * FROM pedido_entrega_jobs
          WHERE completado_at IS NULL AND disponible_at<=NOW() ORDER BY disponible_at
          LIMIT 1 FOR UPDATE SKIP LOCKED`);
        if (!rows[0]) return null;
        const { rows: claimed } = await client.query(`UPDATE pedido_entrega_jobs
          SET disponible_at=NOW()+INTERVAL '10 minutes', intentos=intentos+1
          WHERE empresa_id=$1 AND pedido_id=$2 RETURNING *`, [rows[0].empresa_id, rows[0].pedido_id]);
        return claimed[0];
      });
      if (!job) break;
      try {
        await processJob(job.pedido_id, job.empresa_id, job.usuario_id, job.options);
        await db.query(`UPDATE pedido_entrega_jobs SET completado_at=NOW(), error=NULL
          WHERE empresa_id=$1 AND pedido_id=$2 AND intentos=$3 AND revision=$4`, [job.empresa_id, job.pedido_id, job.intentos, job.revision]);
      } catch (error) {
        logger.warn(`Automatismos pendientes para pedido ${job.pedido_id}:`, error.message);
        await db.query(`UPDATE pedido_entrega_jobs SET error=$3, disponible_at=NOW()+INTERVAL '5 minutes'
          WHERE empresa_id=$1 AND pedido_id=$2 AND intentos=$4 AND revision=$5`, [job.empresa_id, job.pedido_id, String(error.message).slice(0, 2000), job.intentos, job.revision]);
      }
    }
}

function start(processJob) {
  handler = processJob;
  if (timer) return;
  timer = setInterval(() => drain().catch(error => logger.warn("Cola entrega:", error.message)), 15000);
  timer.unref();
  drain().catch(error => logger.warn("Cola entrega:", error.message));
}

async function stop() {
  clearInterval(timer);
  timer = null;
  handler = null;
  await processing;
}

module.exports = { enqueue, start, stop, processPending: drain, ensureSchema };

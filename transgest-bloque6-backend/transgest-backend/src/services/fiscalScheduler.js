const db = require("./db");
const logger = require("./logger");
const { processPendingFiscalQueue } = require("./fiscalProcessor");

let fiscalTimer = null;
let fiscalRunning = false;
let lastRunAt = null;
let lastRunSummary = null;

async function runCycle() {
  if (fiscalRunning) return;
  fiscalRunning = true;
  const cycleSummary = {
    started_at: new Date().toISOString(),
    empresas: 0,
    accepted: 0,
    errors: 0,
    processed: 0,
  };
  try {
    const { rows: empresas } = await db.query(
      `SELECT id, nombre
         FROM empresas
        WHERE COALESCE(configuracion->'facturacion_fiscal'->>'modo','ninguno') IN ('verifactu','sii')`
    );

    for (const empresa of empresas) {
      try {
        cycleSummary.empresas += 1;
        const result = await db.transaction((client) =>
          processPendingFiscalQueue({
            empresaId: empresa.id,
            actorUserId: null,
            limit: 25,
            client,
          })
        );
        cycleSummary.accepted += Number(result.accepted || 0);
        cycleSummary.errors += Number(result.errors || 0);
        cycleSummary.processed += Number(result.total || 0);
        if (result.total > 0) {
          logger.info(`[Fiscal] ${empresa.nombre || empresa.id}: ${result.accepted} aceptadas, ${result.errors} errores, ${result.total} procesadas`);
        }
      } catch (err) {
        logger.warn(`[Fiscal] Error procesando empresa ${empresa.id}: ${err.message}`);
      }
    }
  } catch (err) {
    logger.warn(`[Fiscal] Scheduler cycle failed: ${err.message}`);
  } finally {
    lastRunAt = new Date().toISOString();
    lastRunSummary = {
      ...cycleSummary,
      finished_at: lastRunAt,
    };
    fiscalRunning = false;
  }
}

function startScheduler() {
  const enabled = process.env.FISCAL_SCHEDULER_ENABLED !== "false";
  if (!enabled) {
    logger.info("[Fiscal] Scheduler desactivado por configuracion");
    return;
  }
  const intervalMinutes = Math.max(1, Number(process.env.FISCAL_SCHEDULER_MINUTES || 5));
  if (fiscalTimer) clearInterval(fiscalTimer);
  logger.info(`[Fiscal] Scheduler iniciado - proceso de cola cada ${intervalMinutes} minuto(s)`);
  fiscalTimer = setInterval(() => {
    runCycle().catch(() => {});
  }, intervalMinutes * 60 * 1000);
  setTimeout(() => {
    runCycle().catch(() => {});
  }, 15000);
}

module.exports = {
  startScheduler,
  runCycle,
  getStatus() {
    return {
      enabled: process.env.FISCAL_SCHEDULER_ENABLED !== "false",
      running: fiscalRunning,
      interval_minutes: Math.max(1, Number(process.env.FISCAL_SCHEDULER_MINUTES || 5)),
      last_run_at: lastRunAt,
      last_run_summary: lastRunSummary,
    };
  },
};

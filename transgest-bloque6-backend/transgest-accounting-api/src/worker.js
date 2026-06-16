const config = require("./services/config");
const db = require("./services/db");
const logger = require("./services/logger");
const { processNextEvent } = require("./services/outboxProcessor");

let stopping = false;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runIteration() {
  const result = await processNextEvent();
  if (result.status !== "idle") {
    logger.info({
      msg: "accounting_outbox_event_result",
      event_id: result.event?.id,
      event_type: result.event?.event_type,
      status: result.status,
      attempts: result.event?.attempts,
      error: result.error,
    });
  }
  return result;
}

async function runWorker() {
  const once = process.argv.includes("--once");
  logger.info({
    msg: "accounting_outbox_worker_started",
    consumer_name: config.outbox.consumerName,
    poll_interval_ms: config.outbox.pollIntervalMs,
    once,
  });

  do {
    try {
      const result = await runIteration();
      if (once) break;
      if (result.status === "idle") await sleep(config.outbox.pollIntervalMs);
    } catch (error) {
      logger.error({ msg: "accounting_outbox_worker_error", error: error.message, stack: error.stack });
      if (once) throw error;
      await sleep(config.outbox.pollIntervalMs);
    }
  } while (!stopping);

  await db.pool.end();
  logger.info({ msg: "accounting_outbox_worker_stopped" });
}

process.on("SIGTERM", () => {
  stopping = true;
});

process.on("SIGINT", () => {
  stopping = true;
});

if (require.main === module) {
  runWorker().catch(error => {
    logger.error({ msg: "accounting_outbox_worker_fatal", error: error.message, stack: error.stack });
    process.exitCode = 1;
  });
}

module.exports = { runIteration, runWorker };

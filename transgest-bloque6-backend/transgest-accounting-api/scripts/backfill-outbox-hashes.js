require("../src/resolveWorkspaceModules");
const config = require("../src/services/config");
const db = require("../src/services/db");
const logger = require("../src/services/logger");
const { payloadHash, validateEventContract } = require("../src/domain/eventContracts");

function q(name) {
  return `"${config.schema}"."${name}"`;
}

async function backfillOutboxHashes() {
  const { rows } = await db.query(
    `SELECT id, event_type, schema_version, payload
       FROM ${q("outbox_events")}
      WHERE payload_hash IS NULL
      ORDER BY occurred_at ASC`
  );

  let updated = 0;
  for (const event of rows) {
    validateEventContract(event.event_type, event.schema_version, event.payload);
    const hash = payloadHash(event.payload);
    await db.transaction(async client => {
      await client.query(
        `UPDATE ${q("outbox_events")}
            SET payload_hash=$1
          WHERE id=$2 AND payload_hash IS NULL`,
        [hash, event.id]
      );
      await client.query(
        `UPDATE ${q("processed_events")}
            SET payload_hash=$1
          WHERE event_id=$2 AND payload_hash IS NULL`,
        [hash, event.id]
      );
    });
    updated += 1;
  }

  logger.info({ msg: "accounting_outbox_hashes_backfilled", updated });
  return updated;
}

if (require.main === module) {
  backfillOutboxHashes()
    .then(() => db.pool.end())
    .catch(async error => {
      logger.error({ msg: "accounting_outbox_hashes_backfill_failed", error: error.message, stack: error.stack });
      await db.pool.end();
      process.exitCode = 1;
    });
}

module.exports = { backfillOutboxHashes };

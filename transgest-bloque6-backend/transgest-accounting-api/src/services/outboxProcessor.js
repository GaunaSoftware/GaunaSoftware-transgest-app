const config = require("./config");
const db = require("./db");
const {
  normalizeOutboxError,
  retryDelaySeconds,
} = require("../domain/outbox");
const { verifyEventIntegrity } = require("../domain/eventContracts");

function q(name) {
  return `"${config.schema}"."${name}"`;
}

async function claimNextEvent() {
  return db.transaction(async client => {
    const { rows } = await client.query(
      `SELECT *
         FROM ${q("outbox_events")}
        WHERE status IN ('pending', 'retry', 'processing')
          AND available_at <= NOW()
        ORDER BY occurred_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1`
    );
    if (!rows.length) return null;

    const { rows: claimedRows } = await client.query(
      `UPDATE ${q("outbox_events")}
          SET status='processing',
              attempts=attempts + 1,
              available_at=NOW() + ($1 * INTERVAL '1 second'),
              last_error=NULL
        WHERE id=$2
        RETURNING *`,
      [config.outbox.leaseSeconds, rows[0].id]
    );
    return claimedRows[0];
  });
}

async function acknowledgeEvent(event) {
  return db.transaction(async client => {
    const verifiedHash = verifyEventIntegrity(event);
    const duplicate = await client.query(
      `SELECT id, result_ref
         FROM ${q("processed_events")}
        WHERE consumer_name=$1 AND event_id=$2`,
      [config.outbox.consumerName, event.id]
    );

    if (duplicate.rows.length) {
      await client.query(
        `UPDATE ${q("outbox_events")}
            SET status='processed', processed_at=NOW(), last_error=NULL,
                payload_hash=COALESCE(payload_hash, $2)
          WHERE id=$1`,
        [event.id, verifiedHash]
      );
      return { status: "duplicate", event, result_ref: duplicate.rows[0].result_ref };
    }

    const resultRef = `ack:${event.event_type}`;
    await client.query(
      `INSERT INTO ${q("processed_events")}
         (consumer_name, event_id, event_type, payload_hash, result_ref)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (consumer_name, event_id) DO NOTHING`,
      [
        config.outbox.consumerName,
        event.id,
        event.event_type,
        verifiedHash,
        resultRef,
      ]
    );
    await client.query(
      `UPDATE ${q("outbox_events")}
          SET status='processed', processed_at=NOW(), last_error=NULL,
              payload_hash=COALESCE(payload_hash, $2)
        WHERE id=$1`,
      [event.id, verifiedHash]
    );
    return { status: "processed", event, result_ref: resultRef };
  });
}

async function markEventFailed(event, error) {
  const finalFailure = event.attempts >= config.outbox.maxAttempts;
  const delaySeconds = retryDelaySeconds(event.attempts);
  const { rows } = await db.query(
    `UPDATE ${q("outbox_events")}
        SET status=$1,
            available_at=NOW() + ($2 * INTERVAL '1 second'),
            last_error=$3
      WHERE id=$4
      RETURNING *`,
    [
      finalFailure ? "failed" : "retry",
      delaySeconds,
      normalizeOutboxError(error),
      event.id,
    ]
  );
  return rows[0];
}

async function processNextEvent() {
  const event = await claimNextEvent();
  if (!event) return { status: "idle" };

  try {
    return await acknowledgeEvent(event);
  } catch (error) {
    const failedEvent = await markEventFailed(event, error);
    return {
      status: failedEvent.status,
      event: failedEvent,
      error: normalizeOutboxError(error),
    };
  }
}

module.exports = {
  acknowledgeEvent,
  claimNextEvent,
  markEventFailed,
  processNextEvent,
};

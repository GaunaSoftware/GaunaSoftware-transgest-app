const config = require("./config");
const {
  normalizeEventPayload,
  payloadHash,
  validateEventContract,
} = require("../domain/eventContracts");

function q(name) {
  return `"${config.schema}"."${name}"`;
}

async function enqueueOutboxEvent(client, event) {
  const schemaVersion = Number(event.schema_version || 1);
  const normalizedPayload = normalizeEventPayload(event.payload);
  validateEventContract(event.event_type, schemaVersion, normalizedPayload);
  const hash = payloadHash(normalizedPayload);

  const { rows } = await client.query(
    `INSERT INTO ${q("outbox_events")}
       (tenant_id, company_id, event_type, aggregate_type, aggregate_id, schema_version, payload, payload_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     RETURNING *`,
    [
      event.tenant_id,
      event.company_id,
      event.event_type,
      event.aggregate_type,
      event.aggregate_id || null,
      schemaVersion,
      JSON.stringify(normalizedPayload),
      hash,
    ]
  );
  return rows[0];
}

module.exports = { enqueueOutboxEvent };

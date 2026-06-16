require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { normalizeOutboxQuery, validateOutboxRetry } = require("../domain/outboxOperations");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

router.use(authenticate);

router.get("/outbox-events", requirePermission("outbox.read"), async (req, res, next) => {
  try {
    const filters = normalizeOutboxQuery(req.query);
    const params = [req.accountingUser.selected_company_id];
    const where = ["company_id=$1"];

    if (filters.status) {
      params.push(filters.status);
      where.push(`status=$${params.length}`);
    }
    if (filters.event_type) {
      params.push(filters.event_type);
      where.push(`event_type=$${params.length}`);
    }

    params.push(filters.limit);
    const { rows } = await db.query(
      `SELECT id, tenant_id, company_id, event_type, aggregate_type, aggregate_id,
              schema_version, payload_hash, status, attempts, occurred_at, available_at,
              processed_at, last_error
         FROM ${q("outbox_events")}
        WHERE ${where.join(" AND ")}
        ORDER BY occurred_at DESC
        LIMIT $${params.length}`,
      params
    );
    res.json({ data: rows, filters });
  } catch (error) {
    next(error);
  }
});

router.post("/outbox-events/:id/retry", requirePermission("outbox.retry"), async (req, res, next) => {
  try {
    const selected = req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });

    const result = await db.transaction(async client => {
      const { rows } = await client.query(
        `SELECT *
           FROM ${q("outbox_events")}
          WHERE id=$1 AND company_id=$2
          FOR UPDATE`,
        [req.params.id, selected.company_id]
      );
      const event = rows[0];
      const reason = validateOutboxRetry(event, req.body?.reason);

      const { rows: updatedRows } = await client.query(
        `UPDATE ${q("outbox_events")}
            SET status='pending',
                attempts=0,
                available_at=NOW(),
                processed_at=NULL,
                last_error=NULL
          WHERE id=$1
          RETURNING id, tenant_id, company_id, event_type, aggregate_type, aggregate_id,
                    schema_version, payload_hash, status, attempts, occurred_at, available_at,
                    processed_at, last_error`,
        [event.id]
      );

      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
         VALUES ($1,$2,'user',$3,'outbox_event.retry_requested','outbox_event',$4,$5,$6::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          event.id,
          req.id || null,
          JSON.stringify({
            event_type: event.event_type,
            previous_status: event.status,
            previous_attempts: event.attempts,
            reason,
          }),
        ]
      );

      return updatedRows[0];
    });

    res.json({ event: result });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

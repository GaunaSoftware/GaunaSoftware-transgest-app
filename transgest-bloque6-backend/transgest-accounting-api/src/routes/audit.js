require("../resolveWorkspaceModules");
const express = require("express");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");
const { normalizeAuditQuery } = require("../domain/auditLog");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

router.use(authenticate);

router.get("/audit-log", requirePermission("audit.read"), async (req, res) => {
  const filters = normalizeAuditQuery(req.query);
  const params = [req.accountingUser.selected_company_id];
  const where = ["company_id=$1"];

  if (filters.action) {
    params.push(filters.action);
    where.push(`action=$${params.length}`);
  }

  if (filters.entity_type) {
    params.push(filters.entity_type);
    where.push(`entity_type=$${params.length}`);
  }

  params.push(filters.limit);
  const { rows } = await db.query(
    `SELECT id, tenant_id, company_id, actor_type, actor_id, action, entity_type,
            entity_id, request_id, trace_id, detail, created_at
       FROM ${q("audit_log")}
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );

  res.json({ data: rows, filters });
});

module.exports = router;

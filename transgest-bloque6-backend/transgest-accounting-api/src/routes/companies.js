require("../resolveWorkspaceModules");
const express = require("express");
const jwt = require("jsonwebtoken");
const config = require("../services/config");
const db = require("../services/db");
const { authenticate, requirePermission } = require("../middleware/auth");

const router = express.Router();

function q(name) {
  return `"${config.schema}"."${name}"`;
}

function normalizeRequestedCompanyId(value) {
  const companyId = String(value || "").trim();
  return companyId ? companyId.slice(0, 100) : null;
}

async function auditCompanySelection(client, req, { action, selected, requestedCompanyId }) {
  await client.query(
    `INSERT INTO ${q("audit_log")}
       (tenant_id, company_id, actor_type, actor_id, action, entity_type, entity_id, request_id, detail)
     VALUES ($1,$2,'user',$3,$4,'accounting_company',$5,$6,$7::jsonb)`,
    [
      selected.tenant_id,
      selected.company_id,
      req.accountingUser.id,
      action,
      action === "company.selected" ? selected.company_id : null,
      req.id || null,
      JSON.stringify({ requested_company_id: requestedCompanyId }),
    ]
  );
}

router.use(authenticate);

router.get("/", requirePermission("company.select"), async (req, res) => {
  res.json({
    data: req.accountingUser.contexts.map(c => ({
      id: c.company_id,
      name: c.company_name,
      source_company_id: c.source_company_id,
      tenant_id: c.tenant_id,
      tenant_name: c.tenant_name,
      permissions: c.permissions || [],
    })),
  });
});

router.post("/select", requirePermission("company.select"), async (req, res, next) => {
  try {
    const companyId = normalizeRequestedCompanyId(req.body?.company_id);
    const selected = req.accountingUser.contexts.find(c => c.company_id === companyId);

    if (!selected) {
      const current = req.accountingUser.contexts.find(
        context => context.company_id === req.accountingUser.selected_company_id
      ) || req.accountingUser.contexts[0];

      await db.transaction(client => auditCompanySelection(client, req, {
        action: "company.selection_denied",
        selected: current,
        requestedCompanyId: companyId || null,
      }));
      return res.status(403).json({ error: "Empresa contable no autorizada" });
    }

    await db.transaction(client => auditCompanySelection(client, req, {
      action: "company.selected",
      selected,
      requestedCompanyId: companyId,
    }));

    const token = jwt.sign(
      { sub: req.accountingUser.id, company_id: selected.company_id, purpose: "accounting_session" },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );
    res.json({ token, selected_company_id: selected.company_id, selected_company: selected });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
module.exports.auditCompanySelection = auditCompanySelection;
module.exports.normalizeRequestedCompanyId = normalizeRequestedCompanyId;

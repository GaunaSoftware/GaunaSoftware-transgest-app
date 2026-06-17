require("../resolveWorkspaceModules");
const express = require("express");
const { authenticate } = require("../middleware/auth");
const {
  buildAdvisorPackageManifest,
  INTEGRATION_CATALOG_VERSION,
  integrationSummary,
  listExternalAccountingIntegrations,
} = require("../domain/externalIntegrations");

const router = express.Router();

router.use(authenticate);

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

router.get("/external-integrations", (req, res) => {
  const data = listExternalAccountingIntegrations(req.query);
  res.json({
    catalog_version: INTEGRATION_CATALOG_VERSION,
    disclaimer: "Catalogo tecnico preliminar. No implica certificacion, homologacion ni integracion productiva activa.",
    summary: integrationSummary(data),
    data,
  });
});

router.get("/external-integrations/advisor-package", (req, res) => {
  const selected = selectedContext(req);
  if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
  res.json(buildAdvisorPackageManifest({
    selectedCompany: {
      tenant_id: selected.tenant_id,
      company_id: selected.company_id,
      name: selected.company_name || selected.name || null,
      source_company_id: selected.source_company_id || null,
    },
    permissions: req.accountingUser.permissions || [],
    filters: req.query,
  }));
});

module.exports = router;

require("../resolveWorkspaceModules");
const express = require("express");
const { authenticate } = require("../middleware/auth");
const config = require("../services/config");
const db = require("../services/db");
const { buildAdvisorPackageCsvFiles } = require("../services/advisorPackageExports");
const {
  buildAdvisorPackageManifest,
  buildAdvisorPackageZip,
  INTEGRATION_CATALOG_VERSION,
  integrationSummary,
  listExternalAccountingIntegrations,
} = require("../domain/externalIntegrations");

const router = express.Router();

router.use(authenticate);

function selectedContext(req) {
  return req.accountingUser.contexts.find(c => c.company_id === req.accountingUser.selected_company_id);
}

function q(name) {
  return `"${config.schema}"."${String(name).replace(/"/g, '""')}"`;
}

function safeFilename(value, fallback = "paquete-asesoria.zip") {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  return clean || fallback;
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

router.get("/external-integrations/advisor-package.zip", async (req, res, next) => {
  try {
    const selected = selectedContext(req);
    if (!selected) return res.status(403).json({ error: "Empresa contable no autorizada" });
    const manifest = buildAdvisorPackageManifest({
      selectedCompany: {
        tenant_id: selected.tenant_id,
        company_id: selected.company_id,
        name: selected.company_name || selected.name || null,
        source_company_id: selected.source_company_id || null,
      },
      permissions: req.accountingUser.permissions || [],
      filters: req.query,
    });
    const { files: embeddedCsvFiles } = await db.transaction(async client => {
      const csvPackage = await buildAdvisorPackageCsvFiles({
        client,
        companyId: selected.company_id,
        manifest,
      });
      await client.query(
        `INSERT INTO ${q("audit_log")}
           (tenant_id, company_id, actor_type, actor_id, action, entity_type, request_id, detail)
         VALUES ($1,$2,'user',$3,'external_integration.advisor_package_zip_exported','advisor_package',$4,$5::jsonb)`,
        [
          selected.tenant_id,
          selected.company_id,
          req.accountingUser.id,
          req.id,
          JSON.stringify({
            available_count: manifest.available_count,
            blocked_count: manifest.blocked_count,
            filters: manifest.filters,
            embedded_csv: csvPackage.summary,
          }),
        ]
      );
      return csvPackage;
    });
    const zip = buildAdvisorPackageZip(manifest, embeddedCsvFiles);
    const datePart = new Date().toISOString().slice(0, 10);
    const companyPart = selected.company_name || selected.name || "empresa";
    const filename = safeFilename(`paquete-asesoria-${companyPart}-${datePart}.zip`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(zip);
  } catch (error) {
    next(error);
  }
});

module.exports = router;

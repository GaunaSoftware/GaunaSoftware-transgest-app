const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildAdvisorPackageManifest,
  buildAdvisorPackageZip,
  INTEGRATION_CATALOG_VERSION,
  integrationSummary,
  listExternalAccountingIntegrations,
  normalizeAdvisorPackageQuery,
} = require("../src/domain/externalIntegrations");

test("catalogo de integraciones externas mantiene 10 candidatos prioritarios", () => {
  const integrations = listExternalAccountingIntegrations();
  assert.equal(INTEGRATION_CATALOG_VERSION, "2026-06-17");
  assert.equal(integrations.length, 10);
  assert.deepEqual(
    integrations.map(item => item.priority),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  );
});

test("catalogo filtra por estado, categoria y texto", () => {
  const planned = listExternalAccountingIntegrations({ status: "planned" });
  assert.ok(planned.length >= 3);
  assert.ok(planned.every(item => item.status === "planned"));

  const erp = listExternalAccountingIntegrations({ category: "erp" });
  assert.deepEqual(erp.map(item => item.id), ["sage-200", "odoo"]);

  const holded = listExternalAccountingIntegrations({ q: "holded" });
  assert.ok(holded.some(item => item.id === "holded"));
});

test("resumen de integraciones expone conteos por estado y modo", () => {
  const summary = integrationSummary(listExternalAccountingIntegrations());
  assert.equal(summary.total, 10);
  assert.ok(summary.by_status.research >= 1);
  assert.ok(summary.by_status.planned >= 1);
  assert.ok(summary.by_mode.api_with_outbox >= 1);
  assert.ok(summary.by_mode.export_first >= 1);
});

test("manifiesto asesoria normaliza filtros y bloquea informes sin ejercicio", () => {
  const filters = normalizeAdvisorPackageQuery({
    fiscal_year_id: "",
    period_id: "period-1",
    date_from: "2026-01-01",
    include_empty: "true",
  });
  assert.equal(filters.fiscal_year_id, null);
  assert.equal(filters.include_empty, "true");

  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "journal.read", "ledger.read"],
    filters,
  });
  assert.equal(manifest.exports.find(item => item.id === "parties").available, true);
  assert.equal(manifest.exports.find(item => item.id === "trial_balance").available, false);
  assert.ok(manifest.exports.find(item => item.id === "trial_balance").blocked_reasons.includes("Selecciona un ejercicio"));
});

test("manifiesto asesoria genera rutas CSV cuando hay ejercicio y permisos", () => {
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "journal.read", "ledger.read"],
    filters: { fiscal_year_id: "fy-2026", include_empty: "false" },
  });
  assert.equal(manifest.available_count, 7);
  assert.equal(manifest.blocked_count, 0);
  assert.match(manifest.exports.find(item => item.id === "journal_entries").path, /\/journal-entries\?format=csv/);
  assert.match(manifest.exports.find(item => item.id === "balance_sheet").path, /fiscal_year_id=fy-2026/);
});

test("paquete asesoria ZIP incluye manifiesto e indice de exportaciones", () => {
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "journal.read", "ledger.read"],
    filters: { fiscal_year_id: "fy-2026", include_empty: "true" },
  });
  const zip = buildAdvisorPackageZip(manifest);
  assert.ok(Buffer.isBuffer(zip));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("manifest.json")));
  assert.ok(zip.includes(Buffer.from("exports/index.csv")));
  assert.ok(zip.includes(Buffer.from("/reports/trial-balance?")));
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

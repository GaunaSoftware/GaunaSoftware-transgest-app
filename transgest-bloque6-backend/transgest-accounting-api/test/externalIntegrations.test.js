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
const { buildAdvisorPackageCsvFiles } = require("../src/services/advisorPackageExports");

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
    permissions: ["parties.read", "maturities.read", "banks.read", "fixed_assets.read", "journal.read", "ledger.read"],
    filters,
  });
  assert.equal(manifest.exports.find(item => item.id === "parties").available, true);
  assert.equal(manifest.exports.find(item => item.id === "fixed_assets").available, true);
  assert.equal(manifest.exports.find(item => item.id === "trial_balance").available, false);
  assert.ok(manifest.exports.find(item => item.id === "trial_balance").blocked_reasons.includes("Selecciona un ejercicio"));
});

test("manifiesto asesoria genera rutas CSV cuando hay ejercicio y permisos", () => {
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "fixed_assets.read", "journal.read", "ledger.read"],
    filters: { fiscal_year_id: "fy-2026", include_empty: "false" },
  });
  assert.equal(manifest.available_count, 8);
  assert.equal(manifest.blocked_count, 0);
  assert.match(manifest.exports.find(item => item.id === "fixed_assets").path, /\/fixed-assets\?format=csv/);
  assert.match(manifest.exports.find(item => item.id === "journal_entries").path, /\/journal-entries\?format=csv/);
  assert.match(manifest.exports.find(item => item.id === "balance_sheet").path, /fiscal_year_id=fy-2026/);
});

test("paquete asesoria ZIP incluye manifiesto e indice de exportaciones", () => {
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "fixed_assets.read", "journal.read", "ledger.read"],
    filters: { fiscal_year_id: "fy-2026", include_empty: "true" },
  });
  const zip = buildAdvisorPackageZip(manifest, [
    { name: "exports/terceros.csv", content: "Nombre fiscal\r\nACME\r\n" },
  ]);
  assert.ok(Buffer.isBuffer(zip));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("manifest.json")));
  assert.ok(zip.includes(Buffer.from("exports/index.csv")));
  assert.ok(zip.includes(Buffer.from("exports/terceros.csv")));
  assert.ok(zip.includes(Buffer.from("ACME")));
  assert.ok(zip.includes(Buffer.from("/reports/trial-balance?")));
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
});

test("paquete asesoria construye CSV fisicos para exportaciones soportadas", async () => {
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["parties.read", "maturities.read", "banks.read", "fixed_assets.read", "journal.read"],
    filters: { fiscal_year_id: "fy-2026", date_from: "2026-01-01", date_to: "2026-12-31" },
  });
  const journalParams = [];
  const client = {
    async query(sql, params = []) {
      if (sql.includes("accounting_maturities")) {
        return { rows: [{
          direction: "receivable",
          party_name: "Cliente Demo",
          due_date: "2026-02-01",
          document_ref: "FAC-1",
          description: "Factura demo",
          amount: "100.000000",
          open_amount: "100.000000",
          status: "pending",
        }] };
      }
      if (sql.includes("bank_transactions")) {
        return { rows: [{
          bank_account_name: "Banco Demo",
          transaction_date: "2026-02-02",
          value_date: "2026-02-02",
          direction: "inflow",
          amount: "100.000000",
          description: "Cobro demo",
          reference: "REF-1",
          counterparty_name: "Cliente Demo",
          status: "unmatched",
        }] };
      }
      if (sql.includes("journal_entries")) {
        journalParams.push(...params);
        return { rows: [{
          entry_date: "2026-02-02",
          entry_number: 1,
          year_label: "2026",
          period_name: "Febrero",
          description: "Asiento demo",
          status: "posted",
          total_debit: "100.000000",
          total_credit: "100.000000",
          line_count: 2,
        }] };
      }
      if (sql.includes("accounting_fixed_assets")) {
        return { rows: [{
          asset_code: "VEH-001",
          name: "Cabeza tractora",
          year_label: "2026",
          acquisition_date: "2026-01-15",
          acquisition_cost: "1000.000000",
          residual_value: "100.000000",
          useful_life_months: 60,
          status: "active",
          disposed_at: null,
          asset_account_code: "21800000",
          accumulated_depreciation_account_code: "28180000",
          expense_account_code: "68100000",
        }] };
      }
      if (sql.includes("accounting_parties")) {
        return { rows: [{
          legal_name: "Cliente Demo",
          party_type: "customer",
          tax_id: "B00000000",
          email: "cliente@example.com",
          phone: "600000000",
          default_account_code: "43000000",
          is_active: true,
        }] };
      }
      return { rows: [] };
    },
  };

  const result = await buildAdvisorPackageCsvFiles({ client, companyId: "company-1", manifest });
  assert.deepEqual(result.files.map(file => file.name), [
    "exports/terceros.csv",
    "exports/vencimientos.csv",
    "exports/movimientos_bancarios.csv",
    "exports/inmovilizado.csv",
    "exports/diario.csv",
  ]);
  assert.deepEqual(result.summary.map(item => item.row_count), [1, 1, 1, 1, 1]);
  assert.ok(result.files[0].content.includes("Nombre fiscal"));
  assert.ok(result.files[3].content.includes("Cabeza tractora"));
  assert.ok(result.files[4].content.includes("Contabilizado"));
  assert.equal(journalParams.includes("fy-2026"), false);
});

test("paquete asesoria incluye informes CSV cuando el ejercicio es UUID valido", async () => {
  const fiscalYearId = "33333333-3333-3333-3333-333333333333";
  const manifest = buildAdvisorPackageManifest({
    selectedCompany: { company_id: "company-1", name: "Demo" },
    permissions: ["ledger.read"],
    filters: { fiscal_year_id: fiscalYearId, include_empty: "true" },
  });
  const accountRows = [
    { id: "a1", code: "10000000", name: "Capital", account_type: "equity", is_active: true, is_postable: true, total_debit: "0.000000", total_credit: "100.000000", balance_debit: "0.000000", balance_credit: "100.000000" },
    { id: "a2", code: "43000000", name: "Clientes", account_type: "asset", is_active: true, is_postable: true, total_debit: "100.000000", total_credit: "0.000000", balance_debit: "100.000000", balance_credit: "0.000000" },
    { id: "a3", code: "70000000", name: "Ventas", account_type: "income", is_active: true, is_postable: true, total_debit: "0.000000", total_credit: "50.000000", balance_debit: "0.000000", balance_credit: "50.000000" },
  ];
  const client = {
    async query(sql) {
      if (sql.includes("accounting_periods")) return { rows: [{ id: "period-1" }] };
      if (sql.includes("accounts")) return { rows: accountRows };
      return { rows: [] };
    },
  };

  const result = await buildAdvisorPackageCsvFiles({ client, companyId: "company-1", manifest });
  assert.deepEqual(result.files.map(file => file.name), [
    "exports/sumas_y_saldos.csv",
    "exports/balance_situacion.csv",
    "exports/perdidas_ganancias.csv",
  ]);
  assert.ok(result.files[0].content.includes("Suma Debe"));
  assert.ok(result.files[0].content.includes("TOTAL"));
  assert.ok(result.files[1].content.includes("Total activo"));
  assert.ok(result.files[2].content.includes("Resultado"));
});

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyTemplateAccounts,
  normalizeTemplateImportInput,
  normalizeTemplateSnapshotInput,
  templateChecksum,
} = require("../src/domain/chartTemplates");

test("normaliza snapshot e importacion de plantilla", () => {
  assert.deepEqual(normalizeTemplateSnapshotInput({
    code: " PLAN-2026 ",
    name: " Plan interno ",
    version_label: " v1 ",
    fiscal_year_id: "year-id",
  }), {
    code: "PLAN-2026",
    name: "Plan interno",
    version_label: "v1",
    fiscal_year_id: "year-id",
  });
  assert.deepEqual(normalizeTemplateImportInput({
    fiscal_year_id: "year-id",
    idempotency_key: "import:2026:0001",
  }), {
    fiscal_year_id: "year-id",
    idempotency_key: "import:2026:0001",
  });
});

test("rechaza codigos e idempotencia inseguros", () => {
  assert.throws(() => normalizeTemplateSnapshotInput({
    code: "PLAN 2026",
    name: "Plan",
    version_label: "v1",
    fiscal_year_id: "year-id",
  }), /solo puede contener/);
  assert.throws(() => normalizeTemplateImportInput({
    fiscal_year_id: "year-id",
    idempotency_key: "corta",
  }), /al menos 12/);
});

test("checksum de plantilla es estable por orden de cuentas", () => {
  const accountA = { code: "100", name: "Capital", account_type: "equity", is_postable: true };
  const accountB = { code: "430", name: "Clientes", account_type: "asset", is_postable: true };
  assert.equal(templateChecksum([accountA, accountB]), templateChecksum([accountB, accountA]));
});

test("clasifica altas coincidencias y conflictos sin sobrescribir", () => {
  const template = [
    { code: "100", name: "Capital", account_type: "equity", is_postable: true },
    { code: "430", name: "Clientes", account_type: "asset", is_postable: true },
    { code: "700", name: "Ventas", account_type: "income", is_postable: true },
  ];
  const existing = [
    { code: "100", name: "Capital", account_type: "equity", is_postable: true },
    { code: "430", name: "Clientes nacionales", account_type: "asset", is_postable: true },
  ];
  const result = classifyTemplateAccounts(template, existing);
  assert.deepEqual(result.inserted.map(item => item.code), ["700"]);
  assert.deepEqual(result.matching.map(item => item.code), ["100"]);
  assert.deepEqual(result.conflicts.map(item => item.template.code), ["430"]);
});

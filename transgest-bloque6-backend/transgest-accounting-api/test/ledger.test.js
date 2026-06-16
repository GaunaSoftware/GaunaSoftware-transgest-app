const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCsv, buildFinancialStatements, normalizeFinancialStatementQuery, normalizeLedgerQuery, normalizeTrialBalanceQuery } = require("../src/domain/ledger");

test("normaliza filtros de Mayor por fechas y limite", () => {
  assert.deepEqual(normalizeLedgerQuery({
    period_id: "00000000-0000-0000-0000-000000000002",
    date_from: "2026-01-01",
    date_to: "2026-12-31",
    limit: "900",
  }), {
    period_id: "00000000-0000-0000-0000-000000000002",
    date_from: "2026-01-01",
    date_to: "2026-12-31",
    limit: 500,
    format: null,
  });
});

test("Mayor rechaza rango de fechas incoherente", () => {
  assert.throws(() => normalizeLedgerQuery({
    date_from: "2026-12-31",
    date_to: "2026-01-01",
  }), /date_from/);
  assert.throws(() => normalizeLedgerQuery({ period_id: "periodo-1" }), /period_id/);
});

test("balance de sumas y saldos exige ejercicio y normaliza include_empty", () => {
  const query = normalizeTrialBalanceQuery({
    fiscal_year_id: "00000000-0000-0000-0000-000000000001",
    include_empty: "0",
  });
  assert.equal(query.fiscal_year_id, "00000000-0000-0000-0000-000000000001");
  assert.equal(query.period_id, null);
  assert.equal(query.include_empty, false);
  assert.throws(() => normalizeTrialBalanceQuery({}), /fiscal_year_id/);
  assert.throws(() => normalizeTrialBalanceQuery({
    fiscal_year_id: "00000000-0000-0000-0000-000000000001",
    period_id: "enero",
  }), /period_id/);
});

test("normaliza formato CSV y rechaza formatos no soportados", () => {
  assert.equal(normalizeLedgerQuery({ format: "csv" }).format, "csv");
  assert.equal(normalizeTrialBalanceQuery({
    fiscal_year_id: "00000000-0000-0000-0000-000000000001",
    format: "CSV",
  }).format, "csv");
  assert.throws(() => normalizeLedgerQuery({ format: "pdf" }), /csv/);
});

test("normaliza informes financieros preliminares con cuentas no vacias por defecto", () => {
  const query = normalizeFinancialStatementQuery({
    fiscal_year_id: "00000000-0000-0000-0000-000000000001",
  });
  assert.equal(query.include_empty, false);
  assert.equal(query.format, null);
});

test("calcula Balance y PyG desde saldos por tipo de cuenta", () => {
  const statements = buildFinancialStatements([
    { id: "1", code: "430", name: "Clientes", account_type: "asset", total_debit: "120.000000", total_credit: "20.000000" },
    { id: "2", code: "400", name: "Proveedores", account_type: "liability", total_debit: "10.000000", total_credit: "50.000000" },
    { id: "3", code: "100", name: "Capital", account_type: "equity", total_debit: "0.000000", total_credit: "40.000000" },
    { id: "4", code: "700", name: "Ventas", account_type: "income", total_debit: "5.000000", total_credit: "90.000000" },
    { id: "5", code: "600", name: "Compras", account_type: "expense", total_debit: "25.000000", total_credit: "3.000000" },
    { id: "6", code: "999", name: "Sin saldo", account_type: "asset", total_debit: "0.000000", total_credit: "0.000000" },
  ]);

  assert.equal(statements.balance_sheet.sections.assets.length, 1);
  assert.equal(statements.balance_sheet.totals.assets, "100.000000");
  assert.equal(statements.balance_sheet.totals.liabilities, "40.000000");
  assert.equal(statements.balance_sheet.totals.equity, "40.000000");
  assert.equal(statements.balance_sheet.totals.difference, "20.000000");
  assert.equal(statements.profit_loss.totals.income, "85.000000");
  assert.equal(statements.profit_loss.totals.expenses, "22.000000");
  assert.equal(statements.profit_loss.totals.result, "63.000000");
});

test("buildCsv escapa separadores, comillas y saltos de linea", () => {
  const csv = buildCsv([
    { key: "code", label: "Cuenta" },
    { key: "name", label: "Nombre" },
  ], [
    { code: "430", name: "Cliente; \"especial\"" },
  ]);
  assert.match(csv, /^\uFEFFCuenta;Nombre/);
  assert.match(csv, /430;"Cliente; ""especial"""/);
});

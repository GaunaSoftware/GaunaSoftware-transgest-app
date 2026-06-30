const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildStraightLineDepreciationPlan,
  depreciationAmountForPeriod,
  normalizeFixedAssetDepreciationRunInput,
  normalizeFixedAssetInput,
  normalizeFixedAssetQuery,
  normalizeFixedAssetStatusInput,
  nextStatusForAction,
} = require("../src/domain/fixedAssets");

test("normalizeFixedAssetInput prepara un alta de inmovilizado", () => {
  assert.deepEqual(normalizeFixedAssetInput({
    fiscal_year_id: "fy-2026",
    asset_code: "VEH-001",
    name: "Cabeza tractora",
    acquisition_date: "2026-06-30",
    acquisition_cost: "120000,50",
    residual_value: "20000,50",
    useful_life_months: "60",
    asset_account_id: "account-asset",
    notes: "Alta manual",
  }), {
    fiscal_year_id: "fy-2026",
    asset_code: "VEH-001",
    name: "Cabeza tractora",
    acquisition_date: "2026-06-30",
    acquisition_cost: "120000.500000",
    residual_value: "20000.500000",
    useful_life_months: 60,
    depreciation_method: "straight_line",
    asset_account_id: "account-asset",
    accumulated_depreciation_account_id: null,
    expense_account_id: null,
    source_system: "accounting",
    source_type: "manual",
    source_id: null,
    notes: "Alta manual",
  });
});

test("normalizeFixedAssetInput rechaza fechas, importes y vida util invalidos", () => {
  assert.throws(() => normalizeFixedAssetInput({ fiscal_year_id: "fy", asset_code: "A", name: "Activo", acquisition_date: "2026-99-01", acquisition_cost: "1", useful_life_months: 1 }), /fecha valida/);
  assert.throws(() => normalizeFixedAssetInput({ fiscal_year_id: "fy", asset_code: "A", name: "Activo", acquisition_date: "2026-01-01", acquisition_cost: "0", useful_life_months: 1 }), /mayor que cero/);
  assert.throws(() => normalizeFixedAssetInput({ fiscal_year_id: "fy", asset_code: "A", name: "Activo", acquisition_date: "2026-01-01", acquisition_cost: "100", residual_value: "100", useful_life_months: 1 }), /menor/);
  assert.throws(() => normalizeFixedAssetInput({ fiscal_year_id: "fy", asset_code: "A", name: "Activo", acquisition_date: "2026-01-01", acquisition_cost: "100", useful_life_months: 601 }), /entre 1 y 600/);
});

test("buildStraightLineDepreciationPlan reparte importes y conserva residual", () => {
  const plan = buildStraightLineDepreciationPlan({
    acquisition_date: "2026-01-31",
    acquisition_cost: "1000.000000",
    residual_value: "100.000000",
    useful_life_months: 3,
  });
  assert.equal(plan.depreciable_amount, "900.000000");
  assert.equal(plan.rows.length, 3);
  assert.equal(plan.rows[0].depreciation_date, "2026-01-31");
  assert.equal(plan.rows[1].depreciation_date, "2026-02-28");
  assert.equal(plan.rows[2].amount, "300.000000");
  assert.equal(plan.rows[2].net_book_value, "100.000000");
});

test("normalizeFixedAssetQuery y status controlan filtros y transiciones", () => {
  assert.deepEqual(normalizeFixedAssetQuery({ status: "active", q: " camion ", format: "csv", limit: "900" }), {
    limit: 500,
    status: "active",
    fiscal_year_id: null,
    q: "camion",
    format: "csv",
  });
  assert.deepEqual(normalizeFixedAssetStatusInput({ action: "dispose", reason: "Venta del activo", disposed_at: "2026-12-31" }), {
    action: "dispose",
    reason: "Venta del activo",
    disposed_at: "2026-12-31",
  });
  assert.equal(nextStatusForAction("active", "deactivate"), "inactive");
  assert.equal(nextStatusForAction("inactive", "activate"), "active");
  assert.equal(nextStatusForAction("active", "dispose"), "disposed");
  assert.throws(() => normalizeFixedAssetQuery({ status: "bad" }), /status/);
  assert.throws(() => nextStatusForAction("disposed", "activate"), /inactivo/);
});

test("depreciationAmountForPeriod calcula cuota del periodo y exige idempotencia segura", () => {
  const asset = {
    acquisition_date: "2026-01-31",
    acquisition_cost: "1200.000000",
    residual_value: "0.000000",
    useful_life_months: 12,
  };
  const period = { start_date: "2026-02-01", end_date: "2026-02-28" };
  const depreciation = depreciationAmountForPeriod(asset, period);
  assert.equal(depreciation.amount, "100.000000");
  assert.equal(depreciation.run_date, "2026-02-28");
  assert.deepEqual(depreciation.plan_periods, [2]);
  assert.deepEqual(normalizeFixedAssetDepreciationRunInput({
    period_id: "period-2026-02",
    idempotency_key: "dep:asset:2026-02",
    description: "Amortizacion febrero",
  }), {
    period_id: "period-2026-02",
    idempotency_key: "dep:asset:2026-02",
    description: "Amortizacion febrero",
  });
  assert.throws(() => depreciationAmountForPeriod(asset, { start_date: "2027-01-01", end_date: "2027-01-31" }), /No hay cuota/);
  assert.throws(() => normalizeFixedAssetDepreciationRunInput({ period_id: "p", idempotency_key: "short" }), /idempotency_key/);
});

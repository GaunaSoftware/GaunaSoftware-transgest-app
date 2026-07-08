const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFixedAssetDisposalDraft,
  buildStraightLineDepreciationPlan,
  depreciationAmountForPeriod,
  normalizeFixedAssetDepreciationRunInput,
  normalizeFixedAssetDisposalDraftInput,
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

test("normalizeFixedAssetDisposalDraftInput prepara baja revisable", () => {
  assert.deepEqual(normalizeFixedAssetDisposalDraftInput({
    disposal_type: "sale",
    period_id: "period-id",
    disposal_date: "2026-12-31",
    disposal_loss_account_id: "loss-account",
    disposal_gain_account_id: "gain-account",
    proceeds_account_id: "bank-account",
    sale_proceeds_amount: "1250,50",
    description: "Baja por retirada",
    idempotency_key: "asset-disposal:VEH-001",
  }), {
    disposal_type: "sale",
    period_id: "period-id",
    disposal_date: "2026-12-31",
    disposal_loss_account_id: "loss-account",
    disposal_gain_account_id: "gain-account",
    proceeds_account_id: "bank-account",
    sale_proceeds_amount: "1250.500000",
    description: "Baja por retirada",
    idempotency_key: "asset-disposal:VEH-001",
  });
  assert.equal(normalizeFixedAssetDisposalDraftInput({
    period_id: "period-id",
    disposal_date: "2026-12-31",
    idempotency_key: "asset-disposal:VEH-002",
  }).disposal_type, "withdrawal");
  assert.throws(() => normalizeFixedAssetDisposalDraftInput({ disposal_type: "donation", period_id: "p", disposal_date: "2026-12-31", idempotency_key: "asset-disposal:x" }), /disposal_type/);
  assert.throws(() => normalizeFixedAssetDisposalDraftInput({ period_id: "p", disposal_date: "bad", idempotency_key: "asset-disposal:x" }), /disposal_date/);
  assert.throws(() => normalizeFixedAssetDisposalDraftInput({ period_id: "p", disposal_date: "2026-12-31", idempotency_key: "short" }), /idempotency_key/);
});

test("buildFixedAssetDisposalDraft genera retirada y ventas cuadradas", () => {
  const asset = {
    asset_code: "VEH-001",
    acquisition_cost: "1000.000000",
    asset_account_id: "asset-account",
    accumulated_depreciation_account_id: "acc-dep-account",
  };
  const readiness = { posted_depreciation_amount: "400.000000" };

  const withdrawal = buildFixedAssetDisposalDraft(asset, readiness, {
    disposal_type: "withdrawal",
    disposal_loss_account_id: "loss-account",
  });
  assert.deepEqual(withdrawal.lines.map(line => [line.side, line.account_id, line.amount]), [
    ["debit", "acc-dep-account", "400.000000"],
    ["debit", "loss-account", "600.000000"],
    ["credit", "asset-account", "1000.000000"],
  ]);
  assert.equal(withdrawal.estimated_net_book_value, "600.000000");
  assert.equal(withdrawal.estimated_loss_amount, "600.000000");

  const saleWithLoss = buildFixedAssetDisposalDraft(asset, readiness, {
    disposal_type: "sale",
    proceeds_account_id: "customer-account",
    disposal_loss_account_id: "loss-account",
    sale_proceeds_amount: "500.000000",
  });
  assert.deepEqual(saleWithLoss.lines.map(line => [line.side, line.account_id, line.amount]), [
    ["debit", "acc-dep-account", "400.000000"],
    ["debit", "customer-account", "500.000000"],
    ["debit", "loss-account", "100.000000"],
    ["credit", "asset-account", "1000.000000"],
  ]);
  assert.equal(saleWithLoss.estimated_loss_amount, "100.000000");

  const saleWithGain = buildFixedAssetDisposalDraft(asset, readiness, {
    disposal_type: "sale",
    proceeds_account_id: "customer-account",
    disposal_gain_account_id: "gain-account",
    sale_proceeds_amount: "700.000000",
  });
  assert.deepEqual(saleWithGain.lines.map(line => [line.side, line.account_id, line.amount]), [
    ["debit", "acc-dep-account", "400.000000"],
    ["debit", "customer-account", "700.000000"],
    ["credit", "asset-account", "1000.000000"],
    ["credit", "gain-account", "100.000000"],
  ]);
  assert.equal(saleWithGain.estimated_gain_amount, "100.000000");

  assert.throws(() => buildFixedAssetDisposalDraft(asset, readiness, {
    disposal_type: "sale",
    proceeds_account_id: "customer-account",
    sale_proceeds_amount: "0",
  }), /mayor que cero/);
});

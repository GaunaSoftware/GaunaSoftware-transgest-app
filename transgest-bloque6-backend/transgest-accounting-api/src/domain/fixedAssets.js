const STATUSES = ["active", "inactive", "disposed"];
const STATUS_ACTIONS = ["activate", "deactivate", "dispose"];
const DEPRECIATION_METHODS = ["straight_line"];
const MONEY_SCALE = 6;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeRequired(value, field, maxLength) {
  const text = String(value || "").trim();
  if (!text || text.length > maxLength) {
    throw inputError(`${field} es obligatorio y no puede superar ${maxLength} caracteres`);
  }
  return text;
}

function normalizeOptionalText(value, maxLength, field) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw inputError(`${field} no puede superar ${maxLength} caracteres`);
  return text || null;
}

function normalizeDate(value, field) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw inputError(`${field} debe usar formato YYYY-MM-DD`);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError(`${field} debe ser una fecha valida`);
  }
  return date;
}

function normalizeOptionalDate(value, field) {
  const raw = String(value || "").trim();
  return raw ? normalizeDate(raw, field) : null;
}

function moneyToUnits(value, field = "amount", { allowZero = false } = {}) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(raw)) {
    throw inputError(`${field} debe ser numerico y tener hasta 6 decimales`);
  }
  const [whole, fraction = ""] = raw.split(".");
  const units = (BigInt(whole) * MONEY_FACTOR) + BigInt(fraction.padEnd(MONEY_SCALE, "0"));
  if (!allowZero && units <= 0n) throw inputError(`${field} debe ser mayor que cero`);
  if (allowZero && units < 0n) throw inputError(`${field} no puede ser negativo`);
  return units;
}

function unitsToMoney(units) {
  const normalized = BigInt(units);
  const whole = normalized / MONEY_FACTOR;
  const fraction = String(normalized % MONEY_FACTOR).padStart(MONEY_SCALE, "0");
  return `${whole}.${fraction}`;
}

function normalizePositiveInteger(value, field, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw inputError(`${field} debe ser un entero entre 1 y ${max}`);
  }
  return parsed;
}

function normalizeFixedAssetInput(input = {}) {
  const acquisitionCost = moneyToUnits(input.acquisition_cost, "acquisition_cost");
  const residualValue = moneyToUnits(input.residual_value || "0", "residual_value", { allowZero: true });
  if (residualValue >= acquisitionCost) {
    throw inputError("residual_value debe ser menor que acquisition_cost");
  }
  const method = String(input.depreciation_method || "straight_line").trim();
  if (!DEPRECIATION_METHODS.includes(method)) throw inputError("depreciation_method no soportado");
  return {
    fiscal_year_id: normalizeRequired(input.fiscal_year_id, "fiscal_year_id", 80),
    asset_code: normalizeRequired(input.asset_code, "asset_code", 60),
    name: normalizeRequired(input.name, "name", 220),
    acquisition_date: normalizeDate(input.acquisition_date, "acquisition_date"),
    acquisition_cost: unitsToMoney(acquisitionCost),
    residual_value: unitsToMoney(residualValue),
    useful_life_months: normalizePositiveInteger(input.useful_life_months, "useful_life_months", 600),
    depreciation_method: method,
    asset_account_id: normalizeOptionalText(input.asset_account_id, 80, "asset_account_id"),
    accumulated_depreciation_account_id: normalizeOptionalText(input.accumulated_depreciation_account_id, 80, "accumulated_depreciation_account_id"),
    expense_account_id: normalizeOptionalText(input.expense_account_id, 80, "expense_account_id"),
    source_system: normalizeOptionalText(input.source_system || "accounting", 80, "source_system"),
    source_type: normalizeOptionalText(input.source_type || "manual", 80, "source_type"),
    source_id: normalizeOptionalText(input.source_id, 120, "source_id"),
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
  };
}

function normalizeFixedAssetQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const status = String(query.status || "").trim();
  const format = String(query.format || "json").trim().toLowerCase();
  if (status && !STATUSES.includes(status)) throw inputError("status no soportado");
  if (!["json", "csv"].includes(format)) throw inputError("format no soportado");
  return {
    limit,
    status: status || null,
    fiscal_year_id: String(query.fiscal_year_id || "").trim() || null,
    q: String(query.q || "").trim().slice(0, 140) || null,
    format,
  };
}

function normalizeFixedAssetStatusInput(input = {}) {
  const action = String(input.action || "").trim();
  if (!STATUS_ACTIONS.includes(action)) throw inputError("action no soportada");
  const reason = normalizeRequired(input.reason, "reason", 300);
  if (reason.length < 5) throw inputError("reason debe tener entre 5 y 300 caracteres");
  return {
    action,
    reason,
    disposed_at: action === "dispose" ? normalizeOptionalDate(input.disposed_at, "disposed_at") : null,
  };
}

function normalizeFixedAssetDepreciationRunInput(input = {}) {
  const idempotencyKey = normalizeRequired(input.idempotency_key, "idempotency_key", 120);
  if (idempotencyKey.length < 12 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw inputError("idempotency_key debe tener al menos 12 caracteres seguros");
  }
  return {
    period_id: normalizeRequired(input.period_id, "period_id", 80),
    idempotency_key: idempotencyKey,
    description: normalizeOptionalText(input.description, 500, "description"),
  };
}

function normalizeFixedAssetDisposalDraftInput(input = {}) {
  const idempotencyKey = normalizeRequired(input.idempotency_key, "idempotency_key", 120);
  if (idempotencyKey.length < 12 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw inputError("idempotency_key debe tener al menos 12 caracteres seguros");
  }
  return {
    period_id: normalizeRequired(input.period_id, "period_id", 80),
    disposal_date: normalizeDate(input.disposal_date, "disposal_date"),
    disposal_loss_account_id: normalizeOptionalText(input.disposal_loss_account_id, 80, "disposal_loss_account_id"),
    description: normalizeOptionalText(input.description, 500, "description"),
    idempotency_key: idempotencyKey,
  };
}

function nextStatusForAction(currentStatus, action) {
  if (action === "activate") {
    if (currentStatus !== "inactive") throw inputError("Solo se puede activar inmovilizado inactivo");
    return "active";
  }
  if (action === "deactivate") {
    if (currentStatus !== "active") throw inputError("Solo se puede desactivar inmovilizado activo");
    return "inactive";
  }
  if (!["active", "inactive"].includes(currentStatus)) {
    throw inputError("Solo se puede dar de baja inmovilizado activo o inactivo");
  }
  return "disposed";
}

function sumMoney(values = []) {
  return values.reduce((total, value) => total + moneyToUnits(value, "amount"), 0n);
}

function depreciationAmountForPeriod(asset = {}, period = {}) {
  const periodStart = String(period.start_date || "").slice(0, 10);
  const periodEnd = String(period.end_date || "").slice(0, 10);
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw inputError("El periodo no tiene un rango de fechas valido");
  }
  const plan = buildStraightLineDepreciationPlan(asset);
  const rows = plan.rows.filter(row => row.depreciation_date >= periodStart && row.depreciation_date <= periodEnd);
  if (!rows.length) {
    throw inputError("No hay cuota de amortizacion para el periodo seleccionado");
  }
  const amount = sumMoney(rows.map(row => row.amount));
  if (amount <= 0n) throw inputError("La cuota de amortizacion del periodo debe ser mayor que cero");
  return {
    amount: unitsToMoney(amount),
    run_date: rows[rows.length - 1].depreciation_date,
    plan_from_date: rows[0].depreciation_date,
    plan_to_date: rows[rows.length - 1].depreciation_date,
    plan_periods: rows.map(row => row.period_number),
    rows,
  };
}

function addMonths(dateText, monthOffset) {
  const [year, month, day] = String(dateText).slice(0, 10).split("-").map(Number);
  const base = new Date(Date.UTC(year, month - 1 + monthOffset, 1));
  const lastDay = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(day, lastDay));
  return base.toISOString().slice(0, 10);
}

function buildStraightLineDepreciationPlan(asset = {}) {
  const cost = moneyToUnits(asset.acquisition_cost, "acquisition_cost");
  const residual = moneyToUnits(asset.residual_value || "0", "residual_value", { allowZero: true });
  const months = normalizePositiveInteger(asset.useful_life_months, "useful_life_months", 600);
  const depreciable = cost - residual;
  if (depreciable <= 0n) throw inputError("El valor amortizable debe ser mayor que cero");
  const monthlyBase = depreciable / BigInt(months);
  let remainder = depreciable % BigInt(months);
  let accumulated = 0n;
  const rows = [];
  for (let index = 0; index < months; index += 1) {
    const extra = remainder > 0n ? 1n : 0n;
    const amount = monthlyBase + extra;
    if (remainder > 0n) remainder -= 1n;
    accumulated += amount;
    rows.push({
      period_number: index + 1,
      depreciation_date: addMonths(asset.acquisition_date, index),
      amount: unitsToMoney(amount),
      accumulated: unitsToMoney(accumulated),
      net_book_value: unitsToMoney(cost - accumulated),
    });
  }
  return {
    method: "straight_line",
    acquisition_cost: unitsToMoney(cost),
    residual_value: unitsToMoney(residual),
    depreciable_amount: unitsToMoney(depreciable),
    useful_life_months: months,
    rows,
  };
}

module.exports = {
  DEPRECIATION_METHODS,
  STATUSES,
  depreciationAmountForPeriod,
  buildStraightLineDepreciationPlan,
  moneyToUnits,
  normalizeFixedAssetDepreciationRunInput,
  normalizeFixedAssetDisposalDraftInput,
  normalizeFixedAssetInput,
  normalizeFixedAssetQuery,
  normalizeFixedAssetStatusInput,
  nextStatusForAction,
  unitsToMoney,
};

const DIRECTIONS = ["receivable", "payable"];
const STATUSES = ["pending", "settled", "cancelled"];
const ACTIONS = ["settle", "cancel", "reopen"];
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

function moneyToUnits(value) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(raw)) {
    throw inputError("amount debe ser positivo, numerico y tener hasta 6 decimales");
  }
  const [whole, fraction = ""] = raw.split(".");
  const units = (BigInt(whole) * MONEY_FACTOR) + BigInt(fraction.padEnd(MONEY_SCALE, "0"));
  if (units <= 0n) throw inputError("amount debe ser mayor que cero");
  return units;
}

function unitsToMoney(units) {
  const normalized = BigInt(units);
  const whole = normalized / MONEY_FACTOR;
  const fraction = String(normalized % MONEY_FACTOR).padStart(MONEY_SCALE, "0");
  return `${whole}.${fraction}`;
}

function normalizeMaturityInput(input = {}) {
  const direction = String(input.direction || "").trim();
  if (!DIRECTIONS.includes(direction)) throw inputError("direction no soportado");
  const amountUnits = moneyToUnits(input.amount);
  return {
    party_id: normalizeRequired(input.party_id, "party_id", 80),
    direction,
    issue_date: normalizeOptionalDate(input.issue_date, "issue_date"),
    due_date: normalizeDate(input.due_date, "due_date"),
    document_ref: normalizeOptionalText(input.document_ref, 120, "document_ref"),
    description: normalizeRequired(input.description, "description", 300),
    amount: unitsToMoney(amountUnits),
    open_amount: unitsToMoney(amountUnits),
    currency: "EUR",
    payment_method: normalizeOptionalText(input.payment_method, 80, "payment_method"),
    source_system: normalizeOptionalText(input.source_system || "accounting", 80, "source_system"),
    source_type: normalizeOptionalText(input.source_type || "manual", 80, "source_type"),
    source_id: normalizeOptionalText(input.source_id, 120, "source_id"),
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
  };
}

function normalizeMaturityQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const direction = String(query.direction || "").trim();
  const status = String(query.status || "").trim();
  const format = String(query.format || "json").trim().toLowerCase();
  if (direction && !DIRECTIONS.includes(direction)) throw inputError("direction no soportado");
  if (status && !STATUSES.includes(status)) throw inputError("status no soportado");
  if (!["json", "csv"].includes(format)) throw inputError("format no soportado");
  return {
    limit,
    direction: direction || null,
    status: status || null,
    party_id: String(query.party_id || "").trim() || null,
    due_from: normalizeOptionalDate(query.due_from, "due_from"),
    due_to: normalizeOptionalDate(query.due_to, "due_to"),
    q: String(query.q || "").trim().slice(0, 140) || null,
    format,
  };
}

function normalizeMaturityStatusInput(input = {}) {
  const action = String(input.action || "").trim();
  if (!ACTIONS.includes(action)) throw inputError("action no soportada");
  const reason = normalizeRequired(input.reason, "reason", 300);
  if (reason.length < 5) throw inputError("reason debe tener entre 5 y 300 caracteres");
  return {
    action,
    reason,
    settled_date: action === "settle" ? normalizeOptionalDate(input.settled_date, "settled_date") : null,
  };
}

function nextStatusForAction(currentStatus, action) {
  if (action === "settle") {
    if (currentStatus !== "pending") throw inputError("Solo se puede liquidar un vencimiento pendiente");
    return "settled";
  }
  if (action === "cancel") {
    if (currentStatus !== "pending") throw inputError("Solo se puede cancelar un vencimiento pendiente");
    return "cancelled";
  }
  if (!["settled", "cancelled"].includes(currentStatus)) {
    throw inputError("Solo se puede reabrir un vencimiento liquidado o cancelado");
  }
  return "pending";
}

module.exports = {
  DIRECTIONS,
  STATUSES,
  normalizeMaturityInput,
  normalizeMaturityQuery,
  normalizeMaturityStatusInput,
  nextStatusForAction,
};

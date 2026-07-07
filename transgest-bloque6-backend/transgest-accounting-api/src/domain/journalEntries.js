const crypto = require("crypto");
const { stableStringify } = require("./eventContracts");

const MONEY_SCALE = 6;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeRequired(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw inputError(`${field} es obligatorio y no puede superar ${maxLength} caracteres`);
  }
  return normalized;
}

function normalizeIdempotencyKey(value, field = "idempotency_key") {
  const key = normalizeRequired(value, field, 120);
  if (key.length < 12 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    throw inputError(`${field} debe tener al menos 12 caracteres seguros`);
  }
  return key;
}

function normalizeDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw inputError("entry_date debe usar formato YYYY-MM-DD");
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw inputError("entry_date debe ser una fecha valida");
  }
  return date;
}

function normalizeOptionalDate(value, field) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    return normalizeDate(raw);
  } catch {
    throw inputError(`${field} debe usar formato YYYY-MM-DD y ser una fecha valida`);
  }
}

function normalizeExportFormat(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized !== "csv") throw inputError("format solo admite csv");
  return normalized;
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

function normalizeJournalLine(line = {}, index = 0) {
  const side = String(line.side || "").trim().toLowerCase();
  if (!["debit", "credit"].includes(side)) throw inputError(`lines[${index}].side debe ser debit o credit`);
  const accountId = normalizeRequired(line.account_id, `lines[${index}].account_id`, 80);
  const units = moneyToUnits(line.amount);
  const description = String(line.description || "").trim();
  if (description.length > 300) throw inputError(`lines[${index}].description no puede superar 300 caracteres`);
  return {
    line_number: index + 1,
    account_id: accountId,
    side,
    amount: unitsToMoney(units),
    amount_units: units,
    description: description || null,
  };
}

function normalizeJournalDraftInput(input = {}) {
  const lines = Array.isArray(input.lines) ? input.lines : [];
  if (lines.length < 2 || lines.length > 200) throw inputError("lines debe contener entre 2 y 200 lineas");
  return {
    fiscal_year_id: normalizeRequired(input.fiscal_year_id, "fiscal_year_id", 80),
    entry_date: normalizeDate(input.entry_date),
    description: normalizeRequired(input.description, "description", 500),
    idempotency_key: normalizeIdempotencyKey(input.idempotency_key),
    lines: lines.map(normalizeJournalLine),
  };
}

function normalizeJournalDraftUpdateInput(input = {}, fiscalYearId, idempotencyKey) {
  const normalized = normalizeJournalDraftInput({
    ...input,
    fiscal_year_id: fiscalYearId,
    idempotency_key: idempotencyKey,
  });
  return {
    entry_date: normalized.entry_date,
    description: normalized.description,
    lines: normalized.lines,
  };
}

function normalizeCancellationReason(value) {
  const reason = String(value || "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw inputError("reason es obligatorio y debe tener entre 5 y 500 caracteres");
  }
  return reason;
}

function normalizeJournalReversalInput(input = {}) {
  return {
    entry_date: normalizeDate(input.entry_date),
    reason: normalizeCancellationReason(input.reason),
    idempotency_key: normalizeIdempotencyKey(input.idempotency_key),
  };
}

function journalDraftRequestHash(input) {
  const payload = {
    fiscal_year_id: input.fiscal_year_id,
    entry_date: input.entry_date,
    description: input.description,
    lines: input.lines.map(line => ({
      line_number: line.line_number,
      account_id: line.account_id,
      side: line.side,
      amount: line.amount,
      description: line.description,
    })),
  };
  return crypto.createHash("sha256").update(stableStringify(payload)).digest("hex");
}

function summarizeJournalLines(lines = []) {
  let debitUnits = 0n;
  let creditUnits = 0n;
  for (const line of lines) {
    if (line.amount_units === undefined) throw inputError("Linea no normalizada");
    if (line.side === "debit") debitUnits += BigInt(line.amount_units);
    else creditUnits += BigInt(line.amount_units);
  }
  return {
    debit_units: debitUnits,
    credit_units: creditUnits,
    total_debit: unitsToMoney(debitUnits),
    total_credit: unitsToMoney(creditUnits),
    balanced: debitUnits === creditUnits,
  };
}

function summarizeStoredJournalLines(lines = []) {
  const normalized = lines.map((line, index) => {
    const debit = String(line.debit_amount || "0");
    const credit = String(line.credit_amount || "0");
    const side = Number(debit) > 0 ? "debit" : "credit";
    return normalizeJournalLine({
      account_id: line.account_id,
      side,
      amount: side === "debit" ? debit : credit,
      description: line.description,
    }, index);
  });
  return summarizeJournalLines(normalized);
}

function assertBalancedJournal(lines = []) {
  if (lines.length < 2) throw inputError("El asiento debe contener al menos dos lineas", 409);
  const summary = summarizeStoredJournalLines(lines);
  if (!summary.balanced) throw inputError("El asiento esta descuadrado: Debe y Haber deben coincidir", 409);
  return summary;
}

function normalizeJournalQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
  const status = String(query.status || "").trim();
  if (status && !["draft", "posted", "cancelled"].includes(status)) throw inputError("status no soportado");
  const entryType = String(query.entry_type || "").trim();
  if (entryType && !["manual", "reversal", "depreciation", "fixed_asset_disposal"].includes(entryType)) {
    throw inputError("entry_type no soportado");
  }
  const dateFrom = normalizeOptionalDate(query.date_from, "date_from");
  const dateTo = normalizeOptionalDate(query.date_to, "date_to");
  if (dateFrom && dateTo && dateFrom > dateTo) throw inputError("date_from no puede ser posterior a date_to");
  const q = String(query.q || "").trim().slice(0, 140);
  return {
    fiscal_year_id: String(query.fiscal_year_id || "").trim() || null,
    status: status || null,
    entry_type: entryType || null,
    date_from: dateFrom,
    date_to: dateTo,
    q: q || null,
    format: normalizeExportFormat(query.format),
    limit,
  };
}

module.exports = {
  assertBalancedJournal,
  journalDraftRequestHash,
  moneyToUnits,
  normalizeCancellationReason,
  normalizeIdempotencyKey,
  normalizeJournalDraftInput,
  normalizeJournalDraftUpdateInput,
  normalizeJournalReversalInput,
  normalizeJournalQuery,
  summarizeJournalLines,
  summarizeStoredJournalLines,
  unitsToMoney,
};

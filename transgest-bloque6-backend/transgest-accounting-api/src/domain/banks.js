const TRANSACTION_DIRECTIONS = ["inflow", "outflow"];
const TRANSACTION_STATUSES = ["unmatched", "matched", "ignored"];
const MONEY_SCALE = 6;
const MONEY_FACTOR = 10n ** BigInt(MONEY_SCALE);
const IMPORT_SOURCE_SYSTEM = "bank_csv";
const IMPORT_SOURCE_TYPE = "csv_manual";

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeRequiredText(value, maxLength, field) {
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

function moneyToUnits(value, { allowZero = false, allowNegative = false } = {}) {
  const raw = String(value ?? "").trim().replace(",", ".");
  if (!/^-?\d{1,12}(\.\d{1,6})?$/.test(raw)) {
    throw inputError("amount debe ser numerico y tener hasta 6 decimales");
  }
  const negative = raw.startsWith("-");
  const normalized = negative ? raw.slice(1) : raw;
  const [whole, fraction = ""] = normalized.split(".");
  let units = (BigInt(whole) * MONEY_FACTOR) + BigInt(fraction.padEnd(MONEY_SCALE, "0"));
  if (negative) units = -units;
  if (!allowZero && units === 0n) throw inputError("amount debe ser mayor que cero");
  if (!allowNegative && units < 0n) throw inputError("amount debe ser mayor que cero");
  return units;
}

function unitsToMoney(units) {
  const normalized = BigInt(units);
  const negative = normalized < 0n;
  const absolute = negative ? -normalized : normalized;
  const whole = absolute / MONEY_FACTOR;
  const fraction = String(absolute % MONEY_FACTOR).padStart(MONEY_SCALE, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function normalizeIban(value) {
  const text = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!text) return null;
  if (!/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(text)) throw inputError("iban no tiene un formato basico valido");
  return text;
}

function normalizeBankAccountInput(input = {}) {
  const currency = String(input.currency || "EUR").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw inputError("currency debe usar codigo ISO de 3 letras");
  const openingBalance = unitsToMoney(moneyToUnits(input.opening_balance ?? "0", { allowZero: true }));
  return {
    account_id: String(input.account_id || "").trim() || null,
    name: normalizeRequiredText(input.name, 180, "name"),
    bank_name: normalizeOptionalText(input.bank_name, 180, "bank_name"),
    iban: normalizeIban(input.iban),
    swift_bic: normalizeOptionalText(input.swift_bic, 20, "swift_bic"),
    currency,
    opening_balance: openingBalance,
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
  };
}

function normalizeBankAccountQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const active = query.active === "true" ? true : query.active === "false" ? false : null;
  return {
    limit,
    active,
    q: String(query.q || "").trim().slice(0, 140) || null,
  };
}

function normalizeBankTransactionInput(input = {}) {
  const direction = String(input.direction || "").trim();
  if (!TRANSACTION_DIRECTIONS.includes(direction)) throw inputError("direction no soportado");
  const amount = unitsToMoney(moneyToUnits(input.amount));
  return {
    bank_account_id: normalizeRequiredText(input.bank_account_id, 80, "bank_account_id"),
    transaction_date: normalizeDate(input.transaction_date, "transaction_date"),
    value_date: normalizeOptionalDate(input.value_date, "value_date"),
    description: normalizeRequiredText(input.description, 300, "description"),
    reference: normalizeOptionalText(input.reference, 140, "reference"),
    counterparty_name: normalizeOptionalText(input.counterparty_name, 220, "counterparty_name"),
    amount,
    direction,
    source_system: normalizeOptionalText(input.source_system || "accounting", 80, "source_system"),
    source_type: normalizeOptionalText(input.source_type || "manual", 80, "source_type"),
    source_id: normalizeOptionalText(input.source_id, 120, "source_id"),
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
  };
}

function normalizeBankTransactionQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const direction = String(query.direction || "").trim();
  const status = String(query.status || "").trim();
  const format = String(query.format || "json").trim().toLowerCase();
  if (direction && !TRANSACTION_DIRECTIONS.includes(direction)) throw inputError("direction no soportado");
  if (status && !TRANSACTION_STATUSES.includes(status)) throw inputError("status no soportado");
  if (!["json", "csv"].includes(format)) throw inputError("format no soportado");
  return {
    limit,
    direction: direction || null,
    status: status || null,
    bank_account_id: String(query.bank_account_id || "").trim() || null,
    date_from: normalizeOptionalDate(query.date_from, "date_from"),
    date_to: normalizeOptionalDate(query.date_to, "date_to"),
    q: String(query.q || "").trim().slice(0, 140) || null,
    format,
  };
}

function normalizeBankStatementImportInput(input = {}) {
  const csvText = String(input.csv_text || "").trim();
  if (!csvText) throw inputError("csv_text es obligatorio");
  if (csvText.length > 500000) throw inputError("csv_text no puede superar 500000 caracteres");
  return {
    bank_account_id: normalizeRequiredText(input.bank_account_id, 80, "bank_account_id"),
    filename: normalizeOptionalText(input.filename, 240, "filename"),
    csv_text: csvText,
  };
}

function normalizeBankStatementImportQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20,
    bank_account_id: String(query.bank_account_id || "").trim() || null,
  };
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitCsvLine(line, delimiter) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === "\"") {
      if (quoted && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function detectDelimiter(headerLine) {
  const semicolon = (headerLine.match(/;/g) || []).length;
  const comma = (headerLine.match(/,/g) || []).length;
  return semicolon >= comma ? ";" : ",";
}

function parseImportAmount(rawValue) {
  const raw = String(rawValue || "").trim().replace(/\s+/g, "");
  if (!raw) throw inputError("importe obligatorio");
  let normalized = raw;
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,6}$/.test(raw)) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+\.\d{1,6}$/.test(raw)) {
    normalized = raw.replace(/,/g, "");
  } else {
    normalized = raw.replace(",", ".");
  }
  const units = moneyToUnits(normalized, { allowNegative: true });
  return {
    amount: unitsToMoney(units < 0n ? -units : units),
    sign: units < 0n ? -1 : 1,
  };
}

function normalizeImportDirection(value, sign) {
  const raw = normalizeHeader(value);
  if (!raw) return sign < 0 ? "outflow" : "inflow";
  if (["inflow", "entrada", "cobro", "haber", "abono", "ingreso"].includes(raw)) return "inflow";
  if (["outflow", "salida", "pago", "debe", "cargo", "gasto"].includes(raw)) return "outflow";
  throw inputError("tipo de movimiento no soportado");
}

const IMPORT_HEADER_ALIASES = {
  transaction_date: ["fecha", "fecha_operacion", "transaction_date", "date"],
  value_date: ["fecha_valor", "value_date"],
  description: ["descripcion", "concepto", "description", "detalle"],
  reference: ["referencia", "reference", "ref"],
  counterparty_name: ["contraparte", "tercero", "counterparty", "counterparty_name", "nombre"],
  amount: ["importe", "amount", "valor"],
  direction: ["tipo", "direction", "sentido"],
};

function findHeaderIndex(headers, field) {
  const aliases = IMPORT_HEADER_ALIASES[field];
  return headers.findIndex(header => aliases.includes(header));
}

function parseBankStatementCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  if (lines.length < 2) throw inputError("csv_text debe incluir cabecera y al menos una fila");
  if (lines.length > 501) throw inputError("csv_text no puede incluir mas de 500 movimientos");

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  const indexes = {
    transaction_date: findHeaderIndex(headers, "transaction_date"),
    value_date: findHeaderIndex(headers, "value_date"),
    description: findHeaderIndex(headers, "description"),
    reference: findHeaderIndex(headers, "reference"),
    counterparty_name: findHeaderIndex(headers, "counterparty_name"),
    amount: findHeaderIndex(headers, "amount"),
    direction: findHeaderIndex(headers, "direction"),
  };
  for (const field of ["transaction_date", "description", "amount"]) {
    if (indexes[field] < 0) throw inputError(`csv_text no contiene columna ${field}`);
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    try {
      const cells = splitCsvLine(lines[i], delimiter);
      const amountInfo = parseImportAmount(cells[indexes.amount]);
      const direction = normalizeImportDirection(indexes.direction >= 0 ? cells[indexes.direction] : "", amountInfo.sign);
      rows.push({
        row_number: i + 1,
        transaction_date: normalizeDate(cells[indexes.transaction_date], "transaction_date"),
        value_date: indexes.value_date >= 0 ? normalizeOptionalDate(cells[indexes.value_date], "value_date") : null,
        description: normalizeRequiredText(cells[indexes.description], 300, "description"),
        reference: indexes.reference >= 0 ? normalizeOptionalText(cells[indexes.reference], 140, "reference") : null,
        counterparty_name: indexes.counterparty_name >= 0 ? normalizeOptionalText(cells[indexes.counterparty_name], 220, "counterparty_name") : null,
        amount: amountInfo.amount,
        direction,
      });
    } catch (error) {
      errors.push({ row_number: i + 1, error: error.message });
    }
  }
  return { rows, errors, row_count: lines.length - 1 };
}

function normalizeBankReconciliationInput(input = {}) {
  const maturityId = normalizeRequiredText(input.maturity_id, 80, "maturity_id");
  const reason = normalizeRequiredText(input.reason, 300, "reason");
  if (reason.length < 5) throw inputError("reason debe tener entre 5 y 300 caracteres");
  return { maturity_id: maturityId, reason };
}

function normalizeBankTransactionStatusInput(input = {}) {
  const action = String(input.action || "").trim();
  if (!["ignore", "reopen"].includes(action)) throw inputError("action no soportado");
  const reason = normalizeRequiredText(input.reason, 300, "reason");
  if (reason.length < 5) throw inputError("reason debe tener entre 5 y 300 caracteres");
  return { action, reason };
}

function normalizeBankReconciliationVoidInput(input = {}) {
  const reason = normalizeRequiredText(input.reason, 300, "reason");
  if (reason.length < 5) throw inputError("reason debe tener entre 5 y 300 caracteres");
  return { reason };
}

function normalizeBankReconciliationSuggestionQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const rawWindow = Number.parseInt(query.days_window, 10);
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 20) : 5,
    days_window: Number.isFinite(rawWindow) ? Math.min(Math.max(rawWindow, 0), 120) : 30,
  };
}

function dateOnly(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value || "");
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? text.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

function dateDistanceDays(left, right) {
  const leftTime = Date.parse(`${dateOnly(left)}T00:00:00.000Z`);
  const rightTime = Date.parse(`${dateOnly(right)}T00:00:00.000Z`);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return null;
  return Math.abs(Math.round((leftTime - rightTime) / 86400000));
}

function textTokens(...values) {
  const stopWords = new Set(["de", "del", "la", "las", "el", "los", "y", "a", "por", "para", "con", "sin", "ref"]);
  return new Set(values
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3 && !stopWords.has(token)));
}

function scoreBankReconciliationCandidate(transaction, maturity) {
  const expectedDirection = transaction.direction === "inflow" ? "receivable" : "payable";
  if (maturity.status && maturity.status !== "pending") return { score: 0, reasons: ["Vencimiento no pendiente"] };
  if (maturity.direction !== expectedDirection) return { score: 0, reasons: ["Tipo incompatible"] };
  if (moneyUnits(transaction.amount) !== moneyUnits(maturity.open_amount)) return { score: 0, reasons: ["Importe diferente"] };

  let score = 70;
  const reasons = ["Importe exacto", "Tipo compatible"];
  const distance = dateDistanceDays(transaction.transaction_date, maturity.due_date);
  if (distance !== null) {
    if (distance === 0) {
      score += 15;
      reasons.push("Misma fecha");
    } else if (distance <= 3) {
      score += 12;
      reasons.push(`Vence a ${distance} dias`);
    } else if (distance <= 7) {
      score += 9;
      reasons.push(`Vence a ${distance} dias`);
    } else if (distance <= 15) {
      score += 6;
      reasons.push(`Vence a ${distance} dias`);
    } else if (distance <= 30) {
      score += 3;
      reasons.push(`Vence a ${distance} dias`);
    }
  }

  const transactionTokens = textTokens(transaction.description, transaction.reference, transaction.counterparty_name);
  const maturityTokens = textTokens(maturity.description, maturity.document_ref, maturity.party_name);
  const shared = [...transactionTokens].filter(token => maturityTokens.has(token));
  if (shared.length) {
    score += Math.min(shared.length * 3, 12);
    reasons.push(`Texto coincidente: ${shared.slice(0, 3).join(", ")}`);
  }

  const counterparty = String(transaction.counterparty_name || "").trim().toLowerCase();
  const partyName = String(maturity.party_name || "").trim().toLowerCase();
  if (counterparty && partyName && (counterparty.includes(partyName) || partyName.includes(counterparty))) {
    score += 10;
    reasons.push("Contraparte coincide");
  }

  return { score: Math.min(score, 100), reasons };
}

function moneyUnits(value) {
  return moneyToUnits(value, { allowZero: true });
}

module.exports = {
  IMPORT_SOURCE_SYSTEM,
  IMPORT_SOURCE_TYPE,
  TRANSACTION_DIRECTIONS,
  TRANSACTION_STATUSES,
  moneyUnits,
  normalizeBankAccountInput,
  normalizeBankAccountQuery,
  normalizeBankReconciliationInput,
  normalizeBankReconciliationSuggestionQuery,
  normalizeBankReconciliationVoidInput,
  normalizeBankStatementImportInput,
  normalizeBankStatementImportQuery,
  normalizeBankTransactionInput,
  normalizeBankTransactionQuery,
  normalizeBankTransactionStatusInput,
  parseBankStatementCsv,
  scoreBankReconciliationCandidate,
};

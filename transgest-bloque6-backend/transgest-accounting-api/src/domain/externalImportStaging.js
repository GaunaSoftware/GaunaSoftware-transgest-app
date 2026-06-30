const crypto = require("crypto");
const { stableStringify } = require("./eventContracts");
const { externalAccountingIntegrations } = require("./externalIntegrations");

const IMPORT_TYPES = ["parties", "maturities", "bank_transactions", "journal_entries", "accounts", "generic"];
const SOURCE_FORMATS = ["csv", "json", "manual"];
const BATCH_STATUSES = ["pending_review", "approved", "rejected", "cancelled", "applied"];
const ROW_STATUSES = ["valid", "warning", "error"];
const REVIEW_ACTIONS = ["approve", "reject", "cancel"];
const MAX_ROWS = 500;
const PARTY_TYPES = ["customer", "supplier", "customer_supplier", "employee", "tax_authority", "bank", "other"];
const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense", "memorandum"];
const MATURITY_DIRECTIONS = ["receivable", "payable"];
const BANK_TRANSACTION_DIRECTIONS = ["inflow", "outflow"];
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function inputError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function normalizeIdentifier(value, field, fallback = null) {
  const text = String(value || fallback || "").trim();
  if (!/^[a-zA-Z0-9_.:-]{2,80}$/.test(text)) throw inputError(`${field} debe ser un identificador simple`);
  return text;
}

function normalizeOptionalText(value, maxLength, field) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw inputError(`${field} no puede superar ${maxLength} caracteres`);
  return text || null;
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

function parseGenericCsv(csvText) {
  const lines = String(csvText || "")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter(line => line.trim());
  if (lines.length < 2) throw inputError("csv_text debe incluir cabecera y al menos una fila");
  if (lines.length - 1 > MAX_ROWS) throw inputError(`csv_text no puede incluir mas de ${MAX_ROWS} filas`);

  const delimiter = detectDelimiter(lines[0]);
  const headers = splitCsvLine(lines[0], delimiter).map(normalizeHeader);
  if (!headers.length || headers.some(header => !header)) throw inputError("csv_text contiene cabeceras vacias o invalidas");
  if (new Set(headers).size !== headers.length) throw inputError("csv_text contiene cabeceras duplicadas");

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line, delimiter);
    const raw = {};
    headers.forEach((header, cellIndex) => {
      raw[header] = cells[cellIndex] === undefined ? "" : cells[cellIndex];
    });
    const emptyCells = Object.values(raw).filter(value => !String(value || "").trim()).length;
    const warnings = emptyCells ? [{ code: "empty_cells", message: `${emptyCells} campos vacios` }] : [];
    return {
      row_number: index + 1,
      raw_payload: raw,
      normalized_payload: raw,
      errors: [],
      warnings,
      status: warnings.length ? "warning" : "valid",
    };
  });
}

function normalizeRowInput(row, index) {
  const raw = row && typeof row.raw_payload === "object" && !Array.isArray(row.raw_payload)
    ? row.raw_payload
    : row && typeof row === "object" && !Array.isArray(row)
      ? row
      : null;
  if (!raw) throw inputError(`rows[${index}] debe ser un objeto`);
  const errors = Array.isArray(row.errors) ? row.errors : [];
  const warnings = Array.isArray(row.warnings) ? row.warnings : [];
  const status = errors.length ? "error" : warnings.length ? "warning" : "valid";
  return {
    row_number: index + 1,
    raw_payload: raw,
    normalized_payload: row.normalized_payload && typeof row.normalized_payload === "object" ? row.normalized_payload : raw,
    errors,
    warnings,
    status,
  };
}

function rowsFromInput(input) {
  if (String(input.source_format || "").trim() === "csv" || input.csv_text) {
    return parseGenericCsv(input.csv_text);
  }
  const rows = Array.isArray(input.rows) ? input.rows : [];
  if (!rows.length) throw inputError("rows o csv_text es obligatorio");
  if (rows.length > MAX_ROWS) throw inputError(`rows no puede superar ${MAX_ROWS} elementos`);
  return rows.map(normalizeRowInput);
}

function normalizeExternalImportBatchInput(input = {}) {
  const providerId = normalizeIdentifier(input.provider_id, "provider_id", "generic");
  const knownProvider = providerId === "generic" || externalAccountingIntegrations.some(item => item.id === providerId);
  const importType = String(input.import_type || "generic").trim();
  const sourceFormat = String(input.source_format || (input.csv_text ? "csv" : "manual")).trim();
  if (!IMPORT_TYPES.includes(importType)) throw inputError("import_type no soportado");
  if (!SOURCE_FORMATS.includes(sourceFormat)) throw inputError("source_format no soportado");

  const rows = rowsFromInput({ ...input, provider_id: providerId, import_type: importType, source_format: sourceFormat });
  const normalizedRows = rows.map(row => ({
    ...row,
    row_hash: sha256(stableStringify(row.raw_payload)),
  }));
  if (new Set(normalizedRows.map(row => row.row_hash)).size !== normalizedRows.length) {
    throw inputError("El lote contiene filas duplicadas");
  }
  const warningCount = normalizedRows.filter(row => row.status === "warning").length;
  const errorCount = normalizedRows.filter(row => row.status === "error").length;
  const validCount = normalizedRows.filter(row => row.status !== "error").length;
  const requestHash = sha256(stableStringify({
    provider_id: providerId,
    import_type: importType,
    source_format: sourceFormat,
    rows: normalizedRows.map(row => row.raw_payload),
  }));

  return {
    provider_id: providerId,
    provider_known: knownProvider,
    import_type: importType,
    source_format: sourceFormat,
    original_filename: normalizeOptionalText(input.original_filename || input.filename, 240, "original_filename"),
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
    request_hash: requestHash,
    row_count: normalizedRows.length,
    valid_count: validCount,
    error_count: errorCount,
    warning_count: warningCount,
    rows: normalizedRows,
  };
}

function normalizeExternalImportQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const status = String(query.status || "").trim();
  const importType = String(query.import_type || "").trim();
  return {
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 50,
    status: status && BATCH_STATUSES.includes(status) ? status : null,
    provider_id: String(query.provider_id || "").trim().slice(0, 80) || null,
    import_type: importType && IMPORT_TYPES.includes(importType) ? importType : null,
  };
}

function normalizeExternalImportReviewInput(input = {}) {
  const action = String(input.action || "").trim();
  if (!REVIEW_ACTIONS.includes(action)) throw inputError("action no soportada");
  const reason = String(input.reason || "").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw inputError("reason debe tener entre 5 y 500 caracteres");
  }
  return { action, reason };
}

function normalizeExternalImportApplyInput(input = {}) {
  const reason = String(input.reason || "Aplicacion de lote externo aprobado").trim();
  if (reason.length < 5 || reason.length > 500) {
    throw inputError("reason debe tener entre 5 y 500 caracteres");
  }
  return { reason };
}

function nextBatchStatus(currentStatus, review) {
  if (currentStatus !== "pending_review") {
    throw inputError("Solo se pueden revisar lotes pendientes", 409);
  }
  if (review.action === "approve") return "approved";
  if (review.action === "reject") return "rejected";
  return "cancelled";
}

function firstValue(payload = {}, keys = []) {
  for (const key of keys) {
    const value = payload[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  return "";
}

function normalizePartyType(value) {
  const raw = normalizeHeader(value);
  if (!raw) return "customer";
  if (["cliente", "customer"].includes(raw)) return "customer";
  if (["proveedor", "supplier", "vendor"].includes(raw)) return "supplier";
  if (["cliente_proveedor", "customer_supplier", "ambos"].includes(raw)) return "customer_supplier";
  if (["empleado", "employee"].includes(raw)) return "employee";
  if (["administracion", "tax_authority", "hacienda"].includes(raw)) return "tax_authority";
  if (["banco", "bank"].includes(raw)) return "bank";
  if (["otro", "other"].includes(raw)) return "other";
  return raw;
}

function normalizeAccountType(value) {
  const raw = normalizeHeader(value);
  if (["activo", "asset"].includes(raw)) return "asset";
  if (["pasivo", "liability"].includes(raw)) return "liability";
  if (["patrimonio", "patrimonio_neto", "equity", "net_worth"].includes(raw)) return "equity";
  if (["ingreso", "ingresos", "income", "revenue"].includes(raw)) return "income";
  if (["gasto", "gastos", "expense"].includes(raw)) return "expense";
  if (["orden", "control", "memorandum"].includes(raw)) return "memorandum";
  return raw;
}

function normalizeBooleanLike(value, defaultValue = true) {
  if (value === undefined || value === null || String(value).trim() === "") return defaultValue;
  const raw = normalizeHeader(value);
  if (["true", "1", "si", "yes", "y", "postable", "movimiento"].includes(raw)) return true;
  if (["false", "0", "no", "n", "cabecera", "grupo"].includes(raw)) return false;
  return defaultValue;
}

function normalizeMaturityDirection(value) {
  const raw = normalizeHeader(value);
  if (["cobro", "cliente", "receivable", "debe", "venta"].includes(raw)) return "receivable";
  if (["pago", "proveedor", "payable", "haber", "compra"].includes(raw)) return "payable";
  return raw;
}

function normalizeBankTransactionDirection(value, sign) {
  const raw = normalizeHeader(value);
  if (!raw) return sign < 0 ? "outflow" : "inflow";
  if (["inflow", "entrada", "cobro", "cobrado", "haber", "abono", "ingreso", "positivo"].includes(raw)) return "inflow";
  if (["outflow", "salida", "pago", "pagado", "debe", "cargo", "gasto", "negativo"].includes(raw)) return "outflow";
  return raw;
}

function normalizeDateLike(value) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (!match) return raw;
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function isValidIsoDate(value) {
  const date = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function normalizeAmountLike(value) {
  return String(value || "").trim().replace(",", ".");
}

function parseBankTransactionAmountLike(value) {
  const raw = String(value || "").trim().replace(/\s+/g, "").replace(/[€]/g, "");
  if (!raw) return { amount: "", sign: 1 };
  let normalized = raw;
  if (/^-?\d{1,3}(\.\d{3})+,\d{1,6}$/.test(raw)) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})+\.\d{1,6}$/.test(raw)) {
    normalized = raw.replace(/,/g, "");
  } else {
    normalized = raw.replace(",", ".");
  }
  const sign = normalized.startsWith("-") ? -1 : 1;
  const absolute = sign < 0 ? normalized.slice(1) : normalized;
  return { amount: absolute, sign };
}

function parseSignedAmountLike(value) {
  const parsed = parseBankTransactionAmountLike(value);
  return {
    amount: parsed.amount,
    sign: parsed.sign,
  };
}

function normalizeJournalSide(value, sign = 1) {
  const raw = normalizeHeader(value);
  if (!raw) return sign < 0 ? "credit" : "debit";
  if (["debit", "debe", "d", "cargo"].includes(raw)) return "debit";
  if (["credit", "haber", "h", "abono"].includes(raw)) return "credit";
  return raw;
}

function mapPartyStagingRow(row) {
  const payload = row.normalized_payload || row.raw_payload || {};
  const partyType = normalizePartyType(firstValue(payload, ["party_type", "tipo", "tipo_tercero"]));
  const mapped = {
    party_type: partyType,
    legal_name: firstValue(payload, ["legal_name", "nombre_fiscal", "razon_social", "nombre", "name"]),
    tax_id: firstValue(payload, ["tax_id", "nif_cif", "nif", "cif", "vat"]),
    email: firstValue(payload, ["email", "correo", "correo_electronico"]),
    phone: firstValue(payload, ["phone", "telefono", "tel"]),
  };
  const errors = [];
  const warnings = [];
  if (!mapped.legal_name) errors.push({ code: "missing_legal_name", message: "Falta nombre fiscal" });
  if (!PARTY_TYPES.includes(mapped.party_type)) errors.push({ code: "unsupported_party_type", message: `Tipo de tercero no soportado: ${mapped.party_type}` });
  if (!mapped.tax_id) warnings.push({ code: "missing_tax_id", message: "Sin NIF/CIF para detectar duplicados fiscales" });
  return { mapped, errors, warnings };
}

function mapMaturityStagingRow(row) {
  const payload = row.normalized_payload || row.raw_payload || {};
  const direction = normalizeMaturityDirection(firstValue(payload, ["direction", "tipo", "sentido", "clase"]));
  const amount = normalizeAmountLike(firstValue(payload, ["amount", "importe", "total"]));
  const dueDate = normalizeDateLike(firstValue(payload, ["due_date", "vencimiento", "fecha_vencimiento"]));
  const issueDate = normalizeDateLike(firstValue(payload, ["issue_date", "fecha_emision", "fecha_documento"]));
  const mapped = {
    party_id: firstValue(payload, ["party_id", "tercero_id"]),
    party_tax_id: firstValue(payload, ["party_tax_id", "tax_id", "nif", "cif", "nif_cif"]),
    party_name: firstValue(payload, ["party_name", "tercero", "nombre_tercero", "cliente", "proveedor"]),
    direction,
    issue_date: issueDate || null,
    due_date: dueDate,
    document_ref: firstValue(payload, ["document_ref", "documento", "factura", "referencia"]),
    description: firstValue(payload, ["description", "descripcion", "concepto"]),
    amount,
    payment_method: firstValue(payload, ["payment_method", "forma_pago", "metodo_pago"]),
    notes: firstValue(payload, ["notes", "notas", "observaciones"]),
  };
  const errors = [];
  const warnings = [];
  if (!mapped.party_id && !mapped.party_tax_id && !mapped.party_name) errors.push({ code: "missing_party_reference", message: "Falta referencia de tercero" });
  if (mapped.party_id && !/^[0-9a-fA-F-]{36}$/.test(mapped.party_id)) errors.push({ code: "invalid_party_id", message: "party_id invalido" });
  if (!MATURITY_DIRECTIONS.includes(mapped.direction)) errors.push({ code: "unsupported_maturity_direction", message: `Tipo de vencimiento no soportado: ${mapped.direction || "vacio"}` });
  if (!isValidIsoDate(mapped.due_date)) errors.push({ code: "invalid_due_date", message: "Fecha de vencimiento invalida" });
  if (mapped.issue_date && !isValidIsoDate(mapped.issue_date)) errors.push({ code: "invalid_issue_date", message: "Fecha de emision invalida" });
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(mapped.amount) || Number(mapped.amount) <= 0) errors.push({ code: "invalid_amount", message: "Importe invalido" });
  if (!mapped.description) warnings.push({ code: "missing_description", message: "Sin descripcion; se usara la referencia o el tercero" });
  return { mapped, errors, warnings };
}

function mapBankTransactionStagingRow(row) {
  const payload = row.normalized_payload || row.raw_payload || {};
  const parsedAmount = parseBankTransactionAmountLike(firstValue(payload, ["amount", "importe", "valor"]));
  const direction = normalizeBankTransactionDirection(firstValue(payload, ["direction", "tipo", "sentido"]), parsedAmount.sign);
  const transactionDate = normalizeDateLike(firstValue(payload, ["transaction_date", "fecha", "fecha_operacion", "date"]));
  const valueDate = normalizeDateLike(firstValue(payload, ["value_date", "fecha_valor"]));
  const mapped = {
    bank_account_id: firstValue(payload, ["bank_account_id", "cuenta_bancaria_id", "cuenta_banco_id"]),
    iban: firstValue(payload, ["iban", "cuenta_iban", "iban_cuenta"]).replace(/\s+/g, "").toUpperCase(),
    transaction_date: transactionDate,
    value_date: valueDate || null,
    description: firstValue(payload, ["description", "descripcion", "concepto", "detalle"]),
    reference: firstValue(payload, ["reference", "referencia", "ref", "documento"]),
    counterparty_name: firstValue(payload, ["counterparty_name", "contraparte", "tercero", "nombre"]),
    amount: parsedAmount.amount,
    direction,
    notes: firstValue(payload, ["notes", "notas", "observaciones"]),
  };
  const errors = [];
  const warnings = [];
  if (!mapped.bank_account_id && !mapped.iban) errors.push({ code: "missing_bank_account_reference", message: "Falta bank_account_id o IBAN" });
  if (mapped.bank_account_id && !UUID_RE.test(mapped.bank_account_id)) errors.push({ code: "invalid_bank_account_id", message: "bank_account_id invalido" });
  if (mapped.iban && !/^[A-Z]{2}[0-9A-Z]{13,32}$/.test(mapped.iban)) errors.push({ code: "invalid_iban", message: "IBAN invalido" });
  if (!isValidIsoDate(mapped.transaction_date)) errors.push({ code: "invalid_transaction_date", message: "Fecha de operacion invalida" });
  if (mapped.value_date && !isValidIsoDate(mapped.value_date)) errors.push({ code: "invalid_value_date", message: "Fecha valor invalida" });
  if (!mapped.description) errors.push({ code: "missing_description", message: "Falta concepto o descripcion" });
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(mapped.amount) || Number(mapped.amount) <= 0) errors.push({ code: "invalid_amount", message: "Importe invalido" });
  if (!BANK_TRANSACTION_DIRECTIONS.includes(mapped.direction)) errors.push({ code: "unsupported_bank_transaction_direction", message: `Tipo de movimiento no soportado: ${mapped.direction || "vacio"}` });
  if (!mapped.reference) warnings.push({ code: "missing_reference", message: "Sin referencia bancaria" });
  if (!mapped.counterparty_name) warnings.push({ code: "missing_counterparty", message: "Sin contraparte" });
  return { mapped, errors, warnings };
}

function mapJournalEntryStagingRow(row) {
  const payload = row.normalized_payload || row.raw_payload || {};
  const debit = parseSignedAmountLike(firstValue(payload, ["debit_amount", "debit", "debe"]));
  const credit = parseSignedAmountLike(firstValue(payload, ["credit_amount", "credit", "haber"]));
  const rawAmount = firstValue(payload, ["amount", "importe"]);
  const amount = parseSignedAmountLike(rawAmount);
  const hasDebit = Boolean(debit.amount) && Number(debit.amount) > 0;
  const hasCredit = Boolean(credit.amount) && Number(credit.amount) > 0;
  const side = hasDebit ? "debit" : hasCredit ? "credit" : normalizeJournalSide(firstValue(payload, ["side", "tipo", "sentido", "debe_haber"]), amount.sign);
  const resolvedAmount = hasDebit ? debit.amount : hasCredit ? credit.amount : amount.amount;
  const entryDate = normalizeDateLike(firstValue(payload, ["entry_date", "fecha", "fecha_asiento", "date"]));
  const mapped = {
    entry_ref: firstValue(payload, ["entry_ref", "asiento", "asiento_id", "entry_id", "numero_asiento", "numero"]),
    entry_date: entryDate,
    description: firstValue(payload, ["description", "descripcion", "concepto", "concepto_asiento"]),
    line_description: firstValue(payload, ["line_description", "descripcion_linea", "concepto_linea", "detalle"]),
    account_id: firstValue(payload, ["account_id", "cuenta_id"]),
    account_code: firstValue(payload, ["account_code", "codigo_cuenta", "cuenta", "code"]),
    side,
    amount: resolvedAmount,
  };
  const errors = [];
  const warnings = [];
  if (!mapped.entry_ref) errors.push({ code: "missing_entry_ref", message: "Falta referencia de asiento" });
  if (mapped.entry_ref.length > 180) errors.push({ code: "entry_ref_too_long", message: "La referencia de asiento no puede superar 180 caracteres" });
  if (!isValidIsoDate(mapped.entry_date)) errors.push({ code: "invalid_entry_date", message: "Fecha de asiento invalida" });
  if (!mapped.description) errors.push({ code: "missing_description", message: "Falta concepto del asiento" });
  if (mapped.description.length > 500) errors.push({ code: "description_too_long", message: "El concepto del asiento no puede superar 500 caracteres" });
  if (mapped.line_description.length > 300) errors.push({ code: "line_description_too_long", message: "El concepto de linea no puede superar 300 caracteres" });
  if (!mapped.account_id && !mapped.account_code) errors.push({ code: "missing_account_reference", message: "Falta cuenta contable por ID o codigo" });
  if (mapped.account_id && !UUID_RE.test(mapped.account_id)) errors.push({ code: "invalid_account_id", message: "account_id invalido" });
  if (mapped.account_code && !/^[0-9]{1,20}$/.test(mapped.account_code)) errors.push({ code: "invalid_account_code", message: "Codigo de cuenta invalido" });
  if (hasDebit && hasCredit) errors.push({ code: "ambiguous_journal_side", message: "La linea no puede tener Debe y Haber a la vez" });
  if (!["debit", "credit"].includes(mapped.side)) errors.push({ code: "unsupported_journal_side", message: `Lado no soportado: ${mapped.side || "vacio"}` });
  if (!/^\d{1,12}(\.\d{1,6})?$/.test(mapped.amount) || Number(mapped.amount) <= 0) errors.push({ code: "invalid_amount", message: "Importe invalido" });
  if (!mapped.line_description) warnings.push({ code: "missing_line_description", message: "Sin concepto de linea; se usara el concepto del asiento" });
  return { mapped, errors, warnings };
}

function mapAccountStagingRow(row) {
  const payload = row.normalized_payload || row.raw_payload || {};
  const accountType = normalizeAccountType(firstValue(payload, ["account_type", "tipo", "tipo_cuenta", "naturaleza"]));
  const mapped = {
    code: firstValue(payload, ["code", "codigo", "cuenta", "account", "account_code"]),
    name: firstValue(payload, ["name", "nombre", "descripcion", "description"]),
    account_type: accountType,
    is_postable: normalizeBooleanLike(firstValue(payload, ["is_postable", "postable", "movimiento", "imputable"]), true),
    notes: firstValue(payload, ["notes", "notas", "observaciones"]),
  };
  const errors = [];
  const warnings = [];
  if (!/^[0-9]{1,20}$/.test(mapped.code)) errors.push({ code: "invalid_account_code", message: "Codigo de cuenta invalido" });
  if (!mapped.name) errors.push({ code: "missing_account_name", message: "Falta nombre de cuenta" });
  if (!ACCOUNT_TYPES.includes(mapped.account_type)) errors.push({ code: "unsupported_account_type", message: `Tipo de cuenta no soportado: ${mapped.account_type || "vacio"}` });
  if (mapped.code && mapped.code.length < 3) warnings.push({ code: "short_account_code", message: "Codigo de cuenta corto; revisar si es grupo o cuenta operativa" });
  return { mapped, errors, warnings };
}

module.exports = {
  BATCH_STATUSES,
  IMPORT_TYPES,
  ROW_STATUSES,
  mapAccountStagingRow,
  mapBankTransactionStagingRow,
  mapJournalEntryStagingRow,
  mapMaturityStagingRow,
  mapPartyStagingRow,
  normalizeExternalImportApplyInput,
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
  nextBatchStatus,
  parseGenericCsv,
};

const crypto = require("crypto");
const { stableStringify } = require("./eventContracts");
const { externalAccountingIntegrations } = require("./externalIntegrations");

const IMPORT_TYPES = ["parties", "maturities", "bank_transactions", "journal_entries", "accounts", "generic"];
const SOURCE_FORMATS = ["csv", "json", "manual"];
const BATCH_STATUSES = ["pending_review", "approved", "rejected", "cancelled"];
const ROW_STATUSES = ["valid", "warning", "error"];
const REVIEW_ACTIONS = ["approve", "reject", "cancel"];
const MAX_ROWS = 500;
const PARTY_TYPES = ["customer", "supplier", "customer_supplier", "employee", "tax_authority", "bank", "other"];

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

module.exports = {
  BATCH_STATUSES,
  IMPORT_TYPES,
  ROW_STATUSES,
  mapPartyStagingRow,
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
  nextBatchStatus,
  parseGenericCsv,
};

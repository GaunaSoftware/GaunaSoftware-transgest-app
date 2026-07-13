const PARTY_TYPES = [
  "customer",
  "supplier",
  "customer_supplier",
  "employee",
  "tax_authority",
  "bank",
  "other",
];

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeOptionalText(value, maxLength, field) {
  const text = String(value || "").trim();
  if (text.length > maxLength) throw inputError(`${field} no puede superar ${maxLength} caracteres`);
  return text || null;
}

function normalizeIban(value) {
  const raw = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return null;
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(raw)) throw inputError("iban no tiene un formato valido");
  return raw;
}

function normalizeBic(value) {
  const raw = String(value || "").replace(/\s+/g, "").toUpperCase();
  if (!raw) return null;
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(raw)) throw inputError("swift_bic no tiene un formato valido");
  return raw;
}

function normalizeMandateRef(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 35) throw inputError("mandate_ref no puede superar 35 caracteres");
  return raw;
}

function normalizeMandateDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw inputError("mandate_date debe usar formato YYYY-MM-DD");
  return raw;
}

function normalizeProvinceCode(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (!/^\d{2}$/.test(raw)) throw inputError("province_code debe ser un codigo de 2 digitos");
  return raw;
}

function normalizePartyInput(input = {}) {
  const partyType = String(input.party_type || "").trim();
  const legalName = String(input.legal_name || "").trim();
  const sourceSystem = String(input.source_system || "accounting").trim();
  const sourcePartyId = normalizeOptionalText(input.source_party_id, 120, "source_party_id");
  const defaultAccountId = String(input.default_account_id || "").trim() || null;

  if (!PARTY_TYPES.includes(partyType)) throw inputError("party_type no soportado");
  if (!legalName || legalName.length > 220) {
    throw inputError("legal_name es obligatorio y no puede superar 220 caracteres");
  }
  if (!/^[a-zA-Z0-9_.:-]{2,80}$/.test(sourceSystem)) {
    throw inputError("source_system debe ser un identificador simple");
  }

  return {
    source_system: sourceSystem,
    source_party_id: sourcePartyId,
    party_type: partyType,
    legal_name: legalName,
    tax_id: normalizeOptionalText(input.tax_id, 40, "tax_id"),
    email: normalizeOptionalText(input.email, 180, "email"),
    phone: normalizeOptionalText(input.phone, 60, "phone"),
    default_account_id: defaultAccountId,
    notes: normalizeOptionalText(input.notes, 1000, "notes"),
    iban: normalizeIban(input.iban),
    swift_bic: normalizeBic(input.swift_bic),
    mandate_ref: normalizeMandateRef(input.mandate_ref),
    mandate_date: normalizeMandateDate(input.mandate_date),
    province_code: normalizeProvinceCode(input.province_code),
  };
}

function normalizePartyUpdateInput(input = {}) {
  const normalized = normalizePartyInput({
    ...input,
    source_system: "accounting",
  });
  delete normalized.source_system;
  delete normalized.source_party_id;
  return normalized;
}

function normalizePartyQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const active = query.active === "true" ? true : query.active === "false" ? false : null;
  const partyType = String(query.party_type || "").trim();
  const q = String(query.q || "").trim().slice(0, 140);
  const format = String(query.format || "json").trim().toLowerCase();

  if (partyType && !PARTY_TYPES.includes(partyType)) throw inputError("party_type no soportado");
  if (!["json", "csv"].includes(format)) throw inputError("format no soportado");

  return {
    limit,
    active,
    party_type: partyType || null,
    q: q || null,
    format,
  };
}

function normalizePartyStatusInput(input = {}) {
  if (typeof input.is_active !== "boolean") throw inputError("is_active debe ser boolean");
  const reason = String(input.reason || "").trim();
  if (reason.length < 5 || reason.length > 300) {
    throw inputError("reason debe tener entre 5 y 300 caracteres");
  }
  return { is_active: input.is_active, reason };
}

module.exports = {
  PARTY_TYPES,
  normalizePartyInput,
  normalizePartyQuery,
  normalizePartyStatusInput,
  normalizePartyUpdateInput,
};

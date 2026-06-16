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

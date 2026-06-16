const ACCOUNT_TYPES = [
  "asset",
  "liability",
  "equity",
  "income",
  "expense",
  "memorandum",
];

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function normalizeAccountInput(input = {}) {
  const code = String(input.code || "").trim();
  const name = String(input.name || "").trim();
  const accountType = String(input.account_type || "").trim();
  const notes = String(input.notes || "").trim();
  const parentAccountId = String(input.parent_account_id || "").trim() || null;

  if (!/^[0-9]{1,20}$/.test(code)) {
    throw inputError("code debe contener entre 1 y 20 digitos");
  }
  if (!name || name.length > 220) {
    throw inputError("name es obligatorio y no puede superar 220 caracteres");
  }
  if (!ACCOUNT_TYPES.includes(accountType)) {
    throw inputError("account_type no soportado");
  }
  if (notes.length > 1000) {
    throw inputError("notes no puede superar 1000 caracteres");
  }

  return {
    code,
    name,
    account_type: accountType,
    parent_account_id: parentAccountId,
    is_postable: input.is_postable !== false,
    notes: notes || null,
  };
}

function normalizeAccountQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 200;
  const active = query.active === "true" ? true : query.active === "false" ? false : null;
  const q = String(query.q || "").trim().slice(0, 140);
  const fiscalYearId = String(query.fiscal_year_id || "").trim();

  return {
    limit,
    active,
    q: q || null,
    fiscal_year_id: fiscalYearId || null,
  };
}

function normalizeAccountStatusInput(input = {}) {
  if (typeof input.is_active !== "boolean") {
    throw inputError("is_active debe ser boolean");
  }
  const reason = String(input.reason || "").trim();
  if (reason.length < 5 || reason.length > 300) {
    throw inputError("reason debe tener entre 5 y 300 caracteres");
  }
  return { is_active: input.is_active, reason };
}

module.exports = {
  ACCOUNT_TYPES,
  normalizeAccountInput,
  normalizeAccountQuery,
  normalizeAccountStatusInput,
};

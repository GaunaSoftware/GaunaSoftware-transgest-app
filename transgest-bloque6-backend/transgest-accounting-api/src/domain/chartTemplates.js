const crypto = require("crypto");
const { stableStringify } = require("./eventContracts");

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanRequired(value, field, maxLength) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > maxLength) {
    throw inputError(`${field} es obligatorio y no puede superar ${maxLength} caracteres`);
  }
  return normalized;
}

function normalizeTemplateSnapshotInput(input = {}) {
  const code = cleanRequired(input.code, "code", 80);
  const name = cleanRequired(input.name, "name", 220);
  const versionLabel = cleanRequired(input.version_label, "version_label", 80);
  const fiscalYearId = cleanRequired(input.fiscal_year_id, "fiscal_year_id", 80);
  if (!/^[A-Za-z0-9._-]+$/.test(code)) {
    throw inputError("code solo puede contener letras, numeros, punto, guion y guion bajo");
  }
  return {
    code,
    name,
    version_label: versionLabel,
    fiscal_year_id: fiscalYearId,
  };
}

function normalizeTemplateImportInput(input = {}) {
  const fiscalYearId = cleanRequired(input.fiscal_year_id, "fiscal_year_id", 80);
  const idempotencyKey = cleanRequired(input.idempotency_key, "idempotency_key", 120);
  if (idempotencyKey.length < 12 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
    throw inputError("idempotency_key debe tener al menos 12 caracteres seguros");
  }
  return {
    fiscal_year_id: fiscalYearId,
    idempotency_key: idempotencyKey,
  };
}

function templateChecksum(accounts = []) {
  const normalized = accounts
    .map(account => ({
      code: String(account.code),
      name: String(account.name),
      account_type: String(account.account_type),
      parent_code: account.parent_code ? String(account.parent_code) : null,
      is_postable: Boolean(account.is_postable),
      notes: account.notes ? String(account.notes) : null,
    }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return crypto.createHash("sha256").update(stableStringify(normalized)).digest("hex");
}

function classifyTemplateAccounts(templateAccounts = [], existingAccounts = []) {
  const existingByCode = new Map(existingAccounts.map(account => [String(account.code), account]));
  const result = { inserted: [], matching: [], conflicts: [] };
  for (const account of templateAccounts) {
    const existing = existingByCode.get(String(account.code));
    if (!existing) {
      result.inserted.push(account);
      continue;
    }
    const same = String(existing.name) === String(account.name)
      && String(existing.account_type) === String(account.account_type)
      && Boolean(existing.is_postable) === Boolean(account.is_postable);
    if (same) result.matching.push(account);
    else result.conflicts.push({ template: account, existing });
  }
  return result;
}

module.exports = {
  classifyTemplateAccounts,
  normalizeTemplateImportInput,
  normalizeTemplateSnapshotInput,
  templateChecksum,
};

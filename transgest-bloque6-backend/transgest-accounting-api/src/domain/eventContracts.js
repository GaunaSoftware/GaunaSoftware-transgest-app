const crypto = require("crypto");

const EVENT_CONTRACTS = {
  AccountingFiscalYearOpened: {
    1: ["fiscal_year_id", "year_label", "start_date", "end_date", "period_count"],
  },
  AccountingPeriodLocked: {
    1: ["period_id", "fiscal_year_id", "period_number", "previous_status", "status", "reason"],
  },
  AccountingPeriodUnlocked: {
    1: ["period_id", "fiscal_year_id", "period_number", "previous_status", "status", "reason"],
  },
  AccountingPeriodClosed: {
    1: ["period_id", "fiscal_year_id", "period_number", "previous_status", "status", "reason"],
  },
  AccountingPeriodReopened: {
    1: ["period_id", "fiscal_year_id", "period_number", "previous_status", "status", "reason"],
  },
  AccountingAccountCreated: {
    1: ["account_id", "fiscal_year_id", "code", "name", "account_type", "is_postable"],
  },
  AccountingAccountStatusChanged: {
    1: ["account_id", "fiscal_year_id", "code", "previous_is_active", "is_active", "reason"],
  },
  AccountingPartyCreated: {
    1: ["party_id", "party_type", "legal_name", "is_active"],
  },
  AccountingPartyUpdated: {
    1: ["party_id", "party_type", "legal_name"],
  },
  AccountingPartyStatusChanged: {
    1: ["party_id", "previous_is_active", "is_active", "reason"],
  },
  AccountingMaturityCreated: {
    1: ["maturity_id", "party_id", "direction", "due_date", "amount", "status"],
  },
  AccountingMaturityStatusChanged: {
    1: ["maturity_id", "previous_status", "status", "action", "reason"],
  },
  AccountingBankAccountCreated: {
    1: ["bank_account_id", "name", "currency", "is_active"],
  },
  AccountingBankTransactionCreated: {
    1: ["bank_transaction_id", "bank_account_id", "transaction_date", "direction", "amount", "status"],
  },
  AccountingBankTransactionStatusChanged: {
    1: ["bank_transaction_id", "previous_status", "status", "action", "reason"],
  },
  AccountingBankStatementImported: {
    1: ["import_id", "bank_account_id", "row_count", "inserted_count", "skipped_count", "error_count"],
  },
  AccountingExternalImportBatchStaged: {
    1: ["import_batch_id", "provider_id", "import_type", "row_count", "error_count"],
  },
  AccountingExternalImportBatchStatusChanged: {
    1: ["import_batch_id", "previous_status", "status", "action", "reason"],
  },
  AccountingExternalImportBatchApplied: {
    1: ["import_batch_id", "import_type", "applied_count", "skipped_count"],
  },
  AccountingFixedAssetCreated: {
    1: ["fixed_asset_id", "fiscal_year_id", "asset_code", "name", "acquisition_date", "acquisition_cost", "status"],
  },
  AccountingFixedAssetStatusChanged: {
    1: ["fixed_asset_id", "previous_status", "status", "action", "reason"],
  },
  AccountingFixedAssetDepreciationDraftCreated: {
    1: ["depreciation_run_id", "fixed_asset_id", "journal_entry_id", "fiscal_year_id", "period_id", "amount"],
  },
  AccountingFixedAssetDepreciationDraftCancelled: {
    1: ["depreciation_run_id", "fixed_asset_id", "journal_entry_id", "reason"],
  },
  AccountingFixedAssetDepreciationPosted: {
    1: ["depreciation_run_id", "fixed_asset_id", "journal_entry_id", "period_id", "amount"],
  },
  AccountingBankTransactionReconciled: {
    1: ["bank_reconciliation_id", "bank_transaction_id", "maturity_id", "amount", "reason"],
  },
  AccountingBankReconciliationReversed: {
    1: ["bank_reconciliation_id", "bank_transaction_id", "maturity_id", "amount", "reason"],
  },
  AccountingChartTemplateCreated: {
    1: ["template_id", "source_fiscal_year_id", "code", "version_label", "account_count", "source_checksum"],
  },
  AccountingChartTemplateImported: {
    1: [
      "import_id",
      "template_id",
      "fiscal_year_id",
      "inserted_count",
      "matching_count",
      "conflict_count",
      "template_checksum",
    ],
  },
  AccountingJournalEntryDraftCreated: {
    1: ["journal_entry_id", "fiscal_year_id", "period_id", "entry_date", "line_count"],
  },
  AccountingJournalEntryDraftUpdated: {
    1: ["journal_entry_id", "fiscal_year_id", "period_id", "entry_date", "line_count"],
  },
  AccountingJournalEntryDraftCancelled: {
    1: ["journal_entry_id", "fiscal_year_id", "period_id", "reason"],
  },
  AccountingJournalEntryReversalDraftCreated: {
    1: ["journal_entry_id", "reversal_of_entry_id", "fiscal_year_id", "period_id", "entry_date", "line_count", "reason"],
  },
  AccountingJournalEntryPosted: {
    1: [
      "journal_entry_id",
      "fiscal_year_id",
      "period_id",
      "entry_number",
      "entry_date",
      "total_debit",
      "total_credit",
      "line_count",
    ],
  },
};

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function normalizeEventPayload(payload) {
  const serialized = JSON.stringify(payload);
  if (serialized === undefined) throw new Error("Payload no serializable");
  return JSON.parse(serialized);
}

function payloadHash(payload) {
  return crypto.createHash("sha256").update(stableStringify(normalizeEventPayload(payload))).digest("hex");
}

function validateEventContract(eventType, schemaVersion, payload) {
  const version = Number(schemaVersion);
  const requiredFields = EVENT_CONTRACTS[eventType]?.[version];
  if (!requiredFields) {
    throw new Error(`Contrato de evento no soportado: ${eventType} v${schemaVersion}`);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error(`Payload invalido para ${eventType} v${schemaVersion}`);
  }

  const missing = requiredFields.filter(field => payload[field] === undefined || payload[field] === null);
  if (missing.length) {
    throw new Error(`Payload incompleto para ${eventType} v${schemaVersion}: ${missing.join(", ")}`);
  }

  return payload;
}

function verifyEventIntegrity(event) {
  validateEventContract(event.event_type, event.schema_version, event.payload);
  const expectedHash = payloadHash(event.payload);
  if (event.payload_hash && event.payload_hash !== expectedHash) {
    throw new Error(`Hash de payload invalido para evento ${event.id}`);
  }
  return expectedHash;
}

module.exports = {
  EVENT_CONTRACTS,
  normalizeEventPayload,
  payloadHash,
  stableStringify,
  validateEventContract,
  verifyEventIntegrity,
};

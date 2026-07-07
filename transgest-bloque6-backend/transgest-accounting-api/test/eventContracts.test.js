const test = require("node:test");
const assert = require("node:assert/strict");
const {
  payloadHash,
  validateEventContract,
  verifyEventIntegrity,
} = require("../src/domain/eventContracts");

const fiscalYearPayload = {
  fiscal_year_id: "00000000-0000-0000-0000-000000000001",
  year_label: "2026",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  period_count: 12,
};

test("payloadHash es estable aunque cambie el orden de propiedades", () => {
  const reordered = {
    period_count: 12,
    end_date: "2026-12-31",
    start_date: "2026-01-01",
    year_label: "2026",
    fiscal_year_id: "00000000-0000-0000-0000-000000000001",
  };
  assert.equal(payloadHash(fiscalYearPayload), payloadHash(reordered));
});

test("payloadHash coincide antes y despues de serializar fechas", () => {
  const withDates = {
    ...fiscalYearPayload,
    start_date: new Date("2026-01-01T00:00:00.000Z"),
    end_date: new Date("2026-12-31T00:00:00.000Z"),
  };
  const serialized = JSON.parse(JSON.stringify(withDates));
  assert.equal(payloadHash(withDates), payloadHash(serialized));
});

test("validateEventContract rechaza campos obligatorios ausentes", () => {
  assert.throws(
    () => validateEventContract("AccountingFiscalYearOpened", 1, { year_label: "2026" }),
    /Payload incompleto/
  );
});

test("validateEventContract rechaza versiones desconocidas", () => {
  assert.throws(
    () => validateEventContract("AccountingFiscalYearOpened", 2, fiscalYearPayload),
    /Contrato de evento no soportado/
  );
});

test("verifyEventIntegrity detecta payload manipulado", () => {
  assert.throws(
    () => verifyEventIntegrity({
      id: "event-id",
      event_type: "AccountingFiscalYearOpened",
      schema_version: 1,
      payload: fiscalYearPayload,
      payload_hash: "invalid",
    }),
    /Hash de payload invalido/
  );
});

test("contratos de cuenta exigen trazabilidad de ejercicio y estado", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingAccountCreated", 1, {
    account_id: "account-id",
    fiscal_year_id: "year-id",
    code: "4300001",
    name: "Cliente principal",
    account_type: "asset",
    is_postable: true,
  }));
  assert.throws(() => validateEventContract("AccountingAccountStatusChanged", 1, {
    account_id: "account-id",
  }), /Payload incompleto/);
});

test("contratos de terceros exigen identidad minima y estado", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingPartyCreated", 1, {
    party_id: "party-id",
    party_type: "customer",
    legal_name: "Cliente Norte S.L.",
    tax_id: null,
    is_active: true,
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingPartyUpdated", 1, {
    party_id: "party-id",
    party_type: "supplier",
    legal_name: "Proveedor Sur",
  }));
  assert.throws(() => validateEventContract("AccountingPartyStatusChanged", 1, {
    party_id: "party-id",
  }), /Payload incompleto/);
});

test("contratos de vencimientos exigen tercero, importe y cambio de estado", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingMaturityCreated", 1, {
    maturity_id: "maturity-id",
    party_id: "party-id",
    direction: "receivable",
    due_date: "2026-07-01",
    amount: "123.450000",
    status: "pending",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingMaturityStatusChanged", 1, {
    maturity_id: "maturity-id",
    previous_status: "pending",
    status: "settled",
    action: "settle",
    reason: "Cobro recibido",
  }));
  assert.throws(() => validateEventContract("AccountingMaturityCreated", 1, {
    maturity_id: "maturity-id",
  }), /Payload incompleto/);
});

test("contratos de bancos exigen cuenta, movimiento e importe", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingBankAccountCreated", 1, {
    bank_account_id: "bank-id",
    name: "Banco principal",
    currency: "EUR",
    is_active: true,
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingBankTransactionCreated", 1, {
    bank_transaction_id: "movement-id",
    bank_account_id: "bank-id",
    transaction_date: "2026-06-11",
    direction: "inflow",
    amount: "321.450000",
    status: "unmatched",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingBankStatementImported", 1, {
    import_id: "import-id",
    bank_account_id: "bank-id",
    row_count: 4,
    inserted_count: 3,
    skipped_count: 1,
    error_count: 0,
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingBankTransactionStatusChanged", 1, {
    bank_transaction_id: "movement-id",
    previous_status: "unmatched",
    status: "ignored",
    action: "ignore",
    reason: "Movimiento no conciliable",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingBankTransactionReconciled", 1, {
    bank_reconciliation_id: "reconciliation-id",
    bank_transaction_id: "movement-id",
    maturity_id: "maturity-id",
    amount: "321.450000",
    reason: "Cobro identificado",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingBankReconciliationReversed", 1, {
    bank_reconciliation_id: "reconciliation-id",
    bank_transaction_id: "movement-id",
    maturity_id: "maturity-id",
    amount: "321.450000",
    reason: "Error de conciliacion",
  }));
  assert.throws(() => validateEventContract("AccountingBankTransactionCreated", 1, {
    bank_transaction_id: "movement-id",
  }), /Payload incompleto/);
});

test("contrato de importacion de plantilla exige checksum y resultados", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingChartTemplateImported", 1, {
    import_id: "import-id",
    template_id: "template-id",
    fiscal_year_id: "year-id",
    inserted_count: 3,
    matching_count: 1,
    conflict_count: 0,
    template_checksum: "abc",
  }));
  assert.throws(() => validateEventContract("AccountingChartTemplateCreated", 1, {
    template_id: "template-id",
  }), /Payload incompleto/);
});

test("contratos de staging externo exigen lote y revision", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingExternalImportBatchStaged", 1, {
    import_batch_id: "batch-id",
    provider_id: "contasol-factusol",
    import_type: "parties",
    row_count: 5,
    error_count: 0,
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingExternalImportBatchStatusChanged", 1, {
    import_batch_id: "batch-id",
    previous_status: "pending_review",
    status: "approved",
    action: "approve",
    reason: "Validado por administracion",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingExternalImportBatchApplied", 1, {
    import_batch_id: "batch-id",
    import_type: "parties",
    applied_count: 5,
    skipped_count: 0,
  }));
  assert.throws(() => validateEventContract("AccountingExternalImportBatchStaged", 1, {
    import_batch_id: "batch-id",
  }), /Payload incompleto/);
});

test("contratos de inmovilizado exigen activo, ejercicio e importe", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetCreated", 1, {
    fixed_asset_id: "asset-id",
    fiscal_year_id: "year-id",
    asset_code: "VEH-001",
    name: "Cabeza tractora",
    acquisition_date: "2026-06-30",
    acquisition_cost: "120000.000000",
    status: "active",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetStatusChanged", 1, {
    fixed_asset_id: "asset-id",
    previous_status: "active",
    status: "disposed",
    action: "dispose",
    reason: "Venta del activo",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationDraftCreated", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    fiscal_year_id: "year-id",
    period_id: "period-id",
    amount: "100.000000",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationDraftCancelled", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reason: "Error de periodo",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationPosted", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    period_id: "period-id",
    amount: "100.000000",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationReversalDraftCreated", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reversal_journal_entry_id: "reversal-id",
    reason: "Correccion",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationReversalDraftCancelled", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reversal_journal_entry_id: "reversal-id",
    reason: "Correccion",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDepreciationReversed", 1, {
    depreciation_run_id: "run-id",
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reversal_journal_entry_id: "reversal-id",
    reason: "Correccion",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDisposalDraftCreated", 1, {
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    fiscal_year_id: "year-id",
    period_id: "period-id",
    disposal_date: "2026-12-31",
    estimated_net_book_value: "100.000000",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDisposalDraftCancelled", 1, {
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reason: "Correccion de baja",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDisposalPosted", 1, {
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    previous_status: "active",
    status: "disposed",
    disposed_at: "2026-12-31",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingFixedAssetDisposalReversed", 1, {
    fixed_asset_id: "asset-id",
    journal_entry_id: "entry-id",
    reversal_journal_entry_id: "reversal-id",
    previous_status: "disposed",
    status: "active",
  }));
  assert.throws(() => validateEventContract("AccountingFixedAssetCreated", 1, {
    fixed_asset_id: "asset-id",
  }), /Payload incompleto/);
});

test("contrato de asiento contabilizado exige numero, totales y periodo", () => {
  assert.doesNotThrow(() => validateEventContract("AccountingJournalEntryReversalDraftCreated", 1, {
    journal_entry_id: "reversal-id",
    reversal_of_entry_id: "entry-id",
    fiscal_year_id: "year-id",
    period_id: "period-id",
    entry_date: "2026-06-30",
    line_count: 2,
    reason: "Correccion",
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingJournalEntryDraftUpdated", 1, {
    journal_entry_id: "entry-id",
    fiscal_year_id: "year-id",
    period_id: "period-id",
    entry_date: "2026-06-04",
    line_count: 2,
  }));
  assert.doesNotThrow(() => validateEventContract("AccountingJournalEntryPosted", 1, {
    journal_entry_id: "entry-id",
    fiscal_year_id: "year-id",
    period_id: "period-id",
    entry_number: 1,
    entry_date: "2026-06-04",
    total_debit: "100.000000",
    total_credit: "100.000000",
    line_count: 2,
  }));
});

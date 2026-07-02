const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const migrationsDir = path.join(__dirname, "..", "scripts", "migrations");
const upSql = fs.readFileSync(path.join(migrationsDir, "001_initial.up.sql"), "utf8");
const downSql = fs.readFileSync(path.join(migrationsDir, "001_initial.down.sql"), "utf8");
const auditAppendOnlyUpSql = fs.readFileSync(path.join(migrationsDir, "002_audit_log_append_only.up.sql"), "utf8");
const auditAppendOnlyDownSql = fs.readFileSync(path.join(migrationsDir, "002_audit_log_append_only.down.sql"), "utf8");
const chartOfAccountsUpSql = fs.readFileSync(path.join(migrationsDir, "003_chart_of_accounts.up.sql"), "utf8");
const chartOfAccountsDownSql = fs.readFileSync(path.join(migrationsDir, "003_chart_of_accounts.down.sql"), "utf8");
const chartTemplatesUpSql = fs.readFileSync(path.join(migrationsDir, "004_chart_templates.up.sql"), "utf8");
const chartTemplatesDownSql = fs.readFileSync(path.join(migrationsDir, "004_chart_templates.down.sql"), "utf8");
const journalEngineUpSql = fs.readFileSync(path.join(migrationsDir, "005_journal_engine.up.sql"), "utf8");
const journalEngineDownSql = fs.readFileSync(path.join(migrationsDir, "005_journal_engine.down.sql"), "utf8");
const ledgerPermissionUpSql = fs.readFileSync(path.join(migrationsDir, "006_ledger_read_permission.up.sql"), "utf8");
const ledgerPermissionDownSql = fs.readFileSync(path.join(migrationsDir, "006_ledger_read_permission.down.sql"), "utf8");
const journalCancellationUpSql = fs.readFileSync(path.join(migrationsDir, "007_journal_entry_cancellation.up.sql"), "utf8");
const journalCancellationDownSql = fs.readFileSync(path.join(migrationsDir, "007_journal_entry_cancellation.down.sql"), "utf8");
const journalReversalUpSql = fs.readFileSync(path.join(migrationsDir, "008_journal_entry_reversal.up.sql"), "utf8");
const journalReversalDownSql = fs.readFileSync(path.join(migrationsDir, "008_journal_entry_reversal.down.sql"), "utf8");
const partiesUpSql = fs.readFileSync(path.join(migrationsDir, "009_accounting_parties.up.sql"), "utf8");
const partiesDownSql = fs.readFileSync(path.join(migrationsDir, "009_accounting_parties.down.sql"), "utf8");
const maturitiesUpSql = fs.readFileSync(path.join(migrationsDir, "010_accounting_maturities.up.sql"), "utf8");
const maturitiesDownSql = fs.readFileSync(path.join(migrationsDir, "010_accounting_maturities.down.sql"), "utf8");
const banksUpSql = fs.readFileSync(path.join(migrationsDir, "011_accounting_banks.up.sql"), "utf8");
const banksDownSql = fs.readFileSync(path.join(migrationsDir, "011_accounting_banks.down.sql"), "utf8");
const bankReconciliationsUpSql = fs.readFileSync(path.join(migrationsDir, "012_bank_reconciliations.up.sql"), "utf8");
const bankReconciliationsDownSql = fs.readFileSync(path.join(migrationsDir, "012_bank_reconciliations.down.sql"), "utf8");
const reversibleBankReconciliationsUpSql = fs.readFileSync(path.join(migrationsDir, "013_reversible_bank_reconciliations.up.sql"), "utf8");
const reversibleBankReconciliationsDownSql = fs.readFileSync(path.join(migrationsDir, "013_reversible_bank_reconciliations.down.sql"), "utf8");
const bankStatementImportsUpSql = fs.readFileSync(path.join(migrationsDir, "014_bank_statement_imports.up.sql"), "utf8");
const bankStatementImportsDownSql = fs.readFileSync(path.join(migrationsDir, "014_bank_statement_imports.down.sql"), "utf8");
const externalImportStagingUpSql = fs.readFileSync(path.join(migrationsDir, "015_external_import_staging.up.sql"), "utf8");
const externalImportStagingDownSql = fs.readFileSync(path.join(migrationsDir, "015_external_import_staging.down.sql"), "utf8");
const externalImportApplyPartiesUpSql = fs.readFileSync(path.join(migrationsDir, "016_external_import_apply_parties.up.sql"), "utf8");
const externalImportApplyPartiesDownSql = fs.readFileSync(path.join(migrationsDir, "016_external_import_apply_parties.down.sql"), "utf8");
const periodCloseMetadataUpSql = fs.readFileSync(path.join(migrationsDir, "017_period_close_metadata.up.sql"), "utf8");
const periodCloseMetadataDownSql = fs.readFileSync(path.join(migrationsDir, "017_period_close_metadata.down.sql"), "utf8");
const fixedAssetsUpSql = fs.readFileSync(path.join(migrationsDir, "018_fixed_assets.up.sql"), "utf8");
const fixedAssetsDownSql = fs.readFileSync(path.join(migrationsDir, "018_fixed_assets.down.sql"), "utf8");
const depreciationRunsUpSql = fs.readFileSync(path.join(migrationsDir, "019_depreciation_runs.up.sql"), "utf8");
const depreciationRunsDownSql = fs.readFileSync(path.join(migrationsDir, "019_depreciation_runs.down.sql"), "utf8");
const depreciationRunCancellationUpSql = fs.readFileSync(path.join(migrationsDir, "020_depreciation_run_cancellation.up.sql"), "utf8");
const depreciationRunCancellationDownSql = fs.readFileSync(path.join(migrationsDir, "020_depreciation_run_cancellation.down.sql"), "utf8");
const depreciationRunPostingUpSql = fs.readFileSync(path.join(migrationsDir, "021_depreciation_run_posting.up.sql"), "utf8");
const depreciationRunPostingDownSql = fs.readFileSync(path.join(migrationsDir, "021_depreciation_run_posting.down.sql"), "utf8");
const depreciationRunReversalUpSql = fs.readFileSync(path.join(migrationsDir, "022_depreciation_run_reversal.up.sql"), "utf8");
const depreciationRunReversalDownSql = fs.readFileSync(path.join(migrationsDir, "022_depreciation_run_reversal.down.sql"), "utf8");

const requiredTables = [
  "accounting_tenants",
  "accounting_companies",
  "accounting_users",
  "accounting_roles",
  "accounting_permissions",
  "accounting_user_roles",
  "fiscal_years",
  "accounting_periods",
  "audit_log",
  "outbox_events",
  "processed_events",
];

test("migracion inicial crea y revierte las entidades requeridas de Fase 1", () => {
  for (const table of requiredTables) {
    assert.match(upSql, new RegExp(`CREATE TABLE IF NOT EXISTS accounting\\.${table}\\b`, "i"), `up debe crear ${table}`);
    assert.match(downSql, new RegExp(`DROP TABLE IF EXISTS accounting\\.${table}\\b`, "i"), `down debe revertir ${table}`);
  }
});

test("migracion inicial incluye relacion rol-permiso para RBAC basico", () => {
  assert.match(upSql, /CREATE TABLE IF NOT EXISTS accounting\.accounting_role_permissions\b/i);
  assert.match(upSql, /REFERENCES accounting\.accounting_roles\(id\)/i);
  assert.match(upSql, /REFERENCES accounting\.accounting_permissions\(id\)/i);
});

test("migracion append-only bloquea update delete y truncate de audit_log", () => {
  assert.match(auditAppendOnlyUpSql, /BEFORE UPDATE OR DELETE OR TRUNCATE ON accounting\.audit_log/i);
  assert.match(auditAppendOnlyUpSql, /RAISE EXCEPTION/i);
  assert.match(auditAppendOnlyUpSql, /ERRCODE = '55000'/i);
});

test("rollback append-only elimina trigger y funcion", () => {
  assert.match(auditAppendOnlyDownSql, /DROP TRIGGER IF EXISTS trg_audit_log_append_only/i);
  assert.match(auditAppendOnlyDownSql, /DROP FUNCTION IF EXISTS accounting\.prevent_audit_log_mutation/i);
});

test("migracion plan contable crea y revierte accounts con aislamiento por ejercicio", () => {
  assert.match(chartOfAccountsUpSql, /CREATE TABLE IF NOT EXISTS accounting\.accounts\b/i);
  assert.match(chartOfAccountsUpSql, /UNIQUE \(company_id, fiscal_year_id, code\)/i);
  assert.match(chartOfAccountsUpSql, /CHECK \(code ~ '\^\[0-9\]\{1,20\}\$'\)/i);
  assert.match(chartOfAccountsDownSql, /DROP TABLE IF EXISTS accounting\.accounts/i);
});

test("migracion de plantillas crea catalogo versionado, detalle e importaciones", () => {
  for (const table of ["accounting_standards", "chart_templates", "chart_template_accounts", "chart_template_imports"]) {
    assert.match(chartTemplatesUpSql, new RegExp(`CREATE TABLE IF NOT EXISTS accounting\\.${table}\\b`, "i"));
    assert.match(chartTemplatesDownSql, new RegExp(`DROP TABLE IF EXISTS accounting\\.${table}\\b`, "i"));
  }
  assert.match(chartTemplatesUpSql, /UNIQUE \(company_id, fiscal_year_id, template_id\)/i);
  assert.match(chartTemplatesUpSql, /UNIQUE \(company_id, idempotency_key\)/i);
  assert.match(chartTemplatesUpSql, /source_checksum VARCHAR\(64\) NOT NULL/i);
});

test("migracion de diario crea asientos, lineas y trazabilidad sin borrado en cascada", () => {
  for (const table of ["journal_entries", "journal_lines", "source_links"]) {
    assert.match(journalEngineUpSql, new RegExp(`CREATE TABLE IF NOT EXISTS accounting\\.${table}\\b`, "i"));
    assert.match(journalEngineDownSql, new RegExp(`DROP TABLE IF EXISTS accounting\\.${table}\\b`, "i"));
  }
  assert.match(journalEngineUpSql, /NUMERIC\(18,6\)/i);
  assert.match(journalEngineUpSql, /request_hash VARCHAR\(64\) NOT NULL/i);
  assert.match(journalEngineUpSql, /CHECK \(\s*\(debit_amount > 0 AND credit_amount = 0\)/i);
  assert.match(journalEngineUpSql, /journal_entry_id UUID NOT NULL REFERENCES accounting\.journal_entries\(id\) ON DELETE RESTRICT/i);
  assert.doesNotMatch(journalEngineUpSql, /ON DELETE CASCADE/i);
});

test("migracion de Mayor concede y revierte permiso de lectura", () => {
  assert.match(ledgerPermissionUpSql, /ledger\.read/i);
  assert.match(ledgerPermissionUpSql, /INSERT INTO accounting\.accounting_roles/i);
  assert.match(ledgerPermissionUpSql, /accounting_admin/i);
  assert.match(ledgerPermissionUpSql, /accounting_user/i);
  assert.match(ledgerPermissionUpSql, /accounting_viewer/i);
  assert.match(ledgerPermissionDownSql, /DELETE FROM accounting\.accounting_role_permissions/i);
  assert.match(ledgerPermissionDownSql, /DELETE FROM accounting\.accounting_permissions/i);
});

test("migracion de cancelacion de borradores amplia estados y rollback protegido", () => {
  assert.match(journalCancellationUpSql, /ADD COLUMN IF NOT EXISTS cancelled_at/i);
  assert.match(journalCancellationUpSql, /status IN \('draft', 'posted', 'cancelled'\)/i);
  assert.match(journalCancellationUpSql, /cancel_reason IS NOT NULL/i);
  assert.match(journalCancellationDownSql, /WHERE status = 'cancelled'/i);
  assert.match(journalCancellationDownSql, /RAISE EXCEPTION/i);
  assert.match(journalCancellationDownSql, /DROP COLUMN IF EXISTS cancel_reason/i);
});

test("migracion de reversos enlaza asiento original y rollback protegido", () => {
  assert.match(journalReversalUpSql, /ADD COLUMN IF NOT EXISTS reversal_of_entry_id UUID REFERENCES accounting\.journal_entries\(id\) ON DELETE RESTRICT/i);
  assert.match(journalReversalUpSql, /ADD COLUMN IF NOT EXISTS reversed_by_entry_id UUID REFERENCES accounting\.journal_entries\(id\) ON DELETE RESTRICT/i);
  assert.match(journalReversalUpSql, /entry_type IN \('manual', 'reversal'\)/i);
  assert.match(journalReversalUpSql, /uq_journal_entries_company_reversal_of/i);
  assert.match(journalReversalDownSql, /entry_type = 'reversal'/i);
  assert.match(journalReversalDownSql, /RAISE EXCEPTION/i);
  assert.match(journalReversalDownSql, /DROP COLUMN IF EXISTS reversal_of_entry_id/i);
});

test("migracion de terceros crea maestro y permisos reversibles", () => {
  assert.match(partiesUpSql, /CREATE TABLE IF NOT EXISTS accounting\.accounting_parties/i);
  assert.match(partiesUpSql, /party_type IN \('customer', 'supplier', 'customer_supplier', 'employee', 'tax_authority', 'bank', 'other'\)/i);
  assert.match(partiesUpSql, /parties\.read/i);
  assert.match(partiesUpSql, /parties\.write/i);
  assert.match(partiesDownSql, /DELETE FROM accounting\.accounting_role_permissions/i);
  assert.match(partiesDownSql, /DROP TABLE IF EXISTS accounting\.accounting_parties/i);
});

test("migracion de vencimientos crea cartera y permisos reversibles", () => {
  assert.match(maturitiesUpSql, /CREATE TABLE IF NOT EXISTS accounting\.accounting_maturities/i);
  assert.match(maturitiesUpSql, /party_id UUID NOT NULL REFERENCES accounting\.accounting_parties\(id\) ON DELETE RESTRICT/i);
  assert.match(maturitiesUpSql, /direction IN \('receivable', 'payable'\)/i);
  assert.match(maturitiesUpSql, /maturities\.read/i);
  assert.match(maturitiesUpSql, /maturities\.write/i);
  assert.match(maturitiesDownSql, /DELETE FROM accounting\.accounting_role_permissions/i);
  assert.match(maturitiesDownSql, /DROP TABLE IF EXISTS accounting\.accounting_maturities/i);
});

test("migracion de bancos crea tesoreria manual y permisos reversibles", () => {
  assert.match(banksUpSql, /CREATE TABLE IF NOT EXISTS accounting\.accounting_bank_accounts/i);
  assert.match(banksUpSql, /CREATE TABLE IF NOT EXISTS accounting\.bank_transactions/i);
  assert.match(banksUpSql, /bank_account_id UUID NOT NULL REFERENCES accounting\.accounting_bank_accounts\(id\) ON DELETE RESTRICT/i);
  assert.match(banksUpSql, /direction IN \('inflow', 'outflow'\)/i);
  assert.match(banksUpSql, /banks\.read/i);
  assert.match(banksUpSql, /banks\.write/i);
  assert.match(banksDownSql, /DELETE FROM accounting\.accounting_role_permissions/i);
  assert.match(banksDownSql, /DROP TABLE IF EXISTS accounting\.bank_transactions/i);
  assert.match(banksDownSql, /DROP TABLE IF EXISTS accounting\.accounting_bank_accounts/i);
});

test("migracion de conciliacion bancaria crea vinculos uno a uno reversibles", () => {
  assert.match(bankReconciliationsUpSql, /CREATE TABLE IF NOT EXISTS accounting\.bank_reconciliations/i);
  assert.match(bankReconciliationsUpSql, /bank_transaction_id UUID NOT NULL REFERENCES accounting\.bank_transactions\(id\) ON DELETE RESTRICT/i);
  assert.match(bankReconciliationsUpSql, /maturity_id UUID NOT NULL REFERENCES accounting\.accounting_maturities\(id\) ON DELETE RESTRICT/i);
  assert.match(bankReconciliationsUpSql, /UNIQUE \(bank_transaction_id\)/i);
  assert.match(bankReconciliationsUpSql, /UNIQUE \(maturity_id\)/i);
  assert.match(bankReconciliationsDownSql, /DROP TABLE IF EXISTS accounting\.bank_reconciliations/i);
});

test("migracion de reverso de conciliacion bancaria conserva trazabilidad", () => {
  assert.match(reversibleBankReconciliationsUpSql, /ADD COLUMN IF NOT EXISTS status VARCHAR\(30\) NOT NULL DEFAULT 'active'/i);
  assert.match(reversibleBankReconciliationsUpSql, /ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ/i);
  assert.match(reversibleBankReconciliationsUpSql, /ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES accounting\.accounting_users\(id\) ON DELETE SET NULL/i);
  assert.match(reversibleBankReconciliationsUpSql, /ADD COLUMN IF NOT EXISTS void_reason TEXT/i);
  assert.match(reversibleBankReconciliationsUpSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliations_active_bank_transaction/i);
  assert.match(reversibleBankReconciliationsUpSql, /WHERE status = 'active'/i);
  assert.match(reversibleBankReconciliationsDownSql, /WHERE status = 'voided'/i);
  assert.match(reversibleBankReconciliationsDownSql, /RAISE EXCEPTION/i);
  assert.match(reversibleBankReconciliationsDownSql, /DROP COLUMN IF EXISTS void_reason/i);
});

test("migracion de importacion bancaria crea lote trazable y rollback protegido", () => {
  assert.match(bankStatementImportsUpSql, /CREATE TABLE IF NOT EXISTS accounting\.bank_statement_imports/i);
  assert.match(bankStatementImportsUpSql, /bank_account_id UUID NOT NULL REFERENCES accounting\.accounting_bank_accounts\(id\) ON DELETE RESTRICT/i);
  assert.match(bankStatementImportsUpSql, /request_hash VARCHAR\(64\) NOT NULL/i);
  assert.match(bankStatementImportsUpSql, /UNIQUE \(company_id, request_hash\)/i);
  assert.match(bankStatementImportsUpSql, /ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES accounting\.bank_statement_imports\(id\) ON DELETE SET NULL/i);
  assert.match(bankStatementImportsUpSql, /CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_import_source/i);
  assert.match(bankStatementImportsDownSql, /source_system = 'bank_csv'/i);
  assert.match(bankStatementImportsDownSql, /RAISE EXCEPTION/i);
  assert.match(bankStatementImportsDownSql, /DROP TABLE IF EXISTS accounting\.bank_statement_imports/i);
});

test("migracion de staging externo crea lotes y filas sin aplicar datos", () => {
  assert.match(externalImportStagingUpSql, /CREATE TABLE IF NOT EXISTS accounting\.external_import_batches/i);
  assert.match(externalImportStagingUpSql, /CREATE TABLE IF NOT EXISTS accounting\.external_import_rows/i);
  assert.match(externalImportStagingUpSql, /UNIQUE \(company_id, request_hash\)/i);
  assert.match(externalImportStagingUpSql, /CHECK \(status IN \('pending_review', 'approved', 'rejected', 'cancelled'\)\)/i);
  assert.match(externalImportStagingUpSql, /external_imports\.read/i);
  assert.match(externalImportStagingUpSql, /external_imports\.write/i);
  assert.doesNotMatch(externalImportStagingUpSql, /INSERT INTO accounting\.journal_entries/i);
  assert.doesNotMatch(externalImportStagingUpSql, /INSERT INTO accounting\.accounts/i);
  assert.match(externalImportStagingDownSql, /WHERE status IN \('pending_review', 'approved'\)/i);
  assert.match(externalImportStagingDownSql, /RAISE EXCEPTION/i);
  assert.match(externalImportStagingDownSql, /DROP TABLE IF EXISTS accounting\.external_import_rows/i);
  assert.match(externalImportStagingDownSql, /DROP TABLE IF EXISTS accounting\.external_import_batches/i);
});

test("migracion de aplicacion de importacion externa amplia estados con rollback protegido", () => {
  assert.match(externalImportApplyPartiesUpSql, /ADD COLUMN IF NOT EXISTS applied_by UUID REFERENCES accounting\.accounting_users\(id\) ON DELETE SET NULL/i);
  assert.match(externalImportApplyPartiesUpSql, /ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ/i);
  assert.match(externalImportApplyPartiesUpSql, /ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0/i);
  assert.match(externalImportApplyPartiesUpSql, /status IN \('pending_review', 'approved', 'rejected', 'cancelled', 'applied'\)/i);
  assert.match(externalImportApplyPartiesUpSql, /idx_external_import_batches_applied/i);
  assert.match(externalImportApplyPartiesDownSql, /WHERE status = 'applied'/i);
  assert.match(externalImportApplyPartiesDownSql, /RAISE EXCEPTION/i);
  assert.match(externalImportApplyPartiesDownSql, /DROP COLUMN IF EXISTS applied_by/i);
});

test("migracion de metadatos de cierre de periodos conserva trazabilidad", () => {
  assert.match(periodCloseMetadataUpSql, /ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ/i);
  assert.match(periodCloseMetadataUpSql, /ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES accounting\.accounting_users\(id\) ON DELETE SET NULL/i);
  assert.match(periodCloseMetadataUpSql, /idx_accounting_periods_closed/i);
  assert.match(periodCloseMetadataDownSql, /closed_at IS NOT NULL/i);
  assert.match(periodCloseMetadataDownSql, /RAISE EXCEPTION/i);
  assert.match(periodCloseMetadataDownSql, /DROP COLUMN IF EXISTS closed_by/i);
});

test("migracion de inmovilizado crea registro inicial y permisos reversibles", () => {
  assert.match(fixedAssetsUpSql, /CREATE TABLE IF NOT EXISTS accounting\.accounting_fixed_assets/i);
  assert.match(fixedAssetsUpSql, /fiscal_year_id UUID NOT NULL REFERENCES accounting\.fiscal_years\(id\) ON DELETE RESTRICT/i);
  assert.match(fixedAssetsUpSql, /depreciation_method VARCHAR\(40\) NOT NULL DEFAULT 'straight_line'/i);
  assert.match(fixedAssetsUpSql, /UNIQUE \(company_id, fiscal_year_id, asset_code\)/i);
  assert.match(fixedAssetsUpSql, /fixed_assets\.read/i);
  assert.match(fixedAssetsUpSql, /fixed_assets\.write/i);
  assert.match(fixedAssetsDownSql, /DELETE FROM accounting\.accounting_role_permissions/i);
  assert.match(fixedAssetsDownSql, /DELETE FROM accounting\.accounting_permissions/i);
  assert.match(fixedAssetsDownSql, /DROP TABLE IF EXISTS accounting\.accounting_fixed_assets/i);
});

test("migracion de amortizaciones crea ejecuciones idempotentes y rollback protegido", () => {
  assert.match(depreciationRunsUpSql, /CREATE TABLE IF NOT EXISTS accounting\.depreciation_runs/i);
  assert.match(depreciationRunsUpSql, /fixed_asset_id UUID NOT NULL REFERENCES accounting\.accounting_fixed_assets\(id\) ON DELETE RESTRICT/i);
  assert.match(depreciationRunsUpSql, /journal_entry_id UUID NOT NULL REFERENCES accounting\.journal_entries\(id\) ON DELETE RESTRICT/i);
  assert.match(depreciationRunsUpSql, /UNIQUE \(company_id, fixed_asset_id, period_id\)/i);
  assert.match(depreciationRunsUpSql, /entry_type IN \('manual', 'reversal', 'depreciation'\)/i);
  assert.match(depreciationRunsDownSql, /FROM accounting\.depreciation_runs/i);
  assert.match(depreciationRunsDownSql, /entry_type = 'depreciation'/i);
  assert.match(depreciationRunsDownSql, /RAISE EXCEPTION/i);
  assert.match(depreciationRunsDownSql, /DROP TABLE IF EXISTS accounting\.depreciation_runs/i);
});

test("migracion de cancelacion de amortizaciones conserva trazabilidad y libera periodo", () => {
  assert.match(depreciationRunCancellationUpSql, /ADD COLUMN IF NOT EXISTS cancelled_at/i);
  assert.match(depreciationRunCancellationUpSql, /status IN \('draft_created', 'cancelled'\)/i);
  assert.match(depreciationRunCancellationUpSql, /DROP CONSTRAINT IF EXISTS depreciation_runs_company_id_fixed_asset_id_period_id_key/i);
  assert.match(depreciationRunCancellationUpSql, /WHERE status = 'draft_created'/i);
  assert.match(depreciationRunCancellationDownSql, /WHERE status = 'cancelled'/i);
  assert.match(depreciationRunCancellationDownSql, /RAISE EXCEPTION/i);
  assert.match(depreciationRunCancellationDownSql, /ADD CONSTRAINT depreciation_runs_company_id_fixed_asset_id_period_id_key/i);
});

test("migracion de contabilizacion de amortizaciones mantiene bloqueo activo", () => {
  assert.match(depreciationRunPostingUpSql, /status IN \('draft_created', 'posted', 'cancelled'\)/i);
  assert.match(depreciationRunPostingUpSql, /WHERE status IN \('draft_created', 'posted'\)/i);
  assert.match(depreciationRunPostingDownSql, /WHERE status = 'posted'/i);
  assert.match(depreciationRunPostingDownSql, /RAISE EXCEPTION/i);
  assert.match(depreciationRunPostingDownSql, /WHERE status = 'draft_created'/i);
});

test("migracion de reverso de amortizaciones conserva trazabilidad hasta liberar periodo", () => {
  assert.match(depreciationRunReversalUpSql, /ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES accounting\.journal_entries\(id\) ON DELETE RESTRICT/i);
  assert.match(depreciationRunReversalUpSql, /ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ/i);
  assert.match(depreciationRunReversalUpSql, /status IN \('draft_created', 'posted', 'cancelled', 'reversal_draft_created', 'reversed'\)/i);
  assert.match(depreciationRunReversalUpSql, /WHERE status IN \('draft_created', 'posted', 'reversal_draft_created'\)/i);
  assert.match(depreciationRunReversalDownSql, /WHERE status IN \('reversal_draft_created', 'reversed'\)/i);
  assert.match(depreciationRunReversalDownSql, /RAISE EXCEPTION/i);
  assert.match(depreciationRunReversalDownSql, /DROP COLUMN IF EXISTS reversal_journal_entry_id/i);
});

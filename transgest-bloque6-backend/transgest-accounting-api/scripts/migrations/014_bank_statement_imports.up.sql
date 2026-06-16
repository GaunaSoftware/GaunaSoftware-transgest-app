CREATE TABLE IF NOT EXISTS accounting.bank_statement_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES accounting.accounting_bank_accounts(id) ON DELETE RESTRICT,
  source_type VARCHAR(80) NOT NULL DEFAULT 'csv_manual',
  original_filename VARCHAR(240),
  request_hash VARCHAR(64) NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  imported_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, request_hash),
  CHECK (row_count >= 0),
  CHECK (inserted_count >= 0),
  CHECK (skipped_count >= 0),
  CHECK (error_count >= 0)
);

ALTER TABLE accounting.bank_transactions
  ADD COLUMN IF NOT EXISTS import_id UUID REFERENCES accounting.bank_statement_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bank_statement_imports_company
  ON accounting.bank_statement_imports(company_id, bank_account_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_transactions_import_source
  ON accounting.bank_transactions(company_id, bank_account_id, source_system, source_type, source_id)
  WHERE source_id IS NOT NULL;

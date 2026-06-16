CREATE TABLE IF NOT EXISTS accounting.bank_reconciliations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  bank_transaction_id UUID NOT NULL REFERENCES accounting.bank_transactions(id) ON DELETE RESTRICT,
  maturity_id UUID NOT NULL REFERENCES accounting.accounting_maturities(id) ON DELETE RESTRICT,
  matched_amount NUMERIC(18,6) NOT NULL,
  matched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  matched_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (bank_transaction_id),
  UNIQUE (maturity_id),
  CHECK (matched_amount > 0)
);

CREATE INDEX IF NOT EXISTS idx_bank_reconciliations_company
  ON accounting.bank_reconciliations(company_id, matched_at DESC);

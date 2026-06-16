CREATE TABLE IF NOT EXISTS accounting.accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(220) NOT NULL,
  account_type VARCHAR(30) NOT NULL,
  parent_account_id UUID REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  is_postable BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year_id, code),
  CHECK (code ~ '^[0-9]{1,20}$'),
  CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense', 'memorandum'))
);

CREATE INDEX IF NOT EXISTS idx_accounts_company_year_code
  ON accounting.accounts(company_id, fiscal_year_id, code);

CREATE INDEX IF NOT EXISTS idx_accounts_parent
  ON accounting.accounts(parent_account_id);

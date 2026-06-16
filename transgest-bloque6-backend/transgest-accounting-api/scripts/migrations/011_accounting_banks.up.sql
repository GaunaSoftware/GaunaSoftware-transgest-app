CREATE TABLE IF NOT EXISTS accounting.accounting_bank_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  account_id UUID REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  name VARCHAR(180) NOT NULL,
  bank_name VARCHAR(180),
  iban VARCHAR(34),
  swift_bic VARCHAR(20),
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  opening_balance NUMERIC(18,6) NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, iban),
  CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE TABLE IF NOT EXISTS accounting.bank_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  bank_account_id UUID NOT NULL REFERENCES accounting.accounting_bank_accounts(id) ON DELETE RESTRICT,
  transaction_date DATE NOT NULL,
  value_date DATE,
  description VARCHAR(300) NOT NULL,
  reference VARCHAR(140),
  counterparty_name VARCHAR(220),
  amount NUMERIC(18,6) NOT NULL,
  direction VARCHAR(20) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'unmatched',
  source_system VARCHAR(80) NOT NULL DEFAULT 'accounting',
  source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(120),
  notes TEXT,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount > 0),
  CHECK (direction IN ('inflow', 'outflow')),
  CHECK (status IN ('unmatched', 'matched', 'ignored'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_bank_accounts_company
  ON accounting.accounting_bank_accounts(company_id, is_active, name);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_company_date
  ON accounting.bank_transactions(company_id, bank_account_id, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_status
  ON accounting.bank_transactions(company_id, status, transaction_date DESC);

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES
  ('banks.read', 'banks.read', 'Permite consultar cuentas y movimientos bancarios contables'),
  ('banks.write', 'banks.write', 'Permite crear cuentas y movimientos bancarios contables')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description,
      updated_at=NOW();

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='banks.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='banks.write'
 WHERE r.code IN ('accounting_admin', 'accounting_user')
ON CONFLICT DO NOTHING;

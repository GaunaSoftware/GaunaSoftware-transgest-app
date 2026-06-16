CREATE TABLE IF NOT EXISTS accounting.accounting_maturities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES accounting.accounting_parties(id) ON DELETE RESTRICT,
  direction VARCHAR(20) NOT NULL,
  issue_date DATE,
  due_date DATE NOT NULL,
  document_ref VARCHAR(120),
  description VARCHAR(300) NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  open_amount NUMERIC(18,6) NOT NULL,
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  payment_method VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  source_system VARCHAR(80) NOT NULL DEFAULT 'accounting',
  source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(120),
  notes TEXT,
  settled_at TIMESTAMPTZ,
  settled_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  status_reason TEXT,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (direction IN ('receivable', 'payable')),
  CHECK (status IN ('pending', 'settled', 'cancelled')),
  CHECK (amount > 0),
  CHECK (open_amount >= 0),
  CHECK (open_amount <= amount)
);

CREATE INDEX IF NOT EXISTS idx_accounting_maturities_company_due
  ON accounting.accounting_maturities(company_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_accounting_maturities_party
  ON accounting.accounting_maturities(company_id, party_id, due_date);

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES
  ('maturities.read', 'maturities.read', 'Permite consultar vencimientos de cobro y pago'),
  ('maturities.write', 'maturities.write', 'Permite crear y cambiar vencimientos de cobro y pago')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description,
      updated_at=NOW();

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='maturities.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='maturities.write'
 WHERE r.code IN ('accounting_admin', 'accounting_user')
ON CONFLICT DO NOTHING;

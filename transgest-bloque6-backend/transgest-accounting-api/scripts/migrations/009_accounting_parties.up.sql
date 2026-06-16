CREATE TABLE IF NOT EXISTS accounting.accounting_parties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  source_system VARCHAR(80) NOT NULL DEFAULT 'accounting',
  source_party_id VARCHAR(120),
  party_type VARCHAR(30) NOT NULL,
  legal_name VARCHAR(220) NOT NULL,
  tax_id VARCHAR(40),
  email VARCHAR(180),
  phone VARCHAR(60),
  default_account_id UUID REFERENCES accounting.accounts(id) ON DELETE SET NULL,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, source_system, source_party_id),
  CHECK (party_type IN ('customer', 'supplier', 'customer_supplier', 'employee', 'tax_authority', 'bank', 'other'))
);

CREATE INDEX IF NOT EXISTS idx_accounting_parties_company_type
  ON accounting.accounting_parties(company_id, party_type, is_active, legal_name);

CREATE INDEX IF NOT EXISTS idx_accounting_parties_default_account
  ON accounting.accounting_parties(default_account_id);

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES
  ('parties.read', 'parties.read', 'Permite consultar terceros contables'),
  ('parties.write', 'parties.write', 'Permite crear y activar/desactivar terceros contables')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description,
      updated_at=NOW();

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='parties.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='parties.write'
 WHERE r.code IN ('accounting_admin', 'accounting_user')
ON CONFLICT DO NOTHING;

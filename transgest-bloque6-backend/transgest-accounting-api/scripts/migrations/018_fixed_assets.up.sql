CREATE TABLE IF NOT EXISTS accounting.accounting_fixed_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE RESTRICT,
  asset_code VARCHAR(60) NOT NULL,
  name VARCHAR(220) NOT NULL,
  acquisition_date DATE NOT NULL,
  acquisition_cost NUMERIC(18,6) NOT NULL,
  residual_value NUMERIC(18,6) NOT NULL DEFAULT 0,
  useful_life_months INTEGER NOT NULL,
  depreciation_method VARCHAR(40) NOT NULL DEFAULT 'straight_line',
  asset_account_id UUID REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  accumulated_depreciation_account_id UUID REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  expense_account_id UUID REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  source_system VARCHAR(80) NOT NULL DEFAULT 'accounting',
  source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(120),
  notes TEXT,
  disposed_at DATE,
  status_reason TEXT,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (acquisition_cost > 0),
  CHECK (residual_value >= 0),
  CHECK (residual_value < acquisition_cost),
  CHECK (useful_life_months BETWEEN 1 AND 600),
  CHECK (depreciation_method IN ('straight_line')),
  CHECK (status IN ('active', 'inactive', 'disposed')),
  UNIQUE (company_id, fiscal_year_id, asset_code)
);

CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_company_year
  ON accounting.accounting_fixed_assets(company_id, fiscal_year_id, status, acquisition_date);

CREATE INDEX IF NOT EXISTS idx_accounting_fixed_assets_accounts
  ON accounting.accounting_fixed_assets(company_id, asset_account_id, accumulated_depreciation_account_id, expense_account_id);

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES
  ('fixed_assets.read', 'fixed_assets.read', 'Permite consultar inmovilizado contable'),
  ('fixed_assets.write', 'fixed_assets.write', 'Permite crear y cambiar inmovilizado contable')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description,
      updated_at=NOW();

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='fixed_assets.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='fixed_assets.write'
 WHERE r.code IN ('accounting_admin', 'accounting_user')
ON CONFLICT DO NOTHING;

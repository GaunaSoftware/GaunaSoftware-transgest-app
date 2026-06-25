CREATE TABLE IF NOT EXISTS accounting.external_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  provider_id VARCHAR(80) NOT NULL,
  import_type VARCHAR(60) NOT NULL,
  source_format VARCHAR(30) NOT NULL,
  original_filename VARCHAR(240),
  request_hash VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending_review',
  row_count INTEGER NOT NULL DEFAULT 0,
  valid_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  staged_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, request_hash),
  CHECK (provider_id ~ '^[a-zA-Z0-9_.:-]{2,80}$'),
  CHECK (import_type IN ('parties', 'maturities', 'bank_transactions', 'journal_entries', 'accounts', 'generic')),
  CHECK (source_format IN ('csv', 'json', 'manual')),
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled')),
  CHECK (row_count >= 0),
  CHECK (valid_count >= 0),
  CHECK (error_count >= 0),
  CHECK (warning_count >= 0)
);

CREATE TABLE IF NOT EXISTS accounting.external_import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  batch_id UUID NOT NULL REFERENCES accounting.external_import_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number >= 1),
  row_hash VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'valid',
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, row_number),
  UNIQUE (batch_id, row_hash),
  CHECK (status IN ('valid', 'warning', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_external_import_batches_company
  ON accounting.external_import_batches(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_import_batches_provider
  ON accounting.external_import_batches(company_id, provider_id, import_type);

CREATE INDEX IF NOT EXISTS idx_external_import_rows_batch
  ON accounting.external_import_rows(batch_id, row_number);

INSERT INTO accounting.accounting_permissions (code, name, description)
VALUES
  ('external_imports.read', 'external_imports.read', 'Permite consultar lotes staged de importaciones externas'),
  ('external_imports.write', 'external_imports.write', 'Permite preparar y revisar lotes staged de importaciones externas')
ON CONFLICT (code) DO UPDATE
  SET name=EXCLUDED.name,
      description=EXCLUDED.description,
      updated_at=NOW();

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='external_imports.read'
 WHERE r.code IN ('accounting_admin', 'accounting_user', 'accounting_viewer')
ON CONFLICT DO NOTHING;

INSERT INTO accounting.accounting_role_permissions (role_id, permission_id)
SELECT r.id, p.id
  FROM accounting.accounting_roles r
  JOIN accounting.accounting_permissions p ON p.code='external_imports.write'
 WHERE r.code IN ('accounting_admin', 'accounting_user')
ON CONFLICT DO NOTHING;

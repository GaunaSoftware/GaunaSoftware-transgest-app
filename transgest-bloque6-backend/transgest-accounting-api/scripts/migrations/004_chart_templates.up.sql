CREATE TABLE IF NOT EXISTS accounting.accounting_standards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) NOT NULL,
  name VARCHAR(220) NOT NULL,
  jurisdiction VARCHAR(80) NOT NULL,
  version_label VARCHAR(80) NOT NULL,
  source_url TEXT,
  source_checksum VARCHAR(64),
  effective_from DATE,
  effective_to DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, version_label),
  CHECK (status IN ('draft', 'validated', 'retired')),
  CHECK (source_checksum IS NULL OR source_checksum ~ '^[a-f0-9]{64}$')
);

CREATE TABLE IF NOT EXISTS accounting.chart_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  standard_id UUID REFERENCES accounting.accounting_standards(id) ON DELETE RESTRICT,
  template_scope VARCHAR(20) NOT NULL,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(220) NOT NULL,
  version_label VARCHAR(80) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'published',
  source_type VARCHAR(30) NOT NULL,
  source_url TEXT,
  source_checksum VARCHAR(64) NOT NULL,
  effective_from DATE,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CHECK (template_scope IN ('system', 'company')),
  CHECK (
    (template_scope = 'system' AND tenant_id IS NULL AND company_id IS NULL)
    OR
    (template_scope = 'company' AND tenant_id IS NOT NULL AND company_id IS NOT NULL)
  ),
  CHECK (status IN ('draft', 'published', 'retired')),
  CHECK (source_type IN ('company_snapshot', 'validated_standard', 'manual')),
  CHECK (source_checksum ~ '^[a-f0-9]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_templates_company_code_version
  ON accounting.chart_templates(company_id, code, version_label)
  WHERE company_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chart_templates_system_code_version
  ON accounting.chart_templates(code, version_label)
  WHERE company_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_chart_templates_company_status
  ON accounting.chart_templates(company_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS accounting.chart_template_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES accounting.chart_templates(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(220) NOT NULL,
  account_type VARCHAR(30) NOT NULL,
  parent_code VARCHAR(20),
  is_postable BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (template_id, code),
  CHECK (code ~ '^[0-9]{1,20}$'),
  CHECK (parent_code IS NULL OR parent_code ~ '^[0-9]{1,20}$'),
  CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense', 'memorandum'))
);

CREATE INDEX IF NOT EXISTS idx_chart_template_accounts_template_code
  ON accounting.chart_template_accounts(template_id, code);

CREATE TABLE IF NOT EXISTS accounting.chart_template_imports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES accounting.chart_templates(id) ON DELETE RESTRICT,
  idempotency_key VARCHAR(120) NOT NULL,
  template_checksum VARCHAR(64) NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  matching_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, fiscal_year_id, template_id),
  UNIQUE (company_id, idempotency_key),
  CHECK (template_checksum ~ '^[a-f0-9]{64}$'),
  CHECK (inserted_count >= 0 AND matching_count >= 0 AND conflict_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_chart_template_imports_company_year
  ON accounting.chart_template_imports(company_id, fiscal_year_id, created_at DESC);

CREATE SCHEMA IF NOT EXISTS accounting;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS accounting.accounting_tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system VARCHAR(60) NOT NULL DEFAULT 'transgest',
  source_tenant_id UUID NOT NULL,
  name VARCHAR(200) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_tenant_id)
);

CREATE TABLE IF NOT EXISTS accounting.accounting_companies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  source_system VARCHAR(60) NOT NULL DEFAULT 'transgest',
  source_company_id UUID NOT NULL,
  legal_name VARCHAR(220) NOT NULL,
  tax_id VARCHAR(40),
  country VARCHAR(80) NOT NULL DEFAULT 'ES',
  default_currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_company_id)
);

CREATE TABLE IF NOT EXISTS accounting.accounting_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_system VARCHAR(60) NOT NULL DEFAULT 'transgest',
  source_user_id UUID NOT NULL,
  email VARCHAR(220),
  display_name VARCHAR(220),
  status VARCHAR(30) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_system, source_user_id)
);

CREATE TABLE IF NOT EXISTS accounting.accounting_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(80) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounting.accounting_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(120) NOT NULL UNIQUE,
  name VARCHAR(180) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounting.accounting_role_permissions (
  role_id UUID NOT NULL REFERENCES accounting.accounting_roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES accounting.accounting_permissions(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS accounting.accounting_user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES accounting.accounting_users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES accounting.accounting_roles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, user_id, role_id)
);

CREATE TABLE IF NOT EXISTS accounting.fiscal_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  year_label VARCHAR(20) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, year_label),
  CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS accounting.accounting_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE CASCADE,
  period_number INTEGER NOT NULL CHECK (period_number BETWEEN 1 AND 99),
  name VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'open',
  locked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (fiscal_year_id, period_number),
  CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS accounting.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES accounting.accounting_tenants(id) ON DELETE SET NULL,
  company_id UUID REFERENCES accounting.accounting_companies(id) ON DELETE SET NULL,
  actor_type VARCHAR(40) NOT NULL DEFAULT 'system',
  actor_id UUID,
  action VARCHAR(140) NOT NULL,
  entity_type VARCHAR(120),
  entity_id UUID,
  request_id VARCHAR(120),
  trace_id VARCHAR(120),
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS accounting.outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  event_type VARCHAR(140) NOT NULL,
  aggregate_type VARCHAR(120) NOT NULL,
  aggregate_id UUID,
  schema_version INTEGER NOT NULL DEFAULT 1,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  payload_hash VARCHAR(80),
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS accounting.processed_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name VARCHAR(140) NOT NULL,
  event_id UUID NOT NULL,
  event_type VARCHAR(140) NOT NULL,
  payload_hash VARCHAR(80),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  result_ref VARCHAR(180),
  UNIQUE (consumer_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_accounting_companies_tenant ON accounting.accounting_companies(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_accounting_user_roles_user ON accounting.accounting_user_roles(user_id, company_id);
CREATE INDEX IF NOT EXISTS idx_fiscal_years_company ON accounting.fiscal_years(company_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_periods_company ON accounting.accounting_periods(company_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_company_created ON accounting.audit_log(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_events_pending ON accounting.outbox_events(status, available_at);
CREATE INDEX IF NOT EXISTS idx_processed_events_event ON accounting.processed_events(event_id);


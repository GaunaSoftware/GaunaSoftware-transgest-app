CREATE TABLE IF NOT EXISTS accounting.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES accounting.accounting_periods(id) ON DELETE RESTRICT,
  entry_number INTEGER,
  entry_date DATE NOT NULL,
  posting_date TIMESTAMPTZ,
  description VARCHAR(500) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  entry_type VARCHAR(30) NOT NULL DEFAULT 'manual',
  source_system VARCHAR(80) NOT NULL DEFAULT 'accounting',
  source_type VARCHAR(80) NOT NULL DEFAULT 'manual',
  source_id VARCHAR(180),
  source_event_id UUID,
  idempotency_key VARCHAR(120) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  post_idempotency_key VARCHAR(120),
  trace_id VARCHAR(120),
  request_id VARCHAR(120),
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, idempotency_key),
  UNIQUE (company_id, post_idempotency_key),
  CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  CHECK (status IN ('draft', 'posted')),
  CHECK (entry_type IN ('manual')),
  CHECK (
    (status = 'draft' AND entry_number IS NULL AND posting_date IS NULL)
    OR
    (status = 'posted' AND entry_number IS NOT NULL AND posting_date IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_company_year_number
  ON accounting.journal_entries(company_id, fiscal_year_id, entry_number)
  WHERE entry_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_journal_entries_company_source_event
  ON accounting.journal_entries(company_id, source_event_id)
  WHERE source_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_company_date
  ON accounting.journal_entries(company_id, entry_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_journal_entries_period_status
  ON accounting.journal_entries(period_id, status, entry_number);

CREATE TABLE IF NOT EXISTS accounting.journal_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES accounting.journal_entries(id) ON DELETE RESTRICT,
  line_number INTEGER NOT NULL CHECK (line_number BETWEEN 1 AND 9999),
  account_id UUID NOT NULL REFERENCES accounting.accounts(id) ON DELETE RESTRICT,
  debit_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  credit_amount NUMERIC(18,6) NOT NULL DEFAULT 0,
  currency VARCHAR(3) NOT NULL DEFAULT 'EUR',
  description VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (journal_entry_id, line_number),
  CHECK (debit_amount >= 0),
  CHECK (credit_amount >= 0),
  CHECK (
    (debit_amount > 0 AND credit_amount = 0)
    OR
    (credit_amount > 0 AND debit_amount = 0)
  )
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_entry
  ON accounting.journal_lines(journal_entry_id, line_number);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account
  ON accounting.journal_lines(company_id, account_id, journal_entry_id);

CREATE TABLE IF NOT EXISTS accounting.source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES accounting.journal_entries(id) ON DELETE RESTRICT,
  journal_line_id UUID REFERENCES accounting.journal_lines(id) ON DELETE RESTRICT,
  source_system VARCHAR(80) NOT NULL,
  source_type VARCHAR(80) NOT NULL,
  source_id VARCHAR(180) NOT NULL,
  source_line_id VARCHAR(180),
  source_event_id UUID,
  document_url TEXT,
  payload_hash VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (payload_hash IS NULL OR payload_hash ~ '^[a-f0-9]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_source_links_entry
  ON accounting.source_links(company_id, journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_source_links_source
  ON accounting.source_links(company_id, source_system, source_type, source_id);

ALTER TABLE accounting.accounting_periods
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_periods_closed
  ON accounting.accounting_periods(company_id, closed_at DESC)
  WHERE status = 'closed';

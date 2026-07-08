ALTER TABLE accounting.fiscal_years
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_fiscal_years_closed
  ON accounting.fiscal_years(company_id, closed_at DESC)
  WHERE status = 'closed';

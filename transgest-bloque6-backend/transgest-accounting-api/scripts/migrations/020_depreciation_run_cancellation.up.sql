ALTER TABLE accounting.depreciation_runs
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(500);

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_check;

ALTER TABLE accounting.depreciation_runs
  ADD CONSTRAINT depreciation_runs_status_check
    CHECK (status IN ('draft_created', 'cancelled')),
  ADD CONSTRAINT depreciation_runs_cancel_consistency
    CHECK (
      (
        status = 'draft_created'
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND cancel_reason IS NOT NULL
      )
    );

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_company_id_fixed_asset_id_period_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_runs_active_asset_period
  ON accounting.depreciation_runs(company_id, fixed_asset_id, period_id)
  WHERE status = 'draft_created';

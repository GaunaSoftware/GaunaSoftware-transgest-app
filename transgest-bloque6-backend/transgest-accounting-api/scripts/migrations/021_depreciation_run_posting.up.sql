ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_check,
  DROP CONSTRAINT IF EXISTS depreciation_runs_cancel_consistency;

ALTER TABLE accounting.depreciation_runs
  ADD CONSTRAINT depreciation_runs_status_check
    CHECK (status IN ('draft_created', 'posted', 'cancelled')),
  ADD CONSTRAINT depreciation_runs_status_consistency
    CHECK (
      (
        status IN ('draft_created', 'posted')
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

DROP INDEX IF EXISTS accounting.uq_depreciation_runs_active_asset_period;

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_runs_active_asset_period
  ON accounting.depreciation_runs(company_id, fixed_asset_id, period_id)
  WHERE status IN ('draft_created', 'posted');

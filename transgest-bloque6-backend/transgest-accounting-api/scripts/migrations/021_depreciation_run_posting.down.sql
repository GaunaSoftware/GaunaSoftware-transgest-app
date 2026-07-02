DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting.depreciation_runs
     WHERE status = 'posted'
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 021_depreciation_run_posting: existen amortizaciones contabilizadas';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_depreciation_runs_active_asset_period;

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_consistency,
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

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_runs_active_asset_period
  ON accounting.depreciation_runs(company_id, fixed_asset_id, period_id)
  WHERE status = 'draft_created';

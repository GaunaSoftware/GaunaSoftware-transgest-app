DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting.depreciation_runs
     WHERE status = 'cancelled'
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 020_depreciation_run_cancellation: existen amortizaciones canceladas';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_depreciation_runs_active_asset_period;

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_cancel_consistency,
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_check;

ALTER TABLE accounting.depreciation_runs
  ADD CONSTRAINT depreciation_runs_status_check
    CHECK (status IN ('draft_created'));

ALTER TABLE accounting.depreciation_runs
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at;

ALTER TABLE accounting.depreciation_runs
  ADD CONSTRAINT depreciation_runs_company_id_fixed_asset_id_period_id_key
    UNIQUE (company_id, fixed_asset_id, period_id);

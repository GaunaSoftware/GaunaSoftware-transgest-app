DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting.depreciation_runs
     WHERE status IN ('reversal_draft_created', 'reversed')
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 022_depreciation_run_reversal: existen amortizaciones con reverso';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_depreciation_runs_active_asset_period;

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_consistency,
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_check;

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

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_runs_active_asset_period
  ON accounting.depreciation_runs(company_id, fixed_asset_id, period_id)
  WHERE status IN ('draft_created', 'posted');

ALTER TABLE accounting.depreciation_runs
  DROP COLUMN IF EXISTS reversal_reason,
  DROP COLUMN IF EXISTS reversed_by,
  DROP COLUMN IF EXISTS reversed_at,
  DROP COLUMN IF EXISTS reversal_journal_entry_id;

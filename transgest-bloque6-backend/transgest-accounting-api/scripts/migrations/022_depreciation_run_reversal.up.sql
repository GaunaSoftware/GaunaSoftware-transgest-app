ALTER TABLE accounting.depreciation_runs
  ADD COLUMN IF NOT EXISTS reversal_journal_entry_id UUID REFERENCES accounting.journal_entries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reversal_reason VARCHAR(500);

ALTER TABLE accounting.depreciation_runs
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_consistency,
  DROP CONSTRAINT IF EXISTS depreciation_runs_status_check;

ALTER TABLE accounting.depreciation_runs
  ADD CONSTRAINT depreciation_runs_status_check
    CHECK (status IN ('draft_created', 'posted', 'cancelled', 'reversal_draft_created', 'reversed')),
  ADD CONSTRAINT depreciation_runs_status_consistency
    CHECK (
      (
        status IN ('draft_created', 'posted')
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
        AND reversal_journal_entry_id IS NULL
        AND reversed_at IS NULL
        AND reversal_reason IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND cancelled_at IS NOT NULL
        AND cancel_reason IS NOT NULL
        AND reversal_journal_entry_id IS NULL
        AND reversed_at IS NULL
        AND reversal_reason IS NULL
      )
      OR
      (
        status = 'reversal_draft_created'
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
        AND reversal_journal_entry_id IS NOT NULL
        AND reversed_at IS NULL
        AND reversal_reason IS NOT NULL
      )
      OR
      (
        status = 'reversed'
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
        AND reversal_journal_entry_id IS NOT NULL
        AND reversed_at IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    );

DROP INDEX IF EXISTS accounting.uq_depreciation_runs_active_asset_period;

CREATE UNIQUE INDEX IF NOT EXISTS uq_depreciation_runs_active_asset_period
  ON accounting.depreciation_runs(company_id, fixed_asset_id, period_id)
  WHERE status IN ('draft_created', 'posted', 'reversal_draft_created');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting.journal_entries WHERE status = 'cancelled') THEN
    RAISE EXCEPTION 'No se puede revertir 007_journal_entry_cancellation: existen borradores cancelados';
  END IF;
END $$;

ALTER TABLE accounting.journal_entries
  DROP CONSTRAINT IF EXISTS chk_journal_entries_state_consistency,
  DROP CONSTRAINT IF EXISTS chk_journal_entries_status;

ALTER TABLE accounting.journal_entries
  DROP COLUMN IF EXISTS cancel_reason,
  DROP COLUMN IF EXISTS cancelled_by,
  DROP COLUMN IF EXISTS cancelled_at;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_status
    CHECK (status IN ('draft', 'posted')),
  ADD CONSTRAINT chk_journal_entries_state_consistency
    CHECK (
      (
        status = 'draft'
        AND entry_number IS NULL
        AND posting_date IS NULL
      )
      OR
      (
        status = 'posted'
        AND entry_number IS NOT NULL
        AND posting_date IS NOT NULL
      )
    );

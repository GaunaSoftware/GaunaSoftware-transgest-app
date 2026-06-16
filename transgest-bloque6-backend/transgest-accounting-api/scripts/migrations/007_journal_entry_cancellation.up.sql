ALTER TABLE accounting.journal_entries
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cancel_reason VARCHAR(500);

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'accounting.journal_entries'::regclass
       AND contype = 'c'
       AND (
         pg_get_constraintdef(oid) ILIKE '%status%'
         OR (
           pg_get_constraintdef(oid) ILIKE '%entry_number%'
           AND pg_get_constraintdef(oid) ILIKE '%posting_date%'
         )
       )
  LOOP
    EXECUTE format('ALTER TABLE accounting.journal_entries DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_status
    CHECK (status IN ('draft', 'posted', 'cancelled')),
  ADD CONSTRAINT chk_journal_entries_state_consistency
    CHECK (
      (
        status = 'draft'
        AND entry_number IS NULL
        AND posting_date IS NULL
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
      )
      OR
      (
        status = 'posted'
        AND entry_number IS NOT NULL
        AND posting_date IS NOT NULL
        AND cancelled_at IS NULL
        AND cancel_reason IS NULL
      )
      OR
      (
        status = 'cancelled'
        AND entry_number IS NULL
        AND posting_date IS NULL
        AND cancelled_at IS NOT NULL
        AND cancel_reason IS NOT NULL
      )
    );

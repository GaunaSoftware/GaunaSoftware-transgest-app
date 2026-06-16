DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.journal_entries
     WHERE reversal_of_entry_id IS NOT NULL
        OR reversed_by_entry_id IS NOT NULL
        OR entry_type = 'reversal'
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 008_journal_entry_reversal: existen asientos reversos o enlazados';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_journal_entries_company_reversal_of;

ALTER TABLE accounting.journal_entries
  DROP CONSTRAINT IF EXISTS chk_journal_entries_reversal_links,
  DROP CONSTRAINT IF EXISTS chk_journal_entries_entry_type;

ALTER TABLE accounting.journal_entries
  DROP COLUMN IF EXISTS reversal_reason,
  DROP COLUMN IF EXISTS reversed_by_entry_id,
  DROP COLUMN IF EXISTS reversal_of_entry_id;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_entry_type
    CHECK (entry_type IN ('manual'));

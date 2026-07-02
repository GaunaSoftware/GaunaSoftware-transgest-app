DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'accounting.journal_entries'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format('ALTER TABLE accounting.journal_entries DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_entry_type
    CHECK (entry_type IN ('manual', 'reversal', 'depreciation', 'fixed_asset_disposal')),
  ADD CONSTRAINT chk_journal_entries_reversal_links
    CHECK (
      (
        entry_type IN ('manual', 'depreciation', 'fixed_asset_disposal')
        AND reversal_of_entry_id IS NULL
      )
      OR
      (
        entry_type = 'reversal'
        AND reversal_of_entry_id IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    );

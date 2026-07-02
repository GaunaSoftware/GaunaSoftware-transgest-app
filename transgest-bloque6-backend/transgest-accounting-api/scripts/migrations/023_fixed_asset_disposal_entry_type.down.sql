DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting.journal_entries
     WHERE entry_type = 'fixed_asset_disposal'
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 023_fixed_asset_disposal_entry_type: existen asientos de baja de inmovilizado';
  END IF;
END $$;

ALTER TABLE accounting.journal_entries
  DROP CONSTRAINT IF EXISTS chk_journal_entries_reversal_links,
  DROP CONSTRAINT IF EXISTS chk_journal_entries_entry_type;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_entry_type
    CHECK (entry_type IN ('manual', 'reversal', 'depreciation')),
  ADD CONSTRAINT chk_journal_entries_reversal_links
    CHECK (
      (
        entry_type IN ('manual', 'depreciation')
        AND reversal_of_entry_id IS NULL
      )
      OR
      (
        entry_type = 'reversal'
        AND reversal_of_entry_id IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    );

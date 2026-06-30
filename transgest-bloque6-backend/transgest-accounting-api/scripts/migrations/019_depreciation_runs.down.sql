DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM accounting.depreciation_runs LIMIT 1) THEN
    RAISE EXCEPTION 'No se puede revertir 019_depreciation_runs: existen ejecuciones de amortizacion';
  END IF;

  IF EXISTS (
    SELECT 1 FROM accounting.journal_entries
     WHERE entry_type = 'depreciation'
     LIMIT 1
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 019_depreciation_runs: existen borradores/asientos de amortizacion';
  END IF;
END $$;

DROP TABLE IF EXISTS accounting.depreciation_runs;

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
    CHECK (entry_type IN ('manual', 'reversal')),
  ADD CONSTRAINT chk_journal_entries_reversal_links
    CHECK (
      (
        entry_type = 'manual'
        AND reversal_of_entry_id IS NULL
      )
      OR
      (
        entry_type = 'reversal'
        AND reversal_of_entry_id IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    );

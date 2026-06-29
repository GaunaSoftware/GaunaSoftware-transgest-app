DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.external_import_batches
     WHERE status = 'applied'
        OR applied_count > 0
        OR applied_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 016: existen lotes externos aplicados';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.idx_external_import_batches_applied;

ALTER TABLE accounting.external_import_batches
  DROP CONSTRAINT IF EXISTS external_import_batches_apply_counts_check,
  DROP CONSTRAINT IF EXISTS external_import_batches_status_check;

ALTER TABLE accounting.external_import_batches
  ADD CONSTRAINT external_import_batches_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled'));

ALTER TABLE accounting.external_import_batches
  DROP COLUMN IF EXISTS skipped_count,
  DROP COLUMN IF EXISTS applied_count,
  DROP COLUMN IF EXISTS applied_at,
  DROP COLUMN IF EXISTS applied_by;

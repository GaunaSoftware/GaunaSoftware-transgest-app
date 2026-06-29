ALTER TABLE accounting.external_import_batches
  ADD COLUMN IF NOT EXISTS applied_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS applied_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS skipped_count INTEGER NOT NULL DEFAULT 0;

DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  SELECT conname
    INTO constraint_name
    FROM pg_constraint
   WHERE conrelid = 'accounting.external_import_batches'::regclass
     AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%'
     AND pg_get_constraintdef(oid) LIKE '%pending_review%'
   LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE accounting.external_import_batches DROP CONSTRAINT %I', constraint_name);
  END IF;
END $$;

ALTER TABLE accounting.external_import_batches
  ADD CONSTRAINT external_import_batches_status_check
  CHECK (status IN ('pending_review', 'approved', 'rejected', 'cancelled', 'applied'));

ALTER TABLE accounting.external_import_batches
  ADD CONSTRAINT external_import_batches_apply_counts_check
  CHECK (applied_count >= 0 AND skipped_count >= 0);

CREATE INDEX IF NOT EXISTS idx_external_import_batches_applied
  ON accounting.external_import_batches(company_id, applied_at DESC)
  WHERE status = 'applied';

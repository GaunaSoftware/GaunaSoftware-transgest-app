DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.fiscal_years
     WHERE closed_at IS NOT NULL
        OR closed_by IS NOT NULL
        OR status_reason IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 024: existen ejercicios con metadatos de cierre';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.idx_fiscal_years_closed;

ALTER TABLE accounting.fiscal_years
  DROP COLUMN IF EXISTS status_reason,
  DROP COLUMN IF EXISTS closed_by,
  DROP COLUMN IF EXISTS closed_at;

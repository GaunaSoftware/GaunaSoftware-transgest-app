DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.accounting_periods
     WHERE closed_at IS NOT NULL
        OR closed_by IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 017: existen periodos con metadatos de cierre';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.idx_accounting_periods_closed;

ALTER TABLE accounting.accounting_periods
  DROP COLUMN IF EXISTS closed_by,
  DROP COLUMN IF EXISTS closed_at;

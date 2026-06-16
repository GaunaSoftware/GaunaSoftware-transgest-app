DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.bank_transactions
     WHERE source_system = 'bank_csv'
        OR import_id IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM accounting.bank_statement_imports
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 014: existen importaciones bancarias o movimientos importados';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_bank_transactions_import_source;
DROP INDEX IF EXISTS accounting.idx_bank_statement_imports_company;

ALTER TABLE accounting.bank_transactions
  DROP COLUMN IF EXISTS import_id;

DROP TABLE IF EXISTS accounting.bank_statement_imports;

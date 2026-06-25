DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM accounting.external_import_batches
     WHERE status IN ('pending_review', 'approved')
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 015: existen lotes staged pendientes o aprobados';
  END IF;
END $$;

DELETE FROM accounting.accounting_role_permissions
 WHERE permission_id IN (
   SELECT id FROM accounting.accounting_permissions
    WHERE code IN ('external_imports.read', 'external_imports.write')
 );

DELETE FROM accounting.accounting_permissions
 WHERE code IN ('external_imports.read', 'external_imports.write');

DROP INDEX IF EXISTS accounting.idx_external_import_rows_batch;
DROP INDEX IF EXISTS accounting.idx_external_import_batches_provider;
DROP INDEX IF EXISTS accounting.idx_external_import_batches_company;

DROP TABLE IF EXISTS accounting.external_import_rows;
DROP TABLE IF EXISTS accounting.external_import_batches;

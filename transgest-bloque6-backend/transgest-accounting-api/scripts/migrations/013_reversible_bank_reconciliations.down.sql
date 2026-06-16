DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM accounting.bank_reconciliations
     WHERE status = 'voided'
  ) THEN
    RAISE EXCEPTION 'No se puede revertir 013: existen conciliaciones bancarias anuladas';
  END IF;
END $$;

DROP INDEX IF EXISTS accounting.uq_bank_reconciliations_active_maturity;
DROP INDEX IF EXISTS accounting.uq_bank_reconciliations_active_bank_transaction;

ALTER TABLE accounting.bank_reconciliations
  DROP CONSTRAINT IF EXISTS chk_bank_reconciliations_status;

ALTER TABLE accounting.bank_reconciliations
  ADD CONSTRAINT bank_reconciliations_bank_transaction_id_key UNIQUE (bank_transaction_id),
  ADD CONSTRAINT bank_reconciliations_maturity_id_key UNIQUE (maturity_id);

ALTER TABLE accounting.bank_reconciliations
  DROP COLUMN IF EXISTS void_reason,
  DROP COLUMN IF EXISTS voided_by,
  DROP COLUMN IF EXISTS voided_at,
  DROP COLUMN IF EXISTS status;

ALTER TABLE accounting.bank_reconciliations
  ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS voided_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS void_reason TEXT;

ALTER TABLE accounting.bank_reconciliations
  DROP CONSTRAINT IF EXISTS bank_reconciliations_bank_transaction_id_key,
  DROP CONSTRAINT IF EXISTS bank_reconciliations_maturity_id_key,
  DROP CONSTRAINT IF EXISTS chk_bank_reconciliations_status;

ALTER TABLE accounting.bank_reconciliations
  ADD CONSTRAINT chk_bank_reconciliations_status
  CHECK (
    (status = 'active' AND voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR
    (status = 'voided' AND voided_at IS NOT NULL AND void_reason IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliations_active_bank_transaction
  ON accounting.bank_reconciliations(bank_transaction_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_reconciliations_active_maturity
  ON accounting.bank_reconciliations(maturity_id)
  WHERE status = 'active';

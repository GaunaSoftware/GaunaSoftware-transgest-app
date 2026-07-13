-- Datos bancarios de terceros para remesas SEPA (pagos/cobros).
ALTER TABLE accounting.accounting_parties
  ADD COLUMN IF NOT EXISTS iban VARCHAR(34),
  ADD COLUMN IF NOT EXISTS swift_bic VARCHAR(20);

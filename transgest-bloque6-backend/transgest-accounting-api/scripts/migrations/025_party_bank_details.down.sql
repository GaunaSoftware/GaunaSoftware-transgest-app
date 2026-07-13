ALTER TABLE accounting.accounting_parties
  DROP COLUMN IF EXISTS iban,
  DROP COLUMN IF EXISTS swift_bic;

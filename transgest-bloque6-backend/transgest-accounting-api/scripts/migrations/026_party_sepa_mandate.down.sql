ALTER TABLE accounting.accounting_parties
  DROP COLUMN IF EXISTS mandate_ref,
  DROP COLUMN IF EXISTS mandate_date;

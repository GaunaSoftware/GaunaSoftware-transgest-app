-- Mandato SEPA de adeudos (pain.008) por tercero.
ALTER TABLE accounting.accounting_parties
  ADD COLUMN IF NOT EXISTS mandate_ref VARCHAR(35),
  ADD COLUMN IF NOT EXISTS mandate_date DATE;

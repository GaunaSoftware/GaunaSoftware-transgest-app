-- Codigo de provincia del tercero (2 digitos AEAT) para el modelo 347.
ALTER TABLE accounting.accounting_parties
  ADD COLUMN IF NOT EXISTS province_code VARCHAR(2);

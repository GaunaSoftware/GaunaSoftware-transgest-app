ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(255);

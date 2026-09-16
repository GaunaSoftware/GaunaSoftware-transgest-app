-- Invoice numbers belong to a company, not to the whole platform.
-- Build the replacement before removing the old constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_facturas_empresa_numero_unique ON facturas(empresa_id, numero);
ALTER TABLE facturas DROP CONSTRAINT IF EXISTS facturas_numero_key;

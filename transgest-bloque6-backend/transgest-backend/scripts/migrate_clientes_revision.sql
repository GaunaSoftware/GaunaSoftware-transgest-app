ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS calle VARCHAR(200);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS num_ext VARCHAR(20);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10);
CREATE INDEX IF NOT EXISTS idx_clientes_pendiente ON clientes(empresa_id, pendiente_revision) WHERE pendiente_revision=true;
SELECT 'Migración clientes_revision OK' AS resultado;

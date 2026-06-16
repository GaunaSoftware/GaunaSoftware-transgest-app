-- Conjuntos tractora-remolque
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vehiculos_remolque ON vehiculos(remolque_id);
SELECT 'Migración conjuntos completada' AS resultado;

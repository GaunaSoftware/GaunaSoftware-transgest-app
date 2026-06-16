ALTER TABLE taller_neumaticos ADD COLUMN IF NOT EXISTS tipo VARCHAR(60) DEFAULT 'tractora';
ALTER TABLE taller_neumaticos ADD COLUMN IF NOT EXISTS proveedor VARCHAR(180);
ALTER TABLE taller_neumaticos ADD COLUMN IF NOT EXISTS dot VARCHAR(40);
ALTER TABLE taller_neumaticos ADD COLUMN IF NOT EXISTS profundidad_mm NUMERIC(6,2);

CREATE INDEX IF NOT EXISTS idx_taller_neumaticos_vehiculo_pos
  ON taller_neumaticos(empresa_id, vehiculo_id, posicion)
  WHERE estado='montado';

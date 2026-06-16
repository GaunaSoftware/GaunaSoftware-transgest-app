-- Remolque en pedidos
ALTER TABLE pedidos
  ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS remolque_matricula VARCHAR(20);

-- Historial de vehículos por chófer
CREATE TABLE IF NOT EXISTS chofer_vehiculo_historial (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id     UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  vehiculo_id   UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  remolque_id   UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  pedido_id     UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  matricula     VARCHAR(20),   -- guardada para histórico aunque se borre el vehículo
  remolque_mat  VARCHAR(20),
  tipo          VARCHAR(30) DEFAULT 'asignacion', -- asignacion | pedido
  fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  empresa_id    UUID
);
CREATE INDEX IF NOT EXISTS idx_cvh_chofer ON chofer_vehiculo_historial(chofer_id);
CREATE INDEX IF NOT EXISTS idx_cvh_fecha  ON chofer_vehiculo_historial(chofer_id, fecha DESC);

SELECT 'Migración conjuntos+historial completada' AS resultado;

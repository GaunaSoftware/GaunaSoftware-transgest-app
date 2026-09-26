-- Additive; no inferred events or migration of historical progress.
ALTER TABLE viaje_paradas ADD COLUMN IF NOT EXISTS progreso JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS chofer_parada_operaciones (
  empresa_id UUID NOT NULL,
  client_operation_uuid UUID NOT NULL,
  pedido_id UUID NOT NULL,
  parada_legacy_id TEXT NOT NULL,
  viaje_id UUID,
  parada_id UUID,
  actor_id UUID,
  request_hash TEXT NOT NULL,
  solicitud JSONB NOT NULL,
  resultado JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id,client_operation_uuid),
  FOREIGN KEY (empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id),
  FOREIGN KEY (empresa_id,viaje_id,parada_id) REFERENCES viaje_paradas(empresa_id,viaje_id,id)
);
CREATE INDEX IF NOT EXISTS chofer_parada_operaciones_stop_idx ON chofer_parada_operaciones(empresa_id,pedido_id,parada_legacy_id,received_at);

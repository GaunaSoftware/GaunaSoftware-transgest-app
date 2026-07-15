ALTER TABLE palets_movimientos
  ADD COLUMN IF NOT EXISTS obra_referencia VARCHAR(240),
  ADD COLUMN IF NOT EXISTS movimiento_origen_id UUID REFERENCES palets_movimientos(id) ON DELETE SET NULL;

UPDATE palets_movimientos
   SET obra_referencia = NULLIF(TRIM(pedido_ref), '')
 WHERE obra_referencia IS NULL
   AND NULLIF(TRIM(pedido_ref), '') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_palets_movimientos_origen
  ON palets_movimientos(empresa_id, movimiento_origen_id);

CREATE INDEX IF NOT EXISTS idx_palets_movimientos_obra
  ON palets_movimientos(empresa_id, propietario_cliente_id, obra_referencia);

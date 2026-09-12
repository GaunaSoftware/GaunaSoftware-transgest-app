ALTER TABLE palets_movimientos ADD COLUMN IF NOT EXISTS pedido_transporte_id UUID REFERENCES pedidos(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_palets_transporte ON palets_movimientos(empresa_id, pedido_transporte_id);

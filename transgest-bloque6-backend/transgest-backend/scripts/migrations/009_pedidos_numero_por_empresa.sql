CREATE TABLE IF NOT EXISTS pedido_numero_counters (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  year INTEGER NOT NULL,
  last_num INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, year)
);

ALTER TABLE pedidos DROP CONSTRAINT IF EXISTS pedidos_numero_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_empresa_numero_unique
  ON pedidos(empresa_id, numero);

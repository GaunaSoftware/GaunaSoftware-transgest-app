CREATE TABLE IF NOT EXISTS palets_alertas_usuario (
  empresa_id UUID NOT NULL,
  usuario_id UUID NOT NULL,
  alerta_key VARCHAR(300) NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'leida',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, usuario_id, alerta_key)
);

CREATE INDEX IF NOT EXISTS idx_palets_alertas_usuario_estado
  ON palets_alertas_usuario(empresa_id, usuario_id, estado);

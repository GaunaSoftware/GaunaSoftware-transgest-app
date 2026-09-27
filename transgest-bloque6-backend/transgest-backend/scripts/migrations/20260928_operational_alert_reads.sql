CREATE TABLE IF NOT EXISTS avisos_operativos_leidos (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  alert_key VARCHAR(220) NOT NULL,
  fingerprint TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, usuario_id, alert_key)
);

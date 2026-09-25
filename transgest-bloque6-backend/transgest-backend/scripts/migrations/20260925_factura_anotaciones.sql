-- Informative corrections after issuance. The fiscal invoice and its original
-- document are never updated by this table.
CREATE TABLE IF NOT EXISTS factura_anotaciones (
  factura_id UUID NOT NULL,
  empresa_id UUID NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  datos JSONB NOT NULL,
  cambios JSONB NOT NULL,
  motivo TEXT NOT NULL,
  usuario_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (factura_id, version)
);
CREATE INDEX IF NOT EXISTS factura_anotaciones_empresa_idx
  ON factura_anotaciones (empresa_id, factura_id, version DESC);

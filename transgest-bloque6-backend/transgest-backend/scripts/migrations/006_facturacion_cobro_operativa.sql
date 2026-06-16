CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TYPE estado_factura ADD VALUE IF NOT EXISTS 'reclamada';
ALTER TYPE estado_factura ADD VALUE IF NOT EXISTS 'sin_cobrar';

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS revision_cobro_at DATE,
  ADD COLUMN IF NOT EXISTS aviso_cobro_dias INTEGER NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS reclamacion_estado VARCHAR(40) NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS reclamacion_envios INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reclamacion_ultimo_envio_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reclamacion_hasta DATE,
  ADD COLUMN IF NOT EXISTS agrupada_desde UUID[];

CREATE TABLE IF NOT EXISTS factura_docs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  pedido_doc_id UUID REFERENCES pedido_docs(id) ON DELETE SET NULL,
  pedido_id UUID,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(80),
  file_base64 TEXT,
  file_mime VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_facturas_revision_cobro
  ON facturas(empresa_id, revision_cobro_at, estado)
  WHERE estado <> 'cobrada';

CREATE INDEX IF NOT EXISTS idx_facturas_reclamacion_estado
  ON facturas(empresa_id, reclamacion_estado, estado);

CREATE INDEX IF NOT EXISTS idx_factura_docs_factura
  ON factura_docs(factura_id);

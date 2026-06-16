-- ══════════════════════════════════════════════════════════════════════
-- Migración: docs pedido + periodos tractora por chófer
-- ══════════════════════════════════════════════════════════════════════

-- 1. Documentos adjuntos a pedidos (CMR, albaranes, fotos descarga, etc.)
CREATE TABLE IF NOT EXISTS pedido_docs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id     UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id    UUID REFERENCES empresas(id) ON DELETE CASCADE,
  nombre        VARCHAR(200) NOT NULL,
  tipo          VARCHAR(50)  NOT NULL DEFAULT 'otro',
  -- tipos: cmr | albaran | foto_descarga | pesaje | incidencia | otro
  file_base64   TEXT,        -- almacenado en BD para demo; en producción usar S3
  file_mime     VARCHAR(50)  NOT NULL DEFAULT 'application/pdf',
  file_size_kb  INTEGER,
  notas         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pedido_docs_pedido   ON pedido_docs(pedido_id);
CREATE INDEX IF NOT EXISTS idx_pedido_docs_empresa  ON pedido_docs(empresa_id);

-- 2. Periodos de tractora por chófer (para hojas de ruta multi-tractora)
CREATE TABLE IF NOT EXISTS chofer_tractora_periodos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id     UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  vehiculo_id   UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  remolque_id   UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  empresa_id    UUID REFERENCES empresas(id) ON DELETE CASCADE,
  fecha_inicio  DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin     DATE,        -- NULL = activo actualmente
  matricula     VARCHAR(20), -- desnormalizado para histórico
  remolque_mat  VARCHAR(20),
  notas         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ctp_chofer   ON chofer_tractora_periodos(chofer_id);
CREATE INDEX IF NOT EXISTS idx_ctp_vehiculo ON chofer_tractora_periodos(vehiculo_id);

-- 3. Campo para logo empresa en cfg_precios ya existe via ALTER
-- Confirmar que la columna logo_base64 existe
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo_base64 TEXT;

SELECT 'Migración docs+periodos completada' AS resultado;

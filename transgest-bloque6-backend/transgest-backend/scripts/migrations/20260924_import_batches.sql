-- Lotes de migración TMS. No altera tablas operativas ni documentos fiscales.
CREATE TABLE IF NOT EXISTS import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  filename TEXT NOT NULL,
  file_hash_sha256 CHAR(64),
  source_system TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded','validating','review','ready','running','completed',
    'completed_with_errors','failed','cancelled'
  )),
  total_rows INTEGER NOT NULL DEFAULT 0 CHECK (total_rows >= 0),
  valid_rows INTEGER NOT NULL DEFAULT 0 CHECK (valid_rows >= 0),
  invalid_rows INTEGER NOT NULL DEFAULT 0 CHECK (invalid_rows >= 0),
  created_rows INTEGER NOT NULL DEFAULT 0 CHECK (created_rows >= 0),
  updated_rows INTEGER NOT NULL DEFAULT 0 CHECK (updated_rows >= 0),
  skipped_rows INTEGER NOT NULL DEFAULT 0 CHECK (skipped_rows >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  retention_until TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '90 days'),
  CONSTRAINT import_batches_hash_format CHECK (file_hash_sha256 IS NULL OR file_hash_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_import_batches_empresa_created ON import_batches(empresa_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_import_batches_status ON import_batches(status, created_at) WHERE status IN ('ready','running');

CREATE TABLE IF NOT EXISTS import_rows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  row_number INTEGER NOT NULL CHECK (row_number > 0),
  source_data JSONB NOT NULL,
  normalized_data JSONB,
  status TEXT NOT NULL DEFAULT 'uploaded' CHECK (status IN (
    'uploaded','valid','warning','invalid','ready','running','created','updated',
    'skipped','failed','cancelled','rolled_back'
  )),
  target_id UUID,
  error_code TEXT,
  error_message TEXT,
  source_id TEXT,
  fingerprint CHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, entity_type, row_number)
);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch_status ON import_rows(batch_id, status, row_number);
CREATE INDEX IF NOT EXISTS idx_import_rows_batch_source ON import_rows(batch_id, entity_type, source_id);

-- Identidad lógica independiente de las tablas destino. El índice parcial evita
-- equiparar todos los NULL y permite revisar explícitamente un origen sin ID.
CREATE TABLE IF NOT EXISTS import_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  source_system TEXT NOT NULL,
  source_id TEXT,
  fingerprint CHAR(64),
  target_table TEXT NOT NULL,
  target_id UUID NOT NULL,
  created_by_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, entity_type, source_system, source_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_import_identities_fingerprint
  ON import_identities(empresa_id, entity_type, source_system, fingerprint)
  WHERE source_id IS NULL AND fingerprint IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_import_identities_target ON import_identities(empresa_id, target_table, target_id);

CREATE TABLE IF NOT EXISTS import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES import_batches(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_events_batch ON import_events(batch_id, created_at, id);

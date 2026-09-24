-- Binarios PDF privados, separados de los metadatos y del file_url legado.
CREATE TABLE IF NOT EXISTS import_document_blobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  row_id UUID REFERENCES import_rows(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  sha256 CHAR(64) NOT NULL,
  content BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  committed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_import_document_blobs_tenant ON import_document_blobs(empresa_id,id);
CREATE INDEX IF NOT EXISTS idx_import_document_blobs_staging ON import_document_blobs(created_at)
  WHERE committed_at IS NULL;

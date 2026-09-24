-- Huellas de destino para impedir que un rollback borre trabajo posterior.
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS target_snapshot JSONB;
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS previous_snapshot JSONB;
ALTER TABLE import_rows ADD COLUMN IF NOT EXISTS auxiliary_target JSONB;
ALTER TABLE import_batches DROP CONSTRAINT IF EXISTS import_batches_status_check;
ALTER TABLE import_batches ADD CONSTRAINT import_batches_status_check CHECK (status IN (
  'uploaded','validating','review','ready','running','completed',
  'completed_with_errors','failed','cancelled','rolled_back'));
ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_import_route_prices_batch ON ruta_precios_cliente(import_batch_id) WHERE import_batch_id IS NOT NULL;

-- El histórico conserva su origen sin alterar tráfico, disponibilidad ni fiscalidad.
CREATE TABLE IF NOT EXISTS import_viajes_historicos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  numero_origen TEXT,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_cif TEXT,
  cliente_nombre TEXT NOT NULL,
  referencia_cliente TEXT,
  origen TEXT NOT NULL,
  destino TEXT NOT NULL,
  fecha_carga DATE NOT NULL,
  hora_carga TIME,
  fecha_descarga DATE,
  hora_descarga TIME,
  matricula_tractora TEXT,
  matricula_remolque TEXT,
  chofer_dni TEXT,
  colaborador_cif TEXT,
  mercancia TEXT,
  peso_kg NUMERIC(12,3),
  bultos NUMERIC(12,2),
  km_ruta NUMERIC(12,2),
  km_vacio NUMERIC(12,2),
  importe NUMERIC(14,2),
  precio_colaborador NUMERIC(14,2),
  coste_gasoil NUMERIC(14,2),
  coste_peajes NUMERIC(14,2),
  coste_dietas NUMERIC(14,2),
  coste_otros NUMERIC(14,2),
  estado TEXT,
  notas TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id,source_system,source_id)
);
CREATE INDEX IF NOT EXISTS idx_import_viajes_empresa_fecha ON import_viajes_historicos(empresa_id,fecha_carga DESC);

-- Los pendientes sí entran en tráfico mediante inserción directa, sin llamar
-- rutas que envíen emails, publiquen webhooks o creen facturas.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS migration_source_system TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS migration_source_id TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS migration_numero_origen TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS migration_matricula_remolque TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pedidos_migration_identity ON pedidos(empresa_id,migration_source_system,migration_source_id)
  WHERE migration_source_id IS NOT NULL;

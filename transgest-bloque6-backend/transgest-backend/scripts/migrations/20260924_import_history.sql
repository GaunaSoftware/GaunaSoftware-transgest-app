-- Históricos de migración aislados del circuito fiscal, de numeración y envío.
CREATE TABLE IF NOT EXISTS import_facturas_historicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  numero_origen TEXT NOT NULL,
  serie_origen TEXT,
  fecha DATE NOT NULL,
  cliente_nombre TEXT NOT NULL,
  cliente_cif TEXT,
  total NUMERIC(14,2) NOT NULL,
  tipo_operacion TEXT,
  rectificativa BOOLEAN NOT NULL DEFAULT false,
  rectifica_referencia TEXT,
  estado_historico TEXT,
  origen TEXT,
  notas TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, source_system, source_id)
);
CREATE INDEX IF NOT EXISTS idx_import_facturas_empresa_fecha ON import_facturas_historicas(empresa_id, fecha DESC);

CREATE TABLE IF NOT EXISTS import_factura_lineas_historicas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  factura_id UUID NOT NULL REFERENCES import_facturas_historicas(id) ON DELETE RESTRICT,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  linea INTEGER NOT NULL CHECK (linea > 0),
  importe NUMERIC(14,2) NOT NULL,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  vehiculo_matricula TEXT,
  tipo_operacion TEXT,
  fecha_factura_proveedor DATE,
  proveedor TEXT,
  factura_proveedor TEXT,
  coste_proveedor NUMERIC(14,2),
  beneficio_origen NUMERIC(14,2),
  observaciones TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, source_system, source_id),
  UNIQUE (factura_id, linea)
);
CREATE INDEX IF NOT EXISTS idx_import_lineas_empresa_factura ON import_factura_lineas_historicas(empresa_id, factura_id);

-- Saldo inicial independiente: no crea factura fiscal ni atribuye cobros
-- efectivos sin evidencia de movimientos bancarios/aplicaciones.
CREATE TABLE IF NOT EXISTS import_saldos_pendientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  source_system TEXT NOT NULL,
  source_id TEXT NOT NULL,
  numero_origen TEXT NOT NULL,
  serie_origen TEXT,
  fecha DATE,
  fecha_vencimiento DATE,
  cliente_cif TEXT,
  cliente_nombre TEXT NOT NULL,
  total NUMERIC(14,2) NOT NULL,
  cobrado_origen NUMERIC(14,2),
  saldo_pendiente NUMERIC(14,2) NOT NULL,
  notas TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id, source_system, source_id)
);
CREATE INDEX IF NOT EXISTS idx_import_saldos_empresa_vencimiento ON import_saldos_pendientes(empresa_id, fecha_vencimiento);

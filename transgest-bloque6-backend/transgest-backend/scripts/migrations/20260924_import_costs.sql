-- Costes importados: los agregados no se transforman en repostajes ficticios.
CREATE TABLE IF NOT EXISTS gastos_operativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  subtipo TEXT,
  proveedor TEXT,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL,
  periodo_desde DATE,
  periodo_hasta DATE,
  fecha DATE,
  pais TEXT,
  importe NUMERIC(14,2) NOT NULL,
  iva_pct NUMERIC(7,3),
  referencia TEXT,
  notas TEXT,
  source_system TEXT,
  source_id TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT gastos_operativos_tipo_import CHECK (tipo IN (
    'peaje','combustible_agregado','parking','ferry','adblue','dieta','lavado',
    'recambios','mantenimiento','renting_leasing','itv','otros_costes_flota')),
  CONSTRAINT gastos_operativos_periodo_import CHECK (periodo_desde IS NULL OR periodo_hasta IS NULL OR periodo_desde <= periodo_hasta)
);
CREATE INDEX IF NOT EXISTS idx_gastos_operativos_empresa_fecha ON gastos_operativos(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_gastos_operativos_empresa_vehiculo ON gastos_operativos(empresa_id, vehiculo_id, periodo_desde);

CREATE TABLE IF NOT EXISTS vehiculo_repostajes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  fecha DATE NOT NULL,
  litros NUMERIC(10,2) NOT NULL DEFAULT 0,
  precio_litro NUMERIC(10,4),
  importe NUMERIC(10,2),
  km_odometro NUMERIC(12,2),
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE vehiculo_repostajes ADD COLUMN IF NOT EXISTS hora TIME;
ALTER TABLE vehiculo_repostajes ADD COLUMN IF NOT EXISTS proveedor TEXT;
ALTER TABLE vehiculo_repostajes ADD COLUMN IF NOT EXISTS referencia TEXT;
ALTER TABLE vehiculo_repostajes ADD COLUMN IF NOT EXISTS import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_import_repostajes_empresa_fecha ON vehiculo_repostajes(empresa_id, fecha DESC);

-- El módulo actual representa presupuestos/recurrentes. Los movimientos
-- históricos reales se almacenan aparte para no alterar su reparto mensual.
CREATE TABLE IF NOT EXISTS gastos_estructura_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  tipo TEXT,
  importe NUMERIC(14,2) NOT NULL,
  periodo TEXT,
  fecha DATE NOT NULL,
  notas TEXT,
  source_system TEXT,
  source_id TEXT,
  import_batch_id UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_import_estructura_empresa_fecha ON gastos_estructura_movimientos(empresa_id, fecha DESC);

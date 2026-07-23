CREATE TABLE IF NOT EXISTS gps_integraciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  proveedor VARCHAR(80) NOT NULL,
  nombre VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT false,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ultimo_sync TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gps_integraciones_empresa ON gps_integraciones(empresa_id, activo);

CREATE TABLE IF NOT EXISTS puntos_interes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  nombre VARCHAR(180) NOT NULL,
  cif VARCHAR(40),
  direccion TEXT NOT NULL,
  codigo_postal VARCHAR(20),
  ciudad VARCHAR(120),
  provincia VARCHAR(120),
  pais VARCHAR(80) DEFAULT 'Espana',
  lat NUMERIC(11,8),
  lng NUMERIC(11,8),
  tipo VARCHAR(30) NOT NULL DEFAULT 'ambos',
  ventana VARCHAR(120),
  contacto_nombre VARCHAR(120),
  contacto_telefono VARCHAR(60),
  email VARCHAR(180),
  notas TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP INDEX IF EXISTS idx_puntos_interes_empresa_dir;
DROP INDEX IF EXISTS idx_puntos_interes_empresa_cliente_dir;
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        empresa_id,
        COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid),
        LOWER(TRIM(direccion))
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST, id DESC
    ) AS rn
  FROM puntos_interes
  WHERE activo=true
    AND COALESCE(TRIM(direccion), '') <> ''
)
UPDATE puntos_interes p
   SET activo=false,
       updated_at=NOW(),
       notas=CONCAT_WS(E'\n', NULLIF(p.notas, ''), 'Duplicado desactivado automaticamente al normalizar puntos por cliente.')
  FROM ranked r
 WHERE p.id=r.id
   AND r.rn > 1;
-- Unicidad por (empresa, cliente, direccion): cada cliente puede tener su propia
-- copia de una misma direccion; cliente_id NULL = punto general compartido.
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cli_dir ON puntos_interes(empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion))) WHERE activo=true;
CREATE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cliente ON puntos_interes(empresa_id, cliente_id) WHERE activo=true;
CREATE INDEX IF NOT EXISTS idx_puntos_interes_empresa_nombre ON puntos_interes(empresa_id, LOWER(nombre)) WHERE activo=true;

CREATE TABLE IF NOT EXISTS almacenes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(160) NOT NULL,
  tipo VARCHAR(50) NOT NULL DEFAULT 'general',
  direccion TEXT,
  lat NUMERIC(11,8),
  lng NUMERIC(11,8),
  responsable VARCHAR(160),
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_almacenes_empresa_nombre ON almacenes(empresa_id, LOWER(TRIM(nombre))) WHERE activo=true;

CREATE TABLE IF NOT EXISTS almacen_mercancias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id UUID REFERENCES almacenes(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  origen VARCHAR(30) NOT NULL DEFAULT 'propia',
  nombre VARCHAR(180) NOT NULL,
  sku VARCHAR(80),
  lote VARCHAR(80),
  unidad VARCHAR(30) NOT NULL DEFAULT 'unidad',
  stock_actual NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
  precio_compra NUMERIC(12,4) NOT NULL DEFAULT 0,
  precio_venta NUMERIC(12,4) NOT NULL DEFAULT 0,
  margen_objetivo_pct NUMERIC(6,2) NOT NULL DEFAULT 0,
  aviso_dias INTEGER,
  fecha_caducidad DATE,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_almacen_mercancias_empresa ON almacen_mercancias(empresa_id, almacen_id, cliente_id) WHERE activo=true;

CREATE TABLE IF NOT EXISTS almacen_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id UUID REFERENCES almacenes(id) ON DELETE SET NULL,
  mercancia_id UUID REFERENCES almacen_mercancias(id) ON DELETE SET NULL,
  cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_origen_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_destino_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  tipo VARCHAR(50) NOT NULL,
  cantidad NUMERIC(12,3) NOT NULL,
  unidad VARCHAR(30) NOT NULL DEFAULT 'unidad',
  precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
  num_albaran VARCHAR(100),
  pedido_ref VARCHAR(120),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  notas TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_almacen_movimientos_empresa_fecha ON almacen_movimientos(empresa_id, fecha DESC);

CREATE TABLE IF NOT EXISTS palets_movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id UUID REFERENCES almacenes(id) ON DELETE SET NULL,
  propietario_cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  cliente_movimiento_id UUID REFERENCES clientes(id) ON DELETE SET NULL,
  tipo VARCHAR(40) NOT NULL,
  cantidad INTEGER NOT NULL,
  precio_unitario NUMERIC(10,2) NOT NULL DEFAULT 0,
  num_albaran VARCHAR(100),
  pedido_ref VARCHAR(120),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  notas TEXT,
  factura_id UUID REFERENCES facturas(id) ON DELETE SET NULL,
  estado_salida VARCHAR(30) NOT NULL DEFAULT 'confirmada',
  salida_confirmada_at TIMESTAMPTZ,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_palets_movimientos_empresa_fecha ON palets_movimientos(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_palets_movimientos_propietario ON palets_movimientos(propietario_cliente_id, fecha DESC);

CREATE TABLE IF NOT EXISTS taller_piezas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  almacen_id UUID REFERENCES almacenes(id) ON DELETE SET NULL,
  proveedor VARCHAR(180),
  nombre VARCHAR(180) NOT NULL,
  referencia VARCHAR(100),
  codigo_barras VARCHAR(120),
  categoria VARCHAR(80),
  stock_actual NUMERIC(12,3) NOT NULL DEFAULT 0,
  stock_minimo NUMERIC(12,3) NOT NULL DEFAULT 0,
  precio_compra NUMERIC(12,4) NOT NULL DEFAULT 0,
  etiqueta_tamano VARCHAR(40) DEFAULT '50x25',
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_taller_piezas_barcode ON taller_piezas(empresa_id, codigo_barras) WHERE codigo_barras IS NOT NULL AND activo=true;

CREATE TABLE IF NOT EXISTS taller_intervenciones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  tipo VARCHAR(80) NOT NULL,
  descripcion TEXT,
  km_en_intervencion INTEGER,
  taller_externo VARCHAR(180),
  coste_mano_obra NUMERIC(12,2) NOT NULL DEFAULT 0,
  coste_total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'abierta',
  gerente_autorizo_sin_pieza UUID,
  cierre_definitivo_at TIMESTAMPTZ,
  notas TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_taller_intervenciones_empresa_fecha ON taller_intervenciones(empresa_id, fecha DESC);

CREATE TABLE IF NOT EXISTS taller_intervencion_piezas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intervencion_id UUID NOT NULL REFERENCES taller_intervenciones(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  pieza_id UUID REFERENCES taller_piezas(id) ON DELETE SET NULL,
  codigo_barras VARCHAR(120),
  cantidad NUMERIC(12,3) NOT NULL DEFAULT 1,
  precio_unitario NUMERIC(12,4) NOT NULL DEFAULT 0,
  escaneado BOOLEAN NOT NULL DEFAULT false,
  pendiente_asignar BOOLEAN NOT NULL DEFAULT false,
  autorizado_por UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_taller_intervencion_piezas_intervencion ON taller_intervencion_piezas(intervencion_id);

CREATE TABLE IF NOT EXISTS taller_neumaticos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  codigo_barras VARCHAR(120),
  marca VARCHAR(120),
  modelo VARCHAR(120),
  medida VARCHAR(80) NOT NULL,
  lote VARCHAR(80),
  precio_compra NUMERIC(12,4) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'stock',
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  posicion VARCHAR(40),
  km_montaje INTEGER,
  fecha_montaje DATE,
  fecha_baja DATE,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_taller_neumaticos_barcode ON taller_neumaticos(empresa_id, codigo_barras) WHERE codigo_barras IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_taller_neumaticos_empresa_estado ON taller_neumaticos(empresa_id, estado, medida);

CREATE TABLE IF NOT EXISTS colaborador_facturas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  referencia_orden VARCHAR(120),
  numero_factura VARCHAR(120),
  fecha DATE NOT NULL DEFAULT CURRENT_DATE,
  vencimiento DATE,
  base NUMERIC(12,2) NOT NULL DEFAULT 0,
  iva_pct NUMERIC(6,2) NOT NULL DEFAULT 21,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(40) NOT NULL DEFAULT 'pendiente',
  archivo_base64 TEXT,
  archivo_mime VARCHAR(120),
  notas TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_colaborador_facturas_empresa_ref ON colaborador_facturas(empresa_id, referencia_orden);
CREATE INDEX IF NOT EXISTS idx_colaborador_facturas_colaborador ON colaborador_facturas(colaborador_id, fecha DESC);

CREATE TABLE IF NOT EXISTS cuadrante_filtros (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(100) NOT NULL,
  tipo VARCHAR(60) NOT NULL DEFAULT 'personalizado',
  criterios JSONB NOT NULL DEFAULT '{}'::jsonb,
  orden INTEGER NOT NULL DEFAULT 0,
  visible BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cuadrante_filtros_empresa ON cuadrante_filtros(empresa_id, visible, orden);

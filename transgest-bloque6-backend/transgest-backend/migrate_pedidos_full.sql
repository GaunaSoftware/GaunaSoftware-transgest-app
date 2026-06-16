-- Columns that may be missing from pedidos table
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_ruta INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_vacio INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_descarga TIME;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ventana_carga VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ventana_descarga VARCHAR(20);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chofer2_id UUID REFERENCES choferes(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS volumen NUMERIC(10,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_precio VARCHAR(30) DEFAULT 'viaje';
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS extracostes_importe NUMERIC(10,2) DEFAULT 0;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reparto_chofer1 INTEGER DEFAULT 50;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS referencia_cliente VARCHAR(100);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula VARCHAR(20);
-- Vehiculos columns
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS chofer_id UUID REFERENCES choferes(id) ON DELETE SET NULL;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS clase VARCHAR(100);
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL;
-- Clientes columns
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS pendiente_revision BOOLEAN DEFAULT false;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS calle VARCHAR(200);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS num_ext VARCHAR(20);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10);
-- Tables that may be missing
CREATE TABLE IF NOT EXISTS chofer_vehiculo_historial (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  matricula VARCHAR(20), remolque_mat VARCHAR(20),
  tipo VARCHAR(30) DEFAULT 'pedido',
  fecha TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  empresa_id UUID
);
CREATE TABLE IF NOT EXISTS chofer_tractora_periodos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  remolque_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  empresa_id UUID, fecha_inicio DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_fin DATE, matricula VARCHAR(20), remolque_mat VARCHAR(20), notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS pedido_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id UUID, nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(50) NOT NULL DEFAULT 'otro',
  file_base64 TEXT, file_mime VARCHAR(50) NOT NULL DEFAULT 'application/pdf',
  file_size_kb INTEGER, notas TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
SELECT 'Migración pedidos_full OK' AS resultado;

-- Horarios de carga/descarga en clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_carga VARCHAR(30);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS horario_descarga VARCHAR(30);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_facturacion VARCHAR(150);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS iban VARCHAR(50);

-- Índices para mejorar velocidad de facturas
CREATE INDEX IF NOT EXISTS idx_facturas_empresa_estado ON facturas(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa_fecha  ON facturas(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente        ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_estado  ON pedidos(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_vehiculo        ON pedidos(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_chofer          ON pedidos(chofer_id);

SELECT 'Índices y columnas adicionales OK' AS resultado;

-- Colaboradores: campos adicionales
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS calle VARCHAR(200);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS num_ext VARCHAR(20);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS ciudad VARCHAR(100);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS provincia VARCHAR(100);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_nombre VARCHAR(150);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS contacto_telefono VARCHAR(30);
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS forma_pago VARCHAR(50) DEFAULT 'Transferencia bancaria';

SELECT 'Colaboradores campos adicionales OK' AS resultado;

-- chofer_config: añadir incentivo_pct si no existe
ALTER TABLE chofer_config ADD COLUMN IF NOT EXISTS incentivo_pct NUMERIC(5,2) DEFAULT 0;

-- vehiculo_repostajes: precio_litro puede venir del modal de litros
ALTER TABLE vehiculo_repostajes ADD COLUMN IF NOT EXISTS precio_litro NUMERIC(6,3);

SELECT 'chofer_config y repostajes OK' AS resultado;

-- Múltiples descargas por pedido
CREATE TABLE IF NOT EXISTS pedido_descargas (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id    UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id   UUID NOT NULL,
  direccion    VARCHAR(300),
  cliente_nombre VARCHAR(200),
  fecha_descarga DATE,
  hora_descarga  VARCHAR(10),
  ventana_inicio VARCHAR(10),
  ventana_fin    VARCHAR(10),
  bultos       INTEGER,
  peso_kg      NUMERIC(10,2),
  precio       NUMERIC(10,2) DEFAULT 0,
  notas        TEXT,
  orden        INTEGER DEFAULT 0,
  entregado    BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pedido_descargas_pedido ON pedido_descargas(pedido_id);

-- Grupaje: tipo de carga en pedido
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tipo_carga VARCHAR(20) DEFAULT 'completa'; -- completa | grupaje
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS grupaje_id UUID; -- vincular pedidos de grupaje

-- Grupajes: conjunto de pedidos agrupados
CREATE TABLE IF NOT EXISTS grupajes (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id   UUID NOT NULL,
  nombre       VARCHAR(200),
  vehiculo_id  UUID,
  chofer_id    UUID,
  fecha        DATE,
  estado       VARCHAR(30) DEFAULT 'pendiente',
  metros_libres NUMERIC(5,2),
  kg_disponible NUMERIC(8,2),
  notas        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_grupajes_empresa ON grupajes(empresa_id);

SELECT 'descargas, tipo_carga, grupajes OK' AS resultado;

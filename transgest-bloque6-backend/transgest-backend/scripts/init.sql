-- ══════════════════════════════════════════════════════════════
-- TRANSGEST TMS — Esquema PostgreSQL completo
-- ══════════════════════════════════════════════════════════════

-- Extensiones
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- Búsqueda fuzzy

-- ─────────────────────────────────────────────────────────────
-- USUARIOS Y ROLES
-- ─────────────────────────────────────────────────────────────
CREATE TYPE rol_usuario AS ENUM ('gerente','contable','trafico','visualizador','chofer','cliente');

CREATE TABLE usuarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  rol           rol_usuario  NOT NULL DEFAULT 'visualizador',
  activo        BOOLEAN      NOT NULL DEFAULT true,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- CLIENTES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE clientes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(200) NOT NULL,
  cif             VARCHAR(60)  NOT NULL UNIQUE,
  direccion       VARCHAR(300),
  cp              VARCHAR(20),
  ciudad          VARCHAR(100),
  pais            VARCHAR(100) DEFAULT 'España',
  email           VARCHAR(150),
  contacto        VARCHAR(100),
  telefono        VARCHAR(80),
  forma_pago      VARCHAR(80)  DEFAULT 'Transferencia bancaria',
  vencimiento     VARCHAR(80)  DEFAULT '30 días',
  tipo_iva        SMALLINT     NOT NULL DEFAULT 21,
  tipo_irpf       SMALLINT     NOT NULL DEFAULT 0,
  precio_tn_km    NUMERIC(8,4) DEFAULT 0,
  activo          BOOLEAN      NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Índice para búsqueda full-text (nombre, cif)
CREATE INDEX idx_clientes_nombre_trgm ON clientes USING gin(nombre gin_trgm_ops);
CREATE INDEX idx_clientes_cif         ON clientes(cif);

-- ─────────────────────────────────────────────────────────────
-- VEHÍCULOS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE estado_vehiculo AS ENUM ('disponible','en_ruta','taller','baja');

CREATE TABLE vehiculos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricula       VARCHAR(20)  NOT NULL UNIQUE,
  marca           VARCHAR(50),
  modelo          VARCHAR(50),
  año             SMALLINT,
  tipo            VARCHAR(50)  DEFAULT 'Camión',
  tara_kg         INTEGER,
  carga_max_kg    INTEGER,
  estado          estado_vehiculo NOT NULL DEFAULT 'disponible',
  km_actuales     INTEGER DEFAULT 0,
  activo          BOOLEAN NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- CHOFERES
-- ─────────────────────────────────────────────────────────────
CREATE TABLE choferes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(100) NOT NULL,
  dni             VARCHAR(20)  UNIQUE,
  telefono        VARCHAR(30),
  email           VARCHAR(150),
  vehiculo_id     UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  categoria_carnet VARCHAR(10) DEFAULT 'C+E',
  activo          BOOLEAN NOT NULL DEFAULT true,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- RUTAS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE rutas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origen      VARCHAR(100) NOT NULL,
  destino     VARCHAR(100) NOT NULL,
  km          INTEGER      NOT NULL,
  peajes      NUMERIC(8,2) DEFAULT 0,
  tiempo_h    NUMERIC(5,2),
  activa      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Precios negociados por cliente y ruta (tabla pivote)
CREATE TABLE ruta_precios_cliente (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ruta_id     UUID NOT NULL REFERENCES rutas(id)    ON DELETE CASCADE,
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  precio      NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE (ruta_id, cliente_id)
);

-- Repartos por ruta
CREATE TABLE ruta_repartos (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ruta_id     UUID NOT NULL REFERENCES rutas(id)    ON DELETE CASCADE,
  cliente_id  UUID          REFERENCES clientes(id) ON DELETE SET NULL,
  lugar       VARCHAR(200),
  precio      NUMERIC(10,2) NOT NULL DEFAULT 0,
  orden       SMALLINT DEFAULT 0
);

-- ─────────────────────────────────────────────────────────────
-- PEDIDOS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE estado_pedido AS ENUM (
  'pendiente','confirmado','en_curso','descarga','entregado','cancelado','incidencia'
);

CREATE TABLE pedidos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  numero          VARCHAR(20)  NOT NULL UNIQUE,   -- PED-2025-0001
  cliente_id      UUID NOT NULL REFERENCES clientes(id),
  ruta_id         UUID         REFERENCES rutas(id),
  vehiculo_id     UUID         REFERENCES vehiculos(id),
  chofer_id       UUID         REFERENCES choferes(id),
  origen          VARCHAR(100),
  destino         VARCHAR(100),
  fecha_pedido    DATE         NOT NULL DEFAULT CURRENT_DATE,
  fecha_carga     DATE,
  hora_carga      TIME,
  fecha_entrega   DATE,
  mercancia       VARCHAR(200),
  peso_kg         INTEGER,
  bultos          INTEGER,
  importe         NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado          estado_pedido NOT NULL DEFAULT 'pendiente',
  factura_id      UUID,         -- Se rellena al facturar (FK circular, se añade luego)
  notas           TEXT,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Extracostes de pedido
CREATE TABLE pedido_extracostes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id   UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo        VARCHAR(30)  NOT NULL DEFAULT 'otro',
  concepto    VARCHAR(200) NOT NULL,
  importe     NUMERIC(8,2) NOT NULL
);

CREATE INDEX idx_pedidos_cliente    ON pedidos(cliente_id);
CREATE INDEX idx_pedidos_estado     ON pedidos(estado);
CREATE INDEX idx_pedidos_fecha      ON pedidos(fecha_pedido DESC);

-- ─────────────────────────────────────────────────────────────
-- FACTURAS
-- ─────────────────────────────────────────────────────────────
CREATE TYPE serie_factura  AS ENUM ('A','B','R','G');
CREATE TYPE estado_factura AS ENUM ('borrador','emitida','enviada','cobrada','vencida','rectificada');

CREATE TABLE facturas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  serie           serie_factura  NOT NULL DEFAULT 'A',
  numero          VARCHAR(20)    NOT NULL UNIQUE,  -- A-2025-0001
  cliente_id      UUID NOT NULL REFERENCES clientes(id),
  fecha           DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  estado          estado_factura NOT NULL DEFAULT 'borrador',
  forma_pago      VARCHAR(50),
  vencimiento     VARCHAR(80),
  observaciones   TEXT,
  notas_internas  TEXT,
  -- Totales calculados (desnormalizado para velocidad)
  base_imponible  NUMERIC(12,2) NOT NULL DEFAULT 0,
  tipo_iva        SMALLINT      NOT NULL DEFAULT 21,
  cuota_iva       NUMERIC(12,2) NOT NULL DEFAULT 0,
  tipo_irpf       SMALLINT      NOT NULL DEFAULT 0,
  cuota_irpf      NUMERIC(12,2) NOT NULL DEFAULT 0,
  total           NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_by      UUID          REFERENCES usuarios(id),
  updated_by      UUID          REFERENCES usuarios(id),
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- Líneas de factura
CREATE TABLE factura_lineas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id  UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  concepto    VARCHAR(300) NOT NULL,
  cantidad    NUMERIC(8,2) NOT NULL DEFAULT 1,
  precio_unit NUMERIC(10,2) NOT NULL DEFAULT 0,
  importe     NUMERIC(12,2) GENERATED ALWAYS AS (cantidad * precio_unit) STORED,
  orden       SMALLINT DEFAULT 0
);

-- Extracostes de factura
CREATE TABLE factura_extracostes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id  UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  tipo        VARCHAR(30)  NOT NULL DEFAULT 'otro',
  concepto    VARCHAR(200) NOT NULL,
  importe     NUMERIC(8,2) NOT NULL
);

-- Relación factura ↔ pedidos (N:M)
CREATE TABLE factura_pedidos (
  factura_id  UUID NOT NULL REFERENCES facturas(id)  ON DELETE CASCADE,
  pedido_id   UUID NOT NULL REFERENCES pedidos(id)   ON DELETE CASCADE,
  PRIMARY KEY (factura_id, pedido_id)
);

-- FK circular pedidos → facturas
ALTER TABLE pedidos ADD CONSTRAINT fk_pedido_factura
  FOREIGN KEY (factura_id) REFERENCES facturas(id) ON DELETE SET NULL;

CREATE INDEX idx_facturas_cliente ON facturas(cliente_id);
CREATE INDEX idx_facturas_estado  ON facturas(estado);
CREATE INDEX idx_facturas_fecha   ON facturas(fecha DESC);

-- ─────────────────────────────────────────────────────────────
-- COLABORADORES
-- ─────────────────────────────────────────────────────────────
CREATE TYPE tipo_colaborador AS ENUM ('autonomo','empresa');

CREATE TABLE colaboradores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tipo        tipo_colaborador NOT NULL DEFAULT 'autonomo',
  nombre      VARCHAR(200) NOT NULL,
  cif         VARCHAR(20)  UNIQUE,
  email       VARCHAR(150),
  telefono    VARCHAR(30),
  iban        VARCHAR(34),
  valoracion  SMALLINT DEFAULT 5 CHECK (valoracion BETWEEN 1 AND 5),
  activo      BOOLEAN NOT NULL DEFAULT true,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- DOCUMENTOS (vehículos y choferes)
-- ─────────────────────────────────────────────────────────────
CREATE TYPE tipo_doc_vehiculo AS ENUM ('itv','seguro','tacografo','tarjeta_transporte','permiso_circulacion','otro');
CREATE TYPE tipo_doc_chofer   AS ENUM ('permiso','cap','tarjeta_tacografo','reconocimiento','adr','otro');

CREATE TABLE docs_vehiculos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id     UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  tipo            tipo_doc_vehiculo NOT NULL,
  descripcion     VARCHAR(200),
  fecha_emision   DATE,
  fecha_vencimiento DATE,
  referencia      VARCHAR(100),
  alerta_dias     SMALLINT DEFAULT 30,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE docs_choferes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id       UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  tipo            tipo_doc_chofer NOT NULL,
  descripcion     VARCHAR(200),
  fecha_emision   DATE,
  fecha_vencimiento DATE,
  referencia      VARCHAR(100),
  alerta_dias     SMALLINT DEFAULT 30,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- LOG DE EMAILS ENVIADOS
-- ─────────────────────────────────────────────────────────────
CREATE TABLE email_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  trigger     VARCHAR(50),
  destinatario VARCHAR(150) NOT NULL,
  asunto      VARCHAR(300),
  estado      VARCHAR(20)  DEFAULT 'enviado',
  error       TEXT,
  sent_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────
-- AUDIT LOG (cambios de estado de facturas)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID         REFERENCES empresas(id),
  tabla       VARCHAR(50)  NOT NULL,
  registro_id UUID         NOT NULL,
  campo       VARCHAR(50),
  valor_antes TEXT,
  valor_nuevo TEXT,
  usuario_id  UUID         REFERENCES usuarios(id),
  ip          INET,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_registro ON audit_log(tabla, registro_id);
CREATE INDEX idx_audit_empresa_registro ON audit_log(empresa_id, tabla, registro_id);
CREATE INDEX idx_audit_fecha    ON audit_log(created_at DESC);

-- ─────────────────────────────────────────────────────────────
-- FUNCIÓN: updated_at automático
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Aplicar trigger a todas las tablas con updated_at
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios','clientes','vehiculos','choferes','rutas','pedidos','facturas','colaboradores']
  LOOP
    EXECUTE format('CREATE TRIGGER trg_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION set_updated_at()', t, t);
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- VISTA: documentos próximos a vencer
-- ─────────────────────────────────────────────────────────────
CREATE VIEW v_docs_proximos_vencer AS
  SELECT 'vehiculo' AS tipo_entidad, v.matricula AS entidad,
         d.tipo::text, d.fecha_vencimiento,
         (d.fecha_vencimiento - CURRENT_DATE) AS dias_restantes
  FROM docs_vehiculos d JOIN vehiculos v ON v.id = d.vehiculo_id
  WHERE d.fecha_vencimiento IS NOT NULL
    AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
UNION ALL
  SELECT 'chofer', c.nombre, d.tipo::text, d.fecha_vencimiento,
         (d.fecha_vencimiento - CURRENT_DATE)
  FROM docs_choferes d JOIN choferes c ON c.id = d.chofer_id
  WHERE d.fecha_vencimiento IS NOT NULL
    AND d.fecha_vencimiento <= CURRENT_DATE + INTERVAL '60 days'
ORDER BY dias_restantes ASC;

-- ─────────────────────────────────────────────────────────────
-- VISTA: resumen facturación por cliente
-- ─────────────────────────────────────────────────────────────
CREATE VIEW v_resumen_clientes AS
SELECT
  c.id, c.nombre, c.cif,
  COUNT(f.id)                                   AS total_facturas,
  COALESCE(SUM(f.base_imponible),0)             AS base_total,
  COALESCE(SUM(f.total),0)                      AS facturado_total,
  COALESCE(SUM(CASE WHEN f.estado='cobrada' THEN f.total ELSE 0 END),0) AS cobrado,
  COALESCE(SUM(CASE WHEN f.estado IN ('emitida','enviada') THEN f.total ELSE 0 END),0) AS pendiente
FROM clientes c
LEFT JOIN facturas f ON f.cliente_id = c.id
GROUP BY c.id, c.nombre, c.cif;

-- ══════════════════════════════════════════════════════════════════════════
-- TRANSGEST TMS PRO — Script de instalación completa
-- Versión: 1.0  |  Fecha: 2025
-- 
-- USO EN INSTALACIÓN NUEVA:
--   psql -U transgest_user -d transgest -f install_completo.sql
--
-- USO EN ACTUALIZACIÓN (base existente):
--   Todas las sentencias usan IF NOT EXISTS / ON CONFLICT
--   Es seguro ejecutar varias veces sin romper datos existentes
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- EXTENSIONES
-- ─────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ─────────────────────────────────────────────────────────────────────────
-- TIPOS ENUM
-- ─────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE rol_usuario AS ENUM ('gerente','contable','trafico','visualizador','chofer','cliente');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_vehiculo AS ENUM ('disponible','en_ruta','taller','baja');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_pedido AS ENUM (
    'pendiente','confirmado','en_curso','descarga','entregado','cancelado','incidencia'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE serie_factura AS ENUM ('A','B','R','G');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE estado_factura AS ENUM ('borrador','emitida','enviada','cobrada','vencida','rectificada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_colaborador AS ENUM ('autonomo','empresa');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_doc_vehiculo AS ENUM ('itv','seguro','tacografo','tarjeta_transporte','permiso_circulacion','otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE tipo_doc_chofer AS ENUM ('permiso','cap','tarjeta_tacografo','reconocimiento','adr','otro');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: empresas (multi-tenant)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS empresas (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre            VARCHAR(200) NOT NULL,
  cif               VARCHAR(20),
  email_admin       VARCHAR(200) NOT NULL UNIQUE,
  dominio           VARCHAR(100) UNIQUE,
  plan              VARCHAR(20)  NOT NULL DEFAULT 'basico',
  estado            VARCHAR(20)  NOT NULL DEFAULT 'activo',
  max_vehiculos     INTEGER      NOT NULL DEFAULT 5,
  max_usuarios      INTEGER      NOT NULL DEFAULT 3,
  fecha_registro    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ,
  configuracion     JSONB        NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: planes y precios
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planes (
  id            VARCHAR(20) PRIMARY KEY,
  nombre        VARCHAR(100) NOT NULL,
  precio_mes    NUMERIC(8,2) NOT NULL,
  max_vehiculos INTEGER NOT NULL,
  max_usuarios  INTEGER NOT NULL,
  features      JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO planes VALUES
  ('basico',      'Básico',       49.00,  3,  2, '["pedidos","facturacion","vehiculos"]'),
  ('profesional', 'Profesional', 149.00, 10,  5, '["pedidos","facturacion","vehiculos","choferes","informes","hojas_ruta","tarifas"]'),
  ('enterprise',  'Enterprise',  249.00, 50, 20, '["todo"]')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: superadmins
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS superadmins (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  nombre        VARCHAR(200),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: usuarios
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre        VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  rol           rol_usuario  NOT NULL DEFAULT 'trafico',
  activo        BOOLEAN      NOT NULL DEFAULT true,
  empresa_id    UUID         REFERENCES empresas(id) ON DELETE CASCADE,
  ultimo_acceso TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa ON usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_usuarios_email   ON usuarios(email);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: clientes
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clientes (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id          UUID         REFERENCES empresas(id) ON DELETE CASCADE,
  nombre              VARCHAR(200) NOT NULL,
  cif                 VARCHAR(60),
  -- Contacto
  email               VARCHAR(150),
  telefono            VARCHAR(80),
  web                 VARCHAR(150),
  contacto            VARCHAR(100),  -- nombre persona contacto (legacy)
  contacto_nombre     VARCHAR(100),
  contacto_telefono   VARCHAR(80),
  -- Dirección social desglosada
  direccion           VARCHAR(300),  -- campo legacy (texto libre)
  calle               VARCHAR(200),
  num_ext             VARCHAR(30),
  piso_puerta         VARCHAR(20),
  cod_postal          VARCHAR(20),
  municipio           VARCHAR(100),
  provincia           VARCHAR(100),
  pais_iso            VARCHAR(3)   DEFAULT 'ES',
  cp                  VARCHAR(20),   -- legacy
  ciudad              VARCHAR(100),  -- legacy
  pais                VARCHAR(100)   DEFAULT 'España',
  -- Dirección fiscal (si es distinta)
  dir_fiscal_distinta BOOLEAN DEFAULT false,
  fiscal_calle        VARCHAR(200),
  fiscal_num_ext      VARCHAR(30),
  fiscal_piso_puerta  VARCHAR(20),
  fiscal_cod_postal   VARCHAR(20),
  fiscal_municipio    VARCHAR(100),
  fiscal_provincia    VARCHAR(100),
  fiscal_pais_iso     VARCHAR(3) DEFAULT 'ES',
  -- Facturación
  forma_pago          VARCHAR(80)  DEFAULT 'Transferencia bancaria',
  dias_pago           INTEGER      DEFAULT 30,
  vencimiento         VARCHAR(80)  DEFAULT '30 días',
  tipo_iva            SMALLINT     NOT NULL DEFAULT 21,
  tipo_irpf           SMALLINT     NOT NULL DEFAULT 0,
  iban                VARCHAR(34),
  email_facturas      VARCHAR(150),
  dir_envio_facturas  VARCHAR(300),
  modo_facturacion    VARCHAR(80)  DEFAULT 'por_viaje',
  limite_riesgo       NUMERIC(10,2) DEFAULT 0,
  -- Tarifas
  precio_tn_km        NUMERIC(8,4) DEFAULT 0,
  precio_base         NUMERIC(10,2),
  tipo_precio_defecto VARCHAR(20)  DEFAULT 'viaje',
  minimo_facturable   NUMERIC(10,2),
  descuento           NUMERIC(5,2) DEFAULT 0,
  recargo_combustible NUMERIC(5,2) DEFAULT 0,
  -- Extra
  notas               TEXT,
  activo              BOOLEAN      NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa    ON clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_nombre_trgm ON clientes USING gin(nombre gin_trgm_ops);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: vehiculos
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehiculos (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id    UUID         REFERENCES empresas(id) ON DELETE CASCADE,
  matricula     VARCHAR(20)  NOT NULL,
  marca         VARCHAR(80),
  modelo        VARCHAR(80),
  año           SMALLINT,
  tipo          VARCHAR(50)  DEFAULT 'Camión',
  clase         VARCHAR(50),
  bastidor      VARCHAR(50),
  tara_kg       NUMERIC(8,2),
  carga_max_kg  NUMERIC(8,2),
  km_actuales   INTEGER      DEFAULT 0,
  estado        estado_vehiculo NOT NULL DEFAULT 'disponible',
  activo        BOOLEAN      NOT NULL DEFAULT true,
  chofer_id     UUID,  -- FK añadida después (ref circular)
  remolque_id   UUID,  -- FK añadida después (ref circular)
  notas         TEXT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehiculos_matricula_empresa ON vehiculos(matricula, empresa_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa  ON vehiculos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_remolque ON vehiculos(remolque_id);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: choferes
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS choferes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id        UUID         REFERENCES empresas(id) ON DELETE CASCADE,
  nombre            VARCHAR(100) NOT NULL,
  apellidos         VARCHAR(100),
  dni               VARCHAR(20),
  telefono          VARCHAR(30),
  email             VARCHAR(150),
  vehiculo_id       UUID         REFERENCES vehiculos(id) ON DELETE SET NULL,
  categoria_carnet  VARCHAR(20)  DEFAULT 'C+E',
  tipo_contrato     VARCHAR(50),
  salario           NUMERIC(10,2),
  fecha_alta        DATE,
  fecha_baja        DATE,
  activo            BOOLEAN      NOT NULL DEFAULT true,
  notas             TEXT,
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_choferes_empresa ON choferes(empresa_id);

-- FKs circulares en vehiculos
ALTER TABLE vehiculos ADD CONSTRAINT IF NOT EXISTS fk_vehiculos_chofer
  FOREIGN KEY (chofer_id) REFERENCES choferes(id) ON DELETE SET NULL;
ALTER TABLE vehiculos ADD CONSTRAINT IF NOT EXISTS fk_vehiculos_remolque
  FOREIGN KEY (remolque_id) REFERENCES vehiculos(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: rutas
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rutas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  origen      VARCHAR(100) NOT NULL,
  destino     VARCHAR(100) NOT NULL,
  km          NUMERIC(8,2),
  tiempo_h    NUMERIC(5,2),
  peajes      NUMERIC(8,2) DEFAULT 0,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rutas_empresa ON rutas(empresa_id);

CREATE TABLE IF NOT EXISTS ruta_precios_cliente (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ruta_id     UUID NOT NULL REFERENCES rutas(id) ON DELETE CASCADE,
  cliente_id  UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  precio      NUMERIC(10,2),
  tipo_precio VARCHAR(20) DEFAULT 'viaje',
  activo      BOOLEAN NOT NULL DEFAULT true
);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: colaboradores
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS colaboradores (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  tipo        tipo_colaborador NOT NULL DEFAULT 'autonomo',
  nombre      VARCHAR(200) NOT NULL,
  cif         VARCHAR(20),
  email       VARCHAR(150),
  telefono    VARCHAR(30),
  iban        VARCHAR(34),
  valoracion  SMALLINT DEFAULT 5 CHECK (valoracion BETWEEN 1 AND 5),
  activo      BOOLEAN NOT NULL DEFAULT true,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_colaboradores_empresa ON colaboradores(empresa_id);

CREATE TABLE IF NOT EXISTS colaborador_vehiculos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  colaborador_id  UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  empresa_id      UUID REFERENCES empresas(id) ON DELETE CASCADE,
  matricula       VARCHAR(20) NOT NULL,
  marca           VARCHAR(80),
  modelo          VARCHAR(80),
  año             SMALLINT,
  tipo            VARCHAR(50) DEFAULT 'Camión',
  tara_kg         NUMERIC(8,2),
  carga_max_kg    NUMERIC(8,2),
  bastidor        VARCHAR(30),
  num_ejes        SMALLINT DEFAULT 2,
  longitud_m      NUMERIC(5,2),
  notas           TEXT,
  doc_tarjeta_transp  TEXT,
  doc_tarjeta_exp     DATE,
  doc_seguro_venc     DATE,
  doc_itv_venc        DATE,
  doc_tacografo_venc  DATE,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_colab_veh_colaborador ON colaborador_vehiculos(colaborador_id);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: pedidos
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pedidos (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id          UUID         REFERENCES empresas(id) ON DELETE CASCADE,
  numero              VARCHAR(20)  NOT NULL UNIQUE,
  cliente_id          UUID NOT NULL REFERENCES clientes(id),
  ruta_id             UUID         REFERENCES rutas(id),
  vehiculo_id         UUID         REFERENCES vehiculos(id) ON DELETE SET NULL,
  vehiculo_id2        UUID         REFERENCES vehiculos(id) ON DELETE SET NULL,
  remolque_id         UUID         REFERENCES vehiculos(id) ON DELETE SET NULL,
  remolque_matricula  VARCHAR(20),
  chofer_id           UUID         REFERENCES choferes(id) ON DELETE SET NULL,
  chofer2_id          UUID         REFERENCES choferes(id) ON DELETE SET NULL,
  reparto_chofer1     INTEGER      DEFAULT 50,
  colaborador_id      UUID         REFERENCES colaboradores(id) ON DELETE SET NULL,
  colaborador_nombre  VARCHAR(200),
  precio_colaborador  NUMERIC(10,2),
  precio_cliente_col  NUMERIC(10,2),
  origen              VARCHAR(100),
  destino             VARCHAR(100),
  fecha_pedido        DATE         NOT NULL DEFAULT CURRENT_DATE,
  fecha_carga         DATE,
  hora_carga          TIME,
  fecha_entrega       DATE,
  hora_descarga       TIME,
  mercancia           VARCHAR(200),
  peso_kg             INTEGER,
  bultos              INTEGER,
  importe             NUMERIC(10,2) NOT NULL DEFAULT 0,
  estado              estado_pedido NOT NULL DEFAULT 'pendiente',
  km_ruta             INTEGER,
  km_vacio            INTEGER,
  ultima_posicion     VARCHAR(200),
  posicion_ts         TIMESTAMPTZ,
  factura_id          UUID,
  notas               TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa  ON pedidos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON pedidos(cliente_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_estado   ON pedidos(estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_fecha    ON pedidos(fecha_pedido DESC);

CREATE TABLE IF NOT EXISTS pedido_extracostes (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id  UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  tipo       VARCHAR(30)  NOT NULL DEFAULT 'otro',
  concepto   VARCHAR(200) NOT NULL,
  importe    NUMERIC(8,2) NOT NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: facturas
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id        UUID REFERENCES empresas(id) ON DELETE CASCADE,
  numero            VARCHAR(20)  NOT NULL UNIQUE,
  serie             serie_factura NOT NULL DEFAULT 'A',
  cliente_id        UUID NOT NULL REFERENCES clientes(id),
  fecha             DATE         NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  estado            estado_factura NOT NULL DEFAULT 'emitida',
  base_imponible    NUMERIC(10,2) NOT NULL DEFAULT 0,
  tipo_iva          SMALLINT     NOT NULL DEFAULT 21,
  cuota_iva         NUMERIC(10,2) NOT NULL DEFAULT 0,
  total             NUMERIC(10,2) NOT NULL DEFAULT 0,
  forma_pago        VARCHAR(50),
  observaciones     TEXT,
  factura_orig_id   UUID         REFERENCES facturas(id),
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa ON facturas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente ON facturas(cliente_id);
CREATE INDEX IF NOT EXISTS idx_facturas_estado  ON facturas(estado);
CREATE INDEX IF NOT EXISTS idx_facturas_fecha   ON facturas(fecha DESC);

CREATE TABLE IF NOT EXISTS factura_lineas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  factura_id  UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  concepto    VARCHAR(300) NOT NULL,
  cantidad    NUMERIC(8,2) NOT NULL DEFAULT 1,
  precio_unit NUMERIC(10,2) NOT NULL,
  importe     NUMERIC(10,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS factura_pedidos (
  factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
  pedido_id  UUID NOT NULL REFERENCES pedidos(id),
  PRIMARY KEY (factura_id, pedido_id)
);

-- FK circular pedidos → facturas
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS facturado BOOLEAN DEFAULT false;

-- ─────────────────────────────────────────────────────────────────────────
-- TABLAS: documentos
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS docs_vehiculos (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id       UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  empresa_id        UUID REFERENCES empresas(id) ON DELETE CASCADE,
  tipo_doc          VARCHAR(60) NOT NULL,
  fecha_emision     DATE,
  fecha_vencimiento DATE,
  organismo         VARCHAR(100),
  numero_doc        VARCHAR(50),
  file_url          TEXT,
  file_nombre       VARCHAR(200),
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docs_vehiculos_veh ON docs_vehiculos(vehiculo_id);

CREATE TABLE IF NOT EXISTS docs_choferes (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id         UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  empresa_id        UUID REFERENCES empresas(id) ON DELETE CASCADE,
  tipo_doc          VARCHAR(60) NOT NULL,
  fecha_emision     DATE,
  fecha_vencimiento DATE,
  organismo         VARCHAR(100),
  numero_doc        VARCHAR(50),
  file_url          TEXT,
  file_nombre       VARCHAR(200),
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_docs_choferes_chofer ON docs_choferes(chofer_id);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: historial vehículos por chófer
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS chofer_vehiculo_historial (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chofer_id     UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  vehiculo_id   UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  remolque_id   UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  pedido_id     UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  matricula     VARCHAR(20),
  remolque_mat  VARCHAR(20),
  tipo          VARCHAR(30) DEFAULT 'pedido',
  fecha         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  empresa_id    UUID REFERENCES empresas(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_cvh_chofer ON chofer_vehiculo_historial(chofer_id);
CREATE INDEX IF NOT EXISTS idx_cvh_fecha  ON chofer_vehiculo_historial(chofer_id, fecha DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- TABLA: facturas_suscripcion (lo que el cliente te paga a ti)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS facturas_suscripcion (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id        UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero            VARCHAR(30) NOT NULL,
  concepto          VARCHAR(200) NOT NULL DEFAULT 'Suscripción TransGest',
  plan              VARCHAR(20),
  periodo_desde     DATE NOT NULL,
  periodo_hasta     DATE NOT NULL,
  importe           NUMERIC(8,2) NOT NULL,
  estado            VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  fecha_emision     DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  fecha_pago        DATE,
  notas             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_fsus_empresa ON facturas_suscripcion(empresa_id);

-- ─────────────────────────────────────────────────────────────────────────
-- EMPRESA DEMO (para desarrollo/pruebas)
-- Comentar en producción real si no se quiere empresa demo
-- ─────────────────────────────────────────────────────────────────────────
INSERT INTO empresas (id, nombre, cif, email_admin, plan, estado, max_vehiculos, max_usuarios)
VALUES ('00000000-0000-0000-0000-000000000001', 'Empresa Demo S.L.', 'B00000001', 'gerente@empresa.com', 'enterprise', 'activo', 999, 999)
ON CONFLICT DO NOTHING;

COMMIT;

SELECT 
  'TransGest instalado correctamente' AS resultado,
  (SELECT COUNT(*) FROM empresas)  AS empresas,
  (SELECT COUNT(*) FROM planes)    AS planes;

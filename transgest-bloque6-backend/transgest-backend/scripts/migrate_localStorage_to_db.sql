-- ══════════════════════════════════════════════════════════════════════
-- Migración: localStorage → Base de datos
-- Gastos estructura, Hojas de ruta, Objetivos, Nóminas, Config empresa
-- ══════════════════════════════════════════════════════════════════════

-- 1. GASTOS DE ESTRUCTURA
CREATE TABLE IF NOT EXISTS gastos_estructura (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre      VARCHAR(200) NOT NULL,
  tipo        VARCHAR(100) NOT NULL DEFAULT 'Otros gastos generales',
  importe     NUMERIC(10,2) NOT NULL DEFAULT 0,
  periodo     VARCHAR(20) NOT NULL DEFAULT 'mensual', -- mensual | trimestral | anual | unico
  fecha       VARCHAR(7) NOT NULL, -- YYYY-MM
  notas       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gastos_estr_empresa ON gastos_estructura(empresa_id);
CREATE INDEX IF NOT EXISTS idx_gastos_estr_fecha   ON gastos_estructura(empresa_id, fecha);

CREATE TABLE IF NOT EXISTS meses_cerrados (
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  mes         VARCHAR(7) NOT NULL, -- YYYY-MM
  cerrado_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, mes)
);

-- 2. HOJAS DE RUTA — gasoil por vehículo
CREATE TABLE IF NOT EXISTS vehiculo_gasoil_config (
  vehiculo_id UUID PRIMARY KEY REFERENCES vehiculos(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  tipo        VARCHAR(20) NOT NULL DEFAULT 'fijo', -- fijo | periodos
  precio_fijo NUMERIC(6,3) NOT NULL DEFAULT 1.65,
  periodos    JSONB NOT NULL DEFAULT '[]',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vehiculo_repostajes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  litros      NUMERIC(8,2) NOT NULL DEFAULT 0,
  precio_litro NUMERIC(6,3),
  importe     NUMERIC(8,2),
  km_odometro INTEGER,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_repostajes_vehiculo ON vehiculo_repostajes(vehiculo_id);
CREATE INDEX IF NOT EXISTS idx_repostajes_fecha    ON vehiculo_repostajes(vehiculo_id, fecha DESC);

CREATE TABLE IF NOT EXISTS vehiculo_noches (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  fecha       DATE NOT NULL,
  chofer_id   UUID REFERENCES choferes(id) ON DELETE SET NULL,
  pedido_id   UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  ciudad      VARCHAR(100),
  importe     NUMERIC(8,2) NOT NULL DEFAULT 0,
  notas       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_noches_vehiculo ON vehiculo_noches(vehiculo_id);

-- 3. CONFIGURACIÓN CHÓFER (datos extra para hojas de ruta y nóminas)
CREATE TABLE IF NOT EXISTS chofer_config (
  chofer_id   UUID PRIMARY KEY REFERENCES choferes(id) ON DELETE CASCADE,
  empresa_id  UUID REFERENCES empresas(id) ON DELETE CASCADE,
  salario_base        NUMERIC(10,2),
  precio_noche        NUMERIC(8,2) DEFAULT 40,
  plus_actividad      NUMERIC(8,2) DEFAULT 0,
  irpf_pct            NUMERIC(5,2) DEFAULT 0,
  ss_empresa_pct      NUMERIC(5,2) DEFAULT 29.9,
  ss_trabajador_pct   NUMERIC(5,2) DEFAULT 6.35,
  convenio            VARCHAR(100),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. HISTORIAL NÓMINAS EMITIDAS
CREATE TABLE IF NOT EXISTS nominas_emitidas (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id  UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chofer_id   UUID NOT NULL REFERENCES choferes(id) ON DELETE CASCADE,
  periodo     VARCHAR(7) NOT NULL, -- YYYY-MM
  salario_base        NUMERIC(10,2) NOT NULL DEFAULT 0,
  plus_actividad      NUMERIC(10,2) NOT NULL DEFAULT 0,
  horas_extra         NUMERIC(10,2) NOT NULL DEFAULT 0,
  noches              INTEGER NOT NULL DEFAULT 0,
  importe_noches      NUMERIC(10,2) NOT NULL DEFAULT 0,
  ss_empresa          NUMERIC(10,2) NOT NULL DEFAULT 0,
  ss_trabajador       NUMERIC(10,2) NOT NULL DEFAULT 0,
  irpf                NUMERIC(10,2) NOT NULL DEFAULT 0,
  liquido             NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_empresa       NUMERIC(10,2) NOT NULL DEFAULT 0,
  notas               TEXT,
  emitida_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(empresa_id, chofer_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_nominas_empresa ON nominas_emitidas(empresa_id);
CREATE INDEX IF NOT EXISTS idx_nominas_chofer  ON nominas_emitidas(chofer_id);

-- 5. OBJETIVOS KPIs
CREATE TABLE IF NOT EXISTS objetivos_kpi (
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  periodo         VARCHAR(20) NOT NULL DEFAULT 'mensual', -- mensual | trimestral | anual
  facturacion     NUMERIC(12,2),
  km_totales      INTEGER,
  pct_km_vacio    NUMERIC(5,2),
  pedidos         INTEGER,
  coste_taller    NUMERIC(10,2),
  margen          NUMERIC(5,2),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id, periodo)
);

-- 6. CONFIGURACIÓN EMPRESA (velocidad media, tiempos, etc.)
ALTER TABLE empresas
  ADD COLUMN IF NOT EXISTS cfg_trafico     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cfg_precios     JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cfg_alertas     JSONB NOT NULL DEFAULT '[]';

SELECT 'Migración localStorage→BD completada' AS resultado;

-- Logo empresa
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS logo_base64 TEXT;

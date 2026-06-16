-- ══════════════════════════════════════════════════════════════
-- TRANSGEST — Migración Multi-Tenant
-- Añade empresa_id a todas las tablas para soporte multi-empresa
-- Ejecutar: psql -U transgest_user -d transgest -f migrate_multitenant.sql
-- ══════════════════════════════════════════════════════════════

BEGIN;

-- 1. Tabla de empresas/tenants
CREATE TABLE IF NOT EXISTS empresas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nombre          VARCHAR(200) NOT NULL,
  cif             VARCHAR(20),
  email_admin     VARCHAR(200) NOT NULL UNIQUE,
  dominio         VARCHAR(100) UNIQUE,   -- ej: acme (para acme.transgest.com)
  plan            VARCHAR(20)  NOT NULL DEFAULT 'basico', -- basico | profesional | enterprise
  estado          VARCHAR(20)  NOT NULL DEFAULT 'activo', -- activo | suspendido | cancelado
  max_vehiculos   INTEGER      NOT NULL DEFAULT 5,
  max_usuarios    INTEGER      NOT NULL DEFAULT 3,
  fecha_registro  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  fecha_vencimiento TIMESTAMPTZ,
  configuracion   JSONB        NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 2. Añadir empresa_id a todas las tablas operativas
ALTER TABLE usuarios     ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE clientes     ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE vehiculos    ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE choferes     ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE rutas        ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE pedidos      ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE facturas     ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE docs_vehiculos ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
ALTER TABLE docs_choferes  ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;

-- 3. Índices para performance
CREATE INDEX IF NOT EXISTS idx_usuarios_empresa     ON usuarios(empresa_id);
CREATE INDEX IF NOT EXISTS idx_clientes_empresa     ON clientes(empresa_id);
CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa    ON vehiculos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa      ON pedidos(empresa_id);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa     ON facturas(empresa_id);

-- 4. Crear empresa demo y asignar datos existentes
INSERT INTO empresas (id, nombre, cif, email_admin, dominio, plan, max_vehiculos, max_usuarios)
VALUES ('00000000-0000-0000-0000-000000000001', 'Empresa Demo S.L.', 'B12345678', 'gerente@empresa.com', 'demo', 'profesional', 20, 10)
ON CONFLICT DO NOTHING;

-- 5. Asignar empresa_id a todos los datos existentes
UPDATE usuarios      SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE clientes      SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE vehiculos     SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE choferes      SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE rutas         SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE pedidos       SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE facturas      SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;
UPDATE colaboradores SET empresa_id = '00000000-0000-0000-0000-000000000001' WHERE empresa_id IS NULL;

-- 6. Hacer empresa_id NOT NULL después de rellenar datos
ALTER TABLE usuarios      ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE clientes      ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE vehiculos     ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE choferes      ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE pedidos       ALTER COLUMN empresa_id SET NOT NULL;
ALTER TABLE facturas      ALTER COLUMN empresa_id SET NOT NULL;

-- 7. Tabla superadmin para gestión de tenants
CREATE TABLE IF NOT EXISTS superadmins (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email       VARCHAR(200) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  nombre      VARCHAR(200),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Tabla de planes y precios
CREATE TABLE IF NOT EXISTS planes (
  id          VARCHAR(20) PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  precio_mes  NUMERIC(8,2) NOT NULL,
  max_vehiculos INTEGER NOT NULL,
  max_usuarios  INTEGER NOT NULL,
  features    JSONB NOT NULL DEFAULT '[]'
);

INSERT INTO planes VALUES
  ('basico',       'Básico',       49.00,  3,  2, '["pedidos","facturacion","vehiculos"]'),
  ('profesional',  'Profesional', 149.00, 10,  5, '["pedidos","facturacion","vehiculos","choferes","informes","hojas_ruta","tarifas"]'),
  ('enterprise',   'Enterprise',  399.00, 50, 20, '["todo"]')
ON CONFLICT DO NOTHING;

COMMIT;

SELECT 'Multi-tenant migration completed successfully' AS resultado;

-- Tabla de facturas de suscripción (lo que el cliente te paga a ti)
CREATE TABLE IF NOT EXISTS facturas_suscripcion (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id      UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  numero          VARCHAR(30) NOT NULL,
  concepto        VARCHAR(200) NOT NULL DEFAULT 'Suscripción TransGest',
  plan            VARCHAR(20),
  periodo_desde   DATE NOT NULL,
  periodo_hasta   DATE NOT NULL,
  importe         NUMERIC(8,2) NOT NULL,
  estado          VARCHAR(20) NOT NULL DEFAULT 'pendiente', -- pendiente | pagada | vencida
  fecha_emision   DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE,
  fecha_pago      DATE,
  notas           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fsus_empresa ON facturas_suscripcion(empresa_id);

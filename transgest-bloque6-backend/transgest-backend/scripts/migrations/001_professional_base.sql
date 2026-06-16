CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email_admin VARCHAR(200);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dominio VARCHAR(100);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'basico';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS estado VARCHAR(20) NOT NULL DEFAULT 'activo';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS fecha_vencimiento TIMESTAMPTZ;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS configuracion JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(120);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(120);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(120);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS ciclo_facturacion VARCHAR(20) DEFAULT 'mensual';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS bloqueo_motivo VARCHAR(60);
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS bloqueo_manual BOOLEAN DEFAULT false;

ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS username VARCHAR(80);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil VARCHAR(80);
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS permisos JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN DEFAULT false;

ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_cliente_col NUMERIC(10,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_colaborador NUMERIC(10,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS matricula_colaborador VARCHAR(60);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS remolque_matricula_colaborador VARCHAR(60);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado BOOLEAN DEFAULT false;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_precio_confirmado_at TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_carga_confirmada_at TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_descarga_confirmada_at TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_workflow_enviado_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS colaborador_pedido_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL,
  accion VARCHAR(40) NOT NULL,
  token_hash VARCHAR(80) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  usado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedido_docs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL,
  empresa_id UUID,
  nombre VARCHAR(255) NOT NULL,
  tipo VARCHAR(80),
  file_base64 TEXT,
  file_mime VARCHAR(120),
  file_size_kb INTEGER,
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_estado ON pedidos(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha ON pedidos(empresa_id, fecha_carga DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_vehiculo ON pedidos(vehiculo_id) WHERE vehiculo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_colaborador_tokens_hash ON colaborador_pedido_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_colaborador_tokens_pedido ON colaborador_pedido_tokens(pedido_id);

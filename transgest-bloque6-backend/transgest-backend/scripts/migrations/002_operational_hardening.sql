CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS audit_log_saas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_tipo VARCHAR(40) NOT NULL DEFAULT 'usuario',
  actor_id UUID,
  actor_email VARCHAR(200),
  empresa_id UUID,
  accion VARCHAR(120) NOT NULL,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip VARCHAR(80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS backup_solicitudes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  solicitado_por UUID,
  motivo TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente',
  filename VARCHAR(260),
  resuelto_por UUID,
  resuelto_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pedido_eventos (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL,
  tipo VARCHAR(80) NOT NULL,
  actor_tipo VARCHAR(40) NOT NULL DEFAULT 'sistema',
  actor_id UUID,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_saas_empresa_fecha ON audit_log_saas(empresa_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_saas_accion_fecha ON audit_log_saas(accion, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backup_solicitudes_empresa_estado ON backup_solicitudes(empresa_id, estado, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedido_eventos_pedido_fecha ON pedido_eventos(pedido_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pedido_eventos_empresa_fecha ON pedido_eventos(empresa_id, created_at DESC);

ALTER TABLE pedido_docs ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE pedido_docs ADD COLUMN IF NOT EXISTS origen VARCHAR(40) DEFAULT 'app';
CREATE INDEX IF NOT EXISTS idx_pedido_docs_pedido_fecha ON pedido_docs(pedido_id, created_at DESC);

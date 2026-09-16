-- Prepare security tables before accepting traffic. Existing runtime guards
-- remain temporarily for installations upgrading without the migration runner.
CREATE TABLE IF NOT EXISTS password_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE,
  password_hash VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_password_history_usuario ON password_history(usuario_id, created_at DESC);
CREATE TABLE IF NOT EXISTS empresa_webhooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  secret_mask VARCHAR(40),
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_delivery_at TIMESTAMPTZ,
  last_status INTEGER,
  failure_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_empresa_webhooks_empresa ON empresa_webhooks(empresa_id, activo);

CREATE TABLE IF NOT EXISTS pedido_deca_email_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id UUID NOT NULL,pedido_id UUID NOT NULL,colaborador_id UUID NOT NULL,
  version_key TEXT NOT NULL,base_url TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','failed','obsolete')),
  attempts INTEGER NOT NULL DEFAULT 0,available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,last_error TEXT,UNIQUE(empresa_id,pedido_id,colaborador_id,version_key)
);
CREATE INDEX IF NOT EXISTS pedido_deca_email_pending ON pedido_deca_email_jobs(available_at) WHERE status IN ('pending','processing','failed');

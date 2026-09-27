-- Durable inbox. No order is created by ingestion or parsing.
CREATE TABLE IF NOT EXISTS ai_inbox_items (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL,
 state TEXT NOT NULL DEFAULT 'nuevo' CHECK(state IN ('nuevo','revisar','listo','creado','descartado','error')),
 content_hash TEXT NOT NULL, message_hash TEXT, source_type TEXT NOT NULL,
 filename TEXT, attachments JSONB NOT NULL DEFAULT '[]', encrypted_payload TEXT NOT NULL,
 result JSONB, error TEXT, pedido_id UUID, creation_hash TEXT,
 processing_token UUID, processing_at TIMESTAMPTZ,
 created_by UUID, reviewed_by UUID, reviewed_at TIMESTAMPTZ,
 version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,content_hash), UNIQUE(empresa_id,message_hash)
);
CREATE INDEX IF NOT EXISTS ai_inbox_items_company_state ON ai_inbox_items(empresa_id,state,created_at DESC,id);
CREATE TABLE IF NOT EXISTS ai_inbox_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL, item_id UUID NOT NULL,
 actor_id UUID, action TEXT NOT NULL, detail JSONB NOT NULL DEFAULT '{}', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS ai_inbox_events_item ON ai_inbox_events(empresa_id,item_id,created_at);
-- Existing attempt history, formerly only bootstrapped at runtime.
CREATE TABLE IF NOT EXISTS ai_inbox_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL,user_id UUID,
 provider VARCHAR(40),status VARCHAR(40) NOT NULL DEFAULT 'local',confidence INTEGER DEFAULT 0,
 source_type VARCHAR(80),filename TEXT,attachments JSONB NOT NULL DEFAULT '[]',issues JSONB NOT NULL DEFAULT '[]',
 warnings JSONB NOT NULL DEFAULT '[]',suggestions JSONB NOT NULL DEFAULT '[]',error TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_inbox_runs_empresa_created ON ai_inbox_runs(empresa_id,created_at DESC);

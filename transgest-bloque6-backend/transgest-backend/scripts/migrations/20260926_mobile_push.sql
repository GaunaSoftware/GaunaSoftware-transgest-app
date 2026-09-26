CREATE TABLE IF NOT EXISTS mobile_push_devices (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL, usuario_id UUID NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, encrypted_token TEXT NOT NULL, enabled BOOLEAN NOT NULL DEFAULT true,
 registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mobile_push_owner ON mobile_push_devices(empresa_id,usuario_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS mobile_push_deliveries (
 notification_id UUID NOT NULL, device_id UUID NOT NULL REFERENCES mobile_push_devices(id) ON DELETE CASCADE,
 status TEXT NOT NULL CHECK(status IN ('processing','sent','error','unknown','retry')),
 attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 provider_reference TEXT, error_code TEXT, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(notification_id,device_id)
);

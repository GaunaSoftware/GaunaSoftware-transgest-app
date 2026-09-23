CREATE TABLE IF NOT EXISTS factura_registros_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        modo VARCHAR(20) NOT NULL DEFAULT 'ninguno',
        entorno VARCHAR(20) NOT NULL DEFAULT 'pruebas',
        estado_registro VARCHAR(20) NOT NULL DEFAULT 'alta',
        estado_envio VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        hash_anterior VARCHAR(128),
        huella VARCHAR(128) NOT NULL,
        qr_text TEXT,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        ultimo_error TEXT,
        ultimo_envio_at TIMESTAMPTZ,
        created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        updated_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (factura_id)
      );
CREATE TABLE IF NOT EXISTS factura_envios_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        registro_id UUID NOT NULL REFERENCES factura_registros_fiscales(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        sistema VARCHAR(20) NOT NULL,
        entorno VARCHAR(20) NOT NULL DEFAULT 'pruebas',
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        intento INTEGER NOT NULL DEFAULT 0,
        payload JSONB NOT NULL DEFAULT '{}'::jsonb,
        response JSONB,
        error TEXT,
        next_retry_at TIMESTAMPTZ,
        processed_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
CREATE TABLE IF NOT EXISTS factura_eventos_fiscales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        registro_id UUID NOT NULL REFERENCES factura_registros_fiscales(id) ON DELETE CASCADE,
        factura_id UUID NOT NULL REFERENCES facturas(id) ON DELETE CASCADE,
        empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        evento_tipo VARCHAR(60) NOT NULL,
        detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
-- Additive migration. Existing fiscal records are preserved; no synthetic acceptance.
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS request_payload JSONB;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS provider_uuid TEXT;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE factura_registros_fiscales ADD COLUMN IF NOT EXISTS official_qr_url TEXT;
ALTER TABLE factura_registros_fiscales ADD COLUMN IF NOT EXISTS official_qr_base64 TEXT;
ALTER TABLE factura_registros_fiscales ADD COLUMN IF NOT EXISTS provider_hash TEXT;
ALTER TABLE factura_registros_fiscales ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
ALTER TABLE factura_registros_fiscales ADD COLUMN IF NOT EXISTS fiscal_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS fiscal_provider_uuid_idx ON factura_envios_fiscales(empresa_id,provider_uuid);
CREATE TABLE IF NOT EXISTS fiscal_webhook_receipts (
 empresa_id UUID NOT NULL REFERENCES empresas(id), provider TEXT NOT NULL, event_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(empresa_id,provider,event_id)
);
CREATE TABLE IF NOT EXISTS accounting_party_mappings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id),
 provider TEXT NOT NULL, party_type TEXT NOT NULL, source_party_id UUID NOT NULL,
 account_code VARCHAR(15) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,provider,party_type,source_party_id), UNIQUE(empresa_id,provider,account_code)
);
CREATE TABLE IF NOT EXISTS accounting_invoice_outbox (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id),
 factura_id UUID NOT NULL REFERENCES facturas(id), provider TEXT NOT NULL, entity_type TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','synced','failed','unknown')),
 payload JSONB NOT NULL, payload_hash TEXT NOT NULL, attempts INT NOT NULL DEFAULT 0,
 last_error TEXT, external_ref TEXT, exported_at TIMESTAMPTZ, processed_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,provider,factura_id,entity_type)
);
ALTER TABLE fiscal_webhook_receipts ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE fiscal_webhook_receipts ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;
ALTER TABLE fiscal_webhook_receipts ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE fiscal_webhook_receipts ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fiscal_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

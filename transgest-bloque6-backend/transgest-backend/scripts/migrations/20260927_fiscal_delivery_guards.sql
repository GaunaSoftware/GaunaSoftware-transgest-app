-- Bootstrap the existing fiscal schema on fresh installations.
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
-- Delivery metadata only; fiscal originals and their hashes are untouched.
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS retryable BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ;
ALTER TABLE factura_envios_fiscales ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;
-- Legacy terminal errors have no retry date; require explicit review.
UPDATE factura_envios_fiscales SET retryable=false WHERE estado='error' AND next_retry_at IS NULL;
CREATE INDEX IF NOT EXISTS fiscal_delivery_claim ON factura_envios_fiscales(empresa_id,factura_id,sistema,created_at DESC);

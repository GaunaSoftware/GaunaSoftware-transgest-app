-- Keep original amounts; effective versions are appended explicitly, never inferred.
ALTER TABLE gastos_estructura ADD COLUMN IF NOT EXISTS vigencias JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE gastos_estructura ADD COLUMN IF NOT EXISTS fecha_fin VARCHAR(7);
ALTER TABLE gastos_estructura ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS gastos_estructura_eventos (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 empresa_id UUID NOT NULL REFERENCES empresas(id),
 gasto_id UUID NOT NULL REFERENCES gastos_estructura(id),
 revision INTEGER NOT NULL,
 actor_id UUID,
 accion TEXT NOT NULL,
 motivo TEXT NOT NULL,
 anterior JSONB NOT NULL,
 siguiente JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,gasto_id,revision)
);

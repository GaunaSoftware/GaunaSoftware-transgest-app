ALTER TABLE viajes_operativos ADD COLUMN IF NOT EXISTS disposicion_carga JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE viajes_operativos ADD COLUMN IF NOT EXISTS ruta_calculada JSONB;
ALTER TABLE viaje_pedidos ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS viajes_operativos_grupaje_idx ON viajes_operativos(empresa_id,legacy_grupaje_id) WHERE legacy_grupaje_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS viaje_plan_versiones (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL, viaje_id UUID NOT NULL,
 version INTEGER NOT NULL, snapshot JSONB NOT NULL, motivo TEXT NOT NULL,
 actor_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(empresa_id,viaje_id,version),
 FOREIGN KEY(empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS viaje_operaciones (
 empresa_id UUID NOT NULL, client_operation_uuid UUID NOT NULL, viaje_id UUID NOT NULL,
 request_hash TEXT NOT NULL, resultado JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(empresa_id,client_operation_uuid),
 FOREIGN KEY(empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id)
);

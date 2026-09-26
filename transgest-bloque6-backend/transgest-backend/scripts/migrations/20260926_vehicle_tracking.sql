CREATE TABLE IF NOT EXISTS gps_position_log (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL,
 vehiculo_id UUID, provider VARCHAR(40) NOT NULL DEFAULT 'manual', external_id VARCHAR(120),
 lat NUMERIC(10,7), lng NUMERIC(10,7), ubicacion TEXT, velocidad_kmh NUMERIC(8,2),
 odometro_km NUMERIC(12,2), raw JSONB NOT NULL DEFAULT '{}',
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE gps_position_log ADD COLUMN IF NOT EXISTS ingestion_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS gps_position_ingestion ON gps_position_log(empresa_id,ingestion_key) WHERE ingestion_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS gps_position_tenant_vehicle_time ON gps_position_log(empresa_id,vehiculo_id,recorded_at DESC);
CREATE TABLE IF NOT EXISTS tracking_configuration (
 empresa_id UUID NOT NULL, pedido_id UUID NOT NULL,
 stale_seconds INTEGER NOT NULL DEFAULT 300 CHECK(stale_seconds BETWEEN 30 AND 3600),
 stops JSONB NOT NULL DEFAULT '{}', updated_by UUID, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(empresa_id,pedido_id), FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS tracking_geofence_state (
 empresa_id UUID NOT NULL, pedido_id UUID NOT NULL, parada_id TEXT NOT NULL,
 inside BOOLEAN NOT NULL, observed_at TIMESTAMPTZ NOT NULL, position_id UUID NOT NULL,
 PRIMARY KEY(empresa_id,pedido_id,parada_id), FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS tracking_geofence_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL, pedido_id UUID NOT NULL,
 parada_id TEXT NOT NULL, position_id UUID NOT NULL, event TEXT NOT NULL CHECK(event IN ('entrada','salida')),
 observed_at TIMESTAMPTZ NOT NULL, received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 distance_m NUMERIC NOT NULL, radius_m NUMERIC NOT NULL, hysteresis_m NUMERIC NOT NULL,
 UNIQUE(empresa_id,pedido_id,parada_id,position_id,event),
 FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE INDEX IF NOT EXISTS tracking_events_order_time ON tracking_geofence_events(empresa_id,pedido_id,observed_at DESC);

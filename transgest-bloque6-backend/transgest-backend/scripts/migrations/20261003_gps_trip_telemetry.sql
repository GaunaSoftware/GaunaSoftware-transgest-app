CREATE TABLE IF NOT EXISTS vehicle_telemetry_log (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 vehiculo_id UUID NOT NULL REFERENCES vehiculos(id) ON DELETE CASCADE,
 provider VARCHAR(40) NOT NULL, external_id TEXT NOT NULL DEFAULT '', metric TEXT NOT NULL,
 sensor TEXT NOT NULL, value NUMERIC NOT NULL, unit TEXT NOT NULL, recorded_at TIMESTAMPTZ NOT NULL,
 quality TEXT NOT NULL DEFAULT 'measured', label TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 CHECK (metric IN ('odometer_km','fuel_total_l','frigo_temperature_c','engine_hours')),
 CHECK (quality IN ('measured','interpolated')),
 UNIQUE (empresa_id,vehiculo_id,provider,external_id,metric,sensor,recorded_at)
);
CREATE INDEX IF NOT EXISTS telemetry_vehicle_time ON vehicle_telemetry_log(empresa_id,vehiculo_id,provider,recorded_at);
CREATE TABLE IF NOT EXISTS pedido_telemetry_reports (
 empresa_id UUID NOT NULL, pedido_id UUID NOT NULL, data JSONB NOT NULL DEFAULT '{}',
 status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0,
 requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 locked_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY (empresa_id,pedido_id), FOREIGN KEY (empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS telemetry_pending ON pedido_telemetry_reports(available_at) WHERE status IN ('pending','retry');
CREATE OR REPLACE FUNCTION request_trip_telemetry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE context JSONB;
BEGIN
 IF NEW.estado::text IN ('entregado','facturado') AND NEW.vehiculo_id IS NOT NULL AND NEW.colaborador_id IS NULL
    AND (TG_OP='INSERT' OR OLD.estado::text NOT IN ('entregado','facturado') OR OLD.carga_real_at IS DISTINCT FROM NEW.carga_real_at
         OR OLD.descarga_real_at IS DISTINCT FROM NEW.descarga_real_at OR OLD.vehiculo_id IS DISTINCT FROM NEW.vehiculo_id
         OR OLD.remolque_id IS DISTINCT FROM NEW.remolque_id) THEN
  SELECT jsonb_build_object('vehicle_id',v.id,'provider',CASE WHEN v.gps_provider IN ('geotab','movildata','locatel','tacogest','gps_generic') THEN v.gps_provider ELSE 'app_chofer' END,'external_id',v.gps_external_id,
    'load_at',NEW.carga_real_at,'unload_at',NEW.descarga_real_at,'trailer_id',NEW.remolque_id,'trailer',
    (SELECT jsonb_build_object('vehicle_id',r.id,'provider',r.gps_provider,'external_id',r.gps_external_id)
     FROM vehiculos r WHERE r.id=NEW.remolque_id AND r.empresa_id=NEW.empresa_id AND r.gps_provider IN ('geotab','movildata','locatel','tacogest','gps_generic')))
    INTO context FROM vehiculos v WHERE v.id=NEW.vehiculo_id AND v.empresa_id=NEW.empresa_id;
  INSERT INTO pedido_telemetry_reports(empresa_id,pedido_id,data) VALUES(NEW.empresa_id,NEW.id,jsonb_build_object('context',context))
   ON CONFLICT (empresa_id,pedido_id) DO UPDATE SET data=EXCLUDED.data,status='pending',attempts=0,available_at=NOW(),requested_at=NOW(),updated_at=NOW();
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trip_telemetry_closed ON pedidos;
CREATE TRIGGER trip_telemetry_closed AFTER INSERT OR UPDATE OF estado,carga_real_at,descarga_real_at,vehiculo_id,remolque_id ON pedidos
 FOR EACH ROW EXECUTE FUNCTION request_trip_telemetry();

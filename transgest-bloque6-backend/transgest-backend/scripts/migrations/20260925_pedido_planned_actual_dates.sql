-- fecha_carga/fecha_descarga remain the legacy planned-date contract.
-- Some historical delivery dates may already have been shifted by the old
-- driver-delay workflow; they cannot be reconstructed without an external source.
-- Older base installs receive fecha_descarga from server startup; migrations
-- may run first on an isolated or freshly installed database.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_carga_planificada DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS fecha_descarga_planificada DATE;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS planificacion_origen VARCHAR(24);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS carga_real_at TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS descarga_real_at TIMESTAMPTZ;

UPDATE pedidos
   SET fecha_carga_planificada = COALESCE(fecha_carga_planificada, fecha_carga),
       fecha_descarga_planificada = COALESCE(fecha_descarga_planificada, fecha_descarga, fecha_entrega),
       planificacion_origen = COALESCE(planificacion_origen, 'legacy_sin_verificar')
 WHERE fecha_carga_planificada IS NULL
    OR fecha_descarga_planificada IS NULL
    OR planificacion_origen IS NULL;

CREATE OR REPLACE FUNCTION sync_pedido_planned_dates() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.fecha_carga_planificada := NEW.fecha_carga;
    NEW.fecha_descarga_planificada := COALESCE(NEW.fecha_descarga, NEW.fecha_entrega);
    NEW.planificacion_origen := 'capturada';
  -- A delivery confirmation can still fill legacy fecha_entrega. When it also
  -- stamps descarga_real_at, that date is actual, not a new customer plan.
  ELSIF NEW.fecha_carga IS DISTINCT FROM OLD.fecha_carga
     OR NEW.fecha_descarga IS DISTINCT FROM OLD.fecha_descarga
     OR (NEW.fecha_entrega IS DISTINCT FROM OLD.fecha_entrega
         AND NEW.descarga_real_at IS NOT DISTINCT FROM OLD.descarga_real_at) THEN
    NEW.fecha_carga_planificada := NEW.fecha_carga;
    NEW.fecha_descarga_planificada := COALESCE(NEW.fecha_descarga, NEW.fecha_entrega);
    NEW.planificacion_origen := 'capturada';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pedidos_sync_planned_dates ON pedidos;
CREATE TRIGGER pedidos_sync_planned_dates
BEFORE INSERT OR UPDATE OF fecha_carga, fecha_descarga, fecha_entrega ON pedidos
FOR EACH ROW EXECUTE FUNCTION sync_pedido_planned_dates();

ALTER TABLE pedidos ALTER COLUMN planificacion_origen SET DEFAULT 'capturada';

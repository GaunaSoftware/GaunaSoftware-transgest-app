-- Stop on historical duplicates; never discard or merge prices silently.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM ruta_precios_cliente GROUP BY ruta_id,cliente_id HAVING COUNT(*)>1) THEN
    RAISE EXCEPTION 'Hay tarifas duplicadas por ruta y cliente. Revisar esos registros antes de aplicar la migración de integridad.';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS ruta_precios_cliente_route_customer_unique ON ruta_precios_cliente(ruta_id,cliente_id);
ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
ALTER TABLE superadmins ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT false;

-- Preserve point names independently from addresses. An empty address is only
-- allowed for an explicitly confirmed incomplete point; it must not collide
-- with another incomplete point in the same tenant.
ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS location_incomplete BOOLEAN NOT NULL DEFAULT false;

DROP INDEX IF EXISTS idx_puntos_interes_empresa_cli_dir;
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cli_dir_complete
  ON puntos_interes (empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion)))
  WHERE activo=true AND TRIM(direccion)<>'';

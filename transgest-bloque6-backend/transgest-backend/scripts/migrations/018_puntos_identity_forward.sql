-- Forward-only replacement for edits previously made to migration 003.
-- Preserve all customer points. Ambiguous duplicates require explicit review.
ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS cliente_id UUID REFERENCES clientes(id) ON DELETE SET NULL;
ALTER TABLE puntos_interes ADD COLUMN IF NOT EXISTS direccion_key TEXT;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM puntos_interes WHERE activo=true
    GROUP BY empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion))
    HAVING COUNT(*)>1
  ) OR EXISTS (
    SELECT 1 FROM puntos_interes WHERE activo=true AND direccion_key IS NOT NULL AND direccion_key<>''
    GROUP BY empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), direccion_key
    HAVING COUNT(*)>1
  ) THEN
    RAISE EXCEPTION 'Hay puntos activos duplicados por cliente. Revisarlos antes de migrar; no se desactivan automáticamente.';
  END IF;
END $$;
DROP INDEX IF EXISTS idx_puntos_interes_empresa_dir;
DROP INDEX IF EXISTS idx_puntos_interes_empresa_cliente_dir;
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cli_dir ON puntos_interes(empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(TRIM(direccion))) WHERE activo=true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cli_dir_key ON puntos_interes(empresa_id, COALESCE(cliente_id, '00000000-0000-0000-0000-000000000000'::uuid), direccion_key) WHERE activo=true AND direccion_key IS NOT NULL AND direccion_key<>'';
CREATE INDEX IF NOT EXISTS idx_puntos_interes_empresa_cliente ON puntos_interes(empresa_id, cliente_id) WHERE activo=true;

-- Los identificadores de maestros se repiten legítimamente entre empresas.
-- La base existente también puede contener duplicados dentro de una empresa.
-- No fusionamos ni cambiamos fichas históricas: en ese caso conservamos una
-- búsqueda indexada y exigimos revisión cuando la importación encuentre más
-- de una coincidencia. Los registros importados siguen siendo únicos.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_cif_key;
ALTER TABLE choferes DROP CONSTRAINT IF EXISTS choferes_dni_key;
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS vehiculos_matricula_key;
ALTER TABLE colaboradores DROP CONSTRAINT IF EXISTS colaboradores_cif_key;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM clientes
    WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL
    GROUP BY empresa_id, UPPER(TRIM(cif)) HAVING COUNT(*) > 1
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_clientes_empresa_cif_import_lookup
      ON clientes(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_cif_imported
      ON clientes(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND import_batch_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
    RAISE WARNING 'Clientes con CIF repetido por empresa: se conservan y la importación exigirá revisión';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_cif_import
      ON clientes(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM choferes
    WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(dni),'') IS NOT NULL
    GROUP BY empresa_id, REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g') HAVING COUNT(*) > 1
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_choferes_empresa_dni_import_lookup
      ON choferes(empresa_id, REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(dni),'') IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_choferes_empresa_dni_imported
      ON choferes(empresa_id, REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND import_batch_id IS NOT NULL AND NULLIF(TRIM(dni),'') IS NOT NULL;
    RAISE WARNING 'Conductores con DNI repetido por empresa: se conservan y la importación exigirá revisión';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_choferes_empresa_dni_import
      ON choferes(empresa_id, REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(dni),'') IS NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM vehiculos
    WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(matricula),'') IS NOT NULL
    GROUP BY empresa_id, REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g') HAVING COUNT(*) > 1
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa_matricula_import_lookup
      ON vehiculos(empresa_id, REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(matricula),'') IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_empresa_matricula_imported
      ON vehiculos(empresa_id, REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND import_batch_id IS NOT NULL AND NULLIF(TRIM(matricula),'') IS NOT NULL;
    RAISE WARNING 'Vehículos con matrícula repetida por empresa: se conservan y la importación exigirá revisión';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_empresa_matricula_import
      ON vehiculos(empresa_id, REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g'))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(matricula),'') IS NOT NULL;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM colaboradores
    WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL
    GROUP BY empresa_id, UPPER(TRIM(cif)) HAVING COUNT(*) > 1
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_colaboradores_empresa_cif_import_lookup
      ON colaboradores(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_colaboradores_empresa_cif_imported
      ON colaboradores(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND import_batch_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
    RAISE WARNING 'Colaboradores con CIF repetido por empresa: se conservan y la importación exigirá revisión';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS uq_colaboradores_empresa_cif_import
      ON colaboradores(empresa_id, UPPER(TRIM(cif)))
      WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
  END IF;
END $$;

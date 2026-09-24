-- Los identificadores de maestros se repiten legítimamente entre empresas.
-- Sustituimos las restricciones globales del esquema inicial por índices
-- únicos por empresa. No modifica ni borra registros.
ALTER TABLE clientes DROP CONSTRAINT IF EXISTS clientes_cif_key;
ALTER TABLE choferes DROP CONSTRAINT IF EXISTS choferes_dni_key;
ALTER TABLE vehiculos DROP CONSTRAINT IF EXISTS vehiculos_matricula_key;
ALTER TABLE colaboradores DROP CONSTRAINT IF EXISTS colaboradores_cif_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_clientes_empresa_cif_import
  ON clientes(empresa_id, UPPER(TRIM(cif)))
  WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_choferes_empresa_dni_import
  ON choferes(empresa_id, REGEXP_REPLACE(UPPER(dni),'[^A-Z0-9]','','g'))
  WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(dni),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_vehiculos_empresa_matricula_import
  ON vehiculos(empresa_id, REGEXP_REPLACE(UPPER(matricula),'[^A-Z0-9]','','g'))
  WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(matricula),'') IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_colaboradores_empresa_cif_import
  ON colaboradores(empresa_id, UPPER(TRIM(cif)))
  WHERE empresa_id IS NOT NULL AND NULLIF(TRIM(cif),'') IS NOT NULL;

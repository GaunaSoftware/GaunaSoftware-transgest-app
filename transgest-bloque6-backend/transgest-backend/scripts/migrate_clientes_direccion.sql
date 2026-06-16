-- Migración: direcciones desglosadas y dirección fiscal separada en clientes

-- Dirección social/operativa desglosada
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS calle        VARCHAR(200),
  ADD COLUMN IF NOT EXISTS num_ext      VARCHAR(10),
  ADD COLUMN IF NOT EXISTS piso_puerta  VARCHAR(20),
  ADD COLUMN IF NOT EXISTS cod_postal   VARCHAR(10),
  ADD COLUMN IF NOT EXISTS municipio    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS provincia    VARCHAR(100),
  ADD COLUMN IF NOT EXISTS pais_iso     VARCHAR(3) DEFAULT 'ES';

-- Dirección fiscal (solo si es diferente a la social)
ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS dir_fiscal_distinta  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS fiscal_calle         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS fiscal_num_ext       VARCHAR(10),
  ADD COLUMN IF NOT EXISTS fiscal_piso_puerta   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fiscal_cod_postal    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS fiscal_municipio     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fiscal_provincia     VARCHAR(100),
  ADD COLUMN IF NOT EXISTS fiscal_pais_iso      VARCHAR(3) DEFAULT 'ES';

-- Migrar el campo direccion anterior (texto libre) a calle
UPDATE clientes SET calle = direccion WHERE calle IS NULL AND direccion IS NOT NULL;
UPDATE clientes SET cod_postal = cp WHERE cod_postal IS NULL AND cp IS NOT NULL;
UPDATE clientes SET municipio = ciudad WHERE municipio IS NULL AND ciudad IS NOT NULL;

SELECT 'Migración completada: ' || COUNT(*) || ' clientes actualizados' FROM clientes;

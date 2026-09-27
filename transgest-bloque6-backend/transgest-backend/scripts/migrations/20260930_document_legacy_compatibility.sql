-- install_completo.sql uses tipo_doc/numero_doc whereas init.sql also has
-- these legacy fields, which document routes and import writers still use.
-- Add missing nullable fields without rewriting existing documents.
ALTER TABLE docs_choferes
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(200),
  ADD COLUMN IF NOT EXISTS referencia VARCHAR(100),
  ADD COLUMN IF NOT EXISTS alerta_dias SMALLINT DEFAULT 30;

ALTER TABLE docs_vehiculos
  ADD COLUMN IF NOT EXISTS descripcion VARCHAR(200),
  ADD COLUMN IF NOT EXISTS referencia VARCHAR(100),
  ADD COLUMN IF NOT EXISTS alerta_dias SMALLINT DEFAULT 30;

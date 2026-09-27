-- No backfill of physical receipt dates or quality decisions.
CREATE TABLE IF NOT EXISTS planner_ubicaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),
 almacen text NOT NULL,codigo text NOT NULL,zona text NOT NULL DEFAULT '',pasillo text NOT NULL DEFAULT '',
 estanteria text NOT NULL DEFAULT '',nivel text NOT NULL DEFAULT '',activo boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(empresa_id,almacen,codigo),UNIQUE(empresa_id,id)
);
ALTER TABLE planner_existencias ADD COLUMN IF NOT EXISTS calidad text CHECK(calidad IN ('pendiente','liberado','bloqueado'));
ALTER TABLE planner_existencias ADD COLUMN IF NOT EXISTS recepcion_real_at timestamptz;
ALTER TABLE planner_existencias ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE planner_articulos ADD COLUMN IF NOT EXISTS gtin varchar(14);
CREATE UNIQUE INDEX IF NOT EXISTS planner_article_gtin ON planner_articulos(empresa_id,gtin) WHERE gtin IS NOT NULL;
CREATE OR REPLACE FUNCTION planner_stock_revision() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN NEW.version=OLD.version+1;RETURN NEW;END;$$;
DROP TRIGGER IF EXISTS planner_stock_revision ON planner_existencias;
CREATE TRIGGER planner_stock_revision BEFORE UPDATE ON planner_existencias FOR EACH ROW EXECUTE FUNCTION planner_stock_revision();
CREATE TABLE IF NOT EXISTS planner_asn (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),referencia text NOT NULL,
 fecha_prevista date NOT NULL,lineas jsonb NOT NULL,estado text NOT NULL DEFAULT 'prevista' CHECK(estado IN ('prevista','parcial','recibida','cerrada')),
 cierre_motivo text,created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,referencia),UNIQUE(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS planner_conteos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL,existencia_id uuid NOT NULL,
 stock_version integer NOT NULL,cantidad_sistema numeric(14,3) NOT NULL,cantidad_contada numeric(14,3),
 estado text NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','confirmado')),
 motivo text,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),confirmed_at timestamptz,
 FOREIGN KEY(empresa_id,existencia_id) REFERENCES planner_existencias(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS planner_wms_operaciones (
 empresa_id uuid NOT NULL REFERENCES empresas(id),operacion uuid NOT NULL,tipo text NOT NULL,
 fingerprint text NOT NULL,datos jsonb NOT NULL,created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,operacion)
);
CREATE TABLE IF NOT EXISTS planner_bultos_sscc (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL,preparacion_id uuid NOT NULL,
 sscc varchar(18) NOT NULL,lineas jsonb NOT NULL,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_id,preparacion_id) REFERENCES planner_preparaciones(empresa_id,id),UNIQUE(empresa_id,sscc)
);

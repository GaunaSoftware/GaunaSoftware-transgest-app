-- Additive: never manufacture loading events or quantities for old preparations.
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'carretillero';
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS carretillero_id uuid REFERENCES usuarios(id);
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS carga_confirmada_at timestamptz;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS carga_foto_id uuid REFERENCES pedido_docs(id);
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS documentos_listos_at timestamptz;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS entrega_confirmada_at timestamptz;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS incidencia text;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS documentacion_estado jsonb;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS billing_trigger text NOT NULL DEFAULT 'departure' CHECK(billing_trigger IN ('departure','delivery'));
ALTER TABLE planner_preparacion_lineas ADD COLUMN IF NOT EXISTS cantidad_cargada numeric(14,3) CHECK(cantidad_cargada>=0 AND cantidad_cargada<=cantidad);
CREATE TABLE IF NOT EXISTS planner_carga_operaciones (
 empresa_id uuid NOT NULL REFERENCES empresas(id), operacion uuid NOT NULL,
 preparacion_id uuid NOT NULL REFERENCES planner_preparaciones(id), accion text NOT NULL,
 fingerprint text NOT NULL, resultado jsonb NOT NULL, created_by uuid REFERENCES usuarios(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(empresa_id,operacion)
);
CREATE INDEX IF NOT EXISTS planner_operario_cargas ON planner_preparaciones(empresa_id,carretillero_id,created_at);
CREATE TABLE IF NOT EXISTS planner_facturacion_politicas (
 empresa_id uuid NOT NULL REFERENCES empresas(id),ambito text NOT NULL,
 billing_trigger text NOT NULL CHECK(billing_trigger IN ('departure','delivery')),
 updated_by uuid REFERENCES usuarios(id),updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(empresa_id,ambito)
);
CREATE TABLE IF NOT EXISTS planner_albaran_versiones (
 id uuid PRIMARY KEY,empresa_id uuid NOT NULL,preparacion_id uuid NOT NULL,
 numero text NOT NULL,version integer NOT NULL CHECK(version>0),datos jsonb NOT NULL,
 material_hash text NOT NULL,pdf bytea NOT NULL,pdf_hash text NOT NULL,created_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(empresa_id,preparacion_id) REFERENCES planner_preparaciones(empresa_id,id),
 UNIQUE(empresa_id,preparacion_id,version),UNIQUE(empresa_id,numero)
);
CREATE OR REPLACE FUNCTION protect_planner_delivery_original() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN RAISE EXCEPTION 'Planner delivery originals are immutable; create a new version' USING ERRCODE='55000';END;$$;
DROP TRIGGER IF EXISTS planner_delivery_immutable ON planner_albaran_versiones;
CREATE TRIGGER planner_delivery_immutable BEFORE UPDATE OR DELETE ON planner_albaran_versiones FOR EACH ROW EXECUTE FUNCTION protect_planner_delivery_original();
-- Existing notification model, initialized by migration instead of request DDL.
CREATE TABLE IF NOT EXISTS notificaciones_internas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL,usuario_id uuid NOT NULL,
 tipo varchar(80) NOT NULL,titulo varchar(160) NOT NULL,mensaje text,data jsonb NOT NULL DEFAULT '{}',
 leida boolean NOT NULL DEFAULT false,created_by uuid,created_at timestamptz NOT NULL DEFAULT now(),read_at timestamptz
);

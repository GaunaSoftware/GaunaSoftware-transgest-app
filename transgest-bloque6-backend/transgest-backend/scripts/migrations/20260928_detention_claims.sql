ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS importe_paralizacion numeric(10,2) DEFAULT 0;
CREATE TABLE IF NOT EXISTS pedido_paralizaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id), pedido_id uuid NOT NULL REFERENCES pedidos(id),
 operacion uuid NOT NULL, huella text NOT NULL, estado text NOT NULL CHECK(estado IN ('reclamada','aceptada','rechazada')),
 inicio timestamptz NOT NULL, fin timestamptz NOT NULL CHECK(fin>inicio), minutos numeric NOT NULL CHECK(minutos>0),
 documentado numeric(12,2) NOT NULL CHECK(documentado>=0), aceptado numeric(12,2) NOT NULL DEFAULT 0 CHECK(aceptado>=0),
 documento_id uuid NOT NULL REFERENCES pedido_docs(id), acuerdo text NOT NULL, motivo text NOT NULL,
 version integer NOT NULL DEFAULT 1, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,operacion)
);
CREATE TABLE IF NOT EXISTS pedido_paralizacion_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id), reclamacion_id uuid NOT NULL REFERENCES pedido_paralizaciones(id),
 operacion uuid NOT NULL, huella text NOT NULL, actor_id uuid, datos jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(empresa_id,operacion)
);
ALTER TABLE factura_lineas ADD COLUMN IF NOT EXISTS paralizacion_pedido_id uuid REFERENCES pedidos(id);
CREATE OR REPLACE FUNCTION proteger_paralizacion_documentada() RETURNS trigger AS $$
BEGIN
 IF NEW.importe_paralizacion IS DISTINCT FROM OLD.importe_paralizacion AND EXISTS(SELECT 1 FROM pedido_paralizaciones WHERE empresa_id=NEW.empresa_id AND pedido_id=NEW.id) THEN
  IF COALESCE(NEW.importe_paralizacion,0) <> (SELECT COALESCE(sum(aceptado) FILTER(WHERE estado='aceptada'),0) FROM pedido_paralizaciones WHERE empresa_id=NEW.empresa_id AND pedido_id=NEW.id) THEN
   RAISE EXCEPTION 'Modifica la paralización desde su revisión documentada' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS proteger_paralizacion_documentada ON pedidos;
CREATE TRIGGER proteger_paralizacion_documentada BEFORE UPDATE OF importe_paralizacion ON pedidos FOR EACH ROW EXECUTE FUNCTION proteger_paralizacion_documentada();

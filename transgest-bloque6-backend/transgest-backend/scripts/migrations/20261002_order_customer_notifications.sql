CREATE TABLE IF NOT EXISTS pedido_cliente_email_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id UUID NOT NULL, pedido_id UUID NOT NULL,
  cliente_id UUID NOT NULL, tipo TEXT NOT NULL, estado TEXT NOT NULL, snapshot JSONB NOT NULL,
  dedupe_key TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','sent','skipped','failed')),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), attempts INTEGER NOT NULL DEFAULT 0,
  sent_at TIMESTAMPTZ, last_error TEXT, document_fingerprint TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(empresa_id,dedupe_key)
);
CREATE INDEX IF NOT EXISTS pedido_cliente_email_pending ON pedido_cliente_email_jobs(available_at) WHERE status IN ('pending','failed','processing');

CREATE OR REPLACE FUNCTION enqueue_pedido_cliente_estado() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cliente_id IS NOT NULL AND NEW.empresa_id IS NOT NULL AND NEW.estado IS DISTINCT FROM OLD.estado THEN
    INSERT INTO pedido_cliente_email_jobs(empresa_id,pedido_id,cliente_id,tipo,estado,snapshot,dedupe_key,available_at)
    VALUES(NEW.empresa_id,NEW.id,NEW.cliente_id,'estado',NEW.estado::text,
      jsonb_build_object('numero',NEW.numero,'origen',NEW.origen,'destino',NEW.destino,'mercancia',NEW.mercancia),
      'estado:'||NEW.id::text||':'||gen_random_uuid()::text,NOW()+INTERVAL '3 seconds');
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pedido_cliente_estado_email ON pedidos;
CREATE TRIGGER pedido_cliente_estado_email AFTER UPDATE OF estado ON pedidos FOR EACH ROW EXECUTE FUNCTION enqueue_pedido_cliente_estado();

CREATE OR REPLACE FUNCTION enqueue_pedido_cliente_albaranes() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE p pedidos%ROWTYPE;
BEGIN
  IF NEW.file_base64 IS NOT NULL AND LOWER(COALESCE(NEW.tipo,'')) IN ('albaran','albarán','albaran_colaborador','albaran_descarga','albaran_entrega','foto_entrega','pod','cmr') THEN
    SELECT * INTO p FROM pedidos WHERE id=NEW.pedido_id AND empresa_id=NEW.empresa_id;
    IF p.cliente_id IS NOT NULL AND p.estado::text IN ('entregado','facturado') THEN
      INSERT INTO pedido_cliente_email_jobs(empresa_id,pedido_id,cliente_id,tipo,estado,snapshot,dedupe_key,available_at)
      VALUES(p.empresa_id,p.id,p.cliente_id,'albaranes',p.estado::text,
        jsonb_build_object('numero',p.numero,'origen',p.origen,'destino',p.destino),
        'albaranes:'||p.id::text,NOW()+INTERVAL '3 seconds')
      ON CONFLICT(empresa_id,dedupe_key) DO UPDATE SET status='pending',available_at=NOW()+INTERVAL '3 seconds',
        revision=pedido_cliente_email_jobs.revision+1,attempts=0,last_error=NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS pedido_cliente_albaranes_email ON pedido_docs;
CREATE TRIGGER pedido_cliente_albaranes_email AFTER INSERT OR UPDATE OF file_base64 ON pedido_docs FOR EACH ROW EXECUTE FUNCTION enqueue_pedido_cliente_albaranes();

-- Immutable originals. Legacy repository/history remain untouched.
CREATE TABLE IF NOT EXISTS transport_document_versions (
  id UUID PRIMARY KEY,
  empresa_id UUID NOT NULL,
  pedido_id UUID NOT NULL,
  envio_id UUID,
  viaje_id UUID,
  scope_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version > 0),
  source TEXT NOT NULL CHECK (source IN ('transgest','external','legacy')),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL,
  material_hash TEXT NOT NULL,
  pdf BYTEA NOT NULL,
  pdf_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  token_hash TEXT NOT NULL,
  public_url TEXT NOT NULL,
  retention_until DATE NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (empresa_id,id),
  UNIQUE (empresa_id,pedido_id,scope_key,version),
  FOREIGN KEY (empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id),
  FOREIGN KEY (empresa_id,pedido_id,envio_id) REFERENCES pedidos_envios(empresa_id,pedido_id,id),
  FOREIGN KEY (empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id)
);
CREATE INDEX IF NOT EXISTS transport_document_order_versions ON transport_document_versions(empresa_id,pedido_id,created_at DESC);

-- Lifecycle events are separate from immutable contents. No expiry inferred from planning.
CREATE TABLE IF NOT EXISTS transport_document_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  document_id UUID NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('service_completed','public_disabled','public_enabled')),
  effective_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID,
  reason TEXT NOT NULL,
  FOREIGN KEY (empresa_id,document_id) REFERENCES transport_document_versions(empresa_id,id)
);
CREATE INDEX IF NOT EXISTS transport_document_lifecycle ON transport_document_events(empresa_id,document_id,created_at DESC);

CREATE OR REPLACE FUNCTION protect_transport_document_original() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Transport originals are immutable; create a new version or lifecycle event' USING ERRCODE='55000';
END;
$$;
DROP TRIGGER IF EXISTS transport_document_immutable ON transport_document_versions;
CREATE TRIGGER transport_document_immutable BEFORE UPDATE OR DELETE ON transport_document_versions
FOR EACH ROW EXECUTE FUNCTION protect_transport_document_original();

-- Additive policies/review evidence; no historical invoice or event conversion.
CREATE TABLE IF NOT EXISTS invoice_operational_policies (
 empresa_id UUID NOT NULL REFERENCES empresas(id), scope_key TEXT NOT NULL,
 reglas JSONB NOT NULL, updated_by UUID REFERENCES usuarios(id), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,scope_key)
);
CREATE TABLE IF NOT EXISTS invoice_operational_reviews (
 empresa_id UUID NOT NULL, pedido_id UUID NOT NULL, huella TEXT NOT NULL,
 usuario_id UUID REFERENCES usuarios(id), revisada_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,pedido_id), FOREIGN KEY(empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE TABLE IF NOT EXISTS invoice_operational_events (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id UUID NOT NULL REFERENCES empresas(id),
 usuario_id UUID REFERENCES usuarios(id),pedido_id UUID,evento TEXT NOT NULL,datos JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invoice_operational_events_scope ON invoice_operational_events(empresa_id,created_at DESC);

CREATE TABLE IF NOT EXISTS invoice_workflow_operations (
 empresa_id UUID NOT NULL REFERENCES empresas(id),request_hash TEXT NOT NULL,
 factura_id UUID REFERENCES facturas(id) ON DELETE SET NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,request_hash)
);

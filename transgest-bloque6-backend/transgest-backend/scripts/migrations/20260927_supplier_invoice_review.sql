CREATE TABLE IF NOT EXISTS facturas_proveedor (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id),
 proveedor_id uuid NOT NULL REFERENCES colaboradores(id), nombre text NOT NULL, mime text NOT NULL,
 original bytea NOT NULL, sha256 text NOT NULL, numero text, numero_normalizado text,
 datos jsonb NOT NULL DEFAULT '{}', extraccion jsonb, estado text NOT NULL DEFAULT 'revision' CHECK(estado IN ('revision','revisada')),
 version integer NOT NULL DEFAULT 1, revisada_por uuid REFERENCES usuarios(id), revisada_at timestamptz,
 created_by uuid REFERENCES usuarios(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,proveedor_id,sha256), UNIQUE(empresa_id,proveedor_id,numero_normalizado)
);
CREATE TABLE IF NOT EXISTS factura_proveedor_lineas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id),
 factura_id uuid NOT NULL REFERENCES facturas_proveedor(id), posicion integer NOT NULL, pedido_id uuid REFERENCES pedidos(id),
 datos jsonb NOT NULL, conciliacion jsonb NOT NULL, UNIQUE(factura_id,posicion)
);
CREATE TABLE IF NOT EXISTS factura_proveedor_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id), factura_id uuid NOT NULL REFERENCES facturas_proveedor(id),
 actor_id uuid REFERENCES usuarios(id), tipo text NOT NULL, datos jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS factura_proveedor_config (
 empresa_id uuid PRIMARY KEY REFERENCES empresas(id), tolerancia_eur numeric(12,2) NOT NULL DEFAULT 0 CHECK(tolerancia_eur>=0),
 tolerancia_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK(tolerancia_pct BETWEEN 0 AND 100), updated_by uuid REFERENCES usuarios(id),updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE colaborador_facturas ADD COLUMN IF NOT EXISTS factura_proveedor_id uuid REFERENCES facturas_proveedor(id);
CREATE INDEX IF NOT EXISTS factura_proveedor_empresa_fecha ON facturas_proveedor(empresa_id,proveedor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS factura_proveedor_lineas_pedido ON factura_proveedor_lineas(empresa_id,pedido_id);
CREATE INDEX IF NOT EXISTS colaborador_facturas_review ON colaborador_facturas(factura_proveedor_id);

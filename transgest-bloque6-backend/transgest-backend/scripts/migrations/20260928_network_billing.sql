ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS facturas_origen_at timestamptz;
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS facturas_destino_at timestamptz;
CREATE TABLE IF NOT EXISTS network_facturas (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), conexion_id uuid NOT NULL REFERENCES planner_conexiones_transporte(id),
 emisor_id uuid NOT NULL REFERENCES empresas(id), receptor_id uuid NOT NULL REFERENCES empresas(id),
 factura_id uuid NOT NULL REFERENCES facturas(id), recibida_id uuid NOT NULL REFERENCES facturas_proveedor(id),
 sha256 text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(emisor_id,factura_id,receptor_id)
);

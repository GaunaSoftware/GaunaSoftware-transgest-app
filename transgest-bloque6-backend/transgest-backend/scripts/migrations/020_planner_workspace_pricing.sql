ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS origen_producto text NOT NULL DEFAULT 'transgest';
CREATE INDEX IF NOT EXISTS pedidos_workspace_fecha_idx ON pedidos(empresa_id,origen_producto,fecha_carga);
ALTER TABLE planner_preparacion_lineas ADD COLUMN IF NOT EXISTS descuento_pct numeric(7,4) NOT NULL DEFAULT 0 CHECK(descuento_pct>=0 AND descuento_pct<=100);

-- Only existing orders with concrete warehouse/dock activity are migrated.
UPDATE pedidos p SET origen_producto='planner'
WHERE p.origen_producto='transgest' AND (
 EXISTS(SELECT 1 FROM planner_preparaciones r WHERE r.pedido_id=p.id AND r.empresa_id=p.empresa_id)
 OR EXISTS(SELECT 1 FROM planner_reservas r WHERE r.pedido_id=p.id AND r.empresa_id=p.empresa_id)
);

CREATE TABLE IF NOT EXISTS planner_conductores (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 colaborador_id uuid NOT NULL REFERENCES colaboradores(id),nombre varchar(100) NOT NULL,apellidos varchar(160) NOT NULL DEFAULT '',
 alias varchar(80) NOT NULL DEFAULT '',telefono varchar(40) NOT NULL DEFAULT '',email varchar(180) NOT NULL DEFAULT '',dni varchar(30) NOT NULL DEFAULT '',
 carnet varchar(80) NOT NULL DEFAULT '',activo boolean NOT NULL DEFAULT true,version integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS planner_conductores_proveedor_idx ON planner_conductores(empresa_id,colaborador_id);

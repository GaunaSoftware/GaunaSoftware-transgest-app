-- Saldo de artículos PALET expedidos por Planner, separado del libro de palés
-- de TransGest. No se reconstruyen salidas históricas sin evidencia.
CREATE UNIQUE INDEX IF NOT EXISTS planner_preparacion_lineas_tenant_id ON planner_preparacion_lineas(empresa_id,id);
CREATE TABLE IF NOT EXISTS planner_palets_cliente (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
 preparacion_linea_id uuid NOT NULL,
 cliente_id uuid NOT NULL,
 articulo_id uuid NOT NULL,
 existencia_id uuid NOT NULL,
 tipo varchar(16) NOT NULL CHECK (tipo IN ('entrega','devolucion')),
 cantidad numeric(16,3) NOT NULL CHECK (cantidad>0),
 entrega_id uuid REFERENCES planner_palets_cliente(id),
 operacion uuid NOT NULL,
 referencia varchar(160) NOT NULL DEFAULT '',
 created_by uuid REFERENCES usuarios(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (empresa_id,preparacion_linea_id) REFERENCES planner_preparacion_lineas(empresa_id,id),
 FOREIGN KEY (empresa_id,articulo_id) REFERENCES planner_articulos(empresa_id,id),
 FOREIGN KEY (empresa_id,existencia_id) REFERENCES planner_existencias(empresa_id,id),
 UNIQUE(empresa_id,operacion)
);
CREATE UNIQUE INDEX IF NOT EXISTS planner_palets_entrega_linea ON planner_palets_cliente(empresa_id,preparacion_linea_id) WHERE tipo='entrega';
CREATE INDEX IF NOT EXISTS planner_palets_cliente_saldo ON planner_palets_cliente(empresa_id,cliente_id,tipo,created_at);

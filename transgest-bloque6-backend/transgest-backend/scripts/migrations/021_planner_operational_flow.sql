ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS carga_inicio_at timestamptz;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS carga_fin_at timestamptz;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS reparto_coste jsonb;
ALTER TABLE planner_preparaciones ADD COLUMN IF NOT EXISTS muelle_carga_id uuid;
CREATE TABLE IF NOT EXISTS planner_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),
 pedido_id uuid REFERENCES pedidos(id) ON DELETE SET NULL,preparacion_id uuid REFERENCES planner_preparaciones(id),
 tipo text NOT NULL,datos jsonb NOT NULL DEFAULT '{}',created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS planner_eventos_pedido ON planner_eventos(empresa_id,pedido_id,created_at);

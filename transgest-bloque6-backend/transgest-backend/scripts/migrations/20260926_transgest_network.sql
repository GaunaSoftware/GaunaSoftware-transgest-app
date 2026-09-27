-- Supplier accounts must not depend on the optional demo seed to install their role.
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'colaborador';
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS scopes jsonb NOT NULL DEFAULT '[]';
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS consentimiento_origen_at timestamptz;
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS consentimiento_destino_at timestamptz;
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS consentimiento_version integer NOT NULL DEFAULT 1;
ALTER TABLE planner_conexiones_transporte ADD COLUMN IF NOT EXISTS revocada_at timestamptz;
-- Legacy rows are preserved. Synchronization now requires both explicit consents;
-- do not manufacture a historical consent from the previous active flag.
ALTER TABLE planner_viajes_compartidos ADD COLUMN IF NOT EXISTS external_reference text;
CREATE TABLE IF NOT EXISTS network_invitaciones (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),
 transportista_empresa_id uuid NOT NULL REFERENCES empresas(id),colaborador_id uuid NOT NULL REFERENCES colaboradores(id),
 pedido_id uuid NOT NULL REFERENCES pedidos(id),scopes jsonb NOT NULL,condiciones_hash text NOT NULL,condiciones jsonb NOT NULL,
 token_hash text NOT NULL UNIQUE,token_encrypted text NOT NULL,operacion uuid NOT NULL,fingerprint text NOT NULL,
 created_by uuid NOT NULL REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
 aceptada_at timestamptz,accepted_by uuid REFERENCES usuarios(id),revocada_at timestamptz,conexion_id uuid REFERENCES planner_conexiones_transporte(id),
 UNIQUE(empresa_id,operacion),CHECK(empresa_id<>transportista_empresa_id)
);
CREATE INDEX IF NOT EXISTS network_invite_owner ON network_invitaciones(empresa_id,created_at DESC);
CREATE TABLE IF NOT EXISTS network_eventos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid NOT NULL REFERENCES empresas(id),
 conexion_id uuid REFERENCES planner_conexiones_transporte(id),invitacion_id uuid REFERENCES network_invitaciones(id),
 tipo text NOT NULL,datos jsonb NOT NULL DEFAULT '{}',created_by uuid REFERENCES usuarios(id),created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS network_events_owner ON network_eventos(empresa_id,created_at DESC);
CREATE TABLE IF NOT EXISTS tracking_eta_snapshot (
 empresa_id uuid NOT NULL REFERENCES empresas(id),pedido_id uuid NOT NULL REFERENCES pedidos(id),
 position_recorded_at timestamptz NOT NULL,eta jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(empresa_id,pedido_id)
);

-- Office employees have their own requests; driver leave and payroll are unchanged.
-- This role already exists in access presets and the user editor, but was
-- missing from the fresh-install PostgreSQL enum.
ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'administrativo';
CREATE TABLE IF NOT EXISTS oficina_vacaciones_solicitudes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  motivo TEXT,
  estado VARCHAR(30) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','aprobada','rechazada')),
  resuelto_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  resuelto_at TIMESTAMPTZ,
  comentario_resolucion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (hasta >= desde)
);
CREATE INDEX IF NOT EXISTS idx_oficina_vacaciones_empresa_usuario ON oficina_vacaciones_solicitudes(empresa_id, usuario_id, desde);

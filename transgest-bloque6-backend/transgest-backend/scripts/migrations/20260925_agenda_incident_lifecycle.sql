-- Structured automatic incidents. Historical manual agenda entries are not inferred or rewritten.
-- Older installations created this table at application startup; fresh databases
-- must also be able to migrate before the application starts.
CREATE TABLE IF NOT EXISTS agenda_eventos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  creado_por UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  asignado_a UUID REFERENCES usuarios(id) ON DELETE SET NULL,
  titulo VARCHAR(220) NOT NULL,
  descripcion TEXT,
  fecha_inicio TIMESTAMPTZ NOT NULL,
  fecha_fin TIMESTAMPTZ,
  todo_dia BOOLEAN NOT NULL DEFAULT false,
  tipo VARCHAR(60) NOT NULL DEFAULT 'tarea',
  prioridad VARCHAR(20) NOT NULL DEFAULT 'media',
  estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  visibilidad VARCHAR(20) NOT NULL DEFAULT 'personal',
  pedido_id UUID REFERENCES pedidos(id) ON DELETE SET NULL,
  vehiculo_id UUID REFERENCES vehiculos(id) ON DELETE SET NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_empresa_fecha ON agenda_eventos(empresa_id, fecha_inicio);
CREATE INDEX IF NOT EXISTS idx_agenda_eventos_asignado ON agenda_eventos(empresa_id, asignado_a, fecha_inicio);

ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS cause_code TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS explanation TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS recommended_action TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS resolution_condition TEXT;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
ALTER TABLE agenda_eventos ADD COLUMN IF NOT EXISTS resolution_reason TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agenda_auto_incident_active
  ON agenda_eventos (empresa_id, source_type, source_id, cause_code)
  WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND cause_code IS NOT NULL AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agenda_incident_order
  ON agenda_eventos (empresa_id, pedido_id, generated_at DESC)
  WHERE source_type IS NOT NULL;

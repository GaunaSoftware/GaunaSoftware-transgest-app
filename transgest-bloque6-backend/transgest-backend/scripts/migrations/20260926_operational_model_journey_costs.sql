-- Journey-level costs are kept separate from existing per-order costs.
CREATE TABLE IF NOT EXISTS viaje_costes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  viaje_id UUID NOT NULL,
  client_operation_uuid UUID NOT NULL,
  concepto TEXT NOT NULL CHECK (length(trim(concepto)) > 0),
  referencia TEXT NOT NULL CHECK (length(trim(referencia)) > 0),
  importe_neto NUMERIC(14,2) NOT NULL CHECK (importe_neto >= 0),
  moneda TEXT NOT NULL DEFAULT 'EUR' CHECK (moneda = 'EUR'),
  fecha DATE NOT NULL,
  actor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  anulado_at TIMESTAMPTZ,
  anulacion_motivo TEXT,
  UNIQUE(empresa_id,client_operation_uuid),
  FOREIGN KEY(empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id)
);
CREATE UNIQUE INDEX IF NOT EXISTS viaje_costes_reference_active ON viaje_costes(empresa_id,lower(trim(referencia))) WHERE anulado_at IS NULL;

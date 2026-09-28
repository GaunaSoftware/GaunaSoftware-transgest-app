-- Company-wide insurance renewals. Vehicle policies remain in vehicle documents.
CREATE TABLE IF NOT EXISTS empresa_polizas_seguro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  aseguradora VARCHAR(160) NOT NULL,
  cobertura VARCHAR(200) NOT NULL,
  numero_poliza VARCHAR(120),
  matricula_referencia VARCHAR(32),
  fecha_vencimiento DATE NOT NULL,
  periodicidad VARCHAR(24),
  importe_referencia NUMERIC(12,2),
  correduria VARCHAR(160),
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT empresa_polizas_seguro_periodicidad_ck CHECK (periodicidad IS NULL OR periodicidad IN ('mensual','trimestral','semestral','anual','otra')),
  CONSTRAINT empresa_polizas_seguro_importe_ck CHECK (importe_referencia IS NULL OR importe_referencia >= 0)
);
CREATE INDEX IF NOT EXISTS empresa_polizas_seguro_vencimiento_idx
  ON empresa_polizas_seguro (empresa_id, fecha_vencimiento) WHERE activo = TRUE;

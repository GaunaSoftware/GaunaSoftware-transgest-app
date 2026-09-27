-- Promote the existing standalone localStorage migration into the release ledger.
-- Never replace an existing table or rewrite recorded expenses.
CREATE TABLE IF NOT EXISTS gastos_estructura (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(100) NOT NULL DEFAULT 'Otros gastos generales',
  importe NUMERIC(10,2) NOT NULL DEFAULT 0,
  periodo VARCHAR(20) NOT NULL DEFAULT 'mensual',
  fecha VARCHAR(7) NOT NULL,
  notas TEXT,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gastos_estr_empresa ON gastos_estructura(empresa_id);
CREATE INDEX IF NOT EXISTS idx_gastos_estr_fecha ON gastos_estructura(empresa_id,fecha);
ALTER TABLE gastos_estructura ADD COLUMN IF NOT EXISTS factura_nombre TEXT;
ALTER TABLE gastos_estructura ADD COLUMN IF NOT EXISTS factura_data TEXT;
CREATE TABLE IF NOT EXISTS meses_cerrados (
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  mes VARCHAR(7) NOT NULL,
  cerrado_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (empresa_id,mes)
);

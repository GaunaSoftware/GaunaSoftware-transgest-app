CREATE TABLE IF NOT EXISTS colaborador_pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  colaborador_id UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  fecha DATE NOT NULL, concepto VARCHAR(180), importe NUMERIC(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(20) NOT NULL DEFAULT 'pagado', notas TEXT,
  created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE colaborador_pagos ADD COLUMN IF NOT EXISTS factura_proveedor_id UUID REFERENCES facturas_proveedor(id);
ALTER TABLE colaborador_pagos ADD COLUMN IF NOT EXISTS client_operation_uuid UUID;
ALTER TABLE colaborador_pagos ADD COLUMN IF NOT EXISTS referencia TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS supplier_payment_operation ON colaborador_pagos(empresa_id,client_operation_uuid) WHERE client_operation_uuid IS NOT NULL;
CREATE INDEX IF NOT EXISTS supplier_payment_invoice ON colaborador_pagos(empresa_id,factura_proveedor_id);

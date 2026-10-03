CREATE TABLE IF NOT EXISTS pedido_colaborador_pagos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  colaborador_id UUID REFERENCES colaboradores(id) ON DELETE SET NULL,
  factura_nombre VARCHAR(255), factura_data TEXT,
  fecha_recepcion DATE, fecha_pago_calculada DATE, fecha_pago_real DATE,
  importe NUMERIC(12,2) NOT NULL DEFAULT 0,
  pagado BOOLEAN NOT NULL DEFAULT false,
  documentacion_recibida BOOLEAN NOT NULL DEFAULT false,
  fecha_documentacion_recepcion DATE, notas_pago TEXT,
  created_by UUID, updated_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE pedido_colaborador_pagos ADD COLUMN IF NOT EXISTS updated_by UUID;
-- Fail visibly if legacy duplicates exist; do not discard financial records.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pedido_colaborador_pago ON pedido_colaborador_pagos(pedido_id);

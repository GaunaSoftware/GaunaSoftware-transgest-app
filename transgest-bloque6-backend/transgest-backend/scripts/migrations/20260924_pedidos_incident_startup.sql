-- The overdue-delivery scheduler runs at startup, before the lazy pedido
-- route initialises its columns. Keep the shared incident fields available.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_tipo VARCHAR(80);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_descripcion TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_origen VARCHAR(40);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_creada_por UUID;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_creada_at TIMESTAMPTZ;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS incidencia_automatica BOOLEAN DEFAULT false;

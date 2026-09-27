-- Additive operational graph; no historical conversion and no runtime DDL.
CREATE UNIQUE INDEX IF NOT EXISTS pedidos_empresa_id_id_operativa ON pedidos(empresa_id,id);

CREATE TABLE IF NOT EXISTS pedidos_envios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  pedido_id UUID NOT NULL,
  referencia TEXT,
  snapshot JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id,id),
  UNIQUE (empresa_id,pedido_id,id),
  FOREIGN KEY (empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);

CREATE TABLE IF NOT EXISTS viajes_operativos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  legacy_pedido_id UUID,
  legacy_grupaje_id TEXT,
  client_operation_uuid UUID NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  ejecucion TEXT NOT NULL CHECK (ejecucion IN ('propia','subcontratada','sin_asignar')),
  asignacion_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  km_cargados NUMERIC CHECK (km_cargados >= 0),
  km_vacios NUMERIC CHECK (km_vacios >= 0),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (empresa_id,id),
  UNIQUE (empresa_id,legacy_pedido_id),
  UNIQUE (empresa_id,client_operation_uuid),
  FOREIGN KEY (empresa_id,legacy_pedido_id) REFERENCES pedidos(empresa_id,id)
);

CREATE TABLE IF NOT EXISTS viaje_pedidos (
  empresa_id UUID NOT NULL,
  viaje_id UUID NOT NULL,
  pedido_id UUID NOT NULL,
  PRIMARY KEY (empresa_id,viaje_id,pedido_id),
  FOREIGN KEY (empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id),
  FOREIGN KEY (empresa_id,pedido_id) REFERENCES pedidos(empresa_id,id)
);
CREATE INDEX IF NOT EXISTS viaje_pedidos_pedido_idx ON viaje_pedidos(empresa_id,pedido_id);

CREATE TABLE IF NOT EXISTS viaje_envios (
  empresa_id UUID NOT NULL,
  viaje_id UUID NOT NULL,
  envio_id UUID NOT NULL,
  pedido_id UUID NOT NULL,
  PRIMARY KEY (empresa_id,viaje_id,envio_id),
  FOREIGN KEY (empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id),
  FOREIGN KEY (empresa_id,viaje_id,pedido_id) REFERENCES viaje_pedidos(empresa_id,viaje_id,pedido_id),
  FOREIGN KEY (empresa_id,pedido_id,envio_id) REFERENCES pedidos_envios(empresa_id,pedido_id,id)
);

CREATE TABLE IF NOT EXISTS viaje_paradas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL,
  viaje_id UUID NOT NULL,
  orden INTEGER NOT NULL CHECK (orden > 0),
  tipo TEXT NOT NULL CHECK (tipo IN ('carga','descarga')),
  legacy_key TEXT,
  ubicacion JSONB NOT NULL,
  planificacion JSONB NOT NULL DEFAULT '{}'::jsonb,
  llegada_real_at TIMESTAMPTZ,
  inicio_real_at TIMESTAMPTZ,
  fin_real_at TIMESTAMPTZ,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  incidencias JSONB NOT NULL DEFAULT '[]'::jsonb,
  documentos JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidencias JSONB NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (empresa_id,id),
  UNIQUE (empresa_id,viaje_id,id),
  UNIQUE (empresa_id,viaje_id,orden),
  UNIQUE (empresa_id,viaje_id,legacy_key),
  FOREIGN KEY (empresa_id,viaje_id) REFERENCES viajes_operativos(empresa_id,id)
);

CREATE TABLE IF NOT EXISTS parada_envios (
  empresa_id UUID NOT NULL,
  viaje_id UUID NOT NULL,
  parada_id UUID NOT NULL,
  envio_id UUID NOT NULL,
  peso_kg NUMERIC CHECK (peso_kg >= 0),
  bultos NUMERIC CHECK (bultos >= 0),
  mercancia TEXT,
  PRIMARY KEY (empresa_id,parada_id,envio_id),
  FOREIGN KEY (empresa_id,viaje_id,parada_id) REFERENCES viaje_paradas(empresa_id,viaje_id,id),
  FOREIGN KEY (empresa_id,viaje_id,envio_id) REFERENCES viaje_envios(empresa_id,viaje_id,envio_id)
);

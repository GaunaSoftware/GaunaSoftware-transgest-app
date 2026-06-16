-- Añadir columnas que faltan en choferes
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS apellidos      VARCHAR(100);
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS tipo_contrato  VARCHAR(50);
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS salario        NUMERIC(10,2);
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS fecha_alta     DATE;
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS fecha_baja     DATE;
ALTER TABLE choferes ADD COLUMN IF NOT EXISTS chofer2_id     UUID REFERENCES choferes(id) ON DELETE SET NULL;

-- Añadir columnas que faltan en pedidos (segundo chofer)
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS chofer2_id         UUID REFERENCES choferes(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS reparto_chofer1    INTEGER DEFAULT 50;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_id     UUID REFERENCES colaboradores(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS colaborador_nombre VARCHAR(200);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_colaborador NUMERIC(10,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS precio_cliente_col NUMERIC(10,2);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_ruta            INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS km_vacio           INTEGER;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS hora_descarga      TIME;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS vehiculo_id2       UUID REFERENCES vehiculos(id) ON DELETE SET NULL;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS ultima_posicion    VARCHAR(200);
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS posicion_ts        TIMESTAMPTZ;

-- Añadir columnas que faltan en clientes
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS dir_envio_facturas VARCHAR(300);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS email_facturas     VARCHAR(150);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS modo_facturacion   VARCHAR(30) DEFAULT 'por_viaje';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS limite_riesgo      NUMERIC(10,2) DEFAULT 0;

-- Añadir columnas que faltan en vehiculos  
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS clase             VARCHAR(50);
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS bastidor          VARCHAR(50);
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS km_actuales       INTEGER DEFAULT 0;
ALTER TABLE vehiculos ADD COLUMN IF NOT EXISTS chofer_id         UUID REFERENCES choferes(id) ON DELETE SET NULL;

SELECT 'Migración de columnas completada' AS resultado;

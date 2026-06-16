-- ═══════════════════════════════════════════════════════════════════
-- PERFORMANCE INDEXES — ejecutar una sola vez
-- Reduce tiempos de carga de 3-10 segundos a <200ms
-- ═══════════════════════════════════════════════════════════════════

-- Pedidos: búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_estado    ON pedidos(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_pedidos_empresa_fecha     ON pedidos(empresa_id, fecha_carga DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_pedidos_vehiculo          ON pedidos(vehiculo_id) WHERE vehiculo_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_chofer            ON pedidos(chofer_id) WHERE chofer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_cliente           ON pedidos(cliente_id) WHERE cliente_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pedidos_factura           ON pedidos(factura_id) WHERE factura_id IS NOT NULL;

-- Facturas
CREATE INDEX IF NOT EXISTS idx_facturas_empresa_estado   ON facturas(empresa_id, estado);
CREATE INDEX IF NOT EXISTS idx_facturas_empresa_fecha    ON facturas(empresa_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_facturas_cliente          ON facturas(cliente_id);

-- factura_pedidos (la tabla de unión que estaba causando el 504)
CREATE INDEX IF NOT EXISTS idx_factura_pedidos_factura   ON factura_pedidos(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_pedidos_pedido    ON factura_pedidos(pedido_id);

-- Choferes
CREATE INDEX IF NOT EXISTS idx_choferes_empresa          ON choferes(empresa_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_choferes_vehiculo         ON choferes(vehiculo_id) WHERE vehiculo_id IS NOT NULL;

-- Vehículos
CREATE INDEX IF NOT EXISTS idx_vehiculos_empresa         ON vehiculos(empresa_id) WHERE activo = true;
CREATE INDEX IF NOT EXISTS idx_vehiculos_chofer          ON vehiculos(chofer_id) WHERE chofer_id IS NOT NULL;

-- Clientes
CREATE INDEX IF NOT EXISTS idx_clientes_empresa          ON clientes(empresa_id) WHERE activo = true;

-- Repostajes y noches (HojasRuta)
CREATE INDEX IF NOT EXISTS idx_repostajes_vehiculo_fecha ON vehiculo_repostajes(vehiculo_id, fecha DESC);
CREATE INDEX IF NOT EXISTS idx_noches_vehiculo_fecha     ON vehiculo_noches(vehiculo_id, fecha DESC);

-- Actualizar estadísticas del planificador
ANALYZE pedidos;
ANALYZE facturas;
ANALYZE factura_pedidos;
ANALYZE choferes;
ANALYZE vehiculos;

SELECT 'Índices de rendimiento creados correctamente ✅' AS resultado;

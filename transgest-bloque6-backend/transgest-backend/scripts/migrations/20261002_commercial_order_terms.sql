ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS origen_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL;
ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS destino_punto_id UUID REFERENCES puntos_interes(id) ON DELETE SET NULL;
ALTER TABLE ruta_precios_cliente ADD COLUMN IF NOT EXISTS observaciones_factura TEXT;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS tarifa_instrucciones JSONB;
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS observaciones_factura TEXT;

-- Fix demo data - link everything to the demo empresa
-- First ensure the demo empresa exists
INSERT INTO empresas (id, nombre, cif, email_admin, plan, estado, max_vehiculos, max_usuarios)
VALUES ('00000000-0000-0000-0000-000000000001', 'Empresa Demo', 'B-00000001', 'gerente@empresa.com', 'enterprise', 'activo', 999, 999)
ON CONFLICT (id) DO NOTHING;

-- Link existing usuarios to demo empresa
UPDATE usuarios SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL AND email IN ('gerente@empresa.com','contable@empresa.com','trafico@empresa.com','visor@empresa.com','chofer@empresa.com','cliente@empresa.com');

-- Link clientes to demo empresa
UPDATE clientes SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

-- Link vehiculos to demo empresa
UPDATE vehiculos SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

-- Link pedidos to demo empresa
UPDATE pedidos SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

-- Link rutas to demo empresa
UPDATE rutas SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

-- Link facturas to demo empresa
UPDATE facturas SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

-- Add demo choferes if none exist for this empresa
INSERT INTO choferes (nombre, apellidos, dni, telefono, email, categoria_carnet, tipo_contrato, salario, empresa_id)
SELECT 'Antonio', 'García López', '12345678A', '600111222', 'antonio@empresa.com', 'C+E', 'indefinido', 2200, '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM choferes WHERE empresa_id='00000000-0000-0000-0000-000000000001' AND nombre='Antonio');

INSERT INTO choferes (nombre, apellidos, dni, telefono, email, categoria_carnet, tipo_contrato, salario, empresa_id)
SELECT 'Manuel', 'Rodríguez Pérez', '87654321B', '600333444', 'manuel@empresa.com', 'C+E', 'indefinido', 2100, '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM choferes WHERE empresa_id='00000000-0000-0000-0000-000000000001' AND nombre='Manuel');

INSERT INTO choferes (nombre, apellidos, dni, telefono, email, categoria_carnet, tipo_contrato, salario, empresa_id)
SELECT 'José', 'Martínez Ruiz', '11223344C', '600555666', 'jose@empresa.com', 'C+E', 'autonomo', 1900, '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM choferes WHERE empresa_id='00000000-0000-0000-0000-000000000001' AND nombre='José');

-- Link existing choferes too (in case they exist without empresa_id)
UPDATE choferes SET empresa_id = '00000000-0000-0000-0000-000000000001'
WHERE empresa_id IS NULL;

SELECT 'Demo data fixed' AS resultado,
  (SELECT COUNT(*) FROM choferes WHERE empresa_id='00000000-0000-0000-0000-000000000001') AS choferes,
  (SELECT COUNT(*) FROM vehiculos WHERE empresa_id='00000000-0000-0000-0000-000000000001') AS vehiculos,
  (SELECT COUNT(*) FROM clientes WHERE empresa_id='00000000-0000-0000-0000-000000000001') AS clientes;

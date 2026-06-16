-- IVA configurable por cliente y colaborador.
-- tipo_iva guarda el porcentaje numerico usado en calculos.
-- iva_regimen conserva la etiqueta fiscal: general, reducido, superreducido, cero o exento.

ALTER TABLE clientes
  ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general';

UPDATE clientes
   SET iva_regimen = CASE
     WHEN COALESCE(tipo_iva, 21) = 21 THEN 'general'
     WHEN COALESCE(tipo_iva, 21) = 10 THEN 'reducido'
     WHEN COALESCE(tipo_iva, 21) = 4 THEN 'superreducido'
     WHEN COALESCE(tipo_iva, 21) = 0 THEN 'cero'
     ELSE iva_regimen
   END
 WHERE iva_regimen IS NULL OR iva_regimen = 'general';

ALTER TABLE colaboradores
  ADD COLUMN IF NOT EXISTS tipo_iva NUMERIC(5,2) NOT NULL DEFAULT 21,
  ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general';

ALTER TABLE facturas
  ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general';

UPDATE facturas f
   SET iva_regimen = COALESCE(c.iva_regimen, CASE
     WHEN COALESCE(f.tipo_iva, 21) = 21 THEN 'general'
     WHEN COALESCE(f.tipo_iva, 21) = 10 THEN 'reducido'
     WHEN COALESCE(f.tipo_iva, 21) = 4 THEN 'superreducido'
     WHEN COALESCE(f.tipo_iva, 21) = 0 THEN 'cero'
     ELSE 'general'
   END)
  FROM clientes c
 WHERE c.id = f.cliente_id
   AND c.empresa_id = f.empresa_id;

ALTER TABLE colaborador_facturas
  ADD COLUMN IF NOT EXISTS iva_regimen VARCHAR(30) NOT NULL DEFAULT 'general';


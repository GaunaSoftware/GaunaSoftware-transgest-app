-- Non-fiscal proposals are never accepted revenue or evidence of a client's acceptance.
ALTER TABLE pedido_paralizaciones DROP CONSTRAINT IF EXISTS pedido_paralizaciones_estado_check;
ALTER TABLE pedido_paralizaciones ADD CONSTRAINT pedido_paralizaciones_estado_check
 CHECK(estado IN ('preparada','reclamada','aceptada','rechazada'));
ALTER TABLE pedido_paralizaciones ALTER COLUMN documento_id DROP NOT NULL;
ALTER TABLE pedido_paralizaciones ADD COLUMN IF NOT EXISTS prefactura jsonb;
ALTER TABLE pedido_paralizaciones DROP CONSTRAINT IF EXISTS paralizacion_evidencia_estado;
ALTER TABLE pedido_paralizaciones ADD CONSTRAINT paralizacion_evidencia_estado
 CHECK((estado='preparada' AND documentado=0 AND aceptado=0 AND prefactura IS NOT NULL)
   OR (estado<>'preparada' AND documento_id IS NOT NULL));

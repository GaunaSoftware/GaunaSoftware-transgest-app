-- Las empresas anteriores requieren clasificación explícita: no se presume
-- que una contratación existente pertenezca al canal Directa.
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS origen_comercial text;
ALTER TABLE empresas DROP CONSTRAINT IF EXISTS empresas_origen_comercial_check;
ALTER TABLE empresas ADD CONSTRAINT empresas_origen_comercial_check CHECK (origen_comercial IN ('directa','canal'));

-- Control pasa a Pro. La facturación histórica y las suscripciones Stripe ya
-- existentes no se reescriben; SuperAdmin debe conciliarlas antes de renovar.
UPDATE empresas SET plan = 'profesional' WHERE plan = 'basico';
ALTER TABLE empresas ALTER COLUMN plan SET DEFAULT 'profesional';

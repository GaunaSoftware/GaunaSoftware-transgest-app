ALTER TABLE viajes_operativos ADD COLUMN IF NOT EXISTS relevos JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE IF EXISTS route_optimizations ADD COLUMN IF NOT EXISTS constraint_review JSONB;

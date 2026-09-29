-- Snapshot of an explicitly confirmed fuel clause applied at invoice preparation.
-- The order price and its originally registered surcharge remain unchanged.
ALTER TABLE facturas ADD COLUMN IF NOT EXISTS fuel_clause JSONB;

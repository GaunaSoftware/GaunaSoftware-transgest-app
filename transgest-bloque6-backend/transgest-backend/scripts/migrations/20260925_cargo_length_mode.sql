-- New orders may follow the trailer length; NULL preserves every legacy order's
-- recorded occupied length until a user explicitly chooses automatic/manual.
ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS longitud_ocupada_mode VARCHAR(8);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'pedidos'::regclass AND conname = 'pedidos_longitud_ocupada_mode_check'
  ) THEN
    ALTER TABLE pedidos ADD CONSTRAINT pedidos_longitud_ocupada_mode_check
      CHECK (longitud_ocupada_mode IS NULL OR longitud_ocupada_mode IN ('auto', 'manual'));
  END IF;
END $$;

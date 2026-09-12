-- Optional, user-supplied raster image. Existing customers remain without an image.
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS imagen_data TEXT;

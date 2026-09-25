CREATE TABLE IF NOT EXISTS empresa_factura_plantillas (
  empresa_id uuid PRIMARY KEY REFERENCES empresas(id) ON DELETE CASCADE,
  nombre text NOT NULL,
  mime text NOT NULL CHECK (mime IN ('image/png','image/jpeg')),
  imagen_base64 text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS planner_reglas_reposicion (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL REFERENCES empresas(id),
 articulo_id uuid NOT NULL REFERENCES planner_articulos(id), ubicacion_id uuid NOT NULL REFERENCES planner_ubicaciones(id),
 minimo numeric(16,3) NOT NULL CHECK(minimo>=0), objetivo numeric(16,3) NOT NULL CHECK(objetivo>minimo),
 conteo_dias integer NOT NULL CHECK(conteo_dias BETWEEN 1 AND 3650), activo boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(empresa_id,articulo_id,ubicacion_id)
);

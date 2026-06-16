-- Tabla vehículos de colaboradores
CREATE TABLE IF NOT EXISTS colaborador_vehiculos (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  colaborador_id  UUID NOT NULL REFERENCES colaboradores(id) ON DELETE CASCADE,
  empresa_id      UUID,
  matricula       VARCHAR(20) NOT NULL,
  marca           VARCHAR(80),
  modelo          VARCHAR(80),
  año             SMALLINT,
  tipo            VARCHAR(50) DEFAULT 'Camión',
  tara_kg         NUMERIC(8,2),
  carga_max_kg    NUMERIC(8,2),
  bastidor        VARCHAR(30),
  num_ejes        SMALLINT DEFAULT 2,
  longitud_m      NUMERIC(5,2),
  notas           TEXT,
  -- Documentación
  doc_tarjeta_transp  TEXT,
  doc_tarjeta_exp     DATE,
  doc_seguro_venc     DATE,
  doc_itv_venc        DATE,
  doc_tacografo_venc  DATE,
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_colab_veh_colaborador ON colaborador_vehiculos(colaborador_id);

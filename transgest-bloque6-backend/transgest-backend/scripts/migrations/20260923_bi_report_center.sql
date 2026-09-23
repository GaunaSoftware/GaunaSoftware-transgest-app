-- BI phase 5: private views and expiring, tenant-scoped report snapshots.
CREATE TABLE IF NOT EXISTS bi_report_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  nombre varchar(120) NOT NULL,
  descripcion varchar(500) NOT NULL DEFAULT '',
  alcance varchar(12) NOT NULL CHECK (alcance IN ('personal','compartida')),
  configuracion jsonb NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bi_report_views_tenant_idx ON bi_report_views(empresa_id,alcance,owner_id);

CREATE TABLE IF NOT EXISTS bi_report_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  view_id uuid REFERENCES bi_report_views(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  contract_version varchar(40) NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS bi_report_runs_owner_idx ON bi_report_runs(empresa_id,owner_id,expires_at);

CREATE TABLE IF NOT EXISTS bi_report_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES bi_report_runs(id) ON DELETE CASCADE,
  formato varchar(4) NOT NULL CHECK (formato IN ('pdf','xlsx','csv')),
  contenido bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);
CREATE INDEX IF NOT EXISTS bi_report_exports_owner_idx ON bi_report_exports(empresa_id,owner_id,expires_at);

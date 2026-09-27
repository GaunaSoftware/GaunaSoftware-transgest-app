CREATE TABLE IF NOT EXISTS integration_registry (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), scope_key text NOT NULL,
 empresa_id uuid REFERENCES empresas(id), provider text NOT NULL,
 environment text NOT NULL DEFAULT 'sandbox' CHECK(environment IN ('sandbox','production')),
 api_version text NOT NULL DEFAULT 'unspecified', state text NOT NULL DEFAULT 'planned'
 CHECK(state IN ('planned','development','sandbox_verified','pilot','production_ready','degraded')),
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(scope_key,provider), CHECK(scope_key=COALESCE(empresa_id::text,'global'))
);
CREATE TABLE IF NOT EXISTS integration_registry_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), registry_id uuid NOT NULL REFERENCES integration_registry(id),
 sequence bigserial NOT NULL, kind text NOT NULL CHECK(kind IN ('definition','state','evidence','health')),
 criterion text, passed boolean, reference text, source text NOT NULL,
 environment text NOT NULL, api_version text NOT NULL, actor text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS integration_registry_events_lookup ON integration_registry_events(registry_id,created_at DESC);

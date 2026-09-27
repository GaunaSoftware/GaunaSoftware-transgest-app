-- Additive, per-account release acknowledgements and per-company agenda choices.
CREATE TABLE IF NOT EXISTS user_release_acknowledgements (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  release_id VARCHAR(100) NOT NULL,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, release_id)
);
CREATE TABLE IF NOT EXISTS agenda_preferences (
  usuario_id UUID NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  notice_types JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (usuario_id, empresa_id)
);

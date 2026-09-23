-- Weekly BI mail is opt-in per active manager. A delivery is attempted at most
-- once for each recipient and completed Madrid civil week.
CREATE TABLE IF NOT EXISTS bi_weekly_subscriptions (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, user_id)
);

CREATE TABLE IF NOT EXISTS bi_weekly_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('preparando','enviando','enviado','sin_smtp','por_verificar','fallido')),
  run_id uuid REFERENCES bi_report_runs(id) ON DELETE SET NULL,
  message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, user_id, week_start)
);
CREATE INDEX IF NOT EXISTS bi_weekly_deliveries_recent_idx
  ON bi_weekly_deliveries (empresa_id, user_id, week_start DESC);

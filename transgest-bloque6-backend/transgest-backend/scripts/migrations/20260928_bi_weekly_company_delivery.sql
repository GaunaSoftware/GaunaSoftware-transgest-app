-- One transport hand-off per company and Madrid week. Existing recipient
-- deliveries are backfilled so deploying this guard cannot repeat a sent week.
CREATE TABLE IF NOT EXISTS bi_weekly_company_deliveries (
  empresa_id uuid NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  owner_id uuid REFERENCES usuarios(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL CHECK (status IN ('preparando','enviando','enviado','sin_smtp','por_verificar','fallido')),
  message_id text,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (empresa_id, week_start)
);
INSERT INTO bi_weekly_company_deliveries(empresa_id,week_start,owner_id,status,message_id,error,updated_at)
SELECT DISTINCT ON (empresa_id,week_start) empresa_id,week_start,user_id,
  CASE WHEN status='enviado' THEN 'enviado' ELSE 'por_verificar' END,message_id,
  'Envío anterior a la protección por empresa; no se reenvía automáticamente.',updated_at
FROM bi_weekly_deliveries
ORDER BY empresa_id,week_start,(status='enviado') DESC,updated_at DESC
ON CONFLICT (empresa_id,week_start) DO NOTHING;

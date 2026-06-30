DO $$
DECLARE
  constraint_name TEXT;
BEGIN
  FOR constraint_name IN
    SELECT conname
      FROM pg_constraint
     WHERE conrelid = 'accounting.journal_entries'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%entry_type%'
  LOOP
    EXECUTE format('ALTER TABLE accounting.journal_entries DROP CONSTRAINT IF EXISTS %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE accounting.journal_entries
  ADD CONSTRAINT chk_journal_entries_entry_type
    CHECK (entry_type IN ('manual', 'reversal', 'depreciation')),
  ADD CONSTRAINT chk_journal_entries_reversal_links
    CHECK (
      (
        entry_type IN ('manual', 'depreciation')
        AND reversal_of_entry_id IS NULL
      )
      OR
      (
        entry_type = 'reversal'
        AND reversal_of_entry_id IS NOT NULL
        AND reversal_reason IS NOT NULL
      )
    );

CREATE TABLE IF NOT EXISTS accounting.depreciation_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE RESTRICT,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE RESTRICT,
  fixed_asset_id UUID NOT NULL REFERENCES accounting.accounting_fixed_assets(id) ON DELETE RESTRICT,
  fiscal_year_id UUID NOT NULL REFERENCES accounting.fiscal_years(id) ON DELETE RESTRICT,
  period_id UUID NOT NULL REFERENCES accounting.accounting_periods(id) ON DELETE RESTRICT,
  journal_entry_id UUID NOT NULL REFERENCES accounting.journal_entries(id) ON DELETE RESTRICT,
  run_date DATE NOT NULL,
  amount NUMERIC(18,6) NOT NULL,
  plan_from_date DATE NOT NULL,
  plan_to_date DATE NOT NULL,
  plan_periods INTEGER[] NOT NULL DEFAULT '{}',
  status VARCHAR(30) NOT NULL DEFAULT 'draft_created',
  idempotency_key VARCHAR(120) NOT NULL,
  created_by UUID REFERENCES accounting.accounting_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (amount > 0),
  CHECK (status IN ('draft_created')),
  UNIQUE (company_id, fixed_asset_id, period_id),
  UNIQUE (company_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_depreciation_runs_asset
  ON accounting.depreciation_runs(company_id, fixed_asset_id, run_date DESC);

CREATE INDEX IF NOT EXISTS idx_depreciation_runs_period
  ON accounting.depreciation_runs(company_id, fiscal_year_id, period_id);

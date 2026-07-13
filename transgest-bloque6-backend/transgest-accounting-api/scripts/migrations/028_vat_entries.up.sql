-- Libro registro de IVA por factura (base, tipo, cuota, tercero), alimentado
-- desde la facturacion del TMS principal via /invoices/ingest.
CREATE TABLE IF NOT EXISTS accounting.accounting_vat_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES accounting.accounting_tenants(id) ON DELETE CASCADE,
  company_id UUID NOT NULL REFERENCES accounting.accounting_companies(id) ON DELETE CASCADE,
  direction VARCHAR(20) NOT NULL,
  entry_date DATE NOT NULL,
  party_tax_id VARCHAR(40),
  party_name VARCHAR(220),
  invoice_number VARCHAR(80),
  base NUMERIC(18,2) NOT NULL DEFAULT 0,
  iva_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  iva_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  irpf_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  irpf_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  total NUMERIC(18,2) NOT NULL DEFAULT 0,
  source_system VARCHAR(60) NOT NULL DEFAULT 'transgest',
  source_ref VARCHAR(180) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (direction IN ('repercutido', 'soportado')),
  UNIQUE (company_id, source_system, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_vat_entries_company_date
  ON accounting.accounting_vat_entries(company_id, entry_date);

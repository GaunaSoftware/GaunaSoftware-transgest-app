const db = require("./db");

const ACCOUNTING_INTEGRATION_CATALOG_VERSION = "2026-06-17";
const ACCOUNTING_INTEGRATION_STATUSES = ["not_configured", "assessing", "export_ready", "pilot", "active", "paused"];
const ACCOUNTING_MAPPING_STATUSES = ["pending", "drafted", "validated"];
const ACCOUNTING_MAPPING_ITEMS = [
  "chart_of_accounts",
  "parties",
  "taxes",
  "journal_entries",
  "bank_transactions",
  "documents",
];
const ACCOUNTING_MAPPING_ITEM_LABELS = {
  chart_of_accounts: "Plan contable",
  parties: "Terceros",
  taxes: "Impuestos",
  journal_entries: "Diario",
  bank_transactions: "Bancos",
  documents: "Documentos",
};

const accountingIntegrationCatalog = [
  {
    id: "sage-50-contaplus",
    name: "Sage 50 / ContaPlus",
    vendor: "Sage",
    priority: 1,
    category: "desktop_cloud_connected",
    status: "research",
    recommended_mode: "export_first",
    connector: "CSV/Excel + paquete asesoria",
    flows: ["plan contable", "terceros", "diario", "balance sumas y saldos"],
    source_url: "https://www.sage.com/es-es/productos/sage-50/",
    risk: "Versiones e instalaciones locales variables; requiere validacion con asesor o partner.",
  },
  {
    id: "sage-200",
    name: "Sage 200",
    vendor: "Sage",
    priority: 2,
    category: "erp",
    status: "research",
    recommended_mode: "bidirectional_with_approval",
    connector: "Partner/API + ficheros controlados",
    flows: ["terceros", "documentos", "asientos", "bancos", "balances"],
    source_url: "https://www.sage.com/es-es/productos/sage-200/",
    risk: "Implantaciones personalizadas y permisos/licencias de API.",
  },
  {
    id: "a3innuva-a3asesor",
    name: "Wolters Kluwer a3innuva / a3ASESOR",
    vendor: "Wolters Kluwer",
    priority: 3,
    category: "advisor_suite",
    status: "research",
    recommended_mode: "advisor_export",
    connector: "Paquete asesoria + revision marketplace",
    flows: ["diario", "mayor", "balances", "terceros", "documentos fuente"],
    source_url: "https://www.wolterskluwer.com/es-es/solutions/a3innuva",
    risk: "Ecosistema cerrado; campos fiscales a confirmar con asesoria.",
  },
  {
    id: "holded",
    name: "Holded",
    vendor: "Holded / Visma",
    priority: 4,
    category: "cloud_erp",
    status: "planned",
    recommended_mode: "api_with_outbox",
    connector: "REST API + outbox + fallback CSV",
    flows: ["plan contable", "asientos", "terceros", "facturas", "compras", "bancos"],
    source_url: "https://www.holded.com/es/desarrolladores",
    risk: "Limites de API, webhooks disponibles segun producto y mapeo de impuestos.",
  },
  {
    id: "contasol-factusol",
    name: "CONTASOL / FACTUSOL",
    vendor: "TeamSystem / Software DELSOL",
    priority: 5,
    category: "desktop_cloud_hybrid",
    status: "planned",
    recommended_mode: "file_import_export",
    connector: "Excel/CSV + guia de importacion",
    flows: ["plan contable", "asientos", "balances", "terceros", "bancos"],
    source_url: "https://www.sdelsol.com/programa-contabilidad-contasol/",
    risk: "No asumir API publica; plantillas dependientes de version.",
  },
  {
    id: "odoo",
    name: "Odoo",
    vendor: "Odoo",
    priority: 6,
    category: "erp",
    status: "planned",
    recommended_mode: "api_with_outbox",
    connector: "XML-RPC/JSON-RPC + CSV",
    flows: ["terceros", "facturas", "compras", "pagos", "asientos", "bancos"],
    source_url: "https://www.odoo.com/documentation/18.0/developer/reference/external_api.html",
    risk: "Modelo muy configurable y localizacion fiscal dependiente de la instalacion.",
  },
  {
    id: "anfix",
    name: "Anfix",
    vendor: "Anfix",
    priority: 7,
    category: "cloud_accounting",
    status: "research",
    recommended_mode: "export_first",
    connector: "CSV/Excel + revision API",
    flows: ["facturas", "gastos", "bancos", "asientos", "impuestos"],
    source_url: "https://www.anfix.com/",
    risk: "API publica y alcance tecnico pendientes de confirmar.",
  },
  {
    id: "quipu",
    name: "Quipu",
    vendor: "Quipu",
    priority: 8,
    category: "cloud_accounting",
    status: "research",
    recommended_mode: "export_first",
    connector: "CSV/Excel + paquete documental",
    flows: ["facturas", "gastos", "terceros", "cobros", "pagos"],
    source_url: "https://getquipu.com/",
    risk: "API publica pendiente de validar y control de duplicados documental.",
  },
  {
    id: "billin",
    name: "Billin / TS Facturas Billin",
    vendor: "Billin / TeamSystem",
    priority: 9,
    category: "cloud_invoicing",
    status: "research",
    recommended_mode: "fiscal_boundary_export",
    connector: "Exportacion documental + CSV",
    flows: ["facturas", "tickets", "terceros", "cobros"],
    source_url: "https://www.billin.net/",
    risk: "Tratarlo como frontera documental/facturacion, no como libro mayor maestro.",
  },
  {
    id: "facturascripts",
    name: "FacturaScripts",
    vendor: "FacturaScripts",
    priority: 10,
    category: "open_source_erp",
    status: "planned",
    recommended_mode: "plugin_or_api",
    connector: "Plugin/API + CSV",
    flows: ["terceros", "facturas", "asientos", "pagos", "productos"],
    source_url: "https://facturascripts.com/",
    risk: "Variacion por plugins y versiones autoalojadas.",
  },
];

function summarizeAccountingIntegrations(items = accountingIntegrationCatalog) {
  return items.reduce((acc, item) => {
    acc.total += 1;
    acc.by_status[item.status] = (acc.by_status[item.status] || 0) + 1;
    acc.by_mode[item.recommended_mode] = (acc.by_mode[item.recommended_mode] || 0) + 1;
    acc.by_category[item.category] = (acc.by_category[item.category] || 0) + 1;
    return acc;
  }, { total: 0, by_status: {}, by_mode: {}, by_category: {} });
}

function findAccountingIntegration(id) {
  return accountingIntegrationCatalog.find(item => item.id === id) || null;
}

function cleanText(value, maxLength = 200) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeMappingItems(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return ACCOUNTING_MAPPING_ITEMS.reduce((acc, key) => {
    acc[key] = source[key] === true || source[key] === "true" || source[key] === 1 || source[key] === "1";
    return acc;
  }, {});
}

function countReadyMappingItems(mappingItems = {}) {
  return ACCOUNTING_MAPPING_ITEMS.filter(key => mappingItems[key] === true).length;
}

function normalizeAccountingIntegrationConfigInput(input = {}) {
  const connectorId = cleanText(input.connector_id, 80);
  const connector = connectorId ? findAccountingIntegration(connectorId) : null;
  if (connectorId && !connector) {
    const err = new Error("Conector contable no reconocido");
    err.status = 400;
    throw err;
  }

  const status = cleanText(input.status || "not_configured", 30);
  if (!ACCOUNTING_INTEGRATION_STATUSES.includes(status)) {
    const err = new Error("Estado de integracion contable no valido");
    err.status = 400;
    throw err;
  }

  const mode = cleanText(input.mode || connector?.recommended_mode || "advisor_export", 60);
  const allowedModes = new Set([
    "export_first",
    "advisor_export",
    "api_with_outbox",
    "bidirectional_with_approval",
    "file_import_export",
    "fiscal_boundary_export",
    "plugin_or_api",
  ]);
  if (!allowedModes.has(mode)) {
    const err = new Error("Modo de integracion contable no valido");
    err.status = 400;
    throw err;
  }

  const mappingStatus = cleanText(input.mapping_status || "pending", 30);
  if (!ACCOUNTING_MAPPING_STATUSES.includes(mappingStatus)) {
    const err = new Error("Estado de mapeo contable no valido");
    err.status = 400;
    throw err;
  }
  const mappingItems = normalizeMappingItems(input.mapping_items || input.metadata?.mapping_items || {});
  const mappingReadyCount = countReadyMappingItems(mappingItems);

  return {
    connector_id: connectorId || "",
    connector_name: connector?.name || "",
    status,
    mode,
    owner_email: cleanText(input.owner_email, 200).toLowerCase(),
    advisor_name: cleanText(input.advisor_name, 160),
    mapping_status: mappingStatus,
    notes: cleanText(input.notes, 2000),
    metadata: {
      catalog_version: ACCOUNTING_INTEGRATION_CATALOG_VERSION,
      connector_vendor: connector?.vendor || "",
      connector_category: connector?.category || "",
      source_url: connector?.source_url || "",
      mapping_items: mappingItems,
      mapping_ready_count: mappingReadyCount,
    },
  };
}

async function ensureAccountingIntegrationSettingsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS accounting_external_integration_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      connector_id VARCHAR(80) NOT NULL DEFAULT '',
      connector_name VARCHAR(160) NOT NULL DEFAULT '',
      status VARCHAR(30) NOT NULL DEFAULT 'not_configured',
      mode VARCHAR(60) NOT NULL DEFAULT 'advisor_export',
      owner_email VARCHAR(200) NOT NULL DEFAULT '',
      advisor_name VARCHAR(160) NOT NULL DEFAULT '',
      mapping_status VARCHAR(30) NOT NULL DEFAULT 'pending',
      notes TEXT NOT NULL DEFAULT '',
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id)
    )
  `);
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_accounting_external_configs_status
    ON accounting_external_integration_configs(status, updated_at DESC)
  `).catch(() => {});
}

function publicConfigRow(row = {}) {
  const metadata = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const mappingItems = normalizeMappingItems(metadata.mapping_items || {});
  const mappingReadyCount = Number.isFinite(Number(metadata.mapping_ready_count))
    ? Number(metadata.mapping_ready_count)
    : countReadyMappingItems(mappingItems);
  return {
    empresa_id: row.empresa_id,
    empresa_nombre: row.empresa_nombre || "",
    connector_id: row.connector_id || "",
    connector_name: row.connector_name || "",
    status: row.status || "not_configured",
    mode: row.mode || "advisor_export",
    owner_email: row.owner_email || "",
    advisor_name: row.advisor_name || "",
    mapping_status: row.mapping_status || "pending",
    notes: row.notes || "",
    metadata,
    mapping_items: mappingItems,
    mapping_ready_count: mappingReadyCount,
    updated_at: row.updated_at || null,
  };
}

async function listCompanyAccountingIntegrationConfigs() {
  await ensureAccountingIntegrationSettingsTable();
  const { rows } = await db.query(`
    SELECT
      e.id AS empresa_id,
      e.nombre AS empresa_nombre,
      COALESCE(c.connector_id, '') AS connector_id,
      COALESCE(c.connector_name, '') AS connector_name,
      COALESCE(c.status, 'not_configured') AS status,
      COALESCE(c.mode, 'advisor_export') AS mode,
      COALESCE(c.owner_email, '') AS owner_email,
      COALESCE(c.advisor_name, '') AS advisor_name,
      COALESCE(c.mapping_status, 'pending') AS mapping_status,
      COALESCE(c.notes, '') AS notes,
      COALESCE(c.metadata, '{}'::jsonb) AS metadata,
      c.updated_at
    FROM empresas e
    LEFT JOIN accounting_external_integration_configs c ON c.empresa_id=e.id
    ORDER BY e.nombre ASC
  `);
  return rows.map(publicConfigRow);
}

function summarizeCompanyAccountingSettings(settings = []) {
  return settings.reduce((acc, item) => {
    acc.total += 1;
    acc.by_status[item.status] = (acc.by_status[item.status] || 0) + 1;
    acc.by_mode[item.mode] = (acc.by_mode[item.mode] || 0) + 1;
    if (item.connector_id) acc.with_connector += 1;
    if (item.status === "active") acc.active += 1;
    return acc;
  }, { total: 0, with_connector: 0, active: 0, by_status: {}, by_mode: {} });
}

async function upsertCompanyAccountingIntegrationConfig(empresaId, input = {}, actorId = null) {
  await ensureAccountingIntegrationSettingsTable();
  const normalized = normalizeAccountingIntegrationConfigInput(input);
  const { rows } = await db.query(`
    INSERT INTO accounting_external_integration_configs (
      empresa_id, connector_id, connector_name, status, mode, owner_email,
      advisor_name, mapping_status, notes, metadata, updated_by, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,NOW())
    ON CONFLICT (empresa_id) DO UPDATE SET
      connector_id=EXCLUDED.connector_id,
      connector_name=EXCLUDED.connector_name,
      status=EXCLUDED.status,
      mode=EXCLUDED.mode,
      owner_email=EXCLUDED.owner_email,
      advisor_name=EXCLUDED.advisor_name,
      mapping_status=EXCLUDED.mapping_status,
      notes=EXCLUDED.notes,
      metadata=EXCLUDED.metadata,
      updated_by=EXCLUDED.updated_by,
      updated_at=NOW()
    RETURNING *
  `, [
    empresaId,
    normalized.connector_id,
    normalized.connector_name,
    normalized.status,
    normalized.mode,
    normalized.owner_email,
    normalized.advisor_name,
    normalized.mapping_status,
    normalized.notes,
    JSON.stringify(normalized.metadata),
    actorId,
  ]);
  return publicConfigRow(rows[0]);
}

function buildAccountingIntegrationsGovernance() {
  const accountingFrontendUrl = (process.env.ACCOUNTING_FRONTEND_URL || "http://localhost:8080").replace(/\/+$/, "");
  return {
    catalog_version: ACCOUNTING_INTEGRATION_CATALOG_VERSION,
    owner: "superadmin",
    urls: {
      accounting_frontend: accountingFrontendUrl,
      connectors: `${accountingFrontendUrl}/?tab=integrations`,
    },
    summary: summarizeAccountingIntegrations(),
    integrations: accountingIntegrationCatalog,
    controls: [
      "La activacion y priorizacion de conectores externos se gobierna desde Superadmin.",
      "Ningun conector externo puede escribir directamente en tablas contables.",
      "Las escrituras contables futuras deben pasar por API interna, casos de uso validados y outbox/idempotencia.",
      "Las exportaciones hacia asesoria o software externo no equivalen a cumplimiento legal ni sustituyen revision profesional.",
    ],
    allowed_paths: [
      "exportacion_csv_excel",
      "paquete_asesoria",
      "api_con_outbox_idempotente",
      "plugin_adaptador_versionado",
    ],
    blocked_paths: [
      "insert_directo_tablas_contables",
      "doble_emision_facturas_fiscales",
      "sincronizacion_bidireccional_sin_aprobacion",
      "credenciales_compartidas_entre_empresas",
    ],
    next_steps: [
      "Completar mapeos por empresa para plan contable, terceros, impuestos, diario, bancos y documentos.",
      "Crear colas de sincronizacion con idempotency key por documento/evento.",
      "Validar formatos reales con asesoria o proveedor antes de activar escritura automatica.",
    ],
    disclaimer: "Catalogo tecnico preliminar. No declara certificacion, homologacion ni cumplimiento legal.",
  };
}

module.exports = {
  ACCOUNTING_INTEGRATION_CATALOG_VERSION,
  ACCOUNTING_INTEGRATION_STATUSES,
  ACCOUNTING_MAPPING_ITEMS,
  ACCOUNTING_MAPPING_ITEM_LABELS,
  ACCOUNTING_MAPPING_STATUSES,
  accountingIntegrationCatalog,
  buildAccountingIntegrationsGovernance,
  countReadyMappingItems,
  ensureAccountingIntegrationSettingsTable,
  findAccountingIntegration,
  listCompanyAccountingIntegrationConfigs,
  normalizeAccountingIntegrationConfigInput,
  normalizeMappingItems,
  summarizeCompanyAccountingSettings,
  summarizeAccountingIntegrations,
  upsertCompanyAccountingIntegrationConfig,
};

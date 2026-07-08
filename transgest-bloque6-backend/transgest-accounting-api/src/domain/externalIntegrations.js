const INTEGRATION_CATALOG_VERSION = "2026-06-17";

const externalAccountingIntegrations = [
  {
    id: "sage-50-contaplus",
    name: "Sage 50 / ContaPlus",
    vendor: "Sage",
    category: "desktop_cloud_connected",
    priority: 1,
    status: "research",
    recommended_mode: "export_first",
    connectors: ["csv_excel_export", "advisor_pack", "partner_api_review"],
    flows: ["chart_of_accounts", "parties", "journal_entries", "trial_balance", "bank_transactions"],
    source_url: "https://www.sage.com/es-es/productos/sage-50/",
    notes: "Producto historico en pymes y asesorias espanolas. Priorizar exportaciones auditables y revisar API/SDK disponible por partner antes de automatizar escrituras.",
    risks: ["formatos variables por version", "instalaciones on-premise", "validacion por asesor requerida"],
  },
  {
    id: "sage-200",
    name: "Sage 200",
    vendor: "Sage",
    category: "erp",
    priority: 2,
    status: "research",
    recommended_mode: "bidirectional_with_approval",
    connectors: ["csv_excel_import_export", "partner_connector", "banking_export"],
    flows: ["parties", "sales_purchase_documents", "journal_entries", "bank_transactions", "trial_balance"],
    source_url: "https://www.sage.com/es-es/productos/sage-200/",
    notes: "ERP modular para pymes medianas. Conviene plantear integracion por partner o ficheros controlados, con aprobacion manual de asientos.",
    risks: ["personalizaciones por implantador", "licencias y permisos de API", "mapeo de dimensiones analiticas"],
  },
  {
    id: "a3innuva-a3asesor",
    name: "Wolters Kluwer a3innuva / a3ASESOR",
    vendor: "Wolters Kluwer",
    category: "advisor_suite",
    priority: 3,
    status: "research",
    recommended_mode: "advisor_export",
    connectors: ["advisor_pack", "a3marketplace_review", "csv_excel_export"],
    flows: ["journal_entries", "trial_balance", "tax_reports", "parties", "documents"],
    source_url: "https://www.wolterskluwer.com/es-es/solutions/a3innuva",
    notes: "Muy relevante en despachos profesionales. El primer objetivo debe ser paquete para asesoria: diario, mayor, balances, terceros y documentos fuente.",
    risks: ["ecosistema cerrado", "dependencia de marketplace/partner", "campos fiscales a confirmar con asesoria"],
  },
  {
    id: "holded",
    name: "Holded",
    vendor: "Holded / Visma",
    category: "cloud_erp",
    priority: 4,
    status: "planned",
    recommended_mode: "api_with_outbox",
    connectors: ["rest_api", "webhooks_when_available", "csv_fallback"],
    flows: ["chart_of_accounts", "journal_entries", "parties", "invoices", "purchases", "bank_accounts"],
    source_url: "https://www.holded.com/es/desarrolladores",
    notes: "Dispone de documentacion publica de API con contabilidad, ventas, compras y tesoreria. Buen candidato para conector API idempotente.",
    risks: ["limites de API", "webhooks marcados como proximamente", "mapeo de impuestos y series"],
  },
  {
    id: "contasol-factusol",
    name: "CONTASOL / FACTUSOL",
    vendor: "TeamSystem / Software DELSOL",
    category: "desktop_cloud_hybrid",
    priority: 5,
    status: "planned",
    recommended_mode: "file_import_export",
    connectors: ["excel_import_guide", "csv_excel_export", "document_pack"],
    flows: ["chart_of_accounts", "journal_entries", "trial_balance", "parties", "bank_transactions"],
    source_url: "https://www.sdelsol.com/programa-contabilidad-contasol/",
    notes: "Muy conocido en pymes espanolas. La via realista inicial es exportar/importar ficheros Excel/Calc y paquetes para asesoria.",
    risks: ["no asumir API publica", "plantillas por version", "validacion manual de importacion"],
  },
  {
    id: "odoo",
    name: "Odoo",
    vendor: "Odoo",
    category: "erp",
    priority: 6,
    status: "planned",
    recommended_mode: "api_with_outbox",
    connectors: ["xmlrpc_jsonrpc", "csv_import_export"],
    flows: ["parties", "invoices", "vendor_bills", "payments", "journal_entries", "bank_transactions"],
    source_url: "https://www.odoo.com/documentation/18.0/developer/reference/external_api.html",
    notes: "Odoo expone API externa para modelos y datos en planes compatibles. Candidato potente si la empresa ya usa Odoo como ERP.",
    risks: ["plan Odoo requerido", "modelo de datos muy configurable", "localizacion fiscal por base instalada"],
  },
  {
    id: "anfix",
    name: "Anfix",
    vendor: "Anfix",
    category: "cloud_accounting",
    priority: 7,
    status: "research",
    recommended_mode: "export_first",
    connectors: ["csv_excel_export", "api_review", "advisor_pack"],
    flows: ["invoices", "expenses", "bank_transactions", "journal_entries", "tax_reports"],
    source_url: "https://www.anfix.com/",
    notes: "SaaS de facturacion, contabilidad, bancos e impuestos. Confirmar documentacion tecnica de API antes de conector automatico.",
    risks: ["API publica no confirmada en esta fase", "alcance fiscal a revisar", "sincronizacion bancaria externa"],
  },
  {
    id: "quipu",
    name: "Quipu",
    vendor: "Quipu",
    category: "cloud_accounting",
    priority: 8,
    status: "research",
    recommended_mode: "export_first",
    connectors: ["csv_excel_export", "api_review", "document_pack"],
    flows: ["invoices", "expenses", "parties", "bank_transactions"],
    source_url: "https://getquipu.com/",
    notes: "Herramienta cloud de facturacion y tesoreria. Preparar exportaciones de facturas, gastos y cobros/pagos mientras se confirma API.",
    risks: ["API publica pendiente de validar", "mapeo de estados de cobro", "duplicados de documentos"],
  },
  {
    id: "billin",
    name: "Billin / TS Facturas Billin",
    vendor: "Billin / TeamSystem",
    category: "cloud_invoicing",
    priority: 9,
    status: "research",
    recommended_mode: "fiscal_boundary_export",
    connectors: ["csv_excel_export", "document_pack", "api_review"],
    flows: ["invoices", "tickets", "parties", "collections"],
    source_url: "https://www.billin.net/",
    notes: "Mas orientado a facturacion que a contabilidad completa. Integrarlo como origen/destino documental, no como libro mayor maestro.",
    risks: ["separar facturacion fiscal de contabilidad", "evitar doble emision fiscal", "API pendiente de validar"],
  },
  {
    id: "facturascripts",
    name: "FacturaScripts",
    vendor: "FacturaScripts",
    category: "open_source_erp",
    priority: 10,
    status: "planned",
    recommended_mode: "plugin_or_api",
    connectors: ["rest_api_plugin", "csv_import_export", "database_readonly_bridge"],
    flows: ["parties", "invoices", "journal_entries", "payments", "products"],
    source_url: "https://facturascripts.com/",
    notes: "Open source y extensible. Buen candidato para plugin dedicado si el cliente tiene implantacion propia.",
    risks: ["variacion por plugins instalados", "versiones autoalojadas", "no escribir en base externa sin adaptador"],
  },
];

function listExternalAccountingIntegrations(filters = {}) {
  const category = String(filters.category || "").trim();
  const status = String(filters.status || "").trim();
  const q = String(filters.q || "").trim().toLowerCase();
  return externalAccountingIntegrations.filter(item => {
    if (category && item.category !== category) return false;
    if (status && item.status !== status) return false;
    if (!q) return true;
    return [
      item.name,
      item.vendor,
      item.category,
      item.recommended_mode,
      item.notes,
      item.flows.join(" "),
      item.connectors.join(" "),
    ].join(" ").toLowerCase().includes(q);
  });
}

function integrationSummary(integrations = externalAccountingIntegrations) {
  return integrations.reduce((summary, item) => {
    summary.total += 1;
    summary.by_status[item.status] = (summary.by_status[item.status] || 0) + 1;
    summary.by_mode[item.recommended_mode] = (summary.by_mode[item.recommended_mode] || 0) + 1;
    return summary;
  }, { total: 0, by_status: {}, by_mode: {} });
}

function cleanText(value, maxLength = 120) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizeAdvisorPackageQuery(query = {}) {
  return {
    fiscal_year_id: cleanText(query.fiscal_year_id, 80) || null,
    period_id: cleanText(query.period_id, 80) || null,
    date_from: cleanText(query.date_from, 10) || null,
    date_to: cleanText(query.date_to, 10) || null,
    include_empty: query.include_empty === "true" ? "true" : "false",
  };
}

function appendParams(path, params) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      search.set(key, String(value).trim());
    }
  });
  return `${path}?${search.toString()}`;
}

function exportItem({ id, label, description, permission, path, filters = {}, requiresFiscalYear = false }, context) {
  const blockedReasons = [];
  if (!context.permissions.includes(permission)) blockedReasons.push(`Falta permiso ${permission}`);
  if (requiresFiscalYear && !context.filters.fiscal_year_id) blockedReasons.push("Selecciona un ejercicio");
  return {
    id,
    label,
    description,
    permission,
    available: blockedReasons.length === 0,
    blocked_reasons: blockedReasons,
    path: blockedReasons.length ? null : appendParams(path, { format: "csv", ...filters }),
  };
}

function buildAdvisorPackageManifest({ selectedCompany, permissions = [], filters = {} }) {
  const normalized = normalizeAdvisorPackageQuery(filters);
  const context = {
    permissions,
    filters: normalized,
  };
  const fiscalFilters = {
    fiscal_year_id: normalized.fiscal_year_id,
    period_id: normalized.period_id,
    date_from: normalized.date_from,
    date_to: normalized.date_to,
  };
  const exports = [
    exportItem({
      id: "parties",
      label: "Terceros",
      description: "Clientes, proveedores y otros terceros contables.",
      permission: "parties.read",
      path: "/parties",
      filters: { limit: 500 },
    }, context),
    exportItem({
      id: "maturities",
      label: "Vencimientos",
      description: "Cartera de cobros y pagos pendientes o liquidados.",
      permission: "maturities.read",
      path: "/maturities",
      filters: { limit: 500 },
    }, context),
    exportItem({
      id: "bank_transactions",
      label: "Movimientos bancarios",
      description: "Movimientos manuales o importados para conciliacion.",
      permission: "banks.read",
      path: "/bank-transactions",
      filters: { limit: 500 },
    }, context),
    exportItem({
      id: "fixed_assets",
      label: "Inmovilizado",
      description: "Altas de inmovilizado, estado, vida util y cuentas asociadas.",
      permission: "fixed_assets.read",
      path: "/fixed-assets",
      filters: { fiscal_year_id: normalized.fiscal_year_id, limit: 500 },
    }, context),
    exportItem({
      id: "journal_entries",
      label: "Libro diario",
      description: "Asientos y lineas del diario filtrados por ejercicio si se indica.",
      permission: "journal.read",
      path: "/journal-entries",
      filters: { ...fiscalFilters, limit: 500 },
    }, context),
    exportItem({
      id: "period_status",
      label: "Estado de periodos",
      description: "Ejercicios, periodos, estados operativos, motivos y sellos de cierre.",
      permission: "periods.read",
      path: "/periods",
      filters: { fiscal_year_id: normalized.fiscal_year_id },
    }, context),
    exportItem({
      id: "trial_balance",
      label: "Balance de sumas y saldos",
      description: "Saldos de cuentas del ejercicio seleccionado.",
      permission: "ledger.read",
      path: "/reports/trial-balance",
      filters: { ...fiscalFilters, include_empty: "true" },
      requiresFiscalYear: true,
    }, context),
    exportItem({
      id: "balance_sheet",
      label: "Balance de situacion",
      description: "Balance preliminar calculado desde asientos contabilizados.",
      permission: "ledger.read",
      path: "/reports/balance-sheet",
      filters: { ...fiscalFilters, include_empty: normalized.include_empty },
      requiresFiscalYear: true,
    }, context),
    exportItem({
      id: "profit_loss",
      label: "Perdidas y ganancias",
      description: "Cuenta de resultados preliminar calculada desde asientos contabilizados.",
      permission: "ledger.read",
      path: "/reports/profit-loss",
      filters: { ...fiscalFilters, include_empty: normalized.include_empty },
      requiresFiscalYear: true,
    }, context),
  ];
  return {
    generated_at: new Date().toISOString(),
    selected_company: selectedCompany,
    filters: normalized,
    disclaimer: "Manifiesto de exportacion preliminar para asesoria o software externo. No sustituye revision contable, fiscal ni legal.",
    exports,
    available_count: exports.filter(item => item.available).length,
    blocked_count: exports.filter(item => !item.available).length,
  };
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: day };
}

function safeZipName(name) {
  return String(name || "file.txt")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\.\./g, "")
    .replace(/[^A-Za-z0-9._/ -]/g, "_")
    .slice(0, 180) || "file.txt";
}

function buildZip(files = [], now = new Date()) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime(now);

  files.forEach(file => {
    const name = Buffer.from(safeZipName(file.name), "utf8");
    const content = Buffer.isBuffer(file.content) ? file.content : Buffer.from(String(file.content || ""), "utf8");
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(stamp.time, 10);
    localHeader.writeUInt16LE(stamp.date, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(stamp.time, 12);
    centralHeader.writeUInt16LE(stamp.date, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function csvCell(value) {
  const clean = String(value ?? "").replace(/\r?\n/g, " ").trim();
  return `"${clean.replace(/"/g, '""')}"`;
}

function advisorPackageIndexCsv(exports = []) {
  const headers = ["id", "nombre", "disponible", "permiso", "ruta", "bloqueos"];
  const rows = exports.map(item => ({
    id: item.id,
    nombre: item.label,
    disponible: item.available ? "si" : "no",
    permiso: item.permission,
    ruta: item.path || "",
    bloqueos: (item.blocked_reasons || []).join(" | "),
  }));
  return [
    headers.map(csvCell).join(";"),
    ...rows.map(row => headers.map(header => csvCell(row[header])).join(";")),
  ].join("\n");
}

function buildAdvisorPackageZip(manifest, embeddedFiles = []) {
  const files = [
    {
      name: "manifest.json",
      content: JSON.stringify(manifest, null, 2),
    },
    {
      name: "README.txt",
      content: [
        "TransGest Contabilidad - Paquete asesoria",
        "",
        "Este ZIP contiene un paquete tecnico para preparar exportaciones autorizadas.",
        "No declara cumplimiento legal, certificacion ni homologacion con ningun proveedor.",
        "Algunos CSV se incluyen fisicamente cuando el exportador esta soportado.",
        "Las rutas indicadas conservan permisos y auditoria para descargas individuales.",
        "",
        `Generado: ${manifest.generated_at}`,
        `Empresa: ${manifest.selected_company?.name || manifest.selected_company?.company_id || "-"}`,
      ].join("\n"),
    },
    {
      name: "exports/index.csv",
      content: advisorPackageIndexCsv(manifest.exports || []),
    },
  ];

  embeddedFiles.forEach(file => {
    files.push({
      name: file.name,
      content: file.content,
    });
  });

  (manifest.exports || []).forEach(item => {
    const folder = item.available ? "exports" : "blocked";
    files.push({
      name: `${folder}/${item.id}.txt`,
      content: [
        item.label,
        item.description || "",
        "",
        item.available ? `CSV: ${item.path}` : `Bloqueado: ${(item.blocked_reasons || []).join(" | ")}`,
        `Permiso: ${item.permission}`,
      ].join("\n"),
    });
  });

  return buildZip(files);
}

module.exports = {
  INTEGRATION_CATALOG_VERSION,
  buildAdvisorPackageManifest,
  buildAdvisorPackageZip,
  externalAccountingIntegrations,
  integrationSummary,
  listExternalAccountingIntegrations,
  normalizeAdvisorPackageQuery,
};

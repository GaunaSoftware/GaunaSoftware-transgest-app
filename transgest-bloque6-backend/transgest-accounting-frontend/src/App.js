import { useEffect, useMemo, useState } from "react";
import {
  applyExternalImportBatch,
  cancelFixedAssetDepreciationDraft,
  cancelJournalEntry,
  createAccount,
  createBankAccount,
  createBankTransaction,
  createChartTemplateFromFiscalYear,
  createJournalDraft,
  createJournalReversalDraft,
  createMaturity,
  createExternalImportBatch,
  createFixedAsset,
  createFixedAssetDepreciationDraft,
  createParty,
  downloadAdvisorPackageFile,
  downloadAdvisorPackageZip,
  downloadBalanceSheetCsv,
  downloadBankTransactionsCsv,
  downloadExternalImportBatchesCsv,
  downloadFixedAssetsCsv,
  downloadJournalEntriesCsv,
  downloadLedgerAccountCsv,
  downloadMaturitiesCsv,
  downloadPartiesCsv,
  downloadProfitLossCsv,
  downloadTrialBalanceCsv,
  exchangeSsoToken,
  getAdvisorPackage,
  getAccounts,
  getAuditLog,
  getBankAccounts,
  getBankReconciliationSuggestions,
  getBankStatementImports,
  getBankTransactions,
  getBalanceSheet,
  getCompanies,
  getDashboard,
  getExternalIntegrations,
  getExternalImportBatches,
  getExternalImportBatchPreview,
  getFiscalYears,
  getFixedAssetDepreciationPlan,
  getFixedAssets,
  getMe,
  getOutboxEvents,
  getParties,
  getPeriods,
  getChartTemplates,
  getJournalEntries,
  getJournalEntry,
  getLedgerAccount,
  getMaturities,
  getProfitLoss,
  getToken,
  importChartTemplate,
  importBankStatementCsv,
  openFiscalYear,
  postJournalEntry,
  reconcileBankTransaction,
  removeToken,
  reverseBankReconciliation,
  retryOutboxEvent,
  selectCompany,
  previewChartTemplate,
  getTrialBalance,
  updateJournalDraft,
  updateExternalImportBatchStatus,
  updateFixedAssetStatus,
  updateBankTransactionStatus,
  updateMaturityStatus,
  updateParty,
  updatePartyStatus,
  updatePeriodStatus,
  updateAccountStatus,
} from "./services/api";

const TRANSGEST_FRONTEND_URL = process.env.REACT_APP_TRANSGEST_FRONTEND_URL || "http://localhost";

const tabs = [
  { id: "overview", label: "Resumen" },
  { id: "accounts", label: "Plan contable" },
  { id: "parties", label: "Terceros" },
  { id: "maturities", label: "Vencimientos" },
  { id: "fixed-assets", label: "Inmovilizado" },
  { id: "banks", label: "Bancos" },
  { id: "journal", label: "Diario" },
  { id: "ledger", label: "Mayor" },
  { id: "reports", label: "Informes" },
  { id: "templates", label: "Plantillas" },
  { id: "companies", label: "Empresas" },
  { id: "periods", label: "Ejercicios y periodos" },
  { id: "audit", label: "Auditoria" },
  { id: "integrations", label: "Asesoria" },
  { id: "events", label: "Integracion" },
];

const TAB_STORAGE_KEY = "transgest.accounting.active_tab";
const validTabIds = new Set(tabs.map(tab => tab.id));

function getInitialActiveTab() {
  if (typeof window === "undefined") return "overview";
  const params = new URLSearchParams(window.location.search);
  const urlTab = params.get("tab");
  if (validTabIds.has(urlTab)) return urlTab;
  const storedTab = window.localStorage.getItem(TAB_STORAGE_KEY);
  return validTabIds.has(storedTab) ? storedTab : "overview";
}

function accountingUrlForTab(tabId) {
  const params = new URLSearchParams(window.location.search);
  params.delete("sso_token");
  if (tabId && tabId !== "overview") {
    params.set("tab", tabId);
  } else {
    params.delete("tab");
  }
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

const accountTypeLabels = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Patrimonio neto",
  income: "Ingreso",
  expense: "Gasto",
  memorandum: "Orden / control",
};

const partyTypeLabels = {
  customer: "Cliente",
  supplier: "Proveedor",
  customer_supplier: "Cliente y proveedor",
  employee: "Empleado",
  tax_authority: "Administracion",
  bank: "Banco",
  other: "Otro",
};

const maturityDirectionLabels = {
  receivable: "Cobro",
  payable: "Pago",
};

const maturityStatusLabels = {
  pending: "Pendiente",
  settled: "Liquidado",
  cancelled: "Cancelado",
};

const bankTransactionDirectionLabels = {
  inflow: "Entrada",
  outflow: "Salida",
};

const bankTransactionStatusLabels = {
  unmatched: "Pendiente",
  matched: "Conciliado",
  ignored: "Ignorado",
};

const fixedAssetStatusLabels = {
  active: "Activo",
  inactive: "Inactivo",
  disposed: "Baja",
};

const fixedAssetActionLabels = {
  activate: "Activar",
  deactivate: "Desactivar",
  dispose: "Dar de baja",
};

const integrationCategoryLabels = {
  advisor_suite: "Asesoria",
  cloud_accounting: "Cloud contable",
  cloud_erp: "ERP cloud",
  cloud_invoicing: "Facturacion cloud",
  desktop_cloud_connected: "Escritorio + cloud",
  desktop_cloud_hybrid: "Hibrido",
  erp: "ERP",
  open_source_erp: "Open source",
};

const integrationModeLabels = {
  api_with_outbox: "API con outbox",
  advisor_export: "Paquete asesoria",
  bidirectional_with_approval: "Bidireccional con aprobacion",
  export_first: "Export first",
  file_import_export: "Ficheros import/export",
  fiscal_boundary_export: "Frontera fiscal",
  plugin_or_api: "Plugin o API",
};

const integrationStatusLabels = {
  candidate: "Candidato",
  planned: "Planificado",
  research: "En estudio",
};

const externalImportTypeLabels = {
  accounts: "Plan contable",
  bank_transactions: "Bancos",
  generic: "Generico",
  journal_entries: "Diario",
  maturities: "Vencimientos",
  parties: "Terceros",
};

const externalImportStatusLabels = {
  approved: "Aprobado",
  applied: "Aplicado",
  cancelled: "Cancelado",
  pending_review: "Pendiente",
  rejected: "Rechazado",
};

const externalImportCsvTemplates = {
  accounts: {
    filename: "plan_contable.csv",
    csv: [
      "codigo;nombre;tipo;movimiento;notas",
      "43000001;Clientes transporte;Activo;si;Cuenta operativa de clientes",
      "70000001;Ingresos por transporte;Ingreso;si;Cuenta de ventas",
    ].join("\n"),
  },
  bank_transactions: {
    filename: "movimientos_bancarios.csv",
    csv: [
      "iban;fecha;fecha_valor;concepto;referencia;tercero;importe;tipo",
      "ES9121000418450200051332;30/06/2026;30/06/2026;Cobro cliente ruta norte;TRF-100;Cliente Demo;1250,50;entrada",
      "ES9121000418450200051332;30/06/2026;30/06/2026;Pago proveedor gasoleo;TRF-101;Proveedor Demo;450,25;salida",
    ].join("\n"),
  },
  generic: {
    filename: "lote_generico.csv",
    csv: [
      "campo;valor;notas",
      "referencia;EXT-001;Fila generica para revision manual",
    ].join("\n"),
  },
  journal_entries: {
    filename: "diario_borradores.csv",
    csv: [
      "entry_ref;fecha;concepto;cuenta;debe;haber;concepto_linea",
      "A-2026-001;30/06/2026;Asiento importado ejemplo;43000001;1250,50;;Cliente Demo",
      "A-2026-001;30/06/2026;Asiento importado ejemplo;70000001;;1250,50;Servicio transporte",
    ].join("\n"),
  },
  maturities: {
    filename: "vencimientos.csv",
    csv: [
      "nif;tercero;tipo;vencimiento;factura;concepto;importe;forma_pago",
      "B00000000;Cliente Demo;cobro;31/07/2026;F-100;Servicio transporte;1250,50;transferencia",
      "A00000000;Proveedor Demo;pago;05/08/2026;R-200;Gasto proveedor;450,25;transferencia",
    ].join("\n"),
  },
  parties: {
    filename: "terceros.csv",
    csv: [
      "nombre;nif;tipo;correo;telefono",
      "Cliente Demo;B00000000;cliente;cliente@example.com;600000000",
      "Proveedor Demo;A00000000;proveedor;proveedor@example.com;611000000",
    ].join("\n"),
  },
};

function maturityStatusTone(status) {
  if (status === "pending") return "warning";
  if (status === "settled") return "ok";
  return "neutral";
}

function fixedAssetStatusTone(status) {
  if (status === "active") return "ok";
  if (status === "inactive") return "warning";
  return "neutral";
}

function integrationStatusTone(status) {
  if (status === "planned") return "ok";
  if (status === "research") return "warning";
  return "neutral";
}

function externalImportStatusTone(status) {
  if (status === "approved" || status === "applied") return "ok";
  if (status === "pending_review") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function formatExternalImportIssue(issue) {
  if (!issue) return "";
  if (typeof issue === "string") return issue;
  if (issue.party) return `${issue.code}: ${issue.party.legal_name || issue.party.tax_id || issue.party.id}`;
  if (issue.account) return `${issue.code}: ${issue.account.code || issue.account.name || issue.account.id}`;
  if (issue.maturity) return `${issue.code}: ${issue.maturity.document_ref || issue.maturity.description || issue.maturity.id}`;
  if (issue.bank_transaction) return `${issue.code}: ${issue.bank_transaction.description || issue.bank_transaction.reference || issue.bank_transaction.id}`;
  if (issue.journal_entry) return `${issue.code}: ${issue.journal_entry.description || issue.journal_entry.id}`;
  return issue.message || issue.code || JSON.stringify(issue);
}

function externalImportPreviewTitle(row) {
  return row.mapped?.legal_name || row.mapped?.party_name || row.mapped?.entry_ref || row.mapped?.description || row.mapped?.name || row.mapped?.code || row.mapped?.document_ref || "Sin nombre";
}

function externalImportPreviewSubtitle(row) {
  if (row.mapped?.code) return `${row.mapped.code} | ${row.mapped.account_type || "tipo pendiente"}`;
  if (row.mapped?.transaction_date) return `${row.mapped.transaction_date} | ${row.mapped.amount || "sin importe"} | ${row.mapped.direction || "tipo pendiente"} | ${row.mapped.bank_account_name || row.mapped.iban || "cuenta pendiente"}`;
  if (row.mapped?.entry_date) return `${row.mapped.entry_date} | Debe ${row.mapped.total_debit || "0"} | Haber ${row.mapped.total_credit || "0"} | ${row.mapped.line_count || 0} lineas`;
  if (row.mapped?.due_date) return `${row.mapped.due_date} | ${row.mapped.amount || "sin importe"} | ${row.mapped.direction || "tipo pendiente"}`;
  return `${row.mapped?.tax_id || "Sin NIF/CIF"} | ${row.mapped?.party_type || "tipo pendiente"}`;
}

function StatusBadge({ text, tone = "neutral" }) {
  return <span className={`badge badge-${tone}`}>{text}</span>;
}

function EmptyState({ title, detail }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function WorkspaceHint({ hint, onClose, onOverview }) {
  if (!hint) return null;
  return (
    <div className="workspace-hint">
      <div>
        <span className="eyebrow">Accion rapida</span>
        <strong>{hint.title}</strong>
        <small>{hint.detail}</small>
      </div>
      <div className="workspace-hint-actions">
        <button type="button" className="secondary" onClick={onClose}>Ocultar</button>
        <button type="button" onClick={onOverview}>Resumen</button>
      </div>
    </div>
  );
}

const periodActionLabels = {
  lock: "Bloquear",
  unlock: "Desbloquear",
  close: "Cerrar",
  reopen: "Reabrir",
};

function statusTone(status) {
  if (status === "open") return "ok";
  if (status === "locked") return "warning";
  if (status === "closed") return "neutral";
  return "neutral";
}

function availablePeriodActions(period, permissions) {
  const canWrite = permissions.includes("periods.write");
  const canReopen = permissions.includes("periods.reopen");
  if (period.status === "open" && canWrite) return ["lock", "close"];
  if (period.status === "locked" && canWrite) return ["unlock", "close"];
  if (period.status === "closed" && canReopen) return ["reopen"];
  return [];
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("es-ES", {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatDetail(detail) {
  if (!detail || typeof detail !== "object") return "-";
  return Object.entries(detail)
    .slice(0, 3)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join(" | ") || "-";
}

function outboxStatusTone(status) {
  if (status === "processed") return "ok";
  if (status === "failed") return "danger";
  if (status === "retry" || status === "processing") return "warning";
  return "neutral";
}

function journalStatusTone(status) {
  if (status === "posted") return "ok";
  if (status === "cancelled") return "neutral";
  return "warning";
}

function journalStatusLabel(status) {
  if (status === "posted") return "Contabilizado";
  if (status === "cancelled") return "Cancelado";
  return "Borrador";
}

function newIdempotencyKey(prefix) {
  const suffix = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}:${suffix}`;
}

function journalAmount(value) {
  const parsed = Number.parseFloat(String(value || "0").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(Number(value || 0));
}

function formatShortDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatIbanPreview(value) {
  if (!value) return "Sin IBAN";
  const compact = String(value).replace(/\s+/g, "");
  if (compact.length <= 8) return compact;
  return `${compact.slice(0, 4)} ... ${compact.slice(-4)}`;
}

function amountInputValue(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return "";
  return parsed.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function journalLineToEditable(line) {
  const debit = Number(line.debit_amount || 0);
  const credit = Number(line.credit_amount || 0);
  return {
    account_id: line.account_id || "",
    side: debit > 0 ? "debit" : "credit",
    amount: amountInputValue(debit > 0 ? debit : credit),
    description: line.description || "",
  };
}

function dateInsideFiscalYear(year, preferred = new Date().toISOString().slice(0, 10)) {
  if (!year) return preferred;
  const start = String(year.start_date).slice(0, 10);
  const end = String(year.end_date).slice(0, 10);
  return preferred >= start && preferred <= end ? preferred : start;
}

function StatementPanel({ title, subtitle, totals = [], sections = [], onExport, exporting }) {
  return (
    <section className="statement-panel">
      <div className="ledger-block-heading">
        <div><span className="eyebrow">{subtitle}</span><h3>{title}</h3></div>
        <div className="ledger-actions"><button type="button" onClick={onExport} disabled={exporting}>CSV</button></div>
      </div>
      <div className="statement-totals">
        {totals.map(item => (
          <div key={item.label}><span>{item.label}</span><strong>{formatMoney(item.value)} EUR</strong></div>
        ))}
      </div>
      <div className="statement-table">
        {sections.map(section => (
          <div className="statement-section" key={section.label}>
            <div className="statement-section-title">{section.label}</div>
            {section.rows.length ? section.rows.map(row => (
              <div className="statement-row" key={row.id}>
                <div><strong>{row.code}</strong><small>{row.name}</small></div>
                <span>{accountTypeLabels[row.account_type] || row.account_type}</span>
                <strong>{formatMoney(row.amount)} EUR</strong>
              </div>
            )) : (
              <div className="statement-empty">Sin cuentas con saldo para esta seccion.</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState(null);
  const [session, setSession] = useState(null);
  const [companies, setCompanies] = useState([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [dashboardStatus, setDashboardStatus] = useState(null);
  const [fiscalYears, setFiscalYears] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [activeTab, setActiveTab] = useState(getInitialActiveTab);
  const [workspaceHint, setWorkspaceHint] = useState(null);
  const [openPanels, setOpenPanels] = useState({});
  const [periodsLoading, setPeriodsLoading] = useState(false);
  const [openYearForm, setOpenYearForm] = useState(() => {
    const year = new Date().getFullYear();
    return {
      year_label: String(year),
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    };
  });
  const [openYearStatus, setOpenYearStatus] = useState(null);
  const [periodAction, setPeriodAction] = useState(null);
  const [periodActionStatus, setPeriodActionStatus] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [accountStatus, setAccountStatus] = useState(null);
  const [accountFilters, setAccountFilters] = useState({ fiscal_year_id: "", q: "", active: "" });
  const [accountForm, setAccountForm] = useState({
    fiscal_year_id: "",
    code: "",
    name: "",
    account_type: "asset",
    parent_account_id: "",
    is_postable: true,
    notes: "",
  });
  const [accountStatusAction, setAccountStatusAction] = useState(null);
  const [parties, setParties] = useState([]);
  const [partiesLoading, setPartiesLoading] = useState(false);
  const [partiesExporting, setPartiesExporting] = useState(false);
  const [partyStatus, setPartyStatus] = useState(null);
  const [partyFilters, setPartyFilters] = useState({ party_type: "", q: "", active: "" });
  const [partyForm, setPartyForm] = useState({
    party_type: "customer",
    legal_name: "",
    tax_id: "",
    email: "",
    phone: "",
    default_account_id: "",
    notes: "",
  });
  const [partyEditAction, setPartyEditAction] = useState(null);
  const [partyStatusAction, setPartyStatusAction] = useState(null);
  const [maturities, setMaturities] = useState([]);
  const [maturitiesLoading, setMaturitiesLoading] = useState(false);
  const [maturitiesExporting, setMaturitiesExporting] = useState(false);
  const [maturityStatus, setMaturityStatus] = useState(null);
  const [maturityFilters, setMaturityFilters] = useState({ direction: "", status: "", party_id: "", due_from: "", due_to: "", q: "" });
  const [maturityForm, setMaturityForm] = useState({
    party_id: "",
    direction: "receivable",
    issue_date: new Date().toISOString().slice(0, 10),
    due_date: new Date().toISOString().slice(0, 10),
    document_ref: "",
    description: "",
    amount: "",
    payment_method: "",
    notes: "",
  });
  const [maturityStatusAction, setMaturityStatusAction] = useState(null);
  const [focusedMaturityId, setFocusedMaturityId] = useState(null);
  const [fixedAssets, setFixedAssets] = useState([]);
  const [fixedAssetsLoading, setFixedAssetsLoading] = useState(false);
  const [fixedAssetsExporting, setFixedAssetsExporting] = useState(false);
  const [fixedAssetStatus, setFixedAssetStatus] = useState(null);
  const [fixedAssetPlan, setFixedAssetPlan] = useState(null);
  const [fixedAssetStatusAction, setFixedAssetStatusAction] = useState(null);
  const [fixedAssetDepreciationAction, setFixedAssetDepreciationAction] = useState(null);
  const [fixedAssetDepreciationCancelAction, setFixedAssetDepreciationCancelAction] = useState(null);
  const [fixedAssetFilters, setFixedAssetFilters] = useState({ fiscal_year_id: "", status: "", q: "" });
  const [fixedAssetForm, setFixedAssetForm] = useState({
    fiscal_year_id: "",
    asset_code: "",
    name: "",
    acquisition_date: new Date().toISOString().slice(0, 10),
    acquisition_cost: "",
    residual_value: "0",
    useful_life_months: "60",
    asset_account_id: "",
    accumulated_depreciation_account_id: "",
    expense_account_id: "",
    notes: "",
  });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankTransactions, setBankTransactions] = useState([]);
  const [bankStatementImports, setBankStatementImports] = useState([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [bankTransactionsExporting, setBankTransactionsExporting] = useState(false);
  const [banksStatus, setBanksStatus] = useState(null);
  const [bankReconciliationAction, setBankReconciliationAction] = useState(null);
  const [bankReconciliationReverseAction, setBankReconciliationReverseAction] = useState(null);
  const [bankTransactionStatusAction, setBankTransactionStatusAction] = useState(null);
  const [focusedBankTransactionId, setFocusedBankTransactionId] = useState(null);
  const [bankAccountFilters, setBankAccountFilters] = useState({ q: "", active: "" });
  const [bankTransactionFilters, setBankTransactionFilters] = useState({
    bank_account_id: "",
    direction: "",
    status: "",
    date_from: "",
    date_to: "",
    q: "",
  });
  const [bankAccountForm, setBankAccountForm] = useState({
    account_id: "",
    name: "",
    bank_name: "",
    iban: "",
    swift_bic: "",
    currency: "EUR",
    opening_balance: "0",
    notes: "",
  });
  const [bankTransactionForm, setBankTransactionForm] = useState({
    bank_account_id: "",
    transaction_date: new Date().toISOString().slice(0, 10),
    value_date: "",
    description: "",
    reference: "",
    counterparty_name: "",
    amount: "",
    direction: "inflow",
    notes: "",
  });
  const [bankImportForm, setBankImportForm] = useState({
    bank_account_id: "",
    filename: "extracto.csv",
    csv_text: "",
  });
  const [journalEntries, setJournalEntries] = useState([]);
  const [journalAccounts, setJournalAccounts] = useState([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [journalExporting, setJournalExporting] = useState(false);
  const [journalStatus, setJournalStatus] = useState(null);
  const [journalDetail, setJournalDetail] = useState(null);
  const [journalCancelAction, setJournalCancelAction] = useState(null);
  const [journalEditForm, setJournalEditForm] = useState(null);
  const [journalReverseAction, setJournalReverseAction] = useState(null);
  const [journalFilters, setJournalFilters] = useState({ fiscal_year_id: "", status: "", q: "", date_from: "", date_to: "" });
  const [journalForm, setJournalForm] = useState(() => ({
    fiscal_year_id: "",
    entry_date: new Date().toISOString().slice(0, 10),
    description: "",
    idempotency_key: newIdempotencyKey("journal-draft"),
    lines: [
      { account_id: "", side: "debit", amount: "", description: "" },
      { account_id: "", side: "credit", amount: "", description: "" },
    ],
  }));
  const [ledgerAccounts, setLedgerAccounts] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerStatus, setLedgerStatus] = useState(null);
  const [ledgerExporting, setLedgerExporting] = useState(false);
  const [ledgerFilters, setLedgerFilters] = useState({
    fiscal_year_id: "",
    account_id: "",
    period_id: "",
    date_from: "",
    date_to: "",
    include_empty: "true",
  });
  const [trialBalance, setTrialBalance] = useState({ data: [], summary: null });
  const [ledgerAccount, setLedgerAccount] = useState(null);
  const [ledgerMovements, setLedgerMovements] = useState([]);
  const [ledgerAccountSummary, setLedgerAccountSummary] = useState(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsStatus, setReportsStatus] = useState(null);
  const [reportsExporting, setReportsExporting] = useState(false);
  const [reportsFilters, setReportsFilters] = useState({
    fiscal_year_id: "",
    period_id: "",
    date_from: "",
    date_to: "",
    include_empty: "false",
  });
  const [balanceSheet, setBalanceSheet] = useState(null);
  const [profitLoss, setProfitLoss] = useState(null);
  const [chartTemplates, setChartTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateStatus, setTemplateStatus] = useState(null);
  const [templatePreview, setTemplatePreview] = useState(null);
  const [templateTargetYearId, setTemplateTargetYearId] = useState("");
  const [templateForm, setTemplateForm] = useState({
    fiscal_year_id: "",
    code: "",
    name: "",
    version_label: "v1",
  });
  const [auditRows, setAuditRows] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditStatus, setAuditStatus] = useState(null);
  const [auditFilters, setAuditFilters] = useState({ action: "", entity_type: "", limit: 25 });
  const [outboxRows, setOutboxRows] = useState([]);
  const [outboxLoading, setOutboxLoading] = useState(false);
  const [outboxStatus, setOutboxStatus] = useState(null);
  const [outboxFilters, setOutboxFilters] = useState({ status: "", event_type: "", limit: 25 });
  const [outboxRetry, setOutboxRetry] = useState(null);
  const [integrationCatalog, setIntegrationCatalog] = useState({ data: [], summary: null, catalog_version: "" });
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [integrationsStatus, setIntegrationsStatus] = useState(null);
  const [integrationFilters, setIntegrationFilters] = useState({ q: "", status: "", category: "" });
  const [advisorPackage, setAdvisorPackage] = useState(null);
  const [advisorPackageLoading, setAdvisorPackageLoading] = useState(false);
  const [advisorPackageStatus, setAdvisorPackageStatus] = useState(null);
  const [advisorPackageDownloading, setAdvisorPackageDownloading] = useState(null);
  const [advisorPackageFilters, setAdvisorPackageFilters] = useState({
    fiscal_year_id: "",
    period_id: "",
    date_from: "",
    date_to: "",
    include_empty: "false",
  });
  const [externalImportBatches, setExternalImportBatches] = useState([]);
  const [externalImportLoading, setExternalImportLoading] = useState(false);
  const [externalImportExporting, setExternalImportExporting] = useState(false);
  const [externalImportStatus, setExternalImportStatus] = useState(null);
  const [externalImportFilters, setExternalImportFilters] = useState({ status: "", provider_id: "", import_type: "", limit: 25 });
  const [externalImportTargetYearId, setExternalImportTargetYearId] = useState("");
  const [externalImportForm, setExternalImportForm] = useState({
    provider_id: "generic",
    import_type: "parties",
    original_filename: "importacion.csv",
    notes: "",
    csv_text: "nombre;nif\nCliente Demo;B00000000",
  });
  const [externalImportReview, setExternalImportReview] = useState(null);
  const [externalImportPreview, setExternalImportPreview] = useState(null);

  const selectedCompany = useMemo(
    () => companies.find(c => c.id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  );
  const permissions = session?.permissions || [];
  const canOpenFiscalYear = permissions.includes("fiscal_years.write");
  const canReadAudit = permissions.includes("audit.read");
  const canReadOutbox = permissions.includes("outbox.read");
  const canRetryOutbox = permissions.includes("outbox.retry");
  const canReadAccounts = permissions.includes("accounts.read");
  const canWriteAccounts = permissions.includes("accounts.write");
  const canReadParties = permissions.includes("parties.read");
  const canWriteParties = permissions.includes("parties.write");
  const canReadMaturities = permissions.includes("maturities.read");
  const canWriteMaturities = permissions.includes("maturities.write");
  const canReadFixedAssets = permissions.includes("fixed_assets.read");
  const canWriteFixedAssets = permissions.includes("fixed_assets.write");
  const canReadBanks = permissions.includes("banks.read");
  const canWriteBanks = permissions.includes("banks.write");
  const canReadJournal = permissions.includes("journal.read");
  const canWriteJournal = permissions.includes("journal.write");
  const canPostJournal = permissions.includes("journal.post");
  const canReadLedger = permissions.includes("ledger.read");
  const canReadTemplates = permissions.includes("templates.read");
  const canWriteTemplates = permissions.includes("templates.write");
  const canReadExternalImports = permissions.includes("external_imports.read");
  const canWriteExternalImports = permissions.includes("external_imports.write");
  const activePeriods = periods.filter(period => period.status === "open").length;
  const lockedPeriods = periods.filter(period => period.status !== "open").length;
  const journalDrafts = journalEntries.filter(entry => entry.status === "draft").length;
  const journalPosted = journalEntries.filter(entry => entry.status === "posted").length;
  const journalCancelled = journalEntries.filter(entry => entry.status === "cancelled").length;
  const activeParties = parties.filter(party => party.is_active).length;
  const pendingReceivables = maturities.filter(item => item.status === "pending" && item.direction === "receivable").reduce((total, item) => total + Number(item.open_amount || 0), 0);
  const pendingPayables = maturities.filter(item => item.status === "pending" && item.direction === "payable").reduce((total, item) => total + Number(item.open_amount || 0), 0);
  const fixedAssetCost = fixedAssets.reduce((total, item) => total + Number(item.acquisition_cost || 0), 0);
  const activeFixedAssets = fixedAssets.filter(item => item.status === "active").length;
  const bankInflows = bankTransactions.filter(item => item.direction === "inflow").reduce((total, item) => total + Number(item.amount || 0), 0);
  const bankOutflows = bankTransactions.filter(item => item.direction === "outflow").reduce((total, item) => total + Number(item.amount || 0), 0);
  const bankOpeningBalance = bankAccounts.reduce((total, item) => total + Number(item.opening_balance || 0), 0);
  const unmatchedBankTransactions = bankTransactions.filter(item => item.status === "unmatched").length;
  const pendingMaturityOptions = maturities.filter(item => item.status === "pending");
  const focusedMaturity = maturities.find(item => item.id === focusedMaturityId) || null;
  const focusedBankTransaction = bankTransactions.find(item => item.id === focusedBankTransactionId) || null;
  const selectedBankAccount = bankAccounts.find(account => account.id === bankTransactionFilters.bank_account_id) || null;
  const journalDebit = journalForm.lines.reduce((total, line) => total + (line.side === "debit" ? journalAmount(line.amount) : 0), 0);
  const journalCredit = journalForm.lines.reduce((total, line) => total + (line.side === "credit" ? journalAmount(line.amount) : 0), 0);
  const journalEditDebit = journalEditForm?.lines?.reduce((total, line) => total + (line.side === "debit" ? journalAmount(line.amount) : 0), 0) || 0;
  const journalEditCredit = journalEditForm?.lines?.reduce((total, line) => total + (line.side === "credit" ? journalAmount(line.amount) : 0), 0) || 0;
  const selectedLedgerYear = fiscalYears.find(year => year.id === ledgerFilters.fiscal_year_id);
  const selectedLedgerPeriods = periods.filter(period => period.fiscal_year_id === ledgerFilters.fiscal_year_id);
  const selectedReportsYear = fiscalYears.find(year => year.id === reportsFilters.fiscal_year_id);
  const selectedReportsPeriods = periods.filter(period => period.fiscal_year_id === reportsFilters.fiscal_year_id);
  const selectedAdvisorPackagePeriods = periods.filter(period => period.fiscal_year_id === advisorPackageFilters.fiscal_year_id);
  const overviewFiscalYears = Number(dashboard?.fiscal_years?.total ?? fiscalYears.length);
  const overviewActivePeriods = Number(dashboard?.periods?.open ?? activePeriods);
  const overviewLockedPeriods = Number(
    dashboard?.periods ? Number(dashboard.periods.locked || 0) + Number(dashboard.periods.closed || 0) : lockedPeriods
  );
  const overviewAccounts = Number(dashboard?.accounts?.active ?? accounts.length);
  const overviewPostableAccounts = Number(dashboard?.accounts?.postable ?? accounts.filter(account => account.is_postable && account.is_active).length);
  const overviewActiveParties = Number(dashboard?.parties?.active ?? activeParties);
  const overviewBankAccounts = Number(dashboard?.banks?.accounts?.active ?? bankAccounts.length);
  const overviewUnmatchedBankTransactions = Number(dashboard?.banks?.transactions?.unmatched ?? unmatchedBankTransactions);
  const overviewJournalDrafts = Number(dashboard?.journal?.draft ?? journalDrafts);
  const overviewJournalPosted = Number(dashboard?.journal?.posted ?? journalPosted);
  const overviewJournalCancelled = Number(dashboard?.journal?.cancelled ?? journalCancelled);
  const overviewPendingReceivables = dashboard?.maturities?.receivable_amount ?? pendingReceivables;
  const overviewPendingPayables = dashboard?.maturities?.payable_amount ?? pendingPayables;
  const overviewOverdueMaturities = Number(dashboard?.maturities?.overdue ?? 0);
  const priorityMaturities = dashboard?.priority?.maturities || [];
  const priorityBankTransactions = dashboard?.priority?.bank_transactions || [];
  const priorityJournalDrafts = dashboard?.priority?.journal_drafts || [];
  const priorityOutboxEvents = dashboard?.priority?.outbox_events || [];
  const hasPriorityItems = priorityMaturities.length
    || priorityBankTransactions.length
    || priorityJournalDrafts.length
    || priorityOutboxEvents.length;
  const readinessItems = [
    {
      id: "periods",
      label: "Ejercicio abierto",
      ok: overviewFiscalYears > 0 && overviewActivePeriods > 0,
      detail: overviewFiscalYears ? `${overviewActivePeriods} periodos abiertos` : "Pendiente de crear ejercicio",
      tab: "periods",
    },
    {
      id: "accounts",
      label: "Plan contable",
      ok: overviewAccounts > 0,
      detail: overviewAccounts ? `${overviewAccounts} activas, ${overviewPostableAccounts} imputables` : "Sin cuentas configuradas",
      tab: "accounts",
    },
    {
      id: "parties",
      label: "Terceros",
      ok: overviewActiveParties > 0,
      detail: overviewActiveParties ? `${overviewActiveParties} terceros activos` : "Sin clientes o proveedores contables",
      tab: "parties",
    },
    {
      id: "banks",
      label: "Tesoreria",
      ok: overviewBankAccounts > 0,
      detail: overviewBankAccounts ? `${overviewBankAccounts} cuentas bancarias` : "Sin bancos configurados",
      tab: "banks",
    },
  ];
  const readinessDone = readinessItems.filter(item => item.ok).length;
  const operationalAlerts = [
    overviewJournalDrafts > 0 ? { tone: "warning", label: "Borradores pendientes", detail: `${overviewJournalDrafts} asientos sin contabilizar`, tab: "journal", action: openJournalDraftsAlert } : null,
    overviewUnmatchedBankTransactions > 0 ? { tone: "warning", label: "Banco por conciliar", detail: `${overviewUnmatchedBankTransactions} movimientos pendientes`, tab: "banks", action: openUnmatchedBanksAlert } : null,
    Number(overviewPendingReceivables || 0) > 0 ? { tone: "ok", label: "Cobros pendientes", detail: `${formatMoney(overviewPendingReceivables)} EUR`, tab: "maturities", action: openReceivablesAlert } : null,
    Number(overviewPendingPayables || 0) > 0 ? { tone: "danger", label: "Pagos pendientes", detail: `${formatMoney(overviewPendingPayables)} EUR`, tab: "maturities", action: openPayablesAlert } : null,
    overviewOverdueMaturities > 0 ? { tone: "danger", label: "Vencimientos vencidos", detail: `${overviewOverdueMaturities} pendientes vencidos`, tab: "maturities", action: openOverdueMaturitiesAlert } : null,
    overviewLockedPeriods > 0 ? { tone: "neutral", label: "Periodos no abiertos", detail: `${overviewLockedPeriods} bloqueados o cerrados`, tab: "periods" } : null,
  ].filter(Boolean);
  const quickActions = [
    { label: "Nueva cuenta", tab: "accounts", target: "account-create", enabled: canWriteAccounts, title: "Alta de cuenta contable", detail: "Completa el formulario Nueva cuenta. El alta queda auditada y no genera movimientos." },
    { label: "Nuevo tercero", tab: "parties", target: "party-create", enabled: canWriteParties, title: "Alta de tercero contable", detail: "Crea un cliente, proveedor u otro tercero para reutilizarlo en cartera y conciliacion." },
    { label: "Nuevo vencimiento", tab: "maturities", target: "maturity-create", enabled: canWriteMaturities, title: "Alta de vencimiento", detail: "Registra un cobro o pago previsto. No genera factura ni asiento contable." },
    { label: "Nuevo inmovilizado", tab: "fixed-assets", target: "fixed-asset-create", enabled: canWriteFixedAssets, title: "Alta de inmovilizado", detail: "Registra un activo y revisa su plan de amortizacion lineal preliminar. No genera asientos." },
    { label: "Movimiento bancario", tab: "banks", target: "bank-transaction-create", enabled: canWriteBanks, title: "Alta de movimiento bancario", detail: "Registra o importa movimientos para preparar conciliacion manual." },
    { label: "Borrador de asiento", tab: "journal", target: "journal-create", enabled: canWriteJournal, title: "Nuevo borrador de diario", detail: "Prepara un asiento manual. La partida doble se valida antes de contabilizar." },
    { label: "Balance y PyG", tab: "reports", target: "reports-filters", enabled: canReadLedger, title: "Informes preliminares", detail: "Consulta Balance y PyG calculados desde asientos contabilizados." },
  ];

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("sso_token")) return;
    window.localStorage.setItem(TAB_STORAGE_KEY, activeTab);
    const nextUrl = accountingUrlForTab(activeTab);
    const currentUrl = `${window.location.pathname}${window.location.search}`;
    if (nextUrl !== currentUrl) {
      window.history.replaceState({}, document.title, nextUrl);
    }
  }, [activeTab]);

  useEffect(() => {
    const launchTab = getInitialActiveTab();
    async function boot() {
      setBooting(true);
      setError(null);
      try {
        const params = new URLSearchParams(window.location.search);
        const ssoToken = params.get("sso_token");
        if (ssoToken) {
          await exchangeSsoToken(ssoToken);
          window.history.replaceState({}, document.title, accountingUrlForTab(launchTab));
        } else if (!getToken()) {
          setBooting(false);
          return;
        }
        const me = await getMe();
        const companiesResult = await getCompanies();
        setSession(me);
        setCompanies(companiesResult.data || []);
        setSelectedCompanyId(me.selected_company_id || companiesResult.data?.[0]?.id || null);
      } catch (err) {
        removeToken();
        setError(err);
      } finally {
        setBooting(false);
      }
    }
    boot();
  }, []);

  async function refreshPeriods() {
    if (!selectedCompanyId) return;
    setPeriodsLoading(true);
    Promise.all([
      getFiscalYears().catch(() => ({ data: [] })),
      getPeriods().catch(() => ({ data: [] })),
    ]).then(([years, periodRows]) => {
      setFiscalYears(years.data || []);
      setPeriods(periodRows.data || []);
    }).finally(() => setPeriodsLoading(false));
  }

  async function refreshAudit(nextFilters = auditFilters) {
    if (!selectedCompanyId || !canReadAudit) return;
    setAuditLoading(true);
    setAuditStatus(null);
    try {
      const result = await getAuditLog(nextFilters);
      setAuditRows(result.data || []);
    } catch (err) {
      setAuditRows([]);
      setAuditStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    } finally {
      setAuditLoading(false);
    }
  }

  async function refreshOutbox(nextFilters = outboxFilters) {
    if (!selectedCompanyId || !canReadOutbox) return;
    setOutboxLoading(true);
    setOutboxStatus(null);
    try {
      const result = await getOutboxEvents(nextFilters);
      setOutboxRows(result.data || []);
    } catch (err) {
      setOutboxRows([]);
      setOutboxStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    } finally {
      setOutboxLoading(false);
    }
  }

  async function refreshIntegrations(nextFilters = integrationFilters) {
    if (!session) return;
    setIntegrationsLoading(true);
    setIntegrationsStatus(null);
    try {
      const result = await getExternalIntegrations(nextFilters);
      setIntegrationCatalog({
        data: result.data || [],
        summary: result.summary || null,
        catalog_version: result.catalog_version || "",
        disclaimer: result.disclaimer || "",
      });
    } catch (err) {
      setIntegrationCatalog({ data: [], summary: null, catalog_version: "" });
      setIntegrationsStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    } finally {
      setIntegrationsLoading(false);
    }
  }

  async function refreshAdvisorPackage(nextFilters = advisorPackageFilters) {
    if (!session || !selectedCompanyId) return;
    setAdvisorPackageLoading(true);
    setAdvisorPackageStatus(null);
    try {
      const result = await getAdvisorPackage(nextFilters);
      setAdvisorPackage(result);
    } catch (err) {
      setAdvisorPackage(null);
      setAdvisorPackageStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    } finally {
      setAdvisorPackageLoading(false);
    }
  }

  async function refreshExternalImportBatches(nextFilters = externalImportFilters) {
    if (!selectedCompanyId || !canReadExternalImports) return;
    setExternalImportLoading(true);
    setExternalImportStatus(null);
    try {
      const result = await getExternalImportBatches(nextFilters);
      setExternalImportBatches(result.data || []);
    } catch (err) {
      setExternalImportBatches([]);
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setExternalImportLoading(false);
    }
  }

  async function refreshAccounts(nextFilters = accountFilters) {
    if (!selectedCompanyId || !canReadAccounts) return;
    setAccountsLoading(true);
    setAccountStatus(null);
    try {
      const result = await getAccounts(nextFilters);
      setAccounts(result.data || []);
    } catch (err) {
      setAccounts([]);
      setAccountStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setAccountsLoading(false);
    }
  }

  async function refreshParties(nextFilters = partyFilters) {
    if (!selectedCompanyId || !canReadParties) return;
    setPartiesLoading(true);
    setPartyStatus(null);
    try {
      const result = await getParties(nextFilters);
      setParties(result.data || []);
      if (canReadAccounts && !accounts.length) {
        getAccounts({ limit: 500 }).then(accountResult => setAccounts(accountResult.data || [])).catch(() => {});
      }
    } catch (err) {
      setParties([]);
      setPartyStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setPartiesLoading(false);
    }
  }

  async function refreshMaturities(nextFilters = maturityFilters) {
    if (!selectedCompanyId || !canReadMaturities) return;
    setMaturitiesLoading(true);
    setMaturityStatus(null);
    try {
      const result = await getMaturities(nextFilters);
      setMaturities(result.data || []);
      if (canReadParties && !parties.length) {
        getParties({ active: true, limit: 500 }).then(partyResult => setParties(partyResult.data || [])).catch(() => {});
      }
    } catch (err) {
      setMaturities([]);
      setMaturityStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setMaturitiesLoading(false);
    }
  }

  async function refreshFixedAssets(nextFilters = fixedAssetFilters) {
    if (!selectedCompanyId || !canReadFixedAssets) return;
    setFixedAssetsLoading(true);
    setFixedAssetStatus(null);
    try {
      const result = await getFixedAssets(nextFilters);
      setFixedAssets(result.data || []);
      setFixedAssetFilters(prev => ({ ...prev, ...nextFilters }));
    } catch (err) {
      setFixedAssets([]);
      setFixedAssetStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setFixedAssetsLoading(false);
    }
  }

  async function refreshBanks(nextTransactionFilters = bankTransactionFilters, nextAccountFilters = bankAccountFilters, options = {}) {
    if (!selectedCompanyId || !canReadBanks) return;
    setBanksLoading(true);
    if (options.clearStatus !== false) setBanksStatus(null);
    try {
      const [accountResult, transactionResult, importResult] = await Promise.all([
        getBankAccounts({ ...nextAccountFilters, limit: 500 }),
        getBankTransactions({ ...nextTransactionFilters, limit: 500 }),
        getBankStatementImports({ bank_account_id: nextTransactionFilters.bank_account_id, limit: 10 }),
      ]);
      const accountRows = accountResult.data || [];
      setBankAccounts(accountRows);
      setBankTransactions(transactionResult.data || []);
      setBankStatementImports(importResult.data || []);
      setBankTransactionForm(prev => prev.bank_account_id || !accountRows[0]?.id ? prev : { ...prev, bank_account_id: accountRows[0].id });
      setBankImportForm(prev => prev.bank_account_id || !accountRows[0]?.id ? prev : { ...prev, bank_account_id: accountRows[0].id });
      if (canReadMaturities) {
        getMaturities({ status: "pending", limit: 500 }).then(maturityResult => setMaturities(maturityResult.data || [])).catch(() => {});
      }
      if (canReadAccounts && !accounts.length) {
        getAccounts({ limit: 500 }).then(accountResult => setAccounts(accountResult.data || [])).catch(() => {});
      }
    } catch (err) {
      setBankAccounts([]);
      setBankTransactions([]);
      setBankStatementImports([]);
      setBanksStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setBanksLoading(false);
    }
  }

  async function refreshTemplates() {
    if (!selectedCompanyId || !canReadTemplates) return;
    setTemplatesLoading(true);
    setTemplateStatus(null);
    try {
      const result = await getChartTemplates();
      setChartTemplates(result.data || []);
    } catch (err) {
      setChartTemplates([]);
      setTemplateStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setTemplatesLoading(false);
    }
  }

  async function refreshJournal(nextFilters = journalFilters) {
    if (!selectedCompanyId || !canReadJournal) return;
    setJournalLoading(true);
    setJournalStatus(null);
    try {
      const result = await getJournalEntries(nextFilters);
      const rows = result.data || [];
      setJournalEntries(rows);
      setJournalDetail(current => current && rows.some(entry => entry.id === current.id) ? current : null);
    } catch (err) {
      setJournalEntries([]);
      setJournalDetail(null);
      setJournalStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setJournalLoading(false);
    }
  }

  async function refreshJournalAccounts(fiscalYearId) {
    if (!selectedCompanyId || !canReadAccounts || !fiscalYearId) return;
    try {
      const result = await getAccounts({ fiscal_year_id: fiscalYearId, active: true, limit: 500 });
      setJournalAccounts((result.data || []).filter(account => account.is_postable));
    } catch {
      setJournalAccounts([]);
    }
  }

  async function refreshLedger(nextFilters = ledgerFilters) {
    if (!selectedCompanyId || !canReadLedger || !nextFilters.fiscal_year_id) return;
    setLedgerLoading(true);
    setLedgerStatus(null);
    try {
      const accountResult = await getAccounts({ fiscal_year_id: nextFilters.fiscal_year_id, limit: 500 });
      const accountRows = accountResult.data || [];
      const postableAccounts = accountRows.filter(account => account.is_postable);
      const selectedAccountId = nextFilters.account_id || postableAccounts[0]?.id || accountRows[0]?.id || "";
      const [balanceResult, ledgerResult] = await Promise.all([
        getTrialBalance({
          fiscal_year_id: nextFilters.fiscal_year_id,
          period_id: nextFilters.period_id,
          date_from: nextFilters.date_from,
          date_to: nextFilters.date_to,
          include_empty: nextFilters.include_empty,
        }),
        selectedAccountId ? getLedgerAccount(selectedAccountId, {
          period_id: nextFilters.period_id,
          date_from: nextFilters.date_from,
          date_to: nextFilters.date_to,
          limit: 500,
        }) : Promise.resolve({ account: null, movements: [], summary: null }),
      ]);
      setLedgerAccounts(accountRows);
      setTrialBalance({ data: balanceResult.data || [], summary: balanceResult.summary || null });
      setLedgerAccount(ledgerResult.account || null);
      setLedgerMovements(ledgerResult.movements || []);
      setLedgerAccountSummary(ledgerResult.summary || null);
      setLedgerFilters(prev => ({ ...prev, ...nextFilters, account_id: selectedAccountId }));
    } catch (err) {
      setTrialBalance({ data: [], summary: null });
      setLedgerAccount(null);
      setLedgerMovements([]);
      setLedgerAccountSummary(null);
      setLedgerStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setLedgerLoading(false);
    }
  }

  async function refreshReports(nextFilters = reportsFilters) {
    if (!selectedCompanyId || !canReadLedger || !nextFilters.fiscal_year_id) return;
    setReportsLoading(true);
    setReportsStatus(null);
    try {
      const [balanceResult, profitLossResult] = await Promise.all([
        getBalanceSheet(nextFilters),
        getProfitLoss(nextFilters),
      ]);
      setBalanceSheet(balanceResult.data || null);
      setProfitLoss(profitLossResult.data || null);
      setReportsFilters(prev => ({ ...prev, ...nextFilters }));
    } catch (err) {
      setBalanceSheet(null);
      setProfitLoss(null);
      setReportsStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setReportsLoading(false);
    }
  }

  async function refreshDashboard() {
    if (!selectedCompanyId) return;
    setDashboardStatus(null);
    try {
      const result = await getDashboard();
      setDashboard(result.data || null);
    } catch (err) {
      setDashboard(null);
      setDashboardStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  function prioritySearch(...values) {
    return values.map(value => String(value || "").trim()).find(Boolean) || "";
  }

  function openQuickAction(action) {
    setWorkspaceHint({ tab: action.tab, target: action.target, title: action.title, detail: action.detail });
    openWorkspacePanel(action.target);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab(action.tab);
  }

  function isPanelOpen(panelId) {
    return Boolean(openPanels[panelId]);
  }

  function openWorkspacePanel(panelId) {
    setOpenPanels(prev => ({ ...prev, [panelId]: true }));
  }

  function toggleWorkspacePanel(panelId) {
    setWorkspaceHint(null);
    setOpenPanels(prev => ({ ...prev, [panelId]: !prev[panelId] }));
  }

  function closeWorkspacePanel(panelId) {
    setOpenPanels(prev => ({ ...prev, [panelId]: false }));
  }

  function targetClass(target, baseClass) {
    return workspaceHint?.target === target ? `${baseClass} quick-target` : baseClass;
  }

  function closeWorkspaceHint() {
    setWorkspaceHint(null);
  }

  function returnToOverview() {
    setWorkspaceHint(null);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("overview");
  }

  async function clearMaturityFilters() {
    const nextFilters = { direction: "", status: "", party_id: "", due_from: "", due_to: "", q: "" };
    setMaturityFilters(nextFilters);
    setFocusedMaturityId(null);
    await refreshMaturities(nextFilters);
  }

  async function clearFixedAssetFilters() {
    const nextFilters = { fiscal_year_id: "", status: "", q: "" };
    setFixedAssetFilters(nextFilters);
    setFixedAssetPlan(null);
    await refreshFixedAssets(nextFilters);
  }

  async function clearBankFilters() {
    const nextFilters = { bank_account_id: "", direction: "", status: "", date_from: "", date_to: "", q: "" };
    setBankTransactionFilters(nextFilters);
    setFocusedBankTransactionId(null);
    await refreshBanks(nextFilters, bankAccountFilters);
  }

  async function clearBankAccountFilters() {
    const nextFilters = { q: "", active: "" };
    setBankAccountFilters(nextFilters);
    setFocusedBankTransactionId(null);
    await refreshBanks(bankTransactionFilters, nextFilters);
  }

  async function filterBankAccountTransactions(account) {
    const nextFilters = { ...bankTransactionFilters, bank_account_id: account.id };
    setBankTransactionFilters(nextFilters);
    setFocusedBankTransactionId(null);
    await refreshBanks(nextFilters, bankAccountFilters, { clearStatus: false });
  }

  async function clearSelectedBankAccount() {
    const nextFilters = { ...bankTransactionFilters, bank_account_id: "" };
    setBankTransactionFilters(nextFilters);
    setFocusedBankTransactionId(null);
    await refreshBanks(nextFilters, bankAccountFilters, { clearStatus: false });
  }

  function startBankTransactionForAccount(account) {
    setBankTransactionForm(prev => ({ ...prev, bank_account_id: account.id }));
    setWorkspaceHint({
      tab: "banks",
      target: "bank-transaction-create",
      title: `Movimiento en ${account.name}`,
      detail: "Completa el movimiento manual con la cuenta bancaria ya seleccionada.",
    });
    openWorkspacePanel("bank-transaction-create");
    setFocusedBankTransactionId(null);
  }

  async function openJournalDraftsAlert() {
    const nextFilters = { fiscal_year_id: "", status: "draft", q: "", date_from: "", date_to: "" };
    setJournalFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("journal");
    await refreshJournal(nextFilters);
  }

  async function openUnmatchedBanksAlert() {
    const nextFilters = { bank_account_id: "", direction: "", status: "unmatched", date_from: "", date_to: "", q: "" };
    setBankTransactionFilters(nextFilters);
    setFocusedBankTransactionId(null);
    setFocusedMaturityId(null);
    setActiveTab("banks");
    await refreshBanks(nextFilters, bankAccountFilters, { clearStatus: false });
  }

  async function openReceivablesAlert() {
    const nextFilters = { direction: "receivable", status: "pending", party_id: "", due_from: "", due_to: "", q: "" };
    setMaturityFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("maturities");
    await refreshMaturities(nextFilters);
  }

  async function openPayablesAlert() {
    const nextFilters = { direction: "payable", status: "pending", party_id: "", due_from: "", due_to: "", q: "" };
    setMaturityFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("maturities");
    await refreshMaturities(nextFilters);
  }

  async function openOverdueMaturitiesAlert() {
    const nextFilters = { direction: "", status: "pending", party_id: "", due_from: "", due_to: new Date().toISOString().slice(0, 10), q: "" };
    setMaturityFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("maturities");
    await refreshMaturities(nextFilters);
  }

  async function openPriorityMaturity(item = {}) {
    const nextFilters = {
      direction: item.direction || "",
      status: "pending",
      party_id: "",
      due_from: item.due_date || "",
      due_to: item.due_date || "",
      q: prioritySearch(item.document_ref, item.party_name, item.description),
    };
    setMaturityFilters(nextFilters);
    setFocusedMaturityId(item.id || null);
    setFocusedBankTransactionId(null);
    setActiveTab("maturities");
    await refreshMaturities(nextFilters);
  }

  async function openPriorityBankTransaction(item = {}) {
    const nextFilters = {
      bank_account_id: "",
      direction: item.direction || "",
      status: "unmatched",
      date_from: item.transaction_date || "",
      date_to: item.transaction_date || "",
      q: prioritySearch(item.reference, item.counterparty_name, item.description),
    };
    setBankTransactionFilters(nextFilters);
    setFocusedBankTransactionId(item.id || null);
    setFocusedMaturityId(null);
    setActiveTab("banks");
    await refreshBanks(nextFilters, bankAccountFilters, { clearStatus: false });
  }

  async function openPriorityJournalDraft(item = {}) {
    const nextFilters = {
      fiscal_year_id: item.fiscal_year_id || journalFilters.fiscal_year_id || "",
      status: "draft",
      q: prioritySearch(item.description),
      date_from: item.entry_date || "",
      date_to: item.entry_date || "",
    };
    setJournalFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("journal");
    await refreshJournal(nextFilters);
    if (item.id) await handleOpenJournalEntry(item.id);
  }

  async function openPriorityOutboxEvent(item = {}) {
    const nextFilters = {
      status: item.status || "",
      event_type: item.event_type || "",
      limit: outboxFilters.limit || 25,
    };
    setOutboxFilters(nextFilters);
    setFocusedMaturityId(null);
    setFocusedBankTransactionId(null);
    setActiveTab("events");
    await refreshOutbox(nextFilters);
  }

  useEffect(() => {
    refreshPeriods();
    refreshDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  useEffect(() => {
    if (activeTab === "overview") refreshDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId]);

  useEffect(() => {
    if (!workspaceHint?.target || activeTab !== workspaceHint.tab) return undefined;
    const timeout = window.setTimeout(() => {
      const target = document.querySelector(`[data-workspace-target="${workspaceHint.target}"]`);
      const content = document.querySelector(".content");
      if (target && content) {
        const targetRect = target.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        window.scrollTo({
          top: window.scrollY + targetRect.top - 16,
          behavior: "auto",
        });
        content.scrollTo({
          top: content.scrollTop + targetRect.top - contentRect.top - 16,
          behavior: "auto",
        });
      } else {
        target?.scrollIntoView({ behavior: "auto", block: "start" });
      }
      const field = target?.querySelector("select:not([disabled]), input:not([disabled]):not([type='hidden']), textarea:not([disabled])");
      field?.focus({ preventScroll: true });
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [activeTab, workspaceHint, openPanels]);

  useEffect(() => {
    if (activeTab === "audit") {
      refreshAudit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadAudit]);

  useEffect(() => {
    if (activeTab === "events") {
      refreshOutbox();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadOutbox]);

  useEffect(() => {
    if (activeTab === "integrations") {
      refreshPeriods();
      refreshIntegrations();
      refreshAdvisorPackage();
      refreshExternalImportBatches();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, session?.user?.id, selectedCompanyId]);

  useEffect(() => {
    if (activeTab === "accounts" || activeTab === "overview") {
      refreshAccounts();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadAccounts]);

  useEffect(() => {
    if (activeTab === "parties" || activeTab === "overview") {
      refreshParties();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadParties]);

  useEffect(() => {
    if (activeTab === "maturities" || activeTab === "overview") {
      refreshMaturities();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadMaturities]);

  useEffect(() => {
    if (activeTab === "fixed-assets" || activeTab === "overview") {
      refreshFixedAssets();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadFixedAssets]);

  useEffect(() => {
    if (activeTab === "banks" || activeTab === "overview") {
      refreshBanks();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadBanks]);

  useEffect(() => {
    if (activeTab === "templates" || activeTab === "overview") {
      refreshTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadTemplates]);

  useEffect(() => {
    if (activeTab === "journal" || activeTab === "overview") refreshJournal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadJournal]);

  useEffect(() => {
    if (activeTab === "ledger") refreshLedger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadLedger]);

  useEffect(() => {
    if (activeTab === "reports") refreshReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedCompanyId, canReadLedger]);

  useEffect(() => {
    const defaultYear = fiscalYears[0]?.id || "";
    setAccountFilters(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setAccountForm(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setTemplateTargetYearId(prev => prev || defaultYear);
    setTemplateForm(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setJournalFilters(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setLedgerFilters(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setReportsFilters(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setAdvisorPackageFilters(prev => prev.fiscal_year_id ? prev : { ...prev, fiscal_year_id: defaultYear });
    setExternalImportTargetYearId(prev => prev || defaultYear);
    setJournalForm(prev => {
      if (prev.fiscal_year_id) return prev;
      const year = fiscalYears.find(item => item.id === defaultYear);
      return { ...prev, fiscal_year_id: defaultYear, entry_date: dateInsideFiscalYear(year, prev.entry_date) };
    });
  }, [fiscalYears]);

  useEffect(() => {
    if (activeTab === "journal" && journalForm.fiscal_year_id) refreshJournalAccounts(journalForm.fiscal_year_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, journalForm.fiscal_year_id, selectedCompanyId]);

  useEffect(() => {
    if (activeTab === "integrations" && advisorPackageFilters.fiscal_year_id) {
      refreshAdvisorPackage(advisorPackageFilters);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, advisorPackageFilters.fiscal_year_id]);

  async function handleSelectCompany(id) {
    setError(null);
    try {
      const result = await selectCompany(id);
      setSelectedCompanyId(result.selected_company_id);
      const me = await getMe();
      setSession(me);
      setAuditRows([]);
      setOutboxRows([]);
      setOutboxRetry(null);
      setAccounts([]);
      setAccountStatusAction(null);
      setParties([]);
      setPartyEditAction(null);
      setPartyStatusAction(null);
      setMaturities([]);
      setMaturityStatusAction(null);
      setFocusedMaturityId(null);
      setBankAccounts([]);
      setBankTransactions([]);
      setBankStatementImports([]);
      setBankReconciliationAction(null);
      setBankReconciliationReverseAction(null);
      setBankTransactionStatusAction(null);
      setFocusedBankTransactionId(null);
      setBankImportForm({ bank_account_id: "", filename: "extracto.csv", csv_text: "" });
      setChartTemplates([]);
      setTemplatePreview(null);
      setJournalEntries([]);
      setJournalAccounts([]);
      setJournalDetail(null);
      setJournalCancelAction(null);
      setJournalEditForm(null);
      setJournalReverseAction(null);
      setLedgerAccounts([]);
      setTrialBalance({ data: [], summary: null });
      setLedgerAccount(null);
      setLedgerMovements([]);
      setLedgerAccountSummary(null);
      setExternalImportBatches([]);
      setExternalImportReview(null);
      setExternalImportPreview(null);
    } catch (err) {
      setError(err);
    }
  }

  async function handleOpenFiscalYear(event) {
    event.preventDefault();
    setError(null);
    setOpenYearStatus(null);
    try {
      const result = await openFiscalYear(openYearForm);
      setOpenYearStatus({
        tone: "ok",
        text: `Ejercicio ${result.fiscal_year.year_label} abierto con ${result.periods.length} periodos.`,
      });
      await refreshPeriods();
    } catch (err) {
      setError(err);
      setOpenYearStatus({
        tone: err.status === 409 ? "warning" : "danger",
        text: err.message,
      });
    }
  }

  function startPeriodAction(period, action) {
    setPeriodAction({ period, action, reason: "" });
    setPeriodActionStatus(null);
  }

  async function handlePeriodStatusChange(event) {
    event.preventDefault();
    if (!periodAction) return;
    setError(null);
    setPeriodActionStatus(null);
    try {
      const result = await updatePeriodStatus(periodAction.period.id, {
        action: periodAction.action,
        reason: periodAction.reason,
      });
      setPeriodActionStatus({
        tone: "ok",
        text: `${periodActionLabels[periodAction.action]} aplicado a ${result.period.name}.`,
      });
      setPeriodAction(null);
      await refreshPeriods();
    } catch (err) {
      setError(err);
      setPeriodActionStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    }
  }

  async function handleAuditFilter(event) {
    event.preventDefault();
    await refreshAudit(auditFilters);
  }

  async function handleOutboxFilter(event) {
    event.preventDefault();
    await refreshOutbox(outboxFilters);
  }

  async function handleIntegrationFilter(event) {
    event.preventDefault();
    await refreshIntegrations(integrationFilters);
  }

  async function clearIntegrationFilters() {
    const nextFilters = { q: "", status: "", category: "" };
    setIntegrationFilters(nextFilters);
    await refreshIntegrations(nextFilters);
  }

  async function handleAdvisorPackageFilter(event) {
    event.preventDefault();
    await refreshAdvisorPackage(advisorPackageFilters);
  }

  async function handleDownloadAdvisorPackageFile(item) {
    if (!item?.available || !item.path) return;
    setAdvisorPackageDownloading(item.id);
    setAdvisorPackageStatus(null);
    try {
      const result = await downloadAdvisorPackageFile(item.path);
      saveBlob(result.blob, result.filename || `${item.id}.csv`);
      setAdvisorPackageStatus({ tone: "ok", text: `${item.label} descargado para el paquete de asesoria.` });
    } catch (err) {
      setAdvisorPackageStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setAdvisorPackageDownloading(null);
    }
  }

  async function handleDownloadAdvisorPackageZip() {
    setAdvisorPackageDownloading("zip");
    setAdvisorPackageStatus(null);
    try {
      const result = await downloadAdvisorPackageZip(advisorPackageFilters);
      saveBlob(result.blob, result.filename || "paquete-asesoria.zip");
      setAdvisorPackageStatus({ tone: "ok", text: "ZIP de asesoria generado con CSV disponibles y auditoria." });
    } catch (err) {
      setAdvisorPackageStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setAdvisorPackageDownloading(null);
    }
  }

  async function handleExternalImportFilter(event) {
    event.preventDefault();
    await refreshExternalImportBatches(externalImportFilters);
  }

  async function handleExternalImportExportCsv() {
    setExternalImportExporting(true);
    setExternalImportStatus(null);
    try {
      const result = await downloadExternalImportBatchesCsv(externalImportFilters);
      saveBlob(result.blob, result.filename || "lotes-importacion-contable.csv");
      setExternalImportStatus({ tone: "ok", text: "Historial de lotes exportado a CSV con auditoria." });
    } catch (err) {
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setExternalImportExporting(false);
    }
  }

  function loadExternalImportTemplate() {
    const template = externalImportCsvTemplates[externalImportForm.import_type] || externalImportCsvTemplates.generic;
    setExternalImportForm(prev => ({
      ...prev,
      original_filename: prev.original_filename || template.filename,
      csv_text: template.csv,
    }));
    setExternalImportStatus({
      tone: "neutral",
      text: `Plantilla ${externalImportTypeLabels[externalImportForm.import_type] || "generica"} cargada. Revisa y sustituye los datos de ejemplo antes de preparar staging.`,
    });
  }

  async function handleCreateExternalImportBatch(event) {
    event.preventDefault();
    setExternalImportStatus(null);
    try {
      const result = await createExternalImportBatch({
        provider_id: externalImportForm.provider_id,
        import_type: externalImportForm.import_type,
        source_format: "csv",
        original_filename: externalImportForm.original_filename,
        notes: externalImportForm.notes,
        csv_text: externalImportForm.csv_text,
      });
      setExternalImportStatus({
        tone: result.repeated ? "warning" : "ok",
        text: result.repeated ? "Lote ya existente reutilizado." : `Lote staged con ${result.batch.row_count} fila(s).`,
      });
      await refreshExternalImportBatches(externalImportFilters);
    } catch (err) {
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  function startExternalImportReview(batch, action) {
    setExternalImportReview({
      batch,
      action,
      reason: action === "approve" ? "Validado para siguiente fase" : "Revision manual pendiente",
    });
  }

  async function handleExternalImportPreview(batch) {
    setExternalImportStatus(null);
    if ((batch.import_type === "accounts" || batch.import_type === "journal_entries") && !externalImportTargetYearId) {
      setExternalImportStatus({ tone: "warning", text: "Selecciona un ejercicio destino para previsualizar cuentas o diario." });
      return;
    }
    try {
      const result = await getExternalImportBatchPreview(batch.id, (batch.import_type === "accounts" || batch.import_type === "journal_entries") ? { fiscal_year_id: externalImportTargetYearId } : {});
      setExternalImportPreview(result);
    } catch (err) {
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  async function handleApplyExternalImportBatch(batch) {
    setExternalImportStatus(null);
    if ((batch.import_type === "accounts" || batch.import_type === "journal_entries") && !externalImportTargetYearId) {
      setExternalImportStatus({ tone: "warning", text: "Selecciona un ejercicio destino para aplicar cuentas o diario." });
      return;
    }
    try {
      const result = await applyExternalImportBatch(batch.id, {
        reason: "Aplicacion manual aprobada desde TransGest Contabilidad",
        ...((batch.import_type === "accounts" || batch.import_type === "journal_entries") ? { fiscal_year_id: externalImportTargetYearId } : {}),
      });
      setExternalImportStatus({
        tone: result.repeated ? "warning" : "ok",
        text: result.repeated
          ? `Lote ya aplicado: ${result.summary.applied} registro(s) localizados.`
          : `Lote aplicado: ${result.summary.applied} registro(s) creados.`,
      });
      setExternalImportPreview(null);
      await Promise.all([
        refreshExternalImportBatches(externalImportFilters),
        refreshParties(partyFilters),
        batch.import_type === "accounts" ? refreshAccounts({ ...accountFilters, fiscal_year_id: externalImportTargetYearId }) : Promise.resolve(),
        batch.import_type === "maturities" ? refreshMaturities(maturityFilters) : Promise.resolve(),
        batch.import_type === "bank_transactions" ? refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false }) : Promise.resolve(),
        batch.import_type === "journal_entries" ? refreshJournal({ ...journalFilters, fiscal_year_id: externalImportTargetYearId }) : Promise.resolve(),
      ]);
    } catch (err) {
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  async function handleExternalImportReview(event) {
    event.preventDefault();
    if (!externalImportReview) return;
    setExternalImportStatus(null);
    try {
      const result = await updateExternalImportBatchStatus(externalImportReview.batch.id, {
        action: externalImportReview.action,
        reason: externalImportReview.reason,
      });
      setExternalImportStatus({
        tone: "ok",
        text: `Lote ${externalImportStatusLabels[result.batch.status] || result.batch.status}.`,
      });
      setExternalImportReview(null);
      await refreshExternalImportBatches(externalImportFilters);
    } catch (err) {
      setExternalImportStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  async function handleOutboxRetry(event) {
    event.preventDefault();
    if (!outboxRetry) return;
    setOutboxStatus(null);
    try {
      await retryOutboxEvent(outboxRetry.event.id, outboxRetry.reason);
      setOutboxRetry(null);
      setOutboxStatus({ tone: "ok", text: "Reintento solicitado y auditado." });
      await refreshOutbox(outboxFilters);
    } catch (err) {
      setOutboxStatus({
        tone: err.status === 403 ? "danger" : "warning",
        text: err.message,
      });
    }
  }

  async function handleAccountFilter(event) {
    event.preventDefault();
    await refreshAccounts(accountFilters);
  }

  async function handleCreateAccount(event) {
    event.preventDefault();
    setAccountStatus(null);
    try {
      const result = await createAccount({
        ...accountForm,
        parent_account_id: accountForm.parent_account_id || null,
      });
      setAccountStatus({ tone: "ok", text: `Cuenta ${result.account.code} creada y auditada.` });
      setAccountForm(prev => ({ ...prev, code: "", name: "", parent_account_id: "", notes: "" }));
      await refreshAccounts({ ...accountFilters, fiscal_year_id: accountForm.fiscal_year_id });
    } catch (err) {
      setAccountStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleAccountStatus(event) {
    event.preventDefault();
    if (!accountStatusAction) return;
    setAccountStatus(null);
    try {
      const result = await updateAccountStatus(accountStatusAction.account.id, {
        is_active: !accountStatusAction.account.is_active,
        reason: accountStatusAction.reason,
      });
      setAccountStatus({
        tone: "ok",
        text: `Cuenta ${result.account.code} ${result.account.is_active ? "activada" : "desactivada"}.`,
      });
      setAccountStatusAction(null);
      await refreshAccounts();
    } catch (err) {
      setAccountStatus({ tone: "danger", text: err.message });
    }
  }

  async function handlePartyFilter(event) {
    event.preventDefault();
    await refreshParties(partyFilters);
  }

  async function handleExportPartiesCsv() {
    setPartiesExporting(true);
    setPartyStatus(null);
    try {
      const result = await downloadPartiesCsv({ ...partyFilters, limit: 500 });
      saveBlob(result.blob, result.filename || "terceros.csv");
      setPartyStatus({ tone: "ok", text: "Exportacion CSV de terceros generada y auditada." });
    } catch (err) {
      setPartyStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setPartiesExporting(false);
    }
  }

  async function handleCreateParty(event) {
    event.preventDefault();
    setPartyStatus(null);
    try {
      const result = await createParty({
        ...partyForm,
        default_account_id: partyForm.default_account_id || null,
      });
      setPartyStatus({ tone: "ok", text: `Tercero ${result.party.legal_name} creado y auditado.` });
      setPartyForm(prev => ({ ...prev, legal_name: "", tax_id: "", email: "", phone: "", notes: "" }));
      await refreshParties();
    } catch (err) {
      setPartyStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  function startPartyEdit(party) {
    setPartyStatus(null);
    setPartyStatusAction(null);
    setPartyEditAction({
      party,
      party_type: party.party_type || "customer",
      legal_name: party.legal_name || "",
      tax_id: party.tax_id || "",
      email: party.email || "",
      phone: party.phone || "",
      default_account_id: party.default_account_id || "",
      notes: party.notes || "",
    });
  }

  async function handleUpdateParty(event) {
    event.preventDefault();
    if (!partyEditAction?.party) return;
    setPartyStatus(null);
    try {
      const result = await updateParty(partyEditAction.party.id, {
        party_type: partyEditAction.party_type,
        legal_name: partyEditAction.legal_name,
        tax_id: partyEditAction.tax_id,
        email: partyEditAction.email,
        phone: partyEditAction.phone,
        default_account_id: partyEditAction.default_account_id || null,
        notes: partyEditAction.notes,
      });
      setPartyStatus({ tone: "ok", text: `Tercero ${result.party.legal_name} actualizado y auditado.` });
      setPartyEditAction(null);
      await refreshParties();
    } catch (err) {
      setPartyStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handlePartyStatus(event) {
    event.preventDefault();
    if (!partyStatusAction) return;
    setPartyStatus(null);
    try {
      const result = await updatePartyStatus(partyStatusAction.party.id, {
        is_active: !partyStatusAction.party.is_active,
        reason: partyStatusAction.reason,
      });
      setPartyStatus({
        tone: "ok",
        text: `Tercero ${result.party.legal_name} ${result.party.is_active ? "activado" : "desactivado"}.`,
      });
      setPartyStatusAction(null);
      await refreshParties();
    } catch (err) {
      setPartyStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleMaturityFilter(event) {
    event.preventDefault();
    await refreshMaturities(maturityFilters);
  }

  async function handleExportMaturitiesCsv() {
    setMaturitiesExporting(true);
    setMaturityStatus(null);
    try {
      const result = await downloadMaturitiesCsv({ ...maturityFilters, limit: 500 });
      saveBlob(result.blob, result.filename || "vencimientos.csv");
      setMaturityStatus({ tone: "ok", text: "Exportacion CSV de vencimientos generada y auditada." });
    } catch (err) {
      setMaturityStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setMaturitiesExporting(false);
    }
  }

  async function handleCreateMaturity(event) {
    event.preventDefault();
    setMaturityStatus(null);
    try {
      const result = await createMaturity(maturityForm);
      setMaturityStatus({ tone: "ok", text: `Vencimiento ${result.maturity.description} creado.` });
      setMaturityForm(prev => ({
        ...prev,
        document_ref: "",
        description: "",
        amount: "",
        payment_method: "",
        notes: "",
      }));
      await refreshMaturities();
    } catch (err) {
      setMaturityStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleMaturityStatus(event) {
    event.preventDefault();
    if (!maturityStatusAction?.maturity) return;
    setMaturityStatus(null);
    try {
      const result = await updateMaturityStatus(maturityStatusAction.maturity.id, {
        action: maturityStatusAction.action,
        reason: maturityStatusAction.reason,
        settled_date: maturityStatusAction.settled_date,
      });
      setMaturityStatus({
        tone: "ok",
        text: `Vencimiento ${maturityStatusLabels[result.maturity.status] || result.maturity.status}.`,
      });
      setMaturityStatusAction(null);
      await refreshMaturities();
    } catch (err) {
      setMaturityStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleFixedAssetFilter(event) {
    event.preventDefault();
    setFixedAssetPlan(null);
    await refreshFixedAssets(fixedAssetFilters);
  }

  async function handleExportFixedAssetsCsv() {
    setFixedAssetsExporting(true);
    setFixedAssetStatus(null);
    try {
      const result = await downloadFixedAssetsCsv({ ...fixedAssetFilters, limit: 500 });
      saveBlob(result.blob, result.filename || "inmovilizado.csv");
      setFixedAssetStatus({ tone: "ok", text: "Exportacion CSV de inmovilizado generada y auditada." });
    } catch (err) {
      setFixedAssetStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setFixedAssetsExporting(false);
    }
  }

  async function handleCreateFixedAsset(event) {
    event.preventDefault();
    setFixedAssetStatus(null);
    try {
      const result = await createFixedAsset({
        ...fixedAssetForm,
        asset_account_id: fixedAssetForm.asset_account_id || null,
        accumulated_depreciation_account_id: fixedAssetForm.accumulated_depreciation_account_id || null,
        expense_account_id: fixedAssetForm.expense_account_id || null,
      });
      setFixedAssetStatus({ tone: "ok", text: `Inmovilizado ${result.fixed_asset.asset_code} creado. No se han generado asientos.` });
      setFixedAssetForm(prev => ({
        ...prev,
        asset_code: "",
        name: "",
        acquisition_cost: "",
        residual_value: "0",
        notes: "",
      }));
      await refreshFixedAssets();
    } catch (err) {
      setFixedAssetStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleOpenFixedAssetPlan(asset) {
    setFixedAssetStatus(null);
    try {
      const result = await getFixedAssetDepreciationPlan(asset.id);
      setFixedAssetPlan(result);
    } catch (err) {
      setFixedAssetStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  async function handleFixedAssetStatus(event) {
    event.preventDefault();
    if (!fixedAssetStatusAction?.asset) return;
    setFixedAssetStatus(null);
    try {
      const result = await updateFixedAssetStatus(fixedAssetStatusAction.asset.id, {
        action: fixedAssetStatusAction.action,
        reason: fixedAssetStatusAction.reason,
        disposed_at: fixedAssetStatusAction.disposed_at,
      });
      setFixedAssetStatus({
        tone: "ok",
        text: `Inmovilizado ${result.fixed_asset.asset_code} ${fixedAssetStatusLabels[result.fixed_asset.status] || result.fixed_asset.status}.`,
      });
      setFixedAssetStatusAction(null);
      await refreshFixedAssets();
    } catch (err) {
      setFixedAssetStatus({ tone: "danger", text: err.message });
    }
  }

  function startFixedAssetDepreciation(asset) {
    const firstOpenPeriod = periods.find(period => (
      period.fiscal_year_id === asset.fiscal_year_id
      && period.status === "open"
    ));
    setFixedAssetDepreciationAction({
      asset,
      period_id: firstOpenPeriod?.id || "",
      description: `Amortizacion ${asset.asset_code}`,
      idempotency_key: newIdempotencyKey(`dep:${asset.asset_code}`),
    });
  }

  async function handleFixedAssetDepreciation(event) {
    event.preventDefault();
    if (!fixedAssetDepreciationAction?.asset) return;
    setFixedAssetStatus(null);
    try {
      const result = await createFixedAssetDepreciationDraft(fixedAssetDepreciationAction.asset.id, {
        period_id: fixedAssetDepreciationAction.period_id,
        description: fixedAssetDepreciationAction.description,
        idempotency_key: fixedAssetDepreciationAction.idempotency_key,
      });
      setFixedAssetStatus({
        tone: result.repeated ? "warning" : "ok",
        text: result.repeated
          ? "La amortizacion ya estaba preparada con esa clave. Revisa el borrador existente en Diario."
          : `Borrador de amortizacion creado por ${formatMoney(result.depreciation_run.amount)} EUR. Revisa y contabiliza desde Diario.`,
      });
      setFixedAssetDepreciationAction(null);
      if (fixedAssetPlan?.fixed_asset?.id === result.depreciation_run.fixed_asset_id) {
        setFixedAssetPlan(prev => prev ? { ...prev, depreciation_runs: result.depreciation_runs || prev.depreciation_runs } : prev);
      }
      await refreshJournal();
      await refreshFixedAssets();
    } catch (err) {
      setFixedAssetStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleCancelFixedAssetDepreciation(event) {
    event.preventDefault();
    if (!fixedAssetDepreciationCancelAction?.run) return;
    setFixedAssetStatus(null);
    try {
      const result = await cancelFixedAssetDepreciationDraft(fixedAssetDepreciationCancelAction.run.id, {
        reason: fixedAssetDepreciationCancelAction.reason,
      });
      setFixedAssetStatus({
        tone: result.repeated ? "warning" : "ok",
        text: result.repeated
          ? "La amortizacion ya estaba cancelada."
          : "Borrador de amortizacion cancelado. El periodo queda disponible para preparar una nueva amortizacion.",
      });
      setFixedAssetDepreciationCancelAction(null);
      if (fixedAssetPlan?.fixed_asset?.id === result.depreciation_run.fixed_asset_id) {
        setFixedAssetPlan(prev => prev ? { ...prev, depreciation_runs: result.depreciation_runs || prev.depreciation_runs } : prev);
      }
      await refreshJournal();
    } catch (err) {
      setFixedAssetStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleBankFilter(event) {
    event.preventDefault();
    await refreshBanks(bankTransactionFilters, bankAccountFilters);
  }

  async function handleBankAccountFilter(event) {
    event.preventDefault();
    setFocusedBankTransactionId(null);
    await refreshBanks(bankTransactionFilters, bankAccountFilters);
  }

  async function handleCreateBankAccount(event) {
    event.preventDefault();
    setBanksStatus(null);
    try {
      const result = await createBankAccount({
        ...bankAccountForm,
        account_id: bankAccountForm.account_id || null,
      });
      setBanksStatus({ tone: "ok", text: `Cuenta bancaria ${result.bank_account.name} creada.` });
      setBankAccountForm(prev => ({
        ...prev,
        name: "",
        bank_name: "",
        iban: "",
        swift_bic: "",
        opening_balance: "0",
        notes: "",
      }));
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
    } catch (err) {
      setBanksStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleCreateBankTransaction(event) {
    event.preventDefault();
    setBanksStatus(null);
    try {
      const result = await createBankTransaction(bankTransactionForm);
      setBanksStatus({ tone: "ok", text: `Movimiento ${result.bank_transaction.description} creado.` });
      setBankTransactionForm(prev => ({
        ...prev,
        value_date: "",
        description: "",
        reference: "",
        counterparty_name: "",
        amount: "",
        notes: "",
      }));
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
    } catch (err) {
      setBanksStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleImportBankStatement(event) {
    event.preventDefault();
    setBanksStatus(null);
    try {
      const result = await importBankStatementCsv(bankImportForm);
      setBanksStatus({
        tone: result.import.error_count > 0 ? "warning" : "ok",
        text: `Importacion CSV: ${result.import.inserted_count} movimientos nuevos, ${result.import.skipped_count} duplicados, ${result.import.error_count} filas con error.`,
      });
      setBankImportForm(prev => ({ ...prev, csv_text: "" }));
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
    } catch (err) {
      setBanksStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleExportBankTransactionsCsv() {
    setBankTransactionsExporting(true);
    setBanksStatus(null);
    try {
      const result = await downloadBankTransactionsCsv({ ...bankTransactionFilters, limit: 500 });
      saveBlob(result.blob, result.filename || "movimientos_bancarios.csv");
      setBanksStatus({ tone: "ok", text: "Exportacion CSV de movimientos bancarios generada y auditada." });
    } catch (err) {
      setBanksStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setBankTransactionsExporting(false);
    }
  }

  async function startBankReconciliation(transaction) {
    const expectedDirection = transaction.direction === "inflow" ? "receivable" : "payable";
    const match = pendingMaturityOptions.find(item => (
      item.direction === expectedDirection &&
      Number(item.open_amount || 0) === Number(transaction.amount || 0)
    ));
    setBankReconciliationAction({
      transaction,
      maturity_id: match?.id || "",
      reason: "Conciliacion manual bancaria",
      suggestions: [],
      suggestions_loading: true,
    });
    setBankReconciliationReverseAction(null);
    setBankTransactionStatusAction(null);
    setBanksStatus(null);
    try {
      const result = await getBankReconciliationSuggestions(transaction.id, { limit: 5, days_window: 30 });
      const first = result.suggestions?.[0];
      setBankReconciliationAction(prev => {
        if (!prev || prev.transaction.id !== transaction.id) return prev;
        return {
          ...prev,
          maturity_id: first?.maturity?.id || prev.maturity_id,
          reason: first ? "Conciliacion asistida bancaria" : prev.reason,
          suggestions: result.suggestions || [],
          suggestions_loading: false,
        };
      });
    } catch (err) {
      setBankReconciliationAction(prev => (
        prev && prev.transaction.id === transaction.id ? { ...prev, suggestions_loading: false } : prev
      ));
      setBanksStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    }
  }

  function startBankReconciliationReverse(transaction) {
    setBankReconciliationReverseAction({
      transaction,
      reason: "Reversion manual de conciliacion",
    });
    setBankReconciliationAction(null);
    setBankTransactionStatusAction(null);
  }

  function startBankTransactionStatusAction(transaction, action) {
    setBankTransactionStatusAction({
      transaction,
      action,
      reason: action === "ignore" ? "Movimiento bancario no conciliable" : "Reapertura de movimiento bancario",
    });
    setBankReconciliationAction(null);
    setBankReconciliationReverseAction(null);
  }

  async function handleBankReconciliation(event) {
    event.preventDefault();
    if (!bankReconciliationAction?.transaction) return;
    setBanksStatus(null);
    try {
      const result = await reconcileBankTransaction(bankReconciliationAction.transaction.id, {
        maturity_id: bankReconciliationAction.maturity_id,
        reason: bankReconciliationAction.reason,
      });
      setBanksStatus({
        tone: "ok",
        text: `Movimiento conciliado con ${result.maturity.party_name || "vencimiento"} por ${formatMoney(result.reconciliation.matched_amount)} EUR.`,
      });
      setBankReconciliationAction(null);
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
      await refreshMaturities({ status: "pending", limit: 500 });
    } catch (err) {
      setBanksStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleBankTransactionStatus(event) {
    event.preventDefault();
    if (!bankTransactionStatusAction?.transaction) return;
    setBanksStatus(null);
    try {
      const result = await updateBankTransactionStatus(bankTransactionStatusAction.transaction.id, {
        action: bankTransactionStatusAction.action,
        reason: bankTransactionStatusAction.reason,
      });
      setBanksStatus({
        tone: "ok",
        text: `Movimiento ${bankTransactionStatusLabels[result.bank_transaction.status] || result.bank_transaction.status}: ${result.bank_transaction.description}.`,
      });
      setBankTransactionStatusAction(null);
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
    } catch (err) {
      setBanksStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleBankReconciliationReverse(event) {
    event.preventDefault();
    if (!bankReconciliationReverseAction?.transaction?.reconciliation_id) return;
    setBanksStatus(null);
    try {
      const result = await reverseBankReconciliation(bankReconciliationReverseAction.transaction.reconciliation_id, {
        reason: bankReconciliationReverseAction.reason,
      });
      setBanksStatus({
        tone: "ok",
        text: `Conciliacion revertida. Movimiento pendiente y vencimiento reabierto por ${formatMoney(result.reconciliation.matched_amount)} EUR.`,
      });
      setBankReconciliationReverseAction(null);
      await refreshBanks(bankTransactionFilters, bankAccountFilters, { clearStatus: false });
      await refreshMaturities({ status: "pending", limit: 500 });
    } catch (err) {
      setBanksStatus({ tone: "danger", text: err.message });
    }
  }

  async function handleCreateTemplate(event) {
    event.preventDefault();
    setTemplateStatus(null);
    try {
      const result = await createChartTemplateFromFiscalYear(templateForm);
      setTemplateForm(prev => ({ ...prev, code: "", name: "", version_label: "v1" }));
      await refreshTemplates();
      setTemplateStatus({
        tone: "ok",
        text: `Plantilla ${result.template.name} creada con ${result.template.account_count} cuentas activas.`,
      });
    } catch (err) {
      setTemplateStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handlePreviewTemplate(template) {
    setTemplateStatus(null);
    setTemplatePreview(null);
    if (!templateTargetYearId) {
      setTemplateStatus({ tone: "warning", text: "Selecciona un ejercicio destino." });
      return;
    }
    try {
      const result = await previewChartTemplate(template.id, templateTargetYearId);
      setTemplatePreview(result.preview);
    } catch (err) {
      setTemplateStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleImportTemplate() {
    if (!templatePreview) return;
    setTemplateStatus(null);
    try {
      const idempotencyKey = typeof crypto !== "undefined" && crypto.randomUUID
        ? `chart-import:${crypto.randomUUID()}`
        : `chart-import:${Date.now()}`;
      const result = await importChartTemplate(templatePreview.template.id, {
        fiscal_year_id: templatePreview.fiscal_year.id,
        idempotency_key: idempotencyKey,
      });
      setTemplateStatus({
        tone: "ok",
        text: `Importacion completada: ${result.import.inserted_count} altas, ${result.import.matching_count} coincidencias y ${result.import.conflict_count} conflictos sin sobrescribir.`,
      });
      setTemplatePreview(null);
      setAccountFilters(prev => ({ ...prev, fiscal_year_id: templateTargetYearId }));
      await refreshAccounts({ ...accountFilters, fiscal_year_id: templateTargetYearId });
    } catch (err) {
      setTemplateStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  function updateJournalLine(index, field, value) {
    setJournalForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line),
    }));
  }

  function addJournalLine() {
    setJournalForm(prev => ({
      ...prev,
      lines: [...prev.lines, { account_id: "", side: "debit", amount: "", description: "" }],
    }));
  }

  function removeJournalLine(index) {
    setJournalForm(prev => ({ ...prev, lines: prev.lines.filter((_, lineIndex) => lineIndex !== index) }));
  }

  async function startJournalEdit(entry) {
    setJournalStatus(null);
    setJournalCancelAction(null);
    setJournalReverseAction(null);
    await refreshJournalAccounts(entry.fiscal_year_id);
    setJournalEditForm({
      entry,
      entry_date: String(entry.entry_date).slice(0, 10),
      description: entry.description || "",
      lines: entry.lines.map(journalLineToEditable),
    });
  }

  function updateJournalEditLine(index, field, value) {
    setJournalEditForm(prev => ({
      ...prev,
      lines: prev.lines.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line),
    }));
  }

  function addJournalEditLine() {
    setJournalEditForm(prev => ({
      ...prev,
      lines: [...prev.lines, { account_id: "", side: "debit", amount: "", description: "" }],
    }));
  }

  function removeJournalEditLine(index) {
    setJournalEditForm(prev => ({ ...prev, lines: prev.lines.filter((_, lineIndex) => lineIndex !== index) }));
  }

  async function handleJournalFilter(event) {
    event.preventDefault();
    await refreshJournal(journalFilters);
  }

  async function clearJournalFilters() {
    const nextFilters = { fiscal_year_id: "", status: "", q: "", date_from: "", date_to: "" };
    setJournalFilters(nextFilters);
    await refreshJournal(nextFilters);
  }

  async function handleLedgerFilter(event) {
    event.preventDefault();
    await refreshLedger(ledgerFilters);
  }

  async function handleReportsFilter(event) {
    event.preventDefault();
    await refreshReports(reportsFilters);
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function handleExportTrialBalanceCsv() {
    if (!ledgerFilters.fiscal_year_id) return;
    setLedgerExporting(true);
    setLedgerStatus(null);
    try {
      const result = await downloadTrialBalanceCsv({
        fiscal_year_id: ledgerFilters.fiscal_year_id,
        period_id: ledgerFilters.period_id,
        date_from: ledgerFilters.date_from,
        date_to: ledgerFilters.date_to,
        include_empty: ledgerFilters.include_empty,
      });
      saveBlob(result.blob, result.filename || "sumas-y-saldos.csv");
      setLedgerStatus({ tone: "ok", text: "Exportacion CSV de sumas y saldos generada y auditada." });
    } catch (err) {
      setLedgerStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setLedgerExporting(false);
    }
  }

  async function handleExportJournalCsv() {
    setJournalExporting(true);
    setJournalStatus(null);
    try {
      const result = await downloadJournalEntriesCsv({ ...journalFilters, limit: 200 });
      saveBlob(result.blob, result.filename || "diario.csv");
      setJournalStatus({ tone: "ok", text: "Exportacion CSV de Diario generada y auditada." });
    } catch (err) {
      setJournalStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setJournalExporting(false);
    }
  }

  async function handleExportLedgerCsv() {
    if (!ledgerFilters.account_id) return;
    setLedgerExporting(true);
    setLedgerStatus(null);
    try {
      const result = await downloadLedgerAccountCsv(ledgerFilters.account_id, {
        period_id: ledgerFilters.period_id,
        date_from: ledgerFilters.date_from,
        date_to: ledgerFilters.date_to,
        limit: 500,
      });
      saveBlob(result.blob, result.filename || "mayor.csv");
      setLedgerStatus({ tone: "ok", text: "Exportacion CSV de Mayor generada y auditada." });
    } catch (err) {
      setLedgerStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setLedgerExporting(false);
    }
  }

  async function handleExportBalanceSheetCsv() {
    if (!reportsFilters.fiscal_year_id) return;
    setReportsExporting(true);
    setReportsStatus(null);
    try {
      const result = await downloadBalanceSheetCsv(reportsFilters);
      saveBlob(result.blob, result.filename || "balance-situacion.csv");
      setReportsStatus({ tone: "ok", text: "CSV de Balance generado y auditado." });
    } catch (err) {
      setReportsStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setReportsExporting(false);
    }
  }

  async function handleExportProfitLossCsv() {
    if (!reportsFilters.fiscal_year_id) return;
    setReportsExporting(true);
    setReportsStatus(null);
    try {
      const result = await downloadProfitLossCsv(reportsFilters);
      saveBlob(result.blob, result.filename || "perdidas-ganancias.csv");
      setReportsStatus({ tone: "ok", text: "CSV de PyG generado y auditado." });
    } catch (err) {
      setReportsStatus({ tone: err.status === 403 ? "danger" : "warning", text: err.message });
    } finally {
      setReportsExporting(false);
    }
  }

  async function handleCreateJournalDraft(event) {
    event.preventDefault();
    setJournalStatus(null);
    setJournalEditForm(null);
    setJournalReverseAction(null);
    try {
      const result = await createJournalDraft(journalForm);
      setJournalDetail(result.entry);
      setJournalStatus({ tone: "ok", text: "Borrador guardado. Revísalo antes de contabilizar." });
      setJournalForm(prev => ({
        ...prev,
        description: "",
        idempotency_key: newIdempotencyKey("journal-draft"),
        lines: [
          { account_id: "", side: "debit", amount: "", description: "" },
          { account_id: "", side: "credit", amount: "", description: "" },
        ],
      }));
      await refreshJournal({ ...journalFilters, fiscal_year_id: result.entry.fiscal_year_id });
    } catch (err) {
      setJournalStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleOpenJournalEntry(entryId) {
    setJournalStatus(null);
    setJournalCancelAction(null);
    setJournalEditForm(null);
    setJournalReverseAction(null);
    try {
      const result = await getJournalEntry(entryId);
      setJournalDetail(result.entry);
    } catch (err) {
      setJournalStatus({ tone: "danger", text: err.message });
    }
  }

  async function handlePostJournalEntry(entry) {
    setJournalStatus(null);
    setJournalEditForm(null);
    setJournalCancelAction(null);
    setJournalReverseAction(null);
    try {
      const result = await postJournalEntry(entry.id, `journal-post:${entry.id}`);
      setJournalDetail(result.entry);
      setJournalStatus({ tone: "ok", text: `Asiento ${result.entry.entry_number} contabilizado.` });
      await refreshJournal();
    } catch (err) {
      setJournalStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  function startJournalReverse(entry) {
    const year = fiscalYears.find(item => item.id === entry.fiscal_year_id);
    setJournalStatus(null);
    setJournalEditForm(null);
    setJournalCancelAction(null);
    setJournalReverseAction({
      entry,
      entry_date: dateInsideFiscalYear(year, new Date().toISOString().slice(0, 10)),
      reason: "",
      idempotency_key: newIdempotencyKey(`journal-reverse:${entry.id}`),
    });
  }

  async function handleCreateJournalReversal(event) {
    event.preventDefault();
    if (!journalReverseAction?.entry) return;
    setJournalStatus(null);
    try {
      const result = await createJournalReversalDraft(journalReverseAction.entry.id, {
        entry_date: journalReverseAction.entry_date,
        reason: journalReverseAction.reason,
        idempotency_key: journalReverseAction.idempotency_key,
      });
      setJournalDetail(result.entry);
      setJournalReverseAction(null);
      setJournalStatus({ tone: "ok", text: "Borrador reverso creado. Revisalo antes de contabilizar." });
      await refreshJournal({ ...journalFilters, fiscal_year_id: result.entry.fiscal_year_id });
    } catch (err) {
      setJournalStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleUpdateJournalDraft(event) {
    event.preventDefault();
    if (!journalEditForm?.entry) return;
    setJournalStatus(null);
    try {
      const result = await updateJournalDraft(journalEditForm.entry.id, {
        entry_date: journalEditForm.entry_date,
        description: journalEditForm.description,
        lines: journalEditForm.lines,
      });
      setJournalDetail(result.entry);
      setJournalEditForm(null);
      setJournalStatus({ tone: "ok", text: "Borrador actualizado y auditado." });
      await refreshJournal({ ...journalFilters, fiscal_year_id: result.entry.fiscal_year_id });
    } catch (err) {
      setJournalStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  async function handleCancelJournalEntry(event) {
    event.preventDefault();
    if (!journalCancelAction?.entry) return;
    setJournalStatus(null);
    setJournalEditForm(null);
    setJournalReverseAction(null);
    try {
      const result = await cancelJournalEntry(journalCancelAction.entry.id, journalCancelAction.reason);
      setJournalDetail(result.entry);
      setJournalCancelAction(null);
      setJournalStatus({ tone: "ok", text: "Borrador cancelado y auditado." });
      await refreshJournal();
    } catch (err) {
      setJournalStatus({ tone: err.status === 409 ? "warning" : "danger", text: err.message });
    }
  }

  if (booting) {
    return <main className="screen center">Preparando TransGest Contabilidad...</main>;
  }

  if (!getToken()) {
    return (
      <main className="screen center">
        <section className="login-panel">
          <h1>TransGest Contabilidad</h1>
          <p>Abre este modulo desde TransGest para conservar la sesion y el contexto de empresa.</p>
          {error && <StatusBadge tone={error.status === 403 ? "danger" : "warning"} text={error.message} />}
          <a className="primary-link" href={TRANSGEST_FRONTEND_URL}>Volver a TransGest</a>
        </section>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">TG</span>
          <div>
            <strong>Contabilidad</strong>
            <small>Centro contable</small>
          </div>
        </div>
        <nav>
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={activeTab === tab.id ? "active" : ""}
              onClick={() => { setWorkspaceHint(null); setActiveTab(tab.id); }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <h1>TransGest Contabilidad</h1>
            <p>{selectedCompany ? selectedCompany.name : "Selecciona una empresa autorizada"}</p>
          </div>
          <div className="top-actions">
            <a className="back-link" href={TRANSGEST_FRONTEND_URL}>Volver a TransGest</a>
            <select value={selectedCompanyId || ""} onChange={e => handleSelectCompany(e.target.value)}>
              {companies.map(company => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
            <button onClick={() => { removeToken(); window.location.reload(); }}>Salir</button>
          </div>
        </header>

        {error && (
          <div className="alert">
            <strong>{error.status === 403 ? "Acceso denegado" : "Error"}</strong>
            <span>{error.message}</span>
          </div>
        )}

        {activeTab === "overview" && dashboardStatus && (
          <div className="alert">
            <strong>Resumen parcial</strong>
            <span>{dashboardStatus.text}</span>
          </div>
        )}

        {activeTab === "overview" && (
          <section className="workspace">
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">Situacion de trabajo</span>
                <h2>{selectedCompany?.name || "Empresa sin seleccionar"}</h2>
                <p>Preparacion contable por empresa y ejercicio. El Diario manual valida partida doble y periodos antes de contabilizar.</p>
              </div>
              <button className="primary-command" onClick={() => setActiveTab(fiscalYears.length ? "accounts" : "periods")}>
                {fiscalYears.length ? "Trabajar con el plan contable" : "Abrir primer ejercicio"}
              </button>
            </div>
            <div className="metric-strip">
              <div><span>Ejercicios</span><strong>{overviewFiscalYears}</strong><small>{fiscalYears[0]?.year_label || "Pendiente"}</small></div>
              <div><span>Periodos abiertos</span><strong>{overviewActivePeriods}</strong><small>{overviewLockedPeriods} bloqueados o cerrados</small></div>
              <div><span>Cuentas activas</span><strong>{overviewAccounts}</strong><small>{overviewPostableAccounts} imputables</small></div>
              <div><span>Conexión TransGest</span><strong className="metric-word">Activa</strong><small>SSO y empresa sincronizados</small></div>
            </div>
            <div className="operator-console">
              <article className="readiness-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Preparacion contable</h2>
                    <p>Estado minimo para empezar a registrar trabajo diario.</p>
                  </div>
                  <strong>{readinessDone}/{readinessItems.length}</strong>
                </div>
                <div className="readiness-list">
                  {readinessItems.map(item => (
                    <button key={item.id} type="button" onClick={() => setActiveTab(item.tab)}>
                      <span className={item.ok ? "check-ok" : "check-pending"}>{item.ok ? "OK" : "!"}</span>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </button>
                  ))}
                </div>
              </article>
              <article className="alerts-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Avisos de trabajo</h2>
                    <p>Elementos que conviene revisar antes de cerrar el dia.</p>
                  </div>
                </div>
                {operationalAlerts.length ? (
                  <div className="alert-list">
                    {operationalAlerts.map(alert => (
                      <button key={`${alert.label}-${alert.tab}`} type="button" onClick={() => alert.action ? alert.action() : setActiveTab(alert.tab)}>
                        <StatusBadge tone={alert.tone} text={alert.label} />
                        <strong>{alert.detail}</strong>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin avisos pendientes" detail="No hay borradores, pagos, cobros o movimientos bancarios pendientes en los filtros actuales." />
                )}
              </article>
              <article className="quick-actions-panel">
                <div className="panel-heading">
                  <div>
                    <h2>Accesos rapidos</h2>
                    <p>Atajos para las tareas mas habituales.</p>
                  </div>
                </div>
                <div className="quick-actions">
                  {quickActions.map(action => (
                    <button key={action.label} type="button" disabled={!action.enabled} onClick={() => openQuickAction(action)}>
                      {action.label}
                    </button>
                  ))}
                </div>
              </article>
            </div>
            <article className="priority-board">
              <div className="panel-heading">
                <div>
                  <h2>Bandeja prioritaria</h2>
                  <p>Elementos concretos que requieren revision operativa.</p>
                </div>
                <StatusBadge tone={hasPriorityItems ? "warning" : "ok"} text={hasPriorityItems ? "Pendiente" : "Limpio"} />
              </div>
              {hasPriorityItems ? (
                <div className="priority-grid">
                  <section>
                    <div className="priority-title"><strong>Vencimientos</strong><button type="button" aria-label="Abrir vencimientos prioritarios" onClick={() => openPriorityMaturity(priorityMaturities[0])}>Abrir</button></div>
                    <div className="priority-list">
                      {priorityMaturities.length ? priorityMaturities.map(item => (
                        <button key={item.id} type="button" aria-label={`Abrir vencimiento ${item.party_name || item.document_ref || item.description}`} onClick={() => openPriorityMaturity(item)}>
                          <span>{formatShortDate(item.due_date)}</span>
                          <strong>{item.party_name || item.document_ref || item.description}</strong>
                          <small>{item.direction === "payable" ? "Pago" : "Cobro"} · {formatMoney(item.open_amount)} {item.currency || "EUR"}</small>
                        </button>
                      )) : <p>Sin vencimientos pendientes.</p>}
                    </div>
                  </section>
                  <section>
                    <div className="priority-title"><strong>Bancos</strong><button type="button" aria-label="Abrir movimientos bancarios prioritarios" onClick={() => openPriorityBankTransaction(priorityBankTransactions[0])}>Abrir</button></div>
                    <div className="priority-list">
                      {priorityBankTransactions.length ? priorityBankTransactions.map(item => (
                        <button key={item.id} type="button" aria-label={`Abrir movimiento bancario ${item.counterparty_name || item.reference || item.description}`} onClick={() => openPriorityBankTransaction(item)}>
                          <span>{formatShortDate(item.transaction_date)}</span>
                          <strong>{item.counterparty_name || item.description}</strong>
                          <small>{item.bank_account_name} · {item.direction === "outflow" ? "-" : "+"}{formatMoney(item.amount)} EUR</small>
                        </button>
                      )) : <p>Sin movimientos pendientes.</p>}
                    </div>
                  </section>
                  <section>
                    <div className="priority-title"><strong>Diario</strong><button type="button" aria-label="Abrir borradores de diario prioritarios" onClick={() => openPriorityJournalDraft(priorityJournalDrafts[0])}>Abrir</button></div>
                    <div className="priority-list">
                      {priorityJournalDrafts.length ? priorityJournalDrafts.map(item => (
                        <button key={item.id} type="button" aria-label={`Abrir borrador de diario ${item.description}`} onClick={() => openPriorityJournalDraft(item)}>
                          <span>{formatShortDate(item.entry_date)}</span>
                          <strong>{item.description}</strong>
                          <small>Borrador pendiente de revision</small>
                        </button>
                      )) : <p>Sin borradores pendientes.</p>}
                    </div>
                  </section>
                  <section>
                    <div className="priority-title"><strong>Integracion</strong><button type="button" aria-label="Abrir eventos internos prioritarios" onClick={() => openPriorityOutboxEvent(priorityOutboxEvents[0])}>Abrir</button></div>
                    <div className="priority-list">
                      {priorityOutboxEvents.length ? priorityOutboxEvents.map(item => (
                        <button key={item.id} type="button" aria-label={`Abrir evento interno ${item.event_type}`} onClick={() => openPriorityOutboxEvent(item)}>
                          <span>{item.status}</span>
                          <strong>{item.event_type}</strong>
                          <small>{item.attempts} intentos · {item.aggregate_type}</small>
                        </button>
                      )) : <p>Sin eventos pendientes.</p>}
                    </div>
                  </section>
                </div>
              ) : (
                <EmptyState title="Bandeja sin pendientes" detail="No hay vencimientos, conciliaciones, borradores ni eventos internos pendientes." />
              )}
            </article>
            <div className="work-grid">
              <article className="work-list">
                <div className="panel-heading">
                  <div><h2>Siguientes tareas</h2><p>Orden recomendado para preparar la contabilidad.</p></div>
                </div>
                <button onClick={() => setActiveTab("periods")}><span>{overviewFiscalYears ? "01" : "!"}</span><strong>Ejercicios y periodos</strong><small>{overviewFiscalYears ? `${overviewFiscalYears} ejercicios configurados` : "Abre el primer ejercicio"}</small></button>
                <button onClick={() => setActiveTab("accounts")}><span>{overviewAccounts ? "02" : "!"}</span><strong>Plan contable</strong><small>{overviewAccounts ? `${overviewAccounts} cuentas activas` : "Crea las cuentas necesarias"}</small></button>
                <button onClick={() => setActiveTab("parties")}><span>{overviewActiveParties ? "03" : "!"}</span><strong>Terceros</strong><small>{overviewActiveParties} terceros activos</small></button>
                <button onClick={() => setActiveTab("maturities")}><span>04</span><strong>Vencimientos</strong><small>Cobros {formatMoney(overviewPendingReceivables)} EUR · pagos {formatMoney(overviewPendingPayables)} EUR</small></button>
                <button onClick={() => setActiveTab("banks")}><span>05</span><strong>Bancos</strong><small>{overviewBankAccounts} cuentas · {overviewUnmatchedBankTransactions} movimientos pendientes</small></button>
                <button onClick={() => setActiveTab("journal")}><span>06</span><strong>Diario y asientos</strong><small>{overviewJournalDrafts} borradores, {overviewJournalPosted} contabilizados y {overviewJournalCancelled} cancelados</small></button>
              </article>
              <article className="context-panel">
                <h2>Contexto activo</h2>
                <dl>
                  <dt>Usuario</dt><dd>{session?.selected_company?.email || session?.user_id}</dd>
                  <dt>Empresa</dt><dd>{selectedCompany?.name || "-"}</dd>
                  <dt>Origen</dt><dd>TransGest SSO</dd>
                  <dt>Rol</dt><dd>{canWriteAccounts ? "Edicion contable" : "Consulta contable"}</dd>
                </dl>
                <div className="scope-note">Plan configurable manual. Plantillas PGC y PGC PYMES pendientes de fuente oficial validada.</div>
              </article>
            </div>
          </section>
        )}

        {activeTab === "accounts" && (
          <section className="accounts-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Configuracion por ejercicio</span>
                <h2>Plan contable</h2>
                <p>Cuentas configurables para preparar el trabajo contable. No existen movimientos ni saldos hasta habilitar el diario.</p>
              </div>
              {accountsLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "accounts" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadAccounts ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso accounts.read." />
            ) : (
              <>
                <form className="account-filters" onSubmit={handleAccountFilter}>
                  <label><span>Ejercicio</span><select value={accountFilters.fiscal_year_id} onChange={e => setAccountFilters(prev => ({ ...prev, fiscal_year_id: e.target.value }))}><option value="">Todos</option>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                  <label><span>Buscar</span><input value={accountFilters.q} onChange={e => setAccountFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Codigo o nombre" /></label>
                  <label><span>Estado</span><select value={accountFilters.active} onChange={e => setAccountFilters(prev => ({ ...prev, active: e.target.value }))}><option value="">Todos</option><option value="true">Activas</option><option value="false">Inactivas</option></select></label>
                  <button type="submit">Aplicar</button>
                </form>
                {canWriteAccounts && fiscalYears.length > 0 && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("account-create")}>
                      {isPanelOpen("account-create") ? "Ocultar nueva cuenta" : "Nueva cuenta"}
                    </button>
                  </div>
                )}
                {canWriteAccounts && fiscalYears.length > 0 && isPanelOpen("account-create") && (
                  <form className={targetClass("account-create", "account-create")} data-workspace-target="account-create" onSubmit={handleCreateAccount}>
                    <div className="form-title"><strong>Nueva cuenta</strong><span>Alta transaccional, auditada y sin movimientos.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("account-create")}>Ocultar</button></div>
                    <label><span>Ejercicio</span><select required value={accountForm.fiscal_year_id} onChange={e => setAccountForm(prev => ({ ...prev, fiscal_year_id: e.target.value }))}>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                    <label><span>Codigo</span><input required maxLength={20} pattern="[0-9]+" value={accountForm.code} onChange={e => setAccountForm(prev => ({ ...prev, code: e.target.value }))} placeholder="4300001" /></label>
                    <label className="account-name"><span>Nombre</span><input required maxLength={220} value={accountForm.name} onChange={e => setAccountForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Cliente principal" /></label>
                    <label><span>Tipo</span><select value={accountForm.account_type} onChange={e => setAccountForm(prev => ({ ...prev, account_type: e.target.value }))}>{Object.entries(accountTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label className="checkbox-label"><input type="checkbox" checked={accountForm.is_postable} onChange={e => setAccountForm(prev => ({ ...prev, is_postable: e.target.checked }))} /><span>Admite movimientos futuros</span></label>
                    <button type="submit">Crear cuenta</button>
                  </form>
                )}
                {accountStatus && <div className="form-status"><StatusBadge tone={accountStatus.tone} text={accountStatus.text} /></div>}
                {!fiscalYears.length ? (
                  <EmptyState title="Primero abre un ejercicio" detail="El plan contable se configura de forma independiente para cada ejercicio." />
                ) : accounts.length ? (
                  <div className="accounts-table">
                    <div className="accounts-row head"><span>Codigo</span><span>Cuenta</span><span>Tipo</span><span>Ejercicio</span><span>Estado</span><span></span></div>
                    {accounts.map(account => (
                      <div className="accounts-row" key={account.id}>
                        <strong>{account.code}</strong>
                        <div><strong>{account.name}</strong><small>{account.is_postable ? "Cuenta operativa" : "Agrupacion"}</small></div>
                        <span>{accountTypeLabels[account.account_type] || account.account_type}</span>
                        <span>{account.year_label}</span>
                        <StatusBadge tone={account.is_active ? "ok" : "neutral"} text={account.is_active ? "Activa" : "Inactiva"} />
                        {canWriteAccounts && <button onClick={() => setAccountStatusAction({ account, reason: "" })}>{account.is_active ? "Desactivar" : "Activar"}</button>}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Plan contable vacio" detail="Crea una cuenta manualmente o importa una plantilla interna desde la seccion Plantillas." />}
                {accountStatusAction && (
                  <form className="period-action-form" onSubmit={handleAccountStatus}>
                    <div><strong>{accountStatusAction.account.is_active ? "Desactivar" : "Activar"} cuenta</strong><span>{accountStatusAction.account.code} - {accountStatusAction.account.name}</span></div>
                    <label><span>Motivo</span><input minLength={5} required value={accountStatusAction.reason} onChange={e => setAccountStatusAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setAccountStatusAction(null)}>Cancelar</button></div>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "parties" && (
          <section className="parties-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Clientes y proveedores</span>
                <h2>Terceros contables</h2>
                <p>Maestro de terceros por empresa para preparar futuras facturas, vencimientos y conciliacion. No emite facturas ni genera asientos.</p>
              </div>
              {partiesLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "parties" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadParties ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso parties.read." />
            ) : (
              <>
                <form className="party-filters" onSubmit={handlePartyFilter}>
                  <label><span>Tipo</span><select value={partyFilters.party_type} onChange={e => setPartyFilters(prev => ({ ...prev, party_type: e.target.value }))}><option value="">Todos</option>{Object.entries(partyTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Buscar</span><input value={partyFilters.q} onChange={e => setPartyFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Nombre, NIF o email" /></label>
                  <label><span>Estado</span><select value={partyFilters.active} onChange={e => setPartyFilters(prev => ({ ...prev, active: e.target.value }))}><option value="">Todos</option><option value="true">Activos</option><option value="false">Inactivos</option></select></label>
                  <button type="submit">Aplicar</button>
                  <button type="button" className="secondary" onClick={handleExportPartiesCsv} disabled={partiesExporting || !parties.length}>CSV</button>
                </form>
                {canWriteParties && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("party-create")}>
                      {isPanelOpen("party-create") ? "Ocultar nuevo tercero" : "Nuevo tercero"}
                    </button>
                  </div>
                )}
                {canWriteParties && isPanelOpen("party-create") && (
                  <form className={targetClass("party-create", "party-create")} data-workspace-target="party-create" onSubmit={handleCreateParty}>
                    <div className="form-title"><strong>Nuevo tercero</strong><span>Alta transaccional y auditada. Sin facturas ni efectos fiscales.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("party-create")}>Ocultar</button></div>
                    <label><span>Tipo</span><select value={partyForm.party_type} onChange={e => setPartyForm(prev => ({ ...prev, party_type: e.target.value }))}>{Object.entries(partyTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label><span>Nombre fiscal</span><input required maxLength={220} value={partyForm.legal_name} onChange={e => setPartyForm(prev => ({ ...prev, legal_name: e.target.value }))} placeholder="Cliente o proveedor" /></label>
                    <label><span>NIF/CIF</span><input maxLength={40} value={partyForm.tax_id} onChange={e => setPartyForm(prev => ({ ...prev, tax_id: e.target.value }))} placeholder="Opcional" /></label>
                    <label><span>Email</span><input type="email" maxLength={180} value={partyForm.email} onChange={e => setPartyForm(prev => ({ ...prev, email: e.target.value }))} placeholder="Opcional" /></label>
                    <label><span>Telefono</span><input maxLength={60} value={partyForm.phone} onChange={e => setPartyForm(prev => ({ ...prev, phone: e.target.value }))} placeholder="Opcional" /></label>
                    <label><span>Cuenta por defecto</span><select value={partyForm.default_account_id} onChange={e => setPartyForm(prev => ({ ...prev, default_account_id: e.target.value }))}><option value="">Sin cuenta</option>{accounts.filter(account => account.is_postable && account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                    <button type="submit">Crear tercero</button>
                  </form>
                )}
                {partyStatus && <div className="form-status"><StatusBadge tone={partyStatus.tone} text={partyStatus.text} /></div>}
                {parties.length ? (
                  <div className="parties-table">
                    <div className="party-row head"><span>Tercero</span><span>Tipo</span><span>NIF/CIF</span><span>Contacto</span><span>Cuenta</span><span>Estado</span><span></span></div>
                    {parties.map(party => (
                      <div className="party-row" key={party.id}>
                        <div><strong>{party.legal_name}</strong><small>{party.source_system}{party.source_party_id ? ` / ${party.source_party_id}` : ""}</small></div>
                        <span>{partyTypeLabels[party.party_type] || party.party_type}</span>
                        <span>{party.tax_id || "-"}</span>
                        <div><span>{party.email || "-"}</span><small>{party.phone || ""}</small></div>
                        <span>{party.default_account_code ? `${party.default_account_code} - ${party.default_account_name}` : "-"}</span>
                        <StatusBadge tone={party.is_active ? "ok" : "neutral"} text={party.is_active ? "Activo" : "Inactivo"} />
                        {canWriteParties && (
                          <div className="party-actions">
                            <button onClick={() => startPartyEdit(party)}>Editar</button>
                            <button onClick={() => { setPartyEditAction(null); setPartyStatusAction({ party, reason: "" }); }}>{party.is_active ? "Desactivar" : "Activar"}</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Sin terceros" detail="Crea clientes, proveedores u otros terceros contables antes de preparar ciclos de cobro y pago." />}
                {partyEditAction && (
                  <form className="party-create party-edit" onSubmit={handleUpdateParty}>
                    <div className="form-title"><strong>Editar tercero</strong><span>{partyEditAction.party.source_system}{partyEditAction.party.source_party_id ? ` / ${partyEditAction.party.source_party_id}` : ""}</span></div>
                    <label><span>Tipo</span><select value={partyEditAction.party_type} onChange={e => setPartyEditAction(prev => ({ ...prev, party_type: e.target.value }))}>{Object.entries(partyTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label><span>Nombre fiscal</span><input required maxLength={220} value={partyEditAction.legal_name} onChange={e => setPartyEditAction(prev => ({ ...prev, legal_name: e.target.value }))} /></label>
                    <label><span>NIF/CIF</span><input maxLength={40} value={partyEditAction.tax_id} onChange={e => setPartyEditAction(prev => ({ ...prev, tax_id: e.target.value }))} /></label>
                    <label><span>Email</span><input type="email" maxLength={180} value={partyEditAction.email} onChange={e => setPartyEditAction(prev => ({ ...prev, email: e.target.value }))} /></label>
                    <label><span>Telefono</span><input maxLength={60} value={partyEditAction.phone} onChange={e => setPartyEditAction(prev => ({ ...prev, phone: e.target.value }))} /></label>
                    <label><span>Cuenta por defecto</span><select value={partyEditAction.default_account_id} onChange={e => setPartyEditAction(prev => ({ ...prev, default_account_id: e.target.value }))}><option value="">Sin cuenta</option>{accounts.filter(account => account.is_postable && account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                    <div className="form-buttons"><button type="submit">Guardar cambios</button><button type="button" className="secondary" onClick={() => setPartyEditAction(null)}>Cancelar</button></div>
                  </form>
                )}
                {partyStatusAction && (
                  <form className="period-action-form" onSubmit={handlePartyStatus}>
                    <div><strong>{partyStatusAction.party.is_active ? "Desactivar" : "Activar"} tercero</strong><span>{partyStatusAction.party.legal_name}</span></div>
                    <label><span>Motivo</span><input minLength={5} required value={partyStatusAction.reason} onChange={e => setPartyStatusAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setPartyStatusAction(null)}>Cancelar</button></div>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "maturities" && (
          <section className="maturities-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Cartera</span>
                <h2>Vencimientos</h2>
                <p>Control manual de cobros y pagos previstos. No liquida bancos, no genera remesas y no crea asientos contables.</p>
              </div>
              {maturitiesLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "maturities" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadMaturities ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso maturities.read." />
            ) : (
              <>
                <div className="maturity-summary-strip">
                  <div><span>Cobros pendientes</span><strong>{formatMoney(pendingReceivables)} EUR</strong></div>
                  <div><span>Pagos pendientes</span><strong>{formatMoney(pendingPayables)} EUR</strong></div>
                  <div><span>Vencimientos visibles</span><strong>{maturities.length}</strong></div>
                </div>
                <form className="maturity-filters" onSubmit={handleMaturityFilter}>
                  <label><span>Tipo</span><select value={maturityFilters.direction} onChange={e => setMaturityFilters(prev => ({ ...prev, direction: e.target.value }))}><option value="">Todos</option>{Object.entries(maturityDirectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Estado</span><select value={maturityFilters.status} onChange={e => setMaturityFilters(prev => ({ ...prev, status: e.target.value }))}><option value="">Todos</option>{Object.entries(maturityStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Tercero</span><select value={maturityFilters.party_id} onChange={e => setMaturityFilters(prev => ({ ...prev, party_id: e.target.value }))}><option value="">Todos</option>{parties.map(party => <option key={party.id} value={party.id}>{party.legal_name}</option>)}</select></label>
                  <label><span>Desde</span><input type="date" value={maturityFilters.due_from} onChange={e => setMaturityFilters(prev => ({ ...prev, due_from: e.target.value }))} /></label>
                  <label><span>Hasta</span><input type="date" value={maturityFilters.due_to} onChange={e => setMaturityFilters(prev => ({ ...prev, due_to: e.target.value }))} /></label>
                  <label><span>Buscar</span><input value={maturityFilters.q} onChange={e => setMaturityFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Documento, tercero o concepto" /></label>
                  <button type="submit">Aplicar</button>
                  <button type="button" className="secondary" onClick={clearMaturityFilters}>Limpiar</button>
                  <button type="button" className="secondary" onClick={handleExportMaturitiesCsv} disabled={maturitiesExporting || !maturities.length}>CSV</button>
                </form>
                {canWriteMaturities && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("maturity-create")}>
                      {isPanelOpen("maturity-create") ? "Ocultar nuevo vencimiento" : "Nuevo vencimiento"}
                    </button>
                  </div>
                )}
                {canWriteMaturities && isPanelOpen("maturity-create") && (
                  <form className={targetClass("maturity-create", "maturity-create")} data-workspace-target="maturity-create" onSubmit={handleCreateMaturity}>
                    <div className="form-title"><strong>Nuevo vencimiento</strong><span>Registro manual de cartera. Sin asiento ni factura fiscal.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("maturity-create")}>Ocultar</button></div>
                    <label><span>Tercero</span><select required value={maturityForm.party_id} onChange={e => setMaturityForm(prev => ({ ...prev, party_id: e.target.value }))}><option value="">Selecciona tercero</option>{parties.filter(party => party.is_active).map(party => <option key={party.id} value={party.id}>{party.legal_name}</option>)}</select></label>
                    <label><span>Tipo</span><select value={maturityForm.direction} onChange={e => setMaturityForm(prev => ({ ...prev, direction: e.target.value }))}>{Object.entries(maturityDirectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                    <label><span>Emision</span><input type="date" value={maturityForm.issue_date} onChange={e => setMaturityForm(prev => ({ ...prev, issue_date: e.target.value }))} /></label>
                    <label><span>Vencimiento</span><input type="date" required value={maturityForm.due_date} onChange={e => setMaturityForm(prev => ({ ...prev, due_date: e.target.value }))} /></label>
                    <label><span>Documento</span><input maxLength={120} value={maturityForm.document_ref} onChange={e => setMaturityForm(prev => ({ ...prev, document_ref: e.target.value }))} placeholder="Referencia" /></label>
                    <label><span>Concepto</span><input required maxLength={300} value={maturityForm.description} onChange={e => setMaturityForm(prev => ({ ...prev, description: e.target.value }))} /></label>
                    <label><span>Importe</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={maturityForm.amount} onChange={e => setMaturityForm(prev => ({ ...prev, amount: e.target.value }))} /></label>
                    <label><span>Forma</span><input maxLength={80} value={maturityForm.payment_method} onChange={e => setMaturityForm(prev => ({ ...prev, payment_method: e.target.value }))} placeholder="Transferencia, recibo..." /></label>
                    <button type="submit">Crear vencimiento</button>
                  </form>
                )}
                {maturityStatus && <div className="form-status"><StatusBadge tone={maturityStatus.tone} text={maturityStatus.text} /></div>}
                {focusedMaturity && (
                  <div className="focus-panel">
                    <div>
                      <span className="eyebrow">Vencimiento seleccionado</span>
                      <strong>{focusedMaturity.party_name || focusedMaturity.description}</strong>
                      <small>{focusedMaturity.document_ref || focusedMaturity.description} | {String(focusedMaturity.due_date).slice(0, 10)} | {formatMoney(focusedMaturity.open_amount)} EUR pendientes</small>
                    </div>
                    <div className="focus-panel-actions">
                      {canWriteMaturities && focusedMaturity.status === "pending" && <button type="button" onClick={() => setMaturityStatusAction({ maturity: focusedMaturity, action: "settle", reason: "", settled_date: new Date().toISOString().slice(0, 10) })}>Liquidar</button>}
                      {canWriteMaturities && focusedMaturity.status === "pending" && <button type="button" className="secondary" onClick={() => setMaturityStatusAction({ maturity: focusedMaturity, action: "cancel", reason: "", settled_date: "" })}>Cancelar</button>}
                      <button type="button" className="secondary" onClick={() => setFocusedMaturityId(null)}>Quitar foco</button>
                    </div>
                  </div>
                )}
                {maturities.length ? (
                  <div className="maturities-table">
                    <div className="maturity-row head"><span>Vencimiento</span><span>Tercero</span><span>Tipo</span><span>Importe</span><span>Pendiente</span><span>Estado</span><span></span></div>
                    {maturities.map(item => (
                      <div className={`maturity-row${focusedMaturityId === item.id ? " row-focused" : ""}`} key={item.id}>
                        <div><strong>{String(item.due_date).slice(0, 10)}</strong><small>{item.document_ref || item.description}</small></div>
                        <span>{item.party_name}</span>
                        <span>{maturityDirectionLabels[item.direction] || item.direction}</span>
                        <span>{formatMoney(item.amount)} EUR</span>
                        <span>{formatMoney(item.open_amount)} EUR</span>
                        <StatusBadge tone={maturityStatusTone(item.status)} text={maturityStatusLabels[item.status] || item.status} />
                        {canWriteMaturities && (
                          <div className="maturity-actions">
                            {item.status === "pending" && <button onClick={() => setMaturityStatusAction({ maturity: item, action: "settle", reason: "", settled_date: new Date().toISOString().slice(0, 10) })}>Liquidar</button>}
                            {item.status === "pending" && <button onClick={() => setMaturityStatusAction({ maturity: item, action: "cancel", reason: "", settled_date: "" })}>Cancelar</button>}
                            {item.status !== "pending" && <button onClick={() => setMaturityStatusAction({ maturity: item, action: "reopen", reason: "", settled_date: "" })}>Reabrir</button>}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Sin vencimientos" detail="Registra cobros y pagos previstos para empezar a controlar la cartera." />}
                {maturityStatusAction && (
                  <form className="period-action-form" onSubmit={handleMaturityStatus}>
                    <div><strong>{maturityStatusAction.action === "settle" ? "Liquidar" : maturityStatusAction.action === "cancel" ? "Cancelar" : "Reabrir"} vencimiento</strong><span>{maturityStatusAction.maturity.party_name} · {formatMoney(maturityStatusAction.maturity.open_amount)} EUR</span></div>
                    {maturityStatusAction.action === "settle" && <label><span>Fecha</span><input type="date" value={maturityStatusAction.settled_date} onChange={e => setMaturityStatusAction(prev => ({ ...prev, settled_date: e.target.value }))} /></label>}
                    <label><span>Motivo</span><input minLength={5} required value={maturityStatusAction.reason} onChange={e => setMaturityStatusAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setMaturityStatusAction(null)}>Cancelar</button></div>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "fixed-assets" && (
          <section className="maturities-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Activos</span>
                <h2>Inmovilizado</h2>
                <p>Registro preliminar de activos y plan de amortizacion lineal. No genera asientos ni acredita tratamiento fiscal o legal.</p>
              </div>
              {fixedAssetsLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "fixed-assets" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadFixedAssets ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso fixed_assets.read." />
            ) : (
              <>
                <div className="maturity-summary-strip">
                  <div><span>Activos visibles</span><strong>{fixedAssets.length}</strong></div>
                  <div><span>Activos en uso</span><strong>{activeFixedAssets}</strong></div>
                  <div><span>Coste adquisicion</span><strong>{formatMoney(fixedAssetCost)} EUR</strong></div>
                </div>
                <form className="maturity-filters" onSubmit={handleFixedAssetFilter}>
                  <label><span>Ejercicio</span><select value={fixedAssetFilters.fiscal_year_id} onChange={e => setFixedAssetFilters(prev => ({ ...prev, fiscal_year_id: e.target.value }))}><option value="">Todos</option>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                  <label><span>Estado</span><select value={fixedAssetFilters.status} onChange={e => setFixedAssetFilters(prev => ({ ...prev, status: e.target.value }))}><option value="">Todos</option>{Object.entries(fixedAssetStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Buscar</span><input value={fixedAssetFilters.q} onChange={e => setFixedAssetFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Codigo, nombre o notas" /></label>
                  <button type="submit">Aplicar</button>
                  <button type="button" className="secondary" onClick={clearFixedAssetFilters}>Limpiar</button>
                  <button type="button" className="secondary" onClick={handleExportFixedAssetsCsv} disabled={fixedAssetsExporting || !fixedAssets.length}>CSV</button>
                </form>
                {canWriteFixedAssets && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("fixed-asset-create")}>
                      {isPanelOpen("fixed-asset-create") ? "Ocultar nuevo inmovilizado" : "Nuevo inmovilizado"}
                    </button>
                  </div>
                )}
                {canWriteFixedAssets && isPanelOpen("fixed-asset-create") && (
                  <form className={targetClass("fixed-asset-create", "maturity-create")} data-workspace-target="fixed-asset-create" onSubmit={handleCreateFixedAsset}>
                    <div className="form-title"><strong>Nuevo inmovilizado</strong><span>Alta manual auditada. La amortizacion se calcula como plan preliminar y no crea asientos.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("fixed-asset-create")}>Ocultar</button></div>
                    <label><span>Ejercicio</span><select required value={fixedAssetForm.fiscal_year_id} onChange={e => setFixedAssetForm(prev => ({ ...prev, fiscal_year_id: e.target.value }))}><option value="">Selecciona ejercicio</option>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                    <label><span>Codigo</span><input required maxLength={60} value={fixedAssetForm.asset_code} onChange={e => setFixedAssetForm(prev => ({ ...prev, asset_code: e.target.value }))} placeholder="VEH-001" /></label>
                    <label><span>Nombre</span><input required maxLength={220} value={fixedAssetForm.name} onChange={e => setFixedAssetForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Cabeza tractora" /></label>
                    <label><span>Adquisicion</span><input type="date" required value={fixedAssetForm.acquisition_date} onChange={e => setFixedAssetForm(prev => ({ ...prev, acquisition_date: e.target.value }))} /></label>
                    <label><span>Coste</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={fixedAssetForm.acquisition_cost} onChange={e => setFixedAssetForm(prev => ({ ...prev, acquisition_cost: e.target.value }))} /></label>
                    <label><span>Residual</span><input inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={fixedAssetForm.residual_value} onChange={e => setFixedAssetForm(prev => ({ ...prev, residual_value: e.target.value }))} /></label>
                    <label><span>Vida util meses</span><input required inputMode="numeric" value={fixedAssetForm.useful_life_months} onChange={e => setFixedAssetForm(prev => ({ ...prev, useful_life_months: e.target.value }))} /></label>
                    <label><span>Cuenta activo</span><select value={fixedAssetForm.asset_account_id} onChange={e => setFixedAssetForm(prev => ({ ...prev, asset_account_id: e.target.value }))}><option value="">Sin cuenta</option>{accounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                    <label><span>Amortizacion acumulada</span><select value={fixedAssetForm.accumulated_depreciation_account_id} onChange={e => setFixedAssetForm(prev => ({ ...prev, accumulated_depreciation_account_id: e.target.value }))}><option value="">Sin cuenta</option>{accounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                    <label><span>Gasto amortizacion</span><select value={fixedAssetForm.expense_account_id} onChange={e => setFixedAssetForm(prev => ({ ...prev, expense_account_id: e.target.value }))}><option value="">Sin cuenta</option>{accounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                    <label><span>Notas</span><input maxLength={1000} value={fixedAssetForm.notes} onChange={e => setFixedAssetForm(prev => ({ ...prev, notes: e.target.value }))} /></label>
                    <button type="submit">Crear inmovilizado</button>
                  </form>
                )}
                {fixedAssetStatus && <div className="form-status"><StatusBadge tone={fixedAssetStatus.tone} text={fixedAssetStatus.text} /></div>}
                {fixedAssetPlan && (
                  <div className="focus-panel">
                    <div>
                      <span className="eyebrow">Plan de amortizacion</span>
                      <strong>{fixedAssetPlan.fixed_asset.asset_code} - {fixedAssetPlan.fixed_asset.name}</strong>
                      <small>{fixedAssetPlan.disclaimer}</small>
                    </div>
                    <div className="focus-panel-actions">
                      <button type="button" className="secondary" onClick={() => setFixedAssetPlan(null)}>Cerrar plan</button>
                    </div>
                    {fixedAssetPlan.depreciation_runs?.length > 0 && (
                      <div className="maturities-table wide">
                        <div className="maturity-row head"><span>Periodo</span><span>Fecha</span><span>Importe</span><span>Estado</span><span></span></div>
                        {fixedAssetPlan.depreciation_runs.map(run => (
                          <div className="maturity-row" key={run.id}>
                            <span>{run.period_name}</span>
                            <span>{String(run.run_date).slice(0, 10)}</span>
                            <span>{formatMoney(run.amount)} EUR</span>
                            <StatusBadge tone={run.status === "cancelled" ? "neutral" : journalStatusTone(run.journal_entry_status)} text={run.status === "cancelled" ? "Cancelada" : journalStatusLabel(run.journal_entry_status)} />
                            <div className="maturity-actions">
                              {canWriteFixedAssets && canWriteJournal && run.status !== "cancelled" && run.journal_entry_status === "draft" && (
                                <button type="button" className="secondary" onClick={() => setFixedAssetDepreciationCancelAction({ run, reason: "" })}>Cancelar</button>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="maturities-table wide">
                      <div className="maturity-row head"><span>Periodo</span><span>Fecha</span><span>Cuota</span><span>Acumulado</span><span>Valor neto</span></div>
                      {fixedAssetPlan.plan.rows.slice(0, 24).map(row => (
                        <div className="maturity-row" key={row.period_number}>
                          <span>{row.period_number}</span>
                          <span>{row.depreciation_date}</span>
                          <span>{formatMoney(row.amount)} EUR</span>
                          <span>{formatMoney(row.accumulated)} EUR</span>
                          <span>{formatMoney(row.net_book_value)} EUR</span>
                        </div>
                      ))}
                      {fixedAssetPlan.plan.rows.length > 24 && <div className="scope-note">Mostradas 24 de {fixedAssetPlan.plan.rows.length} cuotas. El CSV de inmovilizado no incluye todavia el plan completo.</div>}
                    </div>
                  </div>
                )}
                {fixedAssets.length ? (
                  <div className="maturities-table">
                    <div className="maturity-row head"><span>Activo</span><span>Ejercicio</span><span>Adquisicion</span><span>Coste</span><span>Vida util</span><span>Estado</span><span></span></div>
                    {fixedAssets.map(asset => (
                      <div className="maturity-row" key={asset.id}>
                        <div><strong>{asset.asset_code}</strong><small>{asset.name}</small></div>
                        <span>{asset.year_label || "-"}</span>
                        <span>{String(asset.acquisition_date).slice(0, 10)}</span>
                        <span>{formatMoney(asset.acquisition_cost)} EUR</span>
                        <span>{asset.useful_life_months} meses</span>
                        <StatusBadge tone={fixedAssetStatusTone(asset.status)} text={fixedAssetStatusLabels[asset.status] || asset.status} />
                        <div className="maturity-actions">
                          <button type="button" onClick={() => handleOpenFixedAssetPlan(asset)}>Plan</button>
                          {canWriteFixedAssets && canWriteJournal && asset.status === "active" && asset.expense_account_id && asset.accumulated_depreciation_account_id && (
                            <button type="button" onClick={() => startFixedAssetDepreciation(asset)}>Amortizar</button>
                          )}
                          {canWriteFixedAssets && asset.status === "active" && <button type="button" onClick={() => setFixedAssetStatusAction({ asset, action: "deactivate", reason: "", disposed_at: "" })}>Desactivar</button>}
                          {canWriteFixedAssets && asset.status === "inactive" && <button type="button" onClick={() => setFixedAssetStatusAction({ asset, action: "activate", reason: "", disposed_at: "" })}>Activar</button>}
                          {canWriteFixedAssets && asset.status !== "disposed" && <button type="button" onClick={() => setFixedAssetStatusAction({ asset, action: "dispose", reason: "", disposed_at: new Date().toISOString().slice(0, 10) })}>Baja</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Sin inmovilizado" detail="Registra activos para preparar su control contable y el plan preliminar de amortizacion." />}
                {fixedAssetStatusAction && (
                  <form className="period-action-form" onSubmit={handleFixedAssetStatus}>
                    <div><strong>{fixedAssetActionLabels[fixedAssetStatusAction.action]}</strong><span>{fixedAssetStatusAction.asset.asset_code} - {fixedAssetStatusAction.asset.name}</span></div>
                    {fixedAssetStatusAction.action === "dispose" && <label><span>Fecha baja</span><input type="date" value={fixedAssetStatusAction.disposed_at} onChange={e => setFixedAssetStatusAction(prev => ({ ...prev, disposed_at: e.target.value }))} /></label>}
                    <label><span>Motivo</span><input minLength={5} required value={fixedAssetStatusAction.reason} onChange={e => setFixedAssetStatusAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setFixedAssetStatusAction(null)}>Cancelar</button></div>
                  </form>
                )}
                {fixedAssetDepreciationAction && (
                  <form className="period-action-form" onSubmit={handleFixedAssetDepreciation}>
                    <div>
                      <strong>Preparar amortizacion</strong>
                      <span>{fixedAssetDepreciationAction.asset.asset_code} - {fixedAssetDepreciationAction.asset.name}</span>
                    </div>
                    <label>
                      <span>Periodo abierto</span>
                      <select required value={fixedAssetDepreciationAction.period_id} onChange={e => setFixedAssetDepreciationAction(prev => ({ ...prev, period_id: e.target.value }))}>
                        <option value="">Selecciona periodo</option>
                        {periods
                          .filter(period => period.fiscal_year_id === fixedAssetDepreciationAction.asset.fiscal_year_id && period.status === "open")
                          .map(period => <option key={period.id} value={period.id}>{period.name}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Concepto</span>
                      <input maxLength={500} value={fixedAssetDepreciationAction.description} onChange={e => setFixedAssetDepreciationAction(prev => ({ ...prev, description: e.target.value }))} />
                    </label>
                    <div className="scope-note">Se creara un borrador en Diario. No se contabiliza automaticamente.</div>
                    <div className="period-action-buttons">
                      <button type="submit">Crear borrador</button>
                      <button type="button" className="secondary" onClick={() => setFixedAssetDepreciationAction(null)}>Cancelar</button>
                    </div>
                  </form>
                )}
                {fixedAssetDepreciationCancelAction && (
                  <form className="period-action-form" onSubmit={handleCancelFixedAssetDepreciation}>
                    <div>
                      <strong>Cancelar amortizacion</strong>
                      <span>{fixedAssetDepreciationCancelAction.run.period_name} - {formatMoney(fixedAssetDepreciationCancelAction.run.amount)} EUR</span>
                    </div>
                    <label>
                      <span>Motivo</span>
                      <input minLength={5} required value={fixedAssetDepreciationCancelAction.reason} onChange={e => setFixedAssetDepreciationCancelAction(prev => ({ ...prev, reason: e.target.value }))} />
                    </label>
                    <div className="scope-note">Se cancelara el borrador de Diario asociado y se conservara la trazabilidad.</div>
                    <div className="period-action-buttons">
                      <button type="submit">Cancelar borrador</button>
                      <button type="button" className="secondary" onClick={() => setFixedAssetDepreciationCancelAction(null)}>Cerrar</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "banks" && (
          <section className="banks-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Tesoreria</span>
                <h2>Bancos</h2>
                <p>Cuentas bancarias y movimientos manuales para preparar conciliacion. No importa Cuaderno 43, no concilia automaticamente y no crea asientos.</p>
              </div>
              {banksLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "banks" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadBanks ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso banks.read." />
            ) : (
              <>
                <div className="bank-summary-strip">
                  <div><span>Cuentas bancarias</span><strong>{bankAccounts.length}</strong></div>
                  <div><span>Saldo inicial</span><strong>{formatMoney(bankOpeningBalance)} EUR</strong></div>
                  <div><span>Entradas visibles</span><strong>{formatMoney(bankInflows)} EUR</strong></div>
                  <div><span>Salidas visibles</span><strong>{formatMoney(bankOutflows)} EUR</strong></div>
                </div>
                <form className="bank-filters" onSubmit={handleBankFilter}>
                  <label><span>Cuenta bancaria</span><select value={bankTransactionFilters.bank_account_id} onChange={e => setBankTransactionFilters(prev => ({ ...prev, bank_account_id: e.target.value }))}><option value="">Todas</option>{bankAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                  <label><span>Tipo</span><select value={bankTransactionFilters.direction} onChange={e => setBankTransactionFilters(prev => ({ ...prev, direction: e.target.value }))}><option value="">Todos</option>{Object.entries(bankTransactionDirectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Estado</span><select value={bankTransactionFilters.status} onChange={e => setBankTransactionFilters(prev => ({ ...prev, status: e.target.value }))}><option value="">Todos</option>{Object.entries(bankTransactionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  <label><span>Desde</span><input type="date" value={bankTransactionFilters.date_from} onChange={e => setBankTransactionFilters(prev => ({ ...prev, date_from: e.target.value }))} /></label>
                  <label><span>Hasta</span><input type="date" value={bankTransactionFilters.date_to} onChange={e => setBankTransactionFilters(prev => ({ ...prev, date_to: e.target.value }))} /></label>
                  <label><span>Buscar</span><input value={bankTransactionFilters.q} onChange={e => setBankTransactionFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Concepto, referencia o contraparte" /></label>
                  <button type="submit">Aplicar</button>
                  <button type="button" className="secondary" onClick={clearBankFilters}>Limpiar</button>
                  <button type="button" className="secondary" onClick={handleExportBankTransactionsCsv} disabled={bankTransactionsExporting || !bankTransactions.length}>CSV</button>
                </form>
                {canWriteBanks && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("bank-account-create")}>
                      {isPanelOpen("bank-account-create") ? "Ocultar cuenta bancaria" : "Nueva cuenta bancaria"}
                    </button>
                    <button type="button" onClick={() => toggleWorkspacePanel("bank-transaction-create")}>
                      {isPanelOpen("bank-transaction-create") ? "Ocultar movimiento" : "Nuevo movimiento"}
                    </button>
                    <button type="button" onClick={() => toggleWorkspacePanel("bank-import-create")}>
                      {isPanelOpen("bank-import-create") ? "Ocultar importacion CSV" : "Importar CSV"}
                    </button>
                  </div>
                )}
                {canWriteBanks && (isPanelOpen("bank-account-create") || isPanelOpen("bank-transaction-create") || isPanelOpen("bank-import-create")) && (
                  <div className="bank-forms">
                    {isPanelOpen("bank-account-create") && (
                    <form className="bank-account-create" onSubmit={handleCreateBankAccount}>
                      <div className="form-title"><strong>Nueva cuenta bancaria</strong><span>Alta manual y auditada. Puede asociarse a una cuenta contable.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("bank-account-create")}>Ocultar</button></div>
                      <label><span>Nombre</span><input required maxLength={180} value={bankAccountForm.name} onChange={e => setBankAccountForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Banco principal" /></label>
                      <label><span>Banco</span><input maxLength={180} value={bankAccountForm.bank_name} onChange={e => setBankAccountForm(prev => ({ ...prev, bank_name: e.target.value }))} placeholder="Entidad" /></label>
                      <label><span>IBAN</span><input maxLength={34} value={bankAccountForm.iban} onChange={e => setBankAccountForm(prev => ({ ...prev, iban: e.target.value }))} placeholder="Opcional" /></label>
                      <label><span>Cuenta contable</span><select value={bankAccountForm.account_id} onChange={e => setBankAccountForm(prev => ({ ...prev, account_id: e.target.value }))}><option value="">Sin cuenta asociada</option>{accounts.filter(account => account.is_postable && account.is_active).map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                      <label><span>Saldo inicial</span><input required inputMode="decimal" value={bankAccountForm.opening_balance} onChange={e => setBankAccountForm(prev => ({ ...prev, opening_balance: e.target.value }))} /></label>
                      <button type="submit">Crear cuenta</button>
                    </form>
                    )}
                    {isPanelOpen("bank-transaction-create") && (
                    <form className={targetClass("bank-transaction-create", "bank-transaction-create")} data-workspace-target="bank-transaction-create" onSubmit={handleCreateBankTransaction}>
                      <div className="form-title"><strong>Nuevo movimiento</strong><span>Movimiento bancario manual. No genera asiento ni conciliacion automatica.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("bank-transaction-create")}>Ocultar</button></div>
                      <label><span>Cuenta</span><select required value={bankTransactionForm.bank_account_id} onChange={e => setBankTransactionForm(prev => ({ ...prev, bank_account_id: e.target.value }))}><option value="">Selecciona cuenta</option>{bankAccounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                      <label><span>Tipo</span><select value={bankTransactionForm.direction} onChange={e => setBankTransactionForm(prev => ({ ...prev, direction: e.target.value }))}>{Object.entries(bankTransactionDirectionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label><span>Fecha</span><input type="date" required value={bankTransactionForm.transaction_date} onChange={e => setBankTransactionForm(prev => ({ ...prev, transaction_date: e.target.value }))} /></label>
                      <label><span>Fecha valor</span><input type="date" value={bankTransactionForm.value_date} onChange={e => setBankTransactionForm(prev => ({ ...prev, value_date: e.target.value }))} /></label>
                      <label><span>Concepto</span><input required maxLength={300} value={bankTransactionForm.description} onChange={e => setBankTransactionForm(prev => ({ ...prev, description: e.target.value }))} /></label>
                      <label><span>Referencia</span><input maxLength={140} value={bankTransactionForm.reference} onChange={e => setBankTransactionForm(prev => ({ ...prev, reference: e.target.value }))} /></label>
                      <label><span>Contraparte</span><input maxLength={220} value={bankTransactionForm.counterparty_name} onChange={e => setBankTransactionForm(prev => ({ ...prev, counterparty_name: e.target.value }))} /></label>
                      <label><span>Importe</span><input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={bankTransactionForm.amount} onChange={e => setBankTransactionForm(prev => ({ ...prev, amount: e.target.value }))} /></label>
                      <button type="submit">Crear movimiento</button>
                    </form>
                    )}
                    {isPanelOpen("bank-import-create") && (
                    <form className="bank-import-create" onSubmit={handleImportBankStatement}>
                      <div className="form-title"><strong>Importar extracto CSV</strong><span>Pega movimientos con cabeceras. No genera asientos ni conciliacion automatica.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("bank-import-create")}>Ocultar</button></div>
                      <label><span>Cuenta</span><select required value={bankImportForm.bank_account_id} onChange={e => setBankImportForm(prev => ({ ...prev, bank_account_id: e.target.value }))}><option value="">Selecciona cuenta</option>{bankAccounts.filter(account => account.is_active).map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select></label>
                      <label><span>Nombre archivo</span><input maxLength={240} value={bankImportForm.filename} onChange={e => setBankImportForm(prev => ({ ...prev, filename: e.target.value }))} /></label>
                      <label className="bank-import-text"><span>CSV</span><textarea required rows={6} value={bankImportForm.csv_text} onChange={e => setBankImportForm(prev => ({ ...prev, csv_text: e.target.value }))} placeholder={"fecha;fecha_valor;descripcion;referencia;contraparte;importe;tipo\n2026-06-12;2026-06-12;Cobro cliente;TRF-1;Cliente;123,45;entrada\n2026-06-13;;Pago gasoil;CARD-9;Estacion;-45,67;"} /></label>
                      <button type="submit">Importar CSV</button>
                    </form>
                    )}
                  </div>
                )}
                <form className="bank-account-filters" onSubmit={handleBankAccountFilter}>
                  <label>
                    <span>Buscar cuenta</span>
                    <input
                      value={bankAccountFilters.q}
                      onChange={e => setBankAccountFilters(prev => ({ ...prev, q: e.target.value }))}
                      placeholder="Banco, cuenta o IBAN"
                    />
                  </label>
                  <label>
                    <span>Estado cuenta</span>
                    <select value={bankAccountFilters.active} onChange={e => setBankAccountFilters(prev => ({ ...prev, active: e.target.value }))}>
                      <option value="">Todas</option>
                      <option value="true">Activas</option>
                      <option value="false">Inactivas</option>
                    </select>
                  </label>
                  <button type="submit">Filtrar cuentas</button>
                  <button type="button" className="secondary" onClick={clearBankAccountFilters}>Limpiar cuentas</button>
                </form>
                {bankAccounts.length ? (
                  <div className="bank-accounts-table">
                    <div className="bank-accounts-heading">
                      <div>
                        <strong>Cuentas bancarias</strong>
                        <span>Origen manual por empresa. No genera asientos ni conciliaciones automaticas.</span>
                      </div>
                      <StatusBadge tone={unmatchedBankTransactions ? "warning" : "ok"} text={`${unmatchedBankTransactions} pendiente(s)`} />
                    </div>
                    <div className="bank-account-row head"><span>Cuenta</span><span>Banco</span><span>IBAN</span><span>Contable</span><span>Saldo inicial</span><span>Estado</span><span></span></div>
                    {bankAccounts.map(account => (
                      <div className="bank-account-row" key={account.id}>
                        <div><strong>{account.name}</strong><small>{account.currency || "EUR"}</small></div>
                        <span>{account.bank_name || "-"}</span>
                        <span>{formatIbanPreview(account.iban)}</span>
                        <span>{account.account_code ? `${account.account_code} - ${account.account_name}` : "Sin cuenta asociada"}</span>
                        <strong>{formatMoney(account.opening_balance)} EUR</strong>
                        <StatusBadge tone={account.is_active ? "ok" : "neutral"} text={account.is_active ? "Activa" : "Inactiva"} />
                        <div className="bank-row-actions">
                          <button type="button" aria-label={`Ver movimientos de ${account.name}`} onClick={() => filterBankAccountTransactions(account)}>Ver movimientos</button>
                          {canWriteBanks && account.is_active && <button type="button" className="secondary" aria-label={`Nuevo movimiento en ${account.name}`} onClick={() => startBankTransactionForAccount(account)}>Nuevo movimiento</button>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin cuentas bancarias" detail="Crea una cuenta bancaria para registrar movimientos manuales y preparar conciliacion." />
                )}
                {selectedBankAccount && (
                  <div className="focus-panel">
                    <div>
                      <span className="eyebrow">Cuenta filtrada</span>
                      <strong>{selectedBankAccount.name}</strong>
                      <small>{selectedBankAccount.bank_name || "Banco sin informar"} | {formatIbanPreview(selectedBankAccount.iban)} | Saldo inicial {formatMoney(selectedBankAccount.opening_balance)} EUR</small>
                    </div>
                    <div className="focus-panel-actions">
                      {canWriteBanks && selectedBankAccount.is_active && <button type="button" onClick={() => startBankTransactionForAccount(selectedBankAccount)}>Nuevo movimiento</button>}
                      <button type="button" className="secondary" onClick={clearSelectedBankAccount}>Quitar filtro</button>
                    </div>
                  </div>
                )}
                {bankStatementImports.length > 0 && (
                  <div className="bank-import-history">
                    <div className="bank-import-history-heading">
                      <div><strong>Ultimas importaciones CSV</strong><span>Lotes recientes de extractos manuales.</span></div>
                      <StatusBadge tone="neutral" text={`${bankStatementImports.length} lote(s)`} />
                    </div>
                    <div className="bank-import-history-table">
                      <div className="bank-import-history-row head"><span>Fecha</span><span>Cuenta</span><span>Archivo</span><span>Filas</span><span>Nuevos</span><span>Duplicados</span><span>Errores</span></div>
                      {bankStatementImports.map(item => (
                        <div className="bank-import-history-row" key={item.id}>
                          <span>{formatDateTime(item.created_at)}</span>
                          <strong>{item.bank_account_name}</strong>
                          <span>{item.original_filename || item.source_type}</span>
                          <span>{item.row_count}</span>
                          <span>{item.inserted_count}</span>
                          <span>{item.skipped_count}</span>
                          <StatusBadge tone={Number(item.error_count || 0) > 0 ? "warning" : "ok"} text={String(item.error_count)} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {banksStatus && <div className="form-status"><StatusBadge tone={banksStatus.tone} text={banksStatus.text} /></div>}
                {focusedBankTransaction && (
                  <div className="focus-panel">
                    <div>
                      <span className="eyebrow">Movimiento seleccionado</span>
                      <strong>{focusedBankTransaction.description}</strong>
                      <small>{focusedBankTransaction.bank_account_name} | {String(focusedBankTransaction.transaction_date).slice(0, 10)} | {focusedBankTransaction.direction === "outflow" ? "-" : "+"}{formatMoney(focusedBankTransaction.amount)} EUR</small>
                    </div>
                    <div className="focus-panel-actions">
                      {canWriteBanks && focusedBankTransaction.status === "unmatched" && <button type="button" onClick={() => startBankReconciliation(focusedBankTransaction)}>Conciliar</button>}
                      {canWriteBanks && focusedBankTransaction.status === "unmatched" && <button type="button" className="secondary" onClick={() => startBankTransactionStatusAction(focusedBankTransaction, "ignore")}>Ignorar</button>}
                      <button type="button" className="secondary" onClick={() => setFocusedBankTransactionId(null)}>Quitar foco</button>
                    </div>
                  </div>
                )}
                {bankTransactions.length ? (
                  <div className="bank-transactions-table">
                    <div className="bank-transaction-row head"><span>Fecha</span><span>Cuenta</span><span>Tipo</span><span>Importe</span><span>Concepto</span><span>Estado</span><span></span></div>
                    {bankTransactions.map(item => (
                      <div className={`bank-transaction-row${focusedBankTransactionId === item.id ? " row-focused" : ""}`} key={item.id}>
                        <div><strong>{String(item.transaction_date).slice(0, 10)}</strong><small>{item.reference || item.value_date ? `Valor ${String(item.value_date || item.transaction_date).slice(0, 10)}` : ""}</small></div>
                        <span>{item.bank_account_name}</span>
                        <span>{bankTransactionDirectionLabels[item.direction] || item.direction}</span>
                        <strong>{formatMoney(item.amount)} EUR</strong>
                        <div><span>{item.description}</span><small>{item.counterparty_name || ""}</small></div>
                        <StatusBadge tone={item.status === "unmatched" ? "warning" : "neutral"} text={bankTransactionStatusLabels[item.status] || item.status} />
                        {canWriteBanks && item.status === "unmatched" ? (
                          <div className="bank-row-actions">
                            <button type="button" className="secondary" onClick={() => setFocusedBankTransactionId(item.id)}>Ver</button>
                            <button onClick={() => startBankReconciliation(item)}>Conciliar</button>
                            <button className="secondary" onClick={() => startBankTransactionStatusAction(item, "ignore")}>Ignorar</button>
                          </div>
                        ) : canWriteBanks && item.status === "matched" && item.reconciliation_id ? (
                          <div className="bank-row-actions"><button type="button" className="secondary" onClick={() => setFocusedBankTransactionId(item.id)}>Ver</button><button onClick={() => startBankReconciliationReverse(item)}>Revertir</button></div>
                        ) : canWriteBanks && item.status === "ignored" ? (
                          <div className="bank-row-actions"><button type="button" className="secondary" onClick={() => setFocusedBankTransactionId(item.id)}>Ver</button><button className="secondary" onClick={() => startBankTransactionStatusAction(item, "reopen")}>Reabrir</button></div>
                        ) : (
                          <div className="bank-row-actions"><button type="button" className="secondary" onClick={() => setFocusedBankTransactionId(item.id)}>Ver</button></div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : <EmptyState title="Sin movimientos bancarios" detail="Crea una cuenta bancaria y registra movimientos manuales para preparar tesoreria." />}
                {bankTransactionStatusAction && (
                  <form className="bank-reconcile-form" onSubmit={handleBankTransactionStatus}>
                    <div><strong>{bankTransactionStatusAction.action === "ignore" ? "Ignorar movimiento" : "Reabrir movimiento"}</strong><span>{bankTransactionStatusAction.transaction.description} - {formatMoney(bankTransactionStatusAction.transaction.amount)} EUR</span></div>
                    <label><span>Motivo</span><input minLength={5} required value={bankTransactionStatusAction.reason} onChange={e => setBankTransactionStatusAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setBankTransactionStatusAction(null)}>Cancelar</button></div>
                  </form>
                )}
                {bankReconciliationAction && (
                  <form className="bank-reconcile-form" onSubmit={handleBankReconciliation}>
                    <div><strong>Conciliar movimiento</strong><span>{bankReconciliationAction.transaction.description} - {formatMoney(bankReconciliationAction.transaction.amount)} EUR</span></div>
                    <div className="bank-suggestion-panel">
                      <div className="bank-suggestion-heading">
                        <strong>Sugerencias</strong>
                        {bankReconciliationAction.suggestions_loading ? <StatusBadge tone="neutral" text="Buscando" /> : <span>{bankReconciliationAction.suggestions?.length || 0} candidato(s)</span>}
                      </div>
                      {!bankReconciliationAction.suggestions_loading && bankReconciliationAction.suggestions?.length ? (
                        <div className="bank-suggestion-list">
                          {bankReconciliationAction.suggestions.map(item => (
                            <button
                              type="button"
                              className={bankReconciliationAction.maturity_id === item.maturity.id ? "selected" : ""}
                              key={item.maturity.id}
                              onClick={() => setBankReconciliationAction(prev => ({ ...prev, maturity_id: item.maturity.id, reason: "Conciliacion asistida bancaria" }))}
                            >
                              <span><strong>{item.score}%</strong>{item.maturity.party_name}</span>
                              <span>{String(item.maturity.due_date).slice(0, 10)} · {formatMoney(item.maturity.open_amount)} EUR</span>
                              <small>{item.reasons.join(" · ")}</small>
                            </button>
                          ))}
                        </div>
                      ) : !bankReconciliationAction.suggestions_loading ? (
                        <div className="scope-note">No hay vencimientos pendientes con importe exacto en la ventana de fechas. Usa el selector manual si procede.</div>
                      ) : null}
                    </div>
                    <label><span>Vencimiento</span><select required value={bankReconciliationAction.maturity_id} onChange={e => setBankReconciliationAction(prev => ({ ...prev, maturity_id: e.target.value }))}><option value="">Selecciona vencimiento</option>{pendingMaturityOptions.filter(item => item.direction === (bankReconciliationAction.transaction.direction === "inflow" ? "receivable" : "payable")).map(item => <option key={item.id} value={item.id}>{String(item.due_date).slice(0, 10)} - {item.party_name} - {formatMoney(item.open_amount)} EUR</option>)}</select></label>
                    <label><span>Motivo</span><input minLength={5} required value={bankReconciliationAction.reason} onChange={e => setBankReconciliationAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Confirmar</button><button type="button" className="secondary" onClick={() => setBankReconciliationAction(null)}>Cancelar</button></div>
                  </form>
                )}
                {bankReconciliationReverseAction && (
                  <form className="bank-reconcile-form" onSubmit={handleBankReconciliationReverse}>
                    <div><strong>Revertir conciliacion</strong><span>{bankReconciliationReverseAction.transaction.description} - {formatMoney(bankReconciliationReverseAction.transaction.amount)} EUR</span></div>
                    <label><span>Motivo</span><input minLength={5} required value={bankReconciliationReverseAction.reason} onChange={e => setBankReconciliationReverseAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                    <div className="period-action-buttons"><button type="submit">Revertir</button><button type="button" className="secondary" onClick={() => setBankReconciliationReverseAction(null)}>Cancelar</button></div>
                  </form>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "journal" && (
          <section className="journal-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Partida doble</span>
                <h2>Libro Diario</h2>
                <p>Prepara borradores manuales y contabilízalos de forma explícita. Los asientos contabilizados no se editan ni se borran.</p>
              </div>
              {journalLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "journal" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadJournal ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso journal.read." />
            ) : (
              <>
                <form className="journal-filters" onSubmit={handleJournalFilter}>
                  <label><span>Ejercicio</span><select value={journalFilters.fiscal_year_id} onChange={e => setJournalFilters(prev => ({ ...prev, fiscal_year_id: e.target.value }))}><option value="">Todos</option>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                  <label><span>Estado</span><select value={journalFilters.status} onChange={e => setJournalFilters(prev => ({ ...prev, status: e.target.value }))}><option value="">Todos</option><option value="draft">Borradores</option><option value="posted">Contabilizados</option><option value="cancelled">Cancelados</option></select></label>
                  <label><span>Buscar</span><input value={journalFilters.q} maxLength={140} onChange={e => setJournalFilters(prev => ({ ...prev, q: e.target.value }))} placeholder="Concepto o numero" /></label>
                  <label><span>Desde</span><input type="date" value={journalFilters.date_from} onChange={e => setJournalFilters(prev => ({ ...prev, date_from: e.target.value }))} /></label>
                  <label><span>Hasta</span><input type="date" value={journalFilters.date_to} onChange={e => setJournalFilters(prev => ({ ...prev, date_to: e.target.value }))} /></label>
                  <button type="submit">Aplicar</button>
                  <button type="button" className="secondary" onClick={clearJournalFilters}>Limpiar</button>
                  <button type="button" className="secondary" onClick={handleExportJournalCsv} disabled={journalExporting || !journalEntries.length}>CSV</button>
                  <div className="journal-summary"><span>Borradores <strong>{journalDrafts}</strong></span><span>Contabilizados <strong>{journalPosted}</strong></span><span>Cancelados <strong>{journalCancelled}</strong></span></div>
                </form>
                {canWriteJournal && fiscalYears.length > 0 && (
                  <div className="workspace-actions">
                    <button type="button" onClick={() => toggleWorkspacePanel("journal-create")}>
                      {isPanelOpen("journal-create") ? "Ocultar borrador" : "Nuevo borrador"}
                    </button>
                  </div>
                )}
                {canWriteJournal && fiscalYears.length > 0 && isPanelOpen("journal-create") && (
                  <form className={targetClass("journal-create", "journal-create")} data-workspace-target="journal-create" onSubmit={handleCreateJournalDraft}>
                    <div className="form-title"><strong>Nuevo borrador manual</strong><span>La partida doble se vuelve a validar al contabilizar.</span><button type="button" className="secondary" onClick={() => closeWorkspacePanel("journal-create")}>Ocultar</button></div>
                    <div className="journal-header-fields">
                      <label><span>Ejercicio</span><select required value={journalForm.fiscal_year_id} onChange={e => { const year = fiscalYears.find(item => item.id === e.target.value); setJournalForm(prev => ({ ...prev, fiscal_year_id: e.target.value, entry_date: dateInsideFiscalYear(year, prev.entry_date) })); }}>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                      <label><span>Fecha</span><input type="date" required value={journalForm.entry_date} onChange={e => setJournalForm(prev => ({ ...prev, entry_date: e.target.value }))} /></label>
                      <label><span>Concepto</span><input required minLength={3} maxLength={500} value={journalForm.description} onChange={e => setJournalForm(prev => ({ ...prev, description: e.target.value }))} placeholder="Concepto del asiento" /></label>
                    </div>
                    {!journalAccounts.length ? (
                      <div className="scope-note">El ejercicio seleccionado necesita cuentas activas que admitan movimientos antes de crear asientos.</div>
                    ) : (
                      <>
                        <div className="journal-lines">
                          <div className="journal-line head"><span>Cuenta</span><span>Debe / Haber</span><span>Importe</span><span>Detalle</span><span></span></div>
                          {journalForm.lines.map((line, index) => (
                            <div className="journal-line" key={`${index}-${line.side}`}>
                              <select required value={line.account_id} onChange={e => updateJournalLine(index, "account_id", e.target.value)}><option value="">Selecciona cuenta</option>{journalAccounts.map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select>
                              <select value={line.side} onChange={e => updateJournalLine(index, "side", e.target.value)}><option value="debit">Debe</option><option value="credit">Haber</option></select>
                              <input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={line.amount} onChange={e => updateJournalLine(index, "amount", e.target.value)} placeholder="0,00" />
                              <input maxLength={300} value={line.description} onChange={e => updateJournalLine(index, "description", e.target.value)} placeholder="Detalle opcional" />
                              <button type="button" disabled={journalForm.lines.length <= 2} onClick={() => removeJournalLine(index)}>Quitar</button>
                            </div>
                          ))}
                        </div>
                        <div className="journal-totals">
                          <button type="button" className="secondary" onClick={addJournalLine}>Añadir línea</button>
                          <span>Debe <strong>{formatMoney(journalDebit)} EUR</strong></span>
                          <span>Haber <strong>{formatMoney(journalCredit)} EUR</strong></span>
                          <StatusBadge tone={journalDebit > 0 && Math.abs(journalDebit - journalCredit) < 0.000001 ? "ok" : "warning"} text={journalDebit > 0 && Math.abs(journalDebit - journalCredit) < 0.000001 ? "Cuadrado" : "Pendiente de cuadrar"} />
                          <button type="submit">Guardar borrador</button>
                        </div>
                      </>
                    )}
                  </form>
                )}
                {journalStatus && <div className="form-status"><StatusBadge tone={journalStatus.tone} text={journalStatus.text} /></div>}
                {journalEntries.length ? (
                  <div className="journal-table">
                    <div className="journal-row head"><span>Número</span><span>Fecha y concepto</span><span>Periodo</span><span>Debe</span><span>Haber</span><span>Estado</span><span></span></div>
                    {journalEntries.map(entry => (
                      <div className="journal-row" key={entry.id}>
                        <strong>{entry.entry_number || "Borrador"}</strong>
                        <div><strong>{entry.description}</strong><small>{String(entry.entry_date).slice(0, 10)} · {entry.line_count} líneas</small></div>
                        <span>{entry.period_name}</span>
                        <span>{formatMoney(entry.total_debit)}</span>
                        <span>{formatMoney(entry.total_credit)}</span>
                        <StatusBadge tone={journalStatusTone(entry.status)} text={journalStatusLabel(entry.status)} />
                        <button type="button" onClick={() => handleOpenJournalEntry(entry.id)}>Abrir</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Diario vacío" detail="Crea el primer borrador manual para comenzar." />
                )}
                {journalDetail && (
                  <div className="journal-detail">
                    <div className="journal-detail-heading">
                      <div><span className="eyebrow">{journalDetail.status === "posted" ? `Asiento ${journalDetail.entry_number}` : "Borrador"}</span><h3>{journalDetail.description}</h3><small>{String(journalDetail.entry_date).slice(0, 10)} · {journalDetail.period_name} · {journalDetail.year_label}</small></div>
                      <div><StatusBadge tone={journalStatusTone(journalDetail.status)} text={journalStatusLabel(journalDetail.status)} /><button type="button" className="secondary" onClick={() => { setJournalDetail(null); setJournalEditForm(null); setJournalCancelAction(null); setJournalReverseAction(null); }}>Cerrar</button></div>
                    </div>
                    <div className="journal-detail-lines">
                      <div className="detail-line head"><span>Cuenta</span><span>Detalle</span><span>Debe</span><span>Haber</span></div>
                      {journalDetail.lines.map(line => <div className="detail-line" key={line.id}><strong>{line.account_code} - {line.account_name}</strong><span>{line.description || "-"}</span><span>{formatMoney(line.debit_amount)}</span><span>{formatMoney(line.credit_amount)}</span></div>)}
                    </div>
                    <div className="source-links">
                      <div className="source-links-heading">
                        <div><span className="eyebrow">Trazabilidad</span><h4>Origen del asiento</h4></div>
                        <StatusBadge tone={journalDetail.source_links?.length ? "ok" : "neutral"} text={journalDetail.source_links?.length ? `${journalDetail.source_links.length} enlace(s)` : "Sin documento externo"} />
                      </div>
                      <div className="source-row">
                        <span>Sistema</span><strong>{journalDetail.source_system || "accounting"}</strong>
                        <span>Tipo</span><strong>{journalDetail.source_type || journalDetail.entry_type || "manual"}</strong>
                        <span>Identificador</span><strong>{journalDetail.source_id || journalDetail.id}</strong>
                      </div>
                      {journalDetail.source_event_id && (
                        <div className="source-row"><span>Evento origen</span><strong>{journalDetail.source_event_id}</strong></div>
                      )}
                      {journalDetail.source_links?.length > 0 && (
                        <div className="source-link-list">
                          {journalDetail.source_links.map(link => (
                            <div className="source-link-row" key={link.id}>
                              <div><strong>{link.source_system} / {link.source_type}</strong><small>{link.source_id}</small></div>
                              <span>{link.source_event_id || "Sin evento"}</span>
                              {link.document_url ? <a href={link.document_url} target="_blank" rel="noreferrer">Documento</a> : <span>Sin documento</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="journal-detail-actions">
                      <span>Debe <strong>{formatMoney(journalDetail.total_debit)} EUR</strong></span>
                      <span>Haber <strong>{formatMoney(journalDetail.total_credit)} EUR</strong></span>
                      {journalDetail.status === "draft" && canWriteJournal && <button type="button" className="secondary" onClick={() => startJournalEdit(journalDetail)}>Editar borrador</button>}
                      {journalDetail.status === "draft" && canWriteJournal && <button type="button" className="secondary" onClick={() => { setJournalEditForm(null); setJournalCancelAction({ entry: journalDetail, reason: "" }); }}>Cancelar borrador</button>}
                      {journalDetail.status === "draft" && canPostJournal && <button type="button" onClick={() => handlePostJournalEntry(journalDetail)}>Contabilizar</button>}
                      {journalDetail.status === "posted" && journalDetail.entry_type !== "reversal" && !journalDetail.reversed_by_entry_id && canWriteJournal && <button type="button" className="secondary" onClick={() => startJournalReverse(journalDetail)}>Crear reverso</button>}
                    </div>
                    {journalDetail.status === "posted" && journalDetail.reversed_by_entry_id && (
                      <div className="scope-note">Este asiento ya tiene un borrador reverso asociado.</div>
                    )}
                    {journalDetail.entry_type === "reversal" && journalDetail.reversal_of_entry_id && (
                      <div className="scope-note">Borrador reverso enlazado al asiento original.</div>
                    )}
                    {journalReverseAction?.entry?.id === journalDetail.id && (
                      <form className="period-action-form" onSubmit={handleCreateJournalReversal}>
                        <div><strong>Crear borrador reverso</strong><span>{journalDetail.description}</span></div>
                        <label><span>Fecha reverso</span><input type="date" required value={journalReverseAction.entry_date} onChange={e => setJournalReverseAction(prev => ({ ...prev, entry_date: e.target.value }))} /></label>
                        <label><span>Motivo</span><input minLength={5} maxLength={500} required value={journalReverseAction.reason} onChange={e => setJournalReverseAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                        <div className="period-action-buttons"><button type="submit">Crear reverso</button><button type="button" className="secondary" onClick={() => setJournalReverseAction(null)}>Cancelar</button></div>
                      </form>
                    )}
                    {journalEditForm?.entry?.id === journalDetail.id && (
                      <form className="journal-create journal-edit" onSubmit={handleUpdateJournalDraft}>
                        <div className="form-title"><strong>Editar borrador</strong><span>Se reemplaza el borrador completo y se registra auditoria.</span></div>
                        <div className="journal-header-fields">
                          <label><span>Fecha</span><input type="date" required value={journalEditForm.entry_date} onChange={e => setJournalEditForm(prev => ({ ...prev, entry_date: e.target.value }))} /></label>
                          <label><span>Concepto</span><input required minLength={3} maxLength={500} value={journalEditForm.description} onChange={e => setJournalEditForm(prev => ({ ...prev, description: e.target.value }))} /></label>
                        </div>
                        {!journalAccounts.length ? (
                          <div className="scope-note">No hay cuentas activas disponibles para editar este borrador.</div>
                        ) : (
                          <>
                            <div className="journal-lines">
                              <div className="journal-line head"><span>Cuenta</span><span>Debe / Haber</span><span>Importe</span><span>Detalle</span><span></span></div>
                              {journalEditForm.lines.map((line, index) => (
                                <div className="journal-line" key={`edit-${index}-${line.side}`}>
                                  <select required value={line.account_id} onChange={e => updateJournalEditLine(index, "account_id", e.target.value)}><option value="">Selecciona cuenta</option>{journalAccounts.map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select>
                                  <select value={line.side} onChange={e => updateJournalEditLine(index, "side", e.target.value)}><option value="debit">Debe</option><option value="credit">Haber</option></select>
                                  <input required inputMode="decimal" pattern="[0-9]+([.,][0-9]{1,6})?" value={line.amount} onChange={e => updateJournalEditLine(index, "amount", e.target.value)} placeholder="0,00" />
                                  <input maxLength={300} value={line.description} onChange={e => updateJournalEditLine(index, "description", e.target.value)} placeholder="Detalle opcional" />
                                  <button type="button" disabled={journalEditForm.lines.length <= 2} onClick={() => removeJournalEditLine(index)}>Quitar</button>
                                </div>
                              ))}
                            </div>
                            <div className="journal-totals">
                              <button type="button" className="secondary" onClick={addJournalEditLine}>Anadir linea</button>
                              <span>Debe <strong>{formatMoney(journalEditDebit)} EUR</strong></span>
                              <span>Haber <strong>{formatMoney(journalEditCredit)} EUR</strong></span>
                              <StatusBadge tone={journalEditDebit > 0 && Math.abs(journalEditDebit - journalEditCredit) < 0.000001 ? "ok" : "warning"} text={journalEditDebit > 0 && Math.abs(journalEditDebit - journalEditCredit) < 0.000001 ? "Cuadrado" : "Pendiente de cuadrar"} />
                              <button type="submit">Guardar cambios</button>
                              <button type="button" className="secondary" onClick={() => setJournalEditForm(null)}>Cancelar edicion</button>
                            </div>
                          </>
                        )}
                      </form>
                    )}
                    {journalDetail.status === "cancelled" && journalDetail.cancel_reason && (
                      <div className="scope-note">Motivo de cancelacion: {journalDetail.cancel_reason}</div>
                    )}
                    {journalCancelAction?.entry?.id === journalDetail.id && (
                      <form className="period-action-form" onSubmit={handleCancelJournalEntry}>
                        <div><strong>Cancelar borrador</strong><span>{journalDetail.description}</span></div>
                        <label><span>Motivo</span><input minLength={5} maxLength={500} required value={journalCancelAction.reason} onChange={e => setJournalCancelAction(prev => ({ ...prev, reason: e.target.value }))} /></label>
                        <div className="period-action-buttons"><button type="submit">Cancelar borrador</button><button type="button" className="secondary" onClick={() => setJournalCancelAction(null)}>Mantener borrador</button></div>
                      </form>
                    )}
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "ledger" && (
          <section className="ledger-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Mayor y saldos</span>
                <h2>Mayor</h2>
                <p>Movimientos contabilizados por cuenta y balance de sumas y saldos calculado desde el Diario.</p>
              </div>
              {ledgerLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            {!canReadLedger ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso ledger.read." />
            ) : !fiscalYears.length ? (
              <EmptyState title="Primero abre un ejercicio" detail="El Mayor se calcula desde asientos contabilizados de un ejercicio." />
            ) : (
              <>
                <form className="ledger-filters" onSubmit={handleLedgerFilter}>
                  <label><span>Ejercicio</span><select value={ledgerFilters.fiscal_year_id} onChange={e => setLedgerFilters(prev => ({ ...prev, fiscal_year_id: e.target.value, account_id: "", period_id: "" }))}>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                  <label><span>Periodo</span><select value={ledgerFilters.period_id} onChange={e => setLedgerFilters(prev => ({ ...prev, period_id: e.target.value }))}><option value="">Todo el ejercicio</option>{selectedLedgerPeriods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
                  <label><span>Cuenta</span><select value={ledgerFilters.account_id} onChange={e => setLedgerFilters(prev => ({ ...prev, account_id: e.target.value }))}><option value="">Primera cuenta operativa</option>{ledgerAccounts.map(account => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}</select></label>
                  <label><span>Desde</span><input type="date" value={ledgerFilters.date_from} min={selectedLedgerYear ? String(selectedLedgerYear.start_date).slice(0, 10) : undefined} max={selectedLedgerYear ? String(selectedLedgerYear.end_date).slice(0, 10) : undefined} onChange={e => setLedgerFilters(prev => ({ ...prev, date_from: e.target.value }))} /></label>
                  <label><span>Hasta</span><input type="date" value={ledgerFilters.date_to} min={selectedLedgerYear ? String(selectedLedgerYear.start_date).slice(0, 10) : undefined} max={selectedLedgerYear ? String(selectedLedgerYear.end_date).slice(0, 10) : undefined} onChange={e => setLedgerFilters(prev => ({ ...prev, date_to: e.target.value }))} /></label>
                  <label><span>Cuentas sin saldo</span><select value={ledgerFilters.include_empty} onChange={e => setLedgerFilters(prev => ({ ...prev, include_empty: e.target.value }))}><option value="true">Mostrar</option><option value="false">Ocultar</option></select></label>
                  <button type="submit">Aplicar</button>
                </form>
                {ledgerStatus && <div className="form-status"><StatusBadge tone={ledgerStatus.tone} text={ledgerStatus.text} /></div>}
                <div className="ledger-summary-strip">
                  <div><span>Total Debe</span><strong>{formatMoney(trialBalance.summary?.total_debit)} EUR</strong></div>
                  <div><span>Total Haber</span><strong>{formatMoney(trialBalance.summary?.total_credit)} EUR</strong></div>
                  <div><span>Saldo deudor</span><strong>{formatMoney(trialBalance.summary?.balance_debit)} EUR</strong></div>
                  <div><span>Saldo acreedor</span><strong>{formatMoney(trialBalance.summary?.balance_credit)} EUR</strong></div>
                </div>
                <div className="ledger-grid">
                  <section className="ledger-block">
                    <div className="ledger-block-heading">
                      <div><span className="eyebrow">Balance</span><h3>Sumas y saldos</h3></div>
                      <div className="ledger-actions"><small>{trialBalance.data.length} cuentas</small><button type="button" onClick={handleExportTrialBalanceCsv} disabled={ledgerExporting || !trialBalance.data.length}>CSV</button></div>
                    </div>
                    {trialBalance.data.length ? (
                      <div className="trial-table">
                        <div className="trial-row head"><span>Cuenta</span><span>Debe</span><span>Haber</span><span>Deudor</span><span>Acreedor</span><span></span></div>
                        {trialBalance.data.map(row => (
                          <div className="trial-row" key={row.id}>
                            <div><strong>{row.code}</strong><small>{row.name}</small></div>
                            <span>{formatMoney(row.total_debit)}</span>
                            <span>{formatMoney(row.total_credit)}</span>
                            <span>{formatMoney(row.balance_debit)}</span>
                            <span>{formatMoney(row.balance_credit)}</span>
                            <button type="button" onClick={() => { setLedgerFilters(prev => ({ ...prev, account_id: row.id })); refreshLedger({ ...ledgerFilters, account_id: row.id }); }}>Mayor</button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="Sin saldos" detail="No hay cuentas con movimientos para los filtros actuales." />
                    )}
                  </section>
                  <section className="ledger-block">
                    <div className="ledger-block-heading">
                      <div><span className="eyebrow">Cuenta</span><h3>{ledgerAccount ? `${ledgerAccount.code} - ${ledgerAccount.name}` : "Mayor de cuenta"}</h3></div>
                      <div className="ledger-actions"><small>Saldo {formatMoney(ledgerAccountSummary?.balance)} EUR</small><button type="button" onClick={handleExportLedgerCsv} disabled={ledgerExporting || !ledgerMovements.length}>CSV</button></div>
                    </div>
                    <div className="ledger-account-totals">
                      <span>Debe <strong>{formatMoney(ledgerAccountSummary?.total_debit)} EUR</strong></span>
                      <span>Haber <strong>{formatMoney(ledgerAccountSummary?.total_credit)} EUR</strong></span>
                    </div>
                    {ledgerMovements.length ? (
                      <div className="ledger-table">
                        <div className="ledger-row head"><span>Fecha</span><span>Asiento</span><span>Concepto</span><span>Debe</span><span>Haber</span><span>Saldo</span></div>
                        {ledgerMovements.map(row => (
                          <div className="ledger-row" key={row.journal_line_id}>
                            <span>{String(row.entry_date).slice(0, 10)}</span>
                            <strong>{row.entry_number}</strong>
                            <div><strong>{row.entry_description}</strong><small>{row.period_name}{row.line_description ? ` · ${row.line_description}` : ""}</small></div>
                            <span>{formatMoney(row.debit_amount)}</span>
                            <span>{formatMoney(row.credit_amount)}</span>
                            <span>{formatMoney(row.running_balance)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="Sin movimientos" detail="La cuenta seleccionada no tiene asientos contabilizados en este rango." />
                    )}
                  </section>
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === "reports" && (
          <section className="reports-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Informes preliminares</span>
                <h2>Balance y PyG</h2>
                <p>Informes tecnicos calculados desde asientos contabilizados. No sustituyen revision contable ni validacion externa.</p>
              </div>
              {reportsLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            <WorkspaceHint hint={workspaceHint?.tab === "reports" ? workspaceHint : null} onClose={closeWorkspaceHint} onOverview={returnToOverview} />
            {!canReadLedger ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso ledger.read." />
            ) : !fiscalYears.length ? (
              <EmptyState title="Primero abre un ejercicio" detail="Los informes se calculan desde cuentas y asientos contabilizados de un ejercicio." />
            ) : (
              <>
                <form className={targetClass("reports-filters", "reports-filters")} data-workspace-target="reports-filters" onSubmit={handleReportsFilter}>
                  <label><span>Ejercicio</span><select value={reportsFilters.fiscal_year_id} onChange={e => setReportsFilters(prev => ({ ...prev, fiscal_year_id: e.target.value, period_id: "" }))}>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                  <label><span>Periodo</span><select value={reportsFilters.period_id} onChange={e => setReportsFilters(prev => ({ ...prev, period_id: e.target.value }))}><option value="">Todo el ejercicio</option>{selectedReportsPeriods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}</select></label>
                  <label><span>Desde</span><input type="date" value={reportsFilters.date_from} min={selectedReportsYear ? String(selectedReportsYear.start_date).slice(0, 10) : undefined} max={selectedReportsYear ? String(selectedReportsYear.end_date).slice(0, 10) : undefined} onChange={e => setReportsFilters(prev => ({ ...prev, date_from: e.target.value }))} /></label>
                  <label><span>Hasta</span><input type="date" value={reportsFilters.date_to} min={selectedReportsYear ? String(selectedReportsYear.start_date).slice(0, 10) : undefined} max={selectedReportsYear ? String(selectedReportsYear.end_date).slice(0, 10) : undefined} onChange={e => setReportsFilters(prev => ({ ...prev, date_to: e.target.value }))} /></label>
                  <label><span>Cuentas sin saldo</span><select value={reportsFilters.include_empty} onChange={e => setReportsFilters(prev => ({ ...prev, include_empty: e.target.value }))}><option value="false">Ocultar</option><option value="true">Mostrar</option></select></label>
                  <button type="submit">Aplicar</button>
                </form>
                {reportsStatus && <div className="form-status"><StatusBadge tone={reportsStatus.tone} text={reportsStatus.text} /></div>}
                <div className="scope-note">Clasificacion basada en el tipo de cuenta configurado. Los epigrafes oficiales de Balance/PyG y plantillas PGC/PGC PYMES siguen pendientes de fuente oficial validada.</div>
                <div className="reports-grid">
                  <StatementPanel
                    title="Balance de situacion"
                    subtitle="Activo, pasivo y patrimonio"
                    exporting={reportsExporting || !balanceSheet}
                    onExport={handleExportBalanceSheetCsv}
                    totals={[
                      { label: "Activo", value: balanceSheet?.totals?.assets },
                      { label: "Pasivo + PN", value: balanceSheet?.totals?.liabilities_equity },
                      { label: "Diferencia", value: balanceSheet?.totals?.difference },
                    ]}
                    sections={[
                      { label: "Activo", rows: balanceSheet?.sections?.assets || [] },
                      { label: "Pasivo", rows: balanceSheet?.sections?.liabilities || [] },
                      { label: "Patrimonio neto", rows: balanceSheet?.sections?.equity || [] },
                    ]}
                  />
                  <StatementPanel
                    title="Perdidas y ganancias"
                    subtitle="Ingresos, gastos y resultado"
                    exporting={reportsExporting || !profitLoss}
                    onExport={handleExportProfitLossCsv}
                    totals={[
                      { label: "Ingresos", value: profitLoss?.totals?.income },
                      { label: "Gastos", value: profitLoss?.totals?.expenses },
                      { label: "Resultado", value: profitLoss?.totals?.result },
                    ]}
                    sections={[
                      { label: "Ingresos", rows: profitLoss?.sections?.income || [] },
                      { label: "Gastos", rows: profitLoss?.sections?.expenses || [] },
                    ]}
                  />
                </div>
              </>
            )}
          </section>
        )}

        {activeTab === "templates" && (
          <section className="templates-workspace">
            <div className="workspace-heading compact">
              <div>
                <span className="eyebrow">Reutilizacion controlada</span>
                <h2>Plantillas de plan contable</h2>
                <p>Instantaneas versionadas de planes internos. Las importaciones nunca sobrescriben cuentas existentes.</p>
              </div>
              {templatesLoading && <StatusBadge tone="neutral" text="Actualizando" />}
            </div>
            {!canReadTemplates ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso templates.read." />
            ) : !fiscalYears.length ? (
              <EmptyState title="Primero abre un ejercicio" detail="Las plantillas se crean desde un plan existente y se aplican sobre un ejercicio destino." />
            ) : (
              <>
                <div className="template-toolbar">
                  <label>
                    <span>Ejercicio destino</span>
                    <select value={templateTargetYearId} onChange={e => { setTemplateTargetYearId(e.target.value); setTemplatePreview(null); }}>
                      {fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}
                    </select>
                  </label>
                  <div>
                    <strong>{chartTemplates.length} plantillas disponibles</strong>
                    <span>Empresa seleccionada: {selectedCompany?.name || "-"}</span>
                  </div>
                </div>
                {canWriteTemplates && (
                  <form className="template-create" onSubmit={handleCreateTemplate}>
                    <div className="form-title"><strong>Guardar plan como plantilla</strong><span>Incluye solo cuentas activas del ejercicio origen.</span></div>
                    <label><span>Ejercicio origen</span><select required value={templateForm.fiscal_year_id} onChange={e => setTemplateForm(prev => ({ ...prev, fiscal_year_id: e.target.value }))}>{fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}</select></label>
                    <label><span>Codigo interno</span><input required maxLength={80} pattern="[A-Za-z0-9._-]+" value={templateForm.code} onChange={e => setTemplateForm(prev => ({ ...prev, code: e.target.value }))} placeholder="PLAN-OPERATIVO" /></label>
                    <label><span>Nombre</span><input required maxLength={220} value={templateForm.name} onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Plan operativo transporte" /></label>
                    <label><span>Version</span><input required maxLength={80} value={templateForm.version_label} onChange={e => setTemplateForm(prev => ({ ...prev, version_label: e.target.value }))} placeholder="v1" /></label>
                    <button type="submit">Crear plantilla</button>
                  </form>
                )}
                {templateStatus && <div className="form-status"><StatusBadge tone={templateStatus.tone} text={templateStatus.text} /></div>}
                <div className="scope-note">El catalogo no contiene todavia plantillas PGC o PGC PYMES validadas. Esta pantalla trabaja solo con instantaneas internas creadas por la empresa.</div>
                {chartTemplates.length ? (
                  <div className="templates-table">
                    <div className="template-row head"><span>Plantilla</span><span>Version</span><span>Cuentas</span><span>Origen</span><span></span></div>
                    {chartTemplates.map(template => (
                      <div className="template-row" key={template.id}>
                        <div><strong>{template.name}</strong><small>{template.code}</small></div>
                        <span>{template.version_label}</span>
                        <strong>{template.account_count}</strong>
                        <span>{template.source_type === "company_snapshot" ? "Plan interno" : template.source_type}</span>
                        <button type="button" onClick={() => handlePreviewTemplate(template)}>Vista previa</button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin plantillas internas" detail="Guarda un plan con cuentas activas para poder reutilizarlo en otros ejercicios." />
                )}
                {templatePreview && (
                  <div className="template-preview">
                    <div>
                      <span className="eyebrow">Vista previa de importacion</span>
                      <h3>{templatePreview.template.name} hacia {templatePreview.fiscal_year.year_label}</h3>
                      <small>Checksum: {templatePreview.template.source_checksum}</small>
                    </div>
                    <div className="preview-counts">
                      <div><span>Altas</span><strong>{templatePreview.inserted_count}</strong></div>
                      <div><span>Coincidencias</span><strong>{templatePreview.matching_count}</strong></div>
                      <div><span>Conflictos</span><strong>{templatePreview.conflict_count}</strong></div>
                    </div>
                    {templatePreview.conflicts.length > 0 && (
                      <div className="conflict-list">
                        {templatePreview.conflicts.map(conflict => (
                          <div key={conflict.code}><strong>{conflict.code}</strong><span>{conflict.existing_name}</span><small>Plantilla: {conflict.template_name}</small></div>
                        ))}
                      </div>
                    )}
                    <div className="template-preview-actions">
                      <button type="button" className="secondary" onClick={() => setTemplatePreview(null)}>Cancelar</button>
                      {canWriteTemplates && <button type="button" onClick={handleImportTemplate}>Importar sin sobrescribir</button>}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "companies" && (
          <section className="panel">
            <h2>Empresas autorizadas</h2>
            {companies.length ? (
              <div className="table">
                <div className="row head"><span>Empresa</span><span>Origen</span><span>Permisos</span></div>
                {companies.map(company => (
                  <div className="row" key={company.id}>
                    <span>{company.name}</span>
                    <span>{company.source_company_id}</span>
                    <span>{(company.permissions || []).join(", ")}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin empresas" detail="No hay empresas contables autorizadas para este usuario." />
            )}
          </section>
        )}

        {activeTab === "periods" && (
          <section className="grid">
            {canOpenFiscalYear && (
              <article className="panel panel-full">
                <div className="panel-heading">
                  <div>
                    <h2>Abrir ejercicio</h2>
                    <p>Crea el ejercicio y sus periodos mensuales iniciales para la empresa seleccionada.</p>
                  </div>
                  {periodsLoading && <StatusBadge tone="neutral" text="Actualizando" />}
                </div>
                <form className="form-grid" onSubmit={handleOpenFiscalYear}>
                  <label>
                    <span>Etiqueta</span>
                    <input
                      value={openYearForm.year_label}
                      onChange={e => setOpenYearForm(prev => ({ ...prev, year_label: e.target.value }))}
                      maxLength={20}
                      required
                    />
                  </label>
                  <label>
                    <span>Inicio</span>
                    <input
                      type="date"
                      value={openYearForm.start_date}
                      onChange={e => setOpenYearForm(prev => ({ ...prev, start_date: e.target.value }))}
                      required
                    />
                  </label>
                  <label>
                    <span>Fin</span>
                    <input
                      type="date"
                      value={openYearForm.end_date}
                      onChange={e => setOpenYearForm(prev => ({ ...prev, end_date: e.target.value }))}
                      required
                    />
                  </label>
                  <button type="submit">Abrir ejercicio</button>
                </form>
                {openYearStatus && <div className="form-status"><StatusBadge tone={openYearStatus.tone} text={openYearStatus.text} /></div>}
              </article>
            )}
            <article className="panel">
              <h2>Ejercicios</h2>
              {fiscalYears.length ? fiscalYears.map(year => (
                <div className="list-item" key={year.id}>
                  <strong>{year.year_label}</strong>
                  <span>{String(year.start_date).slice(0,10)} - {String(year.end_date).slice(0,10)} - {year.status}</span>
                </div>
              )) : <EmptyState title="Sin ejercicios" detail="Aun no hay ejercicios contables para esta empresa." />}
            </article>
            <article className="panel">
              <h2>Periodos</h2>
              {periods.length ? periods.map(period => (
                <div className="list-item period-item" key={period.id}>
                  <div>
                    <strong>{period.name}</strong>
                    <span>{String(period.start_date).slice(0,10)} - {String(period.end_date).slice(0,10)}</span>
                    {period.locked_reason && <small>{period.locked_reason}</small>}
                    {period.status === "closed" && period.closed_at && (
                      <small>Cerrado por {period.closed_by_name || "Usuario"} | {formatDateTime(period.closed_at)}</small>
                    )}
                  </div>
                  <div className="period-actions">
                    <StatusBadge tone={statusTone(period.status)} text={period.status} />
                    {availablePeriodActions(period, permissions).map(action => (
                      <button key={action} onClick={() => startPeriodAction(period, action)}>
                        {periodActionLabels[action]}
                      </button>
                    ))}
                  </div>
                </div>
              )) : <EmptyState title="Sin periodos" detail="Aun no hay periodos contables para esta empresa." />}
              {periodAction && (
                <form className="period-action-form" onSubmit={handlePeriodStatusChange}>
                  <div>
                    <strong>{periodActionLabels[periodAction.action]} periodo</strong>
                    <span>{periodAction.period.name}</span>
                  </div>
                  <label>
                    <span>Motivo</span>
                    <input
                      value={periodAction.reason}
                      onChange={e => setPeriodAction(prev => ({ ...prev, reason: e.target.value }))}
                      minLength={5}
                      required
                    />
                  </label>
                  <div className="period-action-buttons">
                    <button type="submit">{periodActionLabels[periodAction.action]}</button>
                    <button type="button" className="secondary" onClick={() => setPeriodAction(null)}>Cancelar</button>
                  </div>
                </form>
              )}
              {periodActionStatus && (
                <div className="form-status">
                  <StatusBadge tone={periodActionStatus.tone} text={periodActionStatus.text} />
                </div>
              )}
            </article>
          </section>
        )}

        {activeTab === "audit" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Auditoria</h2>
                <p>Consulta read-only de eventos tecnicos registrados para la empresa seleccionada.</p>
              </div>
              {auditLoading && <StatusBadge tone="neutral" text="Cargando" />}
            </div>
            {!canReadAudit ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso audit.read para consultar auditoria." />
            ) : (
              <>
                <form className="audit-filters" onSubmit={handleAuditFilter}>
                  <label>
                    <span>Accion</span>
                    <input
                      value={auditFilters.action}
                      onChange={e => setAuditFilters(prev => ({ ...prev, action: e.target.value }))}
                      placeholder="period.closed"
                    />
                  </label>
                  <label>
                    <span>Entidad</span>
                    <input
                      value={auditFilters.entity_type}
                      onChange={e => setAuditFilters(prev => ({ ...prev, entity_type: e.target.value }))}
                      placeholder="accounting_period"
                    />
                  </label>
                  <label>
                    <span>Limite</span>
                    <select
                      value={auditFilters.limit}
                      onChange={e => setAuditFilters(prev => ({ ...prev, limit: Number(e.target.value) }))}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <button type="submit">Filtrar</button>
                </form>
                {auditStatus && <div className="form-status"><StatusBadge tone={auditStatus.tone} text={auditStatus.text} /></div>}
                {auditRows.length ? (
                  <div className="audit-list">
                    {auditRows.map(row => (
                      <div className="audit-row" key={row.id}>
                        <span>{formatDateTime(row.created_at)}</span>
                        <strong>{row.action}</strong>
                        <span>{row.entity_type || "-"}</span>
                        <small>{formatDetail(row.detail)}</small>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin registros" detail="No hay eventos de auditoria para los filtros actuales." />
                )}
              </>
            )}
          </section>
        )}

        {activeTab === "integrations" && (
          <section className="panel panel-full">
            <div className="panel-heading">
              <div>
                <h2>Exportaciones para asesoria</h2>
                <p>Paquetes CSV y referencia de conectores externos. La activacion, priorizacion y gobierno de integraciones con otros programas se realiza desde Superadmin.</p>
              </div>
              {integrationsLoading && <StatusBadge tone="neutral" text="Cargando" />}
            </div>
            <form className="integration-filters" onSubmit={handleIntegrationFilter}>
              <label>
                <span>Buscar</span>
                <input
                  value={integrationFilters.q}
                  onChange={e => setIntegrationFilters(prev => ({ ...prev, q: e.target.value }))}
                  placeholder="Sage, Holded, API, asesoria..."
                />
              </label>
              <label>
                <span>Estado</span>
                <select value={integrationFilters.status} onChange={e => setIntegrationFilters(prev => ({ ...prev, status: e.target.value }))}>
                  <option value="">Todos</option>
                  {Object.entries(integrationStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <label>
                <span>Categoria</span>
                <select value={integrationFilters.category} onChange={e => setIntegrationFilters(prev => ({ ...prev, category: e.target.value }))}>
                  <option value="">Todas</option>
                  {Object.entries(integrationCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button type="submit">Filtrar</button>
              <button type="button" className="secondary" onClick={clearIntegrationFilters}>Limpiar</button>
            </form>
            {integrationsStatus && <div className="form-status"><StatusBadge tone={integrationsStatus.tone} text={integrationsStatus.text} /></div>}
            <div className="integration-summary-strip">
              <div><span>Catalogo</span><strong>{integrationCatalog.catalog_version || "-"}</strong></div>
              <div><span>Conectores</span><strong>{integrationCatalog.summary?.total || integrationCatalog.data.length}</strong></div>
              <div><span>API + outbox</span><strong>{integrationCatalog.summary?.by_mode?.api_with_outbox || 0}</strong></div>
              <div><span>Export first</span><strong>{integrationCatalog.summary?.by_mode?.export_first || 0}</strong></div>
            </div>
            {integrationCatalog.disclaimer && (
              <div className="scope-note">{integrationCatalog.disclaimer}</div>
            )}
            <div className="scope-note">
              Esta pantalla no administra conectores externos. Superadmin gobierna catalogo, activacion y modo permitido; Contabilidad solo ejecuta exportaciones autorizadas bajo permisos y auditoria.
            </div>
            <div className="advisor-package-panel">
              <div className="panel-heading compact">
                <div>
                  <h2>Paquete asesoria</h2>
                  <p>Genera un paquete ZIP con CSV disponibles, manifiesto y rutas auditadas para asesoria o importacion en programas externos.</p>
                </div>
                <div className="panel-actions">
                  {advisorPackageLoading && <StatusBadge tone="neutral" text="Preparando" />}
                  <button
                    type="button"
                    className="secondary"
                    disabled={!advisorPackage || advisorPackageDownloading === "zip"}
                    onClick={handleDownloadAdvisorPackageZip}
                  >
                    {advisorPackageDownloading === "zip" ? "Preparando ZIP" : "Descargar ZIP"}
                  </button>
                </div>
              </div>
              <form className="advisor-package-filters" onSubmit={handleAdvisorPackageFilter}>
                <label>
                  <span>Ejercicio</span>
                  <select
                    value={advisorPackageFilters.fiscal_year_id}
                    onChange={e => setAdvisorPackageFilters(prev => ({ ...prev, fiscal_year_id: e.target.value, period_id: "" }))}
                  >
                    <option value="">Selecciona ejercicio</option>
                    {fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}
                  </select>
                </label>
                <label>
                  <span>Periodo</span>
                  <select
                    value={advisorPackageFilters.period_id}
                    onChange={e => setAdvisorPackageFilters(prev => ({ ...prev, period_id: e.target.value }))}
                    disabled={!advisorPackageFilters.fiscal_year_id}
                  >
                    <option value="">Todos</option>
                    {selectedAdvisorPackagePeriods.map(period => <option key={period.id} value={period.id}>{period.name}</option>)}
                  </select>
                </label>
                <label><span>Desde</span><input type="date" value={advisorPackageFilters.date_from} onChange={e => setAdvisorPackageFilters(prev => ({ ...prev, date_from: e.target.value }))} /></label>
                <label><span>Hasta</span><input type="date" value={advisorPackageFilters.date_to} onChange={e => setAdvisorPackageFilters(prev => ({ ...prev, date_to: e.target.value }))} /></label>
                <label>
                  <span>Cuentas vacias</span>
                  <select value={advisorPackageFilters.include_empty} onChange={e => setAdvisorPackageFilters(prev => ({ ...prev, include_empty: e.target.value }))}>
                    <option value="false">Ocultar</option>
                    <option value="true">Incluir</option>
                  </select>
                </label>
                <button type="submit">Actualizar paquete</button>
              </form>
              {advisorPackageStatus && <div className="form-status"><StatusBadge tone={advisorPackageStatus.tone} text={advisorPackageStatus.text} /></div>}
              {advisorPackage && (
                <>
                  <div className="advisor-package-summary">
                    <div><span>Disponibles</span><strong>{advisorPackage.available_count}</strong></div>
                    <div><span>Bloqueados</span><strong>{advisorPackage.blocked_count}</strong></div>
                    <div><span>Empresa</span><strong>{advisorPackage.selected_company?.name || selectedCompany?.name || "-"}</strong></div>
                  </div>
                  <div className="advisor-export-list">
                    {advisorPackage.exports.map(item => (
                      <div className={`advisor-export-row${item.available ? "" : " disabled"}`} key={item.id}>
                        <div>
                          <strong>{item.label}</strong>
                          <small>{item.available ? item.description : item.blocked_reasons.join(", ")}</small>
                        </div>
                        <button
                          type="button"
                          disabled={!item.available || advisorPackageDownloading === item.id}
                          onClick={() => handleDownloadAdvisorPackageFile(item)}
                        >
                          {advisorPackageDownloading === item.id ? "Descargando" : "CSV"}
                        </button>
                      </div>
                    ))}
                  </div>
                  <small className="advisor-package-disclaimer">{advisorPackage.disclaimer}</small>
                </>
              )}
            </div>
            <div className="external-import-panel">
              <div className="panel-heading compact">
                <div>
                  <h2>Bandeja de importacion</h2>
                  <p>Prepara ficheros externos en staging para revision. No aplica datos contables ni crea asientos.</p>
                </div>
                {externalImportLoading && <StatusBadge tone="neutral" text="Cargando" />}
              </div>
              {!canReadExternalImports ? (
                <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso external_imports.read." />
              ) : (
                <>
                  {canWriteExternalImports && (
                    <form className="external-import-create" onSubmit={handleCreateExternalImportBatch}>
                      <label>
                        <span>Programa</span>
                        <select value={externalImportForm.provider_id} onChange={e => setExternalImportForm(prev => ({ ...prev, provider_id: e.target.value }))}>
                          <option value="generic">Generico</option>
                          {integrationCatalog.data.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Tipo</span>
                        <select value={externalImportForm.import_type} onChange={e => setExternalImportForm(prev => ({ ...prev, import_type: e.target.value }))}>
                          {Object.entries(externalImportTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Archivo</span>
                        <input value={externalImportForm.original_filename} maxLength={240} onChange={e => setExternalImportForm(prev => ({ ...prev, original_filename: e.target.value }))} />
                      </label>
                      <label>
                        <span>Notas</span>
                        <input value={externalImportForm.notes} maxLength={1000} onChange={e => setExternalImportForm(prev => ({ ...prev, notes: e.target.value }))} />
                      </label>
                      <label className="wide">
                        <span>CSV</span>
                        <textarea value={externalImportForm.csv_text} onChange={e => setExternalImportForm(prev => ({ ...prev, csv_text: e.target.value }))} rows={5} required />
                        <button type="button" className="external-import-template-button" onClick={loadExternalImportTemplate}>Cargar ejemplo</button>
                      </label>
                      <button type="submit">Preparar staging</button>
                    </form>
                  )}
                  <form className="external-import-filters" onSubmit={handleExternalImportFilter}>
                    <label>
                      <span>Estado</span>
                      <select value={externalImportFilters.status} onChange={e => setExternalImportFilters(prev => ({ ...prev, status: e.target.value }))}>
                        <option value="">Todos</option>
                        {Object.entries(externalImportStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Programa</span>
                      <input value={externalImportFilters.provider_id} onChange={e => setExternalImportFilters(prev => ({ ...prev, provider_id: e.target.value }))} placeholder="contasol-factusol" />
                    </label>
                    <label>
                      <span>Tipo</span>
                      <select value={externalImportFilters.import_type} onChange={e => setExternalImportFilters(prev => ({ ...prev, import_type: e.target.value }))}>
                        <option value="">Todos</option>
                        {Object.entries(externalImportTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Ejercicio destino</span>
                      <select value={externalImportTargetYearId} onChange={e => setExternalImportTargetYearId(e.target.value)}>
                        <option value="">Selecciona ejercicio</option>
                        {fiscalYears.map(year => <option key={year.id} value={year.id}>{year.year_label}</option>)}
                      </select>
                    </label>
                    <button type="submit">Filtrar lotes</button>
                    <button type="button" className="secondary" onClick={handleExternalImportExportCsv} disabled={externalImportExporting || !externalImportBatches.length}>
                      {externalImportExporting ? "Exportando" : "CSV"}
                    </button>
                  </form>
                  {externalImportStatus && <div className="form-status"><StatusBadge tone={externalImportStatus.tone} text={externalImportStatus.text} /></div>}
                  {externalImportBatches.length ? (
                    <div className="external-import-list">
                      {externalImportBatches.map(batch => (
                        <div className="external-import-row" key={batch.id}>
                          <div>
                            <strong>{batch.original_filename || batch.provider_id}</strong>
                            <small>{batch.provider_id} | {externalImportTypeLabels[batch.import_type] || batch.import_type} | {formatDateTime(batch.created_at)}</small>
                            <div className="external-import-meta">
                              <span>Preparado: {batch.staged_by_name || "Usuario"}</span>
                              {batch.reviewed_at && <span>Revisado: {batch.reviewed_by_name || "Usuario"} | {formatDateTime(batch.reviewed_at)}</span>}
                              {batch.applied_at && <span>Aplicado: {batch.applied_by_name || "Usuario"} | {formatDateTime(batch.applied_at)}</span>}
                            </div>
                          </div>
                          <div className="external-import-counts">
                            <span>{batch.row_count} filas</span>
                            <span>{batch.error_count} errores</span>
                            <span>{batch.warning_count} avisos</span>
                            {batch.status === "applied" && <span>{batch.applied_count || 0} aplicadas</span>}
                          </div>
                          <StatusBadge tone={externalImportStatusTone(batch.status)} text={externalImportStatusLabels[batch.status] || batch.status} />
                          <div className="external-import-actions">
                            <button type="button" className="secondary" onClick={() => handleExternalImportPreview(batch)}>Previsualizar</button>
                            {canWriteExternalImports && (
                              (batch.import_type === "parties" && canWriteParties) ||
                              (batch.import_type === "accounts" && canWriteAccounts) ||
                              (batch.import_type === "maturities" && canWriteMaturities) ||
                              (batch.import_type === "bank_transactions" && canWriteBanks) ||
                              (batch.import_type === "journal_entries" && canWriteJournal)
                            ) && batch.status === "approved" && (
                              <button type="button" onClick={() => handleApplyExternalImportBatch(batch)}>
                                {batch.import_type === "accounts" ? "Aplicar cuentas" : batch.import_type === "maturities" ? "Aplicar vencimientos" : batch.import_type === "bank_transactions" ? "Aplicar movimientos" : batch.import_type === "journal_entries" ? "Aplicar borradores" : "Aplicar terceros"}
                              </button>
                            )}
                            {canWriteExternalImports && batch.status === "pending_review" && (
                              <>
                                <button type="button" disabled={Number(batch.error_count) > 0} onClick={() => startExternalImportReview(batch, "approve")}>Aprobar</button>
                                <button type="button" className="secondary" onClick={() => startExternalImportReview(batch, "reject")}>Rechazar</button>
                                <button type="button" className="secondary" onClick={() => startExternalImportReview(batch, "cancel")}>Cancelar</button>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyState title="Sin lotes staged" detail="Todavia no hay ficheros externos preparados para revision." />
                  )}
                  {externalImportPreview && (
                    <div className="external-import-preview">
                      <div className="external-import-preview-heading">
                        <div>
                          <strong>Vista previa del lote</strong>
                          <span>{externalImportPreview.batch.original_filename || externalImportPreview.batch.provider_id}</span>
                          <div className="external-import-meta">
                            <span>Preparado: {externalImportPreview.batch.staged_by_name || "Usuario"}</span>
                            {externalImportPreview.batch.reviewed_at && <span>Revisado: {externalImportPreview.batch.reviewed_by_name || "Usuario"} | {formatDateTime(externalImportPreview.batch.reviewed_at)}</span>}
                            {externalImportPreview.batch.applied_at && <span>Aplicado: {externalImportPreview.batch.applied_by_name || "Usuario"} | {formatDateTime(externalImportPreview.batch.applied_at)}</span>}
                          </div>
                        </div>
                        <button type="button" className="secondary" onClick={() => setExternalImportPreview(null)}>Cerrar</button>
                      </div>
                      {!externalImportPreview.supported ? (
                        <div className="scope-note">
                          Tipo no soportado todavia para preview: {externalImportPreview.reason || externalImportPreview.batch.import_type}
                        </div>
                      ) : (
                        <>
                          <div className="external-import-preview-summary">
                            <span>{externalImportPreview.summary.rows} filas</span>
                            <span>{externalImportPreview.summary.create} nuevas</span>
                            <span>{externalImportPreview.summary.conflict} conflictos</span>
                            <span>{externalImportPreview.summary.error} errores</span>
                          </div>
                          <div className="external-import-preview-list">
                            {externalImportPreview.rows.slice(0, 30).map(row => (
                              <div className="external-import-preview-row" key={row.row_id}>
                                <div>
                                  <strong>{externalImportPreviewTitle(row)}</strong>
                                  <small>{externalImportPreviewSubtitle(row)}</small>
                                  {row.lines?.length > 0 && (
                                    <div className="external-import-preview-lines">
                                      {row.lines.slice(0, 6).map(line => (
                                        <span className="external-import-preview-line" key={`${line.row_hash || line.row_id}-${line.row_number}`}>
                                          <strong>{line.account_code || "Cuenta pendiente"}</strong>
                                          <em>{line.side === "debit" ? "Debe" : "Haber"} {line.amount}</em>
                                          <small>{line.description || line.account_name || "-"}</small>
                                        </span>
                                      ))}
                                      {row.lines.length > 6 && <small>{row.lines.length - 6} linea(s) mas en el lote</small>}
                                    </div>
                                  )}
                                </div>
                                <StatusBadge
                                  tone={row.action === "create" ? "ok" : row.action === "conflict" ? "warning" : "danger"}
                                  text={row.action === "create" ? "Nueva" : row.action === "conflict" ? "Conflicto" : "Error"}
                                />
                                <small>{[...row.errors, ...row.warnings, ...row.conflicts].map(formatExternalImportIssue).filter(Boolean).join(" | ") || "Lista para siguiente fase"}</small>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {externalImportReview && (
                    <form className="period-action-form" onSubmit={handleExternalImportReview}>
                      <div>
                        <strong>{externalImportReview.action === "approve" ? "Aprobar lote" : externalImportReview.action === "reject" ? "Rechazar lote" : "Cancelar lote"}</strong>
                        <span>{externalImportReview.batch.original_filename || externalImportReview.batch.provider_id}</span>
                      </div>
                      <label>
                        <span>Motivo</span>
                        <input minLength={5} required value={externalImportReview.reason} onChange={e => setExternalImportReview(prev => ({ ...prev, reason: e.target.value }))} />
                      </label>
                      <div className="period-action-buttons">
                        <button type="submit">Confirmar</button>
                        <button type="button" className="secondary" onClick={() => setExternalImportReview(null)}>Cancelar</button>
                      </div>
                    </form>
                  )}
                </>
              )}
            </div>
            {integrationCatalog.data.length ? (
              <div className="integration-grid">
                {integrationCatalog.data.map(item => (
                  <article className="integration-card" key={item.id}>
                    <div className="integration-card-heading">
                      <div>
                        <span className="eyebrow">Prioridad {item.priority}</span>
                        <h3>{item.name}</h3>
                        <small>{item.vendor} | {integrationCategoryLabels[item.category] || item.category}</small>
                      </div>
                      <StatusBadge tone={integrationStatusTone(item.status)} text={integrationStatusLabels[item.status] || item.status} />
                    </div>
                    <div className="integration-mode">
                      <span>Modo definido por Superadmin</span>
                      <strong>{integrationModeLabels[item.recommended_mode] || item.recommended_mode}</strong>
                    </div>
                    <div className="integration-tags">
                      {item.connectors.map(connector => <span key={connector}>{connector}</span>)}
                    </div>
                    <p>{item.notes}</p>
                    <div className="integration-detail">
                      <strong>Flujos previstos</strong>
                      <small>{item.flows.join(", ")}</small>
                    </div>
                    <div className="integration-detail">
                      <strong>Riesgos</strong>
                      <small>{item.risks.join(", ")}</small>
                    </div>
                    <a href={item.source_url} target="_blank" rel="noreferrer">Fuente del proveedor</a>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState title="Sin conectores" detail="No hay conectores para los filtros actuales." />
            )}
          </section>
        )}

        {activeTab === "events" && (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Eventos internos</h2>
                <p>Monitorizacion administrativa del outbox contable. No muestra payloads completos.</p>
              </div>
              {outboxLoading && <StatusBadge tone="neutral" text="Cargando" />}
            </div>
            {!canReadOutbox ? (
              <EmptyState title="Sin permiso" detail="Este usuario no tiene permiso outbox.read." />
            ) : (
              <>
                <form className="audit-filters" onSubmit={handleOutboxFilter}>
                  <label>
                    <span>Estado</span>
                    <select
                      value={outboxFilters.status}
                      onChange={e => setOutboxFilters(prev => ({ ...prev, status: e.target.value }))}
                    >
                      <option value="">Todos</option>
                      <option value="pending">pending</option>
                      <option value="processing">processing</option>
                      <option value="retry">retry</option>
                      <option value="processed">processed</option>
                      <option value="failed">failed</option>
                    </select>
                  </label>
                  <label>
                    <span>Tipo de evento</span>
                    <input
                      value={outboxFilters.event_type}
                      onChange={e => setOutboxFilters(prev => ({ ...prev, event_type: e.target.value }))}
                      placeholder="AccountingPeriodClosed"
                    />
                  </label>
                  <label>
                    <span>Limite</span>
                    <select
                      value={outboxFilters.limit}
                      onChange={e => setOutboxFilters(prev => ({ ...prev, limit: Number(e.target.value) }))}
                    >
                      <option value={10}>10</option>
                      <option value={25}>25</option>
                      <option value={50}>50</option>
                      <option value={100}>100</option>
                    </select>
                  </label>
                  <button type="submit">Filtrar</button>
                </form>
                {outboxStatus && <div className="form-status"><StatusBadge tone={outboxStatus.tone} text={outboxStatus.text} /></div>}
                {outboxRows.length ? (
                  <div className="event-list">
                    {outboxRows.map(row => (
                      <div className="event-row" key={row.id}>
                        <div>
                          <strong>{row.event_type}</strong>
                          <span>{formatDateTime(row.occurred_at)} - v{row.schema_version}</span>
                        </div>
                        <div>
                          <StatusBadge tone={outboxStatusTone(row.status)} text={row.status} />
                          <span>Intentos: {row.attempts}</span>
                        </div>
                        <small>{row.last_error || `Hash: ${row.payload_hash || "-"}`}</small>
                        {row.status === "failed" && canRetryOutbox && (
                          <button onClick={() => setOutboxRetry({ event: row, reason: "" })}>Reintentar</button>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyState title="Sin eventos" detail="No hay eventos para los filtros actuales." />
                )}
                {outboxRetry && (
                  <form className="period-action-form" onSubmit={handleOutboxRetry}>
                    <div>
                      <strong>Reintentar evento</strong>
                      <span>{outboxRetry.event.event_type}</span>
                    </div>
                    <label>
                      <span>Motivo</span>
                      <input
                        value={outboxRetry.reason}
                        onChange={e => setOutboxRetry(prev => ({ ...prev, reason: e.target.value }))}
                        minLength={5}
                        required
                      />
                    </label>
                    <div className="period-action-buttons">
                      <button type="submit">Reintentar</button>
                      <button type="button" className="secondary" onClick={() => setOutboxRetry(null)}>Cancelar</button>
                    </div>
                  </form>
                )}
              </>
            )}
          </section>
        )}
      </main>
    </div>
  );
}

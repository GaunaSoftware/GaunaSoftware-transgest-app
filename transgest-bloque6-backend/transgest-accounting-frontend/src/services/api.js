const BASE = process.env.REACT_APP_ACCOUNTING_API_URL || "";
const TOKEN_KEY = "tg_accounting_token";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function parseResponse(res) {
  const type = res.headers.get("content-type") || "";
  if (type.includes("application/json")) return res.json().catch(() => ({}));
  const text = await res.text().catch(() => "");
  return text ? { error: text } : {};
}

export async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await parseResponse(res);
  if (!res.ok) {
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export async function downloadFile(path) {
  const token = getToken();
  const res = await fetch(`${BASE}/api/v1${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const data = await parseResponse(res);
    const err = new Error(data.error || `Error ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return {
    blob: await res.blob(),
    filename: filenameFromDisposition(res.headers.get("content-disposition")),
  };
}

function filenameFromDisposition(disposition) {
  const match = String(disposition || "").match(/filename="([^"]+)"/);
  return match?.[1] || null;
}

function buildQueryString(filters = {}, defaults = {}) {
  const params = new URLSearchParams(defaults);
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return params.toString();
}

function withQuery(path, filters = {}, defaults = {}) {
  const query = buildQueryString(filters, defaults);
  return query ? `${path}?${query}` : path;
}

export async function exchangeSsoToken(ssoToken) {
  const data = await apiFetch("/auth/sso/exchange", {
    method: "POST",
    body: { sso_token: ssoToken },
  });
  setToken(data.token);
  return data;
}

export const getMe = () => apiFetch("/auth/me");
export const getCompanies = () => apiFetch("/companies");
export const getDashboard = () => apiFetch("/dashboard");
export const getExternalIntegrations = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/external-integrations${suffix}`);
};

export const getAdvisorPackage = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/external-integrations/advisor-package${suffix}`);
};

export const downloadAdvisorPackageFile = path => downloadFile(path);
export const downloadAdvisorPackageZip = (filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return downloadFile(`/external-integrations/advisor-package.zip${suffix}`);
};

export function getExternalImportBatches(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/external-import-batches${suffix}`);
}

export function downloadExternalImportBatchesCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return downloadFile(`/external-import-batches?${params.toString()}`);
}

export const getExternalImportBatchPreview = (batchId, filters = {}) => {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/external-import-batches/${batchId}/preview${suffix}`);
};

export const createExternalImportBatch = data => apiFetch("/external-import-batches", {
  method: "POST",
  body: data,
});

export const updateExternalImportBatchStatus = (batchId, data) => apiFetch(`/external-import-batches/${batchId}/status`, {
  method: "PATCH",
  body: data,
});

export const applyExternalImportBatch = (batchId, data) => apiFetch(`/external-import-batches/${batchId}/apply`, {
  method: "POST",
  body: data,
});

export async function selectCompany(companyId) {
  const data = await apiFetch("/companies/select", {
    method: "POST",
    body: { company_id: companyId },
  });
  setToken(data.token);
  return data;
}

export const getFiscalYears = () => apiFetch("/fiscal-years");
export const openFiscalYear = (data) => apiFetch("/fiscal-years", { method: "POST", body: data });
export const getPeriods = () => apiFetch("/periods");
export const getPeriodCloseReadiness = periodId => apiFetch(`/periods/${periodId}/close-readiness`);
export const updatePeriodStatus = (periodId, data) => apiFetch(`/periods/${periodId}/status`, { method: "PATCH", body: data });

export function getAccounts(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/accounts${suffix}`);
}

export const createAccount = data => apiFetch("/accounts", { method: "POST", body: data });
export const updateAccountStatus = (accountId, data) => apiFetch(`/accounts/${accountId}/status`, {
  method: "PATCH",
  body: data,
});

export function getParties(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/parties${suffix}`);
}

export const createParty = data => apiFetch("/parties", { method: "POST", body: data });
export const updateParty = (partyId, data) => apiFetch(`/parties/${partyId}`, {
  method: "PUT",
  body: data,
});
export const updatePartyStatus = (partyId, data) => apiFetch(`/parties/${partyId}/status`, {
  method: "PATCH",
  body: data,
});
export function downloadPartiesCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  return downloadFile(`/parties?${params.toString()}`);
}

export function getMaturities(filters = {}) {
  return apiFetch(withQuery("/maturities", filters));
}

export const createMaturity = data => apiFetch("/maturities", { method: "POST", body: data });
export const updateMaturityStatus = (maturityId, data) => apiFetch(`/maturities/${maturityId}/status`, {
  method: "PATCH",
  body: data,
});

export function downloadMaturitiesCsv(filters = {}) {
  return downloadFile(withQuery("/maturities", filters, { format: "csv" }));
}

export function getFixedAssets(filters = {}) {
  return apiFetch(withQuery("/fixed-assets", filters));
}

export const createFixedAsset = data => apiFetch("/fixed-assets", { method: "POST", body: data });
export const createFixedAssetDepreciationDraft = (assetId, data) => apiFetch(`/fixed-assets/${assetId}/depreciation-runs`, {
  method: "POST",
  body: data,
});
export const cancelFixedAssetDepreciationDraft = (runId, data) => apiFetch(`/fixed-assets/depreciation-runs/${runId}/cancel`, {
  method: "POST",
  body: data,
});
export const createFixedAssetDisposalDraft = (assetId, data) => apiFetch(`/fixed-assets/${assetId}/disposal-draft`, {
  method: "POST",
  body: data,
});
export const updateFixedAssetStatus = (assetId, data) => apiFetch(`/fixed-assets/${assetId}/status`, {
  method: "PATCH",
  body: data,
});
export const getFixedAssetDisposalReadiness = assetId => apiFetch(`/fixed-assets/${assetId}/disposal-readiness`);
export const getFixedAssetDepreciationPlan = assetId => apiFetch(`/fixed-assets/${assetId}/depreciation-plan`);

export function downloadFixedAssetsCsv(filters = {}) {
  return downloadFile(withQuery("/fixed-assets", filters, { format: "csv" }));
}

export function getBankAccounts(filters = {}) {
  return apiFetch(withQuery("/bank-accounts", filters));
}

export const createBankAccount = data => apiFetch("/bank-accounts", { method: "POST", body: data });

export function getBankTransactions(filters = {}) {
  return apiFetch(withQuery("/bank-transactions", filters));
}

export const createBankTransaction = data => apiFetch("/bank-transactions", { method: "POST", body: data });
export const updateBankTransactionStatus = (transactionId, data) => apiFetch(`/bank-transactions/${transactionId}/status`, {
  method: "PATCH",
  body: data,
});
export const importBankStatementCsv = data => apiFetch("/bank-statement-imports", { method: "POST", body: data });
export function getBankStatementImports(filters = {}) {
  return apiFetch(withQuery("/bank-statement-imports", filters));
}
export function getBankReconciliationSuggestions(transactionId, filters = {}) {
  return apiFetch(withQuery(`/bank-transactions/${transactionId}/reconciliation-suggestions`, filters));
}
export const reconcileBankTransaction = (transactionId, data) => apiFetch(`/bank-transactions/${transactionId}/reconcile`, {
  method: "POST",
  body: data,
});
export const reverseBankReconciliation = (reconciliationId, data) => apiFetch(`/bank-reconciliations/${reconciliationId}/reverse`, {
  method: "POST",
  body: data,
});

export function downloadBankTransactionsCsv(filters = {}) {
  return downloadFile(withQuery("/bank-transactions", filters, { format: "csv" }));
}
export const getChartTemplates = () => apiFetch("/chart-templates");
export const createChartTemplateFromFiscalYear = data => apiFetch("/chart-templates/from-fiscal-year", {
  method: "POST",
  body: data,
});
export const previewChartTemplate = (templateId, fiscalYearId) => apiFetch(
  `/chart-templates/${templateId}/preview?fiscal_year_id=${encodeURIComponent(fiscalYearId)}`
);
export const importChartTemplate = (templateId, data) => apiFetch(`/chart-templates/${templateId}/import`, {
  method: "POST",
  body: data,
});

export function getJournalEntries(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/journal-entries${suffix}`);
}
export function downloadJournalEntriesCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return downloadFile(`/journal-entries?${params.toString()}`);
}
export const getJournalEntry = entryId => apiFetch(`/journal-entries/${entryId}`);
export const createJournalDraft = data => apiFetch("/journal-entries/drafts", { method: "POST", body: data });
export const updateJournalDraft = (entryId, data) => apiFetch(`/journal-entries/${entryId}/draft`, {
  method: "PUT",
  body: data,
});
export const postJournalEntry = (entryId, idempotencyKey) => apiFetch(`/journal-entries/${entryId}/post`, {
  method: "POST",
  body: { idempotency_key: idempotencyKey },
});
export const cancelJournalEntry = (entryId, reason) => apiFetch(`/journal-entries/${entryId}/cancel`, {
  method: "POST",
  body: { reason },
});
export const createJournalReversalDraft = (entryId, data) => apiFetch(`/journal-entries/${entryId}/reverse`, {
  method: "POST",
  body: data,
});

export function getLedgerAccount(accountId, filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/ledger/accounts/${accountId}${suffix}`);
}

export function downloadLedgerAccountCsv(accountId, filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return downloadFile(`/ledger/accounts/${accountId}?${params.toString()}`);
}

export function getTrialBalance(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/reports/trial-balance${suffix}`);
}

export function downloadTrialBalanceCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return downloadFile(`/reports/trial-balance?${params.toString()}`);
}

export function getBalanceSheet(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/reports/balance-sheet${suffix}`);
}

export function getProfitLoss(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/reports/profit-loss${suffix}`);
}

export function downloadBalanceSheetCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return downloadFile(`/reports/balance-sheet?${params.toString()}`);
}

export function downloadProfitLossCsv(filters = {}) {
  const params = new URLSearchParams({ format: "csv" });
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) params.set(key, String(value).trim());
  });
  return downloadFile(`/reports/profit-loss?${params.toString()}`);
}

export function getAuditLog(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/audit-log${suffix}`);
}

export function getOutboxEvents(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch(`/outbox-events${suffix}`);
}

export const retryOutboxEvent = (eventId, reason) => apiFetch(`/outbox-events/${eventId}/retry`, {
  method: "POST",
  body: { reason },
});

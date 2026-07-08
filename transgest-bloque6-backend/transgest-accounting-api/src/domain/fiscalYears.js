function parseIsoDate(value, fieldName) {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error(`${fieldName} debe tener formato YYYY-MM-DD`);
    err.status = 400;
    throw err;
  }
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    const err = new Error(`${fieldName} no es una fecha valida`);
    err.status = 400;
    throw err;
  }
  return date;
}

function formatIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function endOfUtcMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function normalizeFiscalYearInput(input = {}) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const startDate = parseIsoDate(input.start_date || `${currentYear}-01-01`, "start_date");
  const endDate = parseIsoDate(input.end_date || `${startDate.getUTCFullYear()}-12-31`, "end_date");
  if (startDate > endDate) {
    const err = new Error("start_date debe ser anterior o igual a end_date");
    err.status = 400;
    throw err;
  }
  const yearLabel = String(input.year_label || startDate.getUTCFullYear()).trim();
  if (!yearLabel || yearLabel.length > 20) {
    const err = new Error("year_label es obligatorio y no puede superar 20 caracteres");
    err.status = 400;
    throw err;
  }
  return {
    year_label: yearLabel,
    start_date: formatIsoDate(startDate),
    end_date: formatIsoDate(endDate),
  };
}

function buildMonthlyPeriods(startDateValue, endDateValue) {
  const startDate = parseIsoDate(startDateValue, "start_date");
  const endDate = parseIsoDate(endDateValue, "end_date");
  const periods = [];
  let cursor = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1));
  let periodNumber = 1;

  while (cursor <= endDate) {
    const monthStart = cursor < startDate ? startDate : cursor;
    const naturalMonthEnd = endOfUtcMonth(cursor);
    const monthEnd = naturalMonthEnd > endDate ? endDate : naturalMonthEnd;
    if (monthStart <= monthEnd) {
      const label = monthStart.toLocaleString("es-ES", { month: "long", timeZone: "UTC" });
      periods.push({
        period_number: periodNumber,
        name: `${label.charAt(0).toUpperCase()}${label.slice(1)} ${monthStart.getUTCFullYear()}`,
        start_date: formatIsoDate(monthStart),
        end_date: formatIsoDate(monthEnd),
      });
      periodNumber += 1;
    }
    cursor = addUtcMonths(cursor, 1);
  }
  return periods;
}

function normalizeFiscalYearStatusReason(reason) {
  const text = String(reason || "").trim();
  if (text.length < 5 || text.length > 300) {
    const err = new Error("reason debe tener entre 5 y 300 caracteres");
    err.status = 400;
    throw err;
  }
  return text;
}

function validateFiscalYearStatusChange(fiscalYear = {}, action, reason) {
  const normalizedAction = String(action || "").trim().toLowerCase();
  if (!["close", "reopen"].includes(normalizedAction)) {
    const err = new Error("Accion de ejercicio no soportada");
    err.status = 400;
    throw err;
  }
  if (normalizedAction === "close" && fiscalYear.status !== "open") {
    const err = new Error(`No se puede cerrar un ejercicio en estado ${fiscalYear.status}`);
    err.status = 409;
    throw err;
  }
  if (normalizedAction === "reopen" && fiscalYear.status !== "closed") {
    const err = new Error(`No se puede reabrir un ejercicio en estado ${fiscalYear.status}`);
    err.status = 409;
    throw err;
  }
  return {
    action: normalizedAction,
    previous_status: fiscalYear.status,
    target_status: normalizedAction === "close" ? "closed" : "open",
    audit_action: normalizedAction === "close" ? "fiscal_year.closed" : "fiscal_year.reopened",
    event_type: normalizedAction === "close" ? "AccountingFiscalYearClosed" : "AccountingFiscalYearReopened",
    reason: normalizeFiscalYearStatusReason(reason),
  };
}

function buildFiscalYearCloseReadiness(stats = {}) {
  const openPeriods = Number(stats.open_periods || 0);
  const lockedPeriods = Number(stats.locked_periods || 0);
  const draftJournalEntries = Number(stats.draft_journal_entries || 0);
  const pendingDepreciationDrafts = Number(stats.pending_depreciation_drafts || 0);
  const pendingDepreciationReversals = Number(stats.pending_depreciation_reversals || 0);
  const blockers = [];
  if (openPeriods > 0) blockers.push(`${openPeriods} periodo(s) abierto(s)`);
  if (lockedPeriods > 0) blockers.push(`${lockedPeriods} periodo(s) bloqueado(s)`);
  if (draftJournalEntries > 0) blockers.push(`${draftJournalEntries} asiento(s) en borrador`);
  if (pendingDepreciationDrafts > 0) blockers.push(`${pendingDepreciationDrafts} amortizacion(es) en borrador`);
  if (pendingDepreciationReversals > 0) blockers.push(`${pendingDepreciationReversals} reverso(s) de amortizacion pendiente(s)`);
  return {
    ready: blockers.length === 0,
    blockers,
    counts: {
      open_periods: openPeriods,
      locked_periods: lockedPeriods,
      draft_journal_entries: draftJournalEntries,
      pending_depreciation_drafts: pendingDepreciationDrafts,
      pending_depreciation_reversals: pendingDepreciationReversals,
    },
    disclaimer: "Comprobacion operativa interna para cierre de ejercicio. No genera regularizacion ni sustituye revision contable, fiscal o legal.",
  };
}

function ensureFiscalYearOpen(fiscalYear = {}, action = "operar") {
  if (fiscalYear.status !== "open") {
    const err = new Error(`No se puede ${action}: el ejercicio ${fiscalYear.year_label || fiscalYear.id || ""} no esta abierto`);
    err.status = 409;
    throw err;
  }
  return fiscalYear;
}

module.exports = {
  buildFiscalYearCloseReadiness,
  buildMonthlyPeriods,
  ensureFiscalYearOpen,
  normalizeFiscalYearInput,
  validateFiscalYearStatusChange,
};

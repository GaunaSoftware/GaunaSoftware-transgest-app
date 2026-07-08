const PERIOD_STATUSES = ["open", "locked", "closed"];

const ACTIONS = {
  lock: {
    target_status: "locked",
    event_type: "AccountingPeriodLocked",
    audit_action: "period.locked",
    permission: "periods.write",
  },
  unlock: {
    target_status: "open",
    event_type: "AccountingPeriodUnlocked",
    audit_action: "period.unlocked",
    permission: "periods.write",
  },
  close: {
    target_status: "closed",
    event_type: "AccountingPeriodClosed",
    audit_action: "period.closed",
    permission: "periods.write",
  },
  reopen: {
    target_status: "open",
    event_type: "AccountingPeriodReopened",
    audit_action: "period.reopened",
    permission: "periods.reopen",
  },
};

const ALLOWED_TRANSITIONS = {
  open: ["lock", "close"],
  locked: ["unlock", "close"],
  closed: ["reopen"],
};

function normalizeReason(reason) {
  return String(reason || "").trim();
}

function getPeriodAction(action) {
  const normalized = String(action || "").trim().toLowerCase();
  return ACTIONS[normalized] ? { action: normalized, ...ACTIONS[normalized] } : null;
}

function validatePeriodStatusChange(period, action, reason) {
  const definition = getPeriodAction(action);
  if (!definition) {
    const err = new Error("Accion de periodo no soportada");
    err.status = 400;
    throw err;
  }

  if (!PERIOD_STATUSES.includes(period?.status)) {
    const err = new Error("Estado de periodo no soportado");
    err.status = 400;
    throw err;
  }

  const allowed = ALLOWED_TRANSITIONS[period.status] || [];
  if (!allowed.includes(definition.action)) {
    const err = new Error(`No se puede ejecutar ${definition.action} desde estado ${period.status}`);
    err.status = 409;
    throw err;
  }

  const normalizedReason = normalizeReason(reason);
  if (normalizedReason.length < 5) {
    const err = new Error("El motivo debe tener al menos 5 caracteres");
    err.status = 400;
    throw err;
  }

  return {
    ...definition,
    reason: normalizedReason,
    previous_status: period.status,
  };
}

function buildPeriodCloseReadiness(stats = {}) {
  const draftJournalEntries = Number(stats.draft_journal_entries || 0);
  const pendingDepreciationDrafts = Number(stats.pending_depreciation_drafts || 0);
  const pendingDepreciationReversals = Number(stats.pending_depreciation_reversals || 0);
  const blockers = [];
  if (draftJournalEntries > 0) blockers.push(`${draftJournalEntries} asiento(s) en borrador`);
  if (pendingDepreciationDrafts > 0) blockers.push(`${pendingDepreciationDrafts} amortizacion(es) en borrador`);
  if (pendingDepreciationReversals > 0) blockers.push(`${pendingDepreciationReversals} reverso(s) de amortizacion pendiente(s)`);
  return {
    ready: blockers.length === 0,
    blockers,
    counts: {
      draft_journal_entries: draftJournalEntries,
      pending_depreciation_drafts: pendingDepreciationDrafts,
      pending_depreciation_reversals: pendingDepreciationReversals,
    },
    disclaimer: "Comprobacion operativa interna para cierre de periodo. No sustituye revision contable, fiscal ni legal.",
  };
}

function ensurePeriodOpen(period = {}, action = "operar") {
  if (period.status !== "open") {
    const err = new Error(`No se puede ${action}: el periodo ${period.name || period.id || ""} no esta abierto`);
    err.status = 409;
    throw err;
  }
  return period;
}

module.exports = {
  PERIOD_STATUSES,
  buildPeriodCloseReadiness,
  ensurePeriodOpen,
  getPeriodAction,
  validatePeriodStatusChange,
};

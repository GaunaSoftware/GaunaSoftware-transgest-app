const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildFiscalYearCloseReadiness,
  validateFiscalYearStatusChange,
} = require("../src/domain/fiscalYears");
const { buildPeriodCloseReadiness, getPeriodAction, validatePeriodStatusChange } = require("../src/domain/periods");

test("acciones de periodo exponen permiso y evento esperado", () => {
  assert.equal(getPeriodAction("lock").permission, "periods.write");
  assert.equal(getPeriodAction("lock").event_type, "AccountingPeriodLocked");
  assert.equal(getPeriodAction("reopen").permission, "periods.reopen");
  assert.equal(getPeriodAction("reopen").event_type, "AccountingPeriodReopened");
});

test("periodo abierto puede bloquearse con motivo", () => {
  const change = validatePeriodStatusChange({ status: "open" }, "lock", "Cierre operativo");
  assert.equal(change.target_status, "locked");
  assert.equal(change.previous_status, "open");
  assert.equal(change.reason, "Cierre operativo");
});

test("periodo bloqueado puede cerrarse", () => {
  const change = validatePeriodStatusChange({ status: "locked" }, "close", "Cierre mensual");
  assert.equal(change.target_status, "closed");
});

test("periodo cerrado no puede bloquearse directamente", () => {
  assert.throws(
    () => validatePeriodStatusChange({ status: "closed" }, "lock", "Cierre mensual"),
    /No se puede ejecutar/
  );
});

test("reabrir periodo cerrado requiere motivo suficiente", () => {
  assert.throws(
    () => validatePeriodStatusChange({ status: "closed" }, "reopen", "abc"),
    /al menos 5/
  );
  const change = validatePeriodStatusChange({ status: "closed" }, "reopen", "Revision asesor");
  assert.equal(change.target_status, "open");
});

test("buildPeriodCloseReadiness bloquea cierre con borradores pendientes", () => {
  const readiness = buildPeriodCloseReadiness({
    draft_journal_entries: "2",
    pending_depreciation_drafts: 1,
    pending_depreciation_reversals: 0,
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.counts, {
    draft_journal_entries: 2,
    pending_depreciation_drafts: 1,
    pending_depreciation_reversals: 0,
  });
  assert.ok(readiness.blockers.some(item => item.includes("asiento")));
  assert.ok(readiness.blockers.some(item => item.includes("amortizacion")));
  assert.equal(buildPeriodCloseReadiness({}).ready, true);
});

test("ejercicio solo cierra abierto y exige todos los periodos cerrados", () => {
  const close = validateFiscalYearStatusChange({ status: "open" }, "close", "Cierre ejercicio");
  assert.equal(close.target_status, "closed");
  assert.equal(close.event_type, "AccountingFiscalYearClosed");
  const reopen = validateFiscalYearStatusChange({ status: "closed" }, "reopen", "Revision asesor");
  assert.equal(reopen.target_status, "open");
  assert.equal(reopen.event_type, "AccountingFiscalYearReopened");
  assert.throws(() => validateFiscalYearStatusChange({ status: "open" }, "reopen", "Revision asesor"), /No se puede reabrir/);

  const readiness = buildFiscalYearCloseReadiness({
    open_periods: 1,
    locked_periods: 2,
    draft_journal_entries: 3,
    pending_depreciation_drafts: 0,
    pending_depreciation_reversals: 1,
  });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.counts.open_periods, 1);
  assert.ok(readiness.blockers.some(item => item.includes("periodo")));
  assert.ok(readiness.blockers.some(item => item.includes("asiento")));
  assert.equal(buildFiscalYearCloseReadiness({}).ready, true);
});

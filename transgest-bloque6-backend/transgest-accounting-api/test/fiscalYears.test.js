const test = require("node:test");
const assert = require("node:assert/strict");
const { buildMonthlyPeriods, normalizeFiscalYearInput } = require("../src/domain/fiscalYears");

test("normalizeFiscalYearInput aplica defaults de ejercicio natural", () => {
  const input = normalizeFiscalYearInput({ start_date: "2026-01-01" });
  assert.equal(input.year_label, "2026");
  assert.equal(input.start_date, "2026-01-01");
  assert.equal(input.end_date, "2026-12-31");
});

test("buildMonthlyPeriods genera 12 periodos mensuales para ejercicio natural", () => {
  const periods = buildMonthlyPeriods("2026-01-01", "2026-12-31");
  assert.equal(periods.length, 12);
  assert.equal(periods[0].period_number, 1);
  assert.equal(periods[0].start_date, "2026-01-01");
  assert.equal(periods[0].end_date, "2026-01-31");
  assert.equal(periods[11].period_number, 12);
  assert.equal(periods[11].start_date, "2026-12-01");
  assert.equal(periods[11].end_date, "2026-12-31");
});

test("buildMonthlyPeriods acota periodos en ejercicios partidos", () => {
  const periods = buildMonthlyPeriods("2026-04-15", "2026-06-10");
  assert.deepEqual(periods.map(p => [p.start_date, p.end_date]), [
    ["2026-04-15", "2026-04-30"],
    ["2026-05-01", "2026-05-31"],
    ["2026-06-01", "2026-06-10"],
  ]);
});

test("normalizeFiscalYearInput rechaza fechas invalidas", () => {
  assert.throws(() => normalizeFiscalYearInput({ start_date: "2026-02-31" }), /fecha valida/);
  assert.throws(() => normalizeFiscalYearInput({ start_date: "2026-12-31", end_date: "2026-01-01" }), /anterior/);
});

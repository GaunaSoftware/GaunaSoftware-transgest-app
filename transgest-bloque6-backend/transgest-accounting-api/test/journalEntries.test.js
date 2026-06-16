const test = require("node:test");
const assert = require("node:assert/strict");
const {
  assertBalancedJournal,
  journalDraftRequestHash,
  moneyToUnits,
  normalizeCancellationReason,
  normalizeJournalDraftInput,
  normalizeJournalDraftUpdateInput,
  normalizeJournalQuery,
  normalizeJournalReversalInput,
  summarizeJournalLines,
  unitsToMoney,
} = require("../src/domain/journalEntries");

test("normaliza borrador manual con precision decimal exacta", () => {
  const input = normalizeJournalDraftInput({
    fiscal_year_id: "year-id",
    entry_date: "2026-06-04",
    description: "Aportacion inicial",
    idempotency_key: "draft:2026:0001",
    lines: [
      { account_id: "account-1", side: "debit", amount: "1000,25" },
      { account_id: "account-2", side: "credit", amount: "1000.250000" },
    ],
  });
  assert.equal(input.lines[0].amount, "1000.250000");
  assert.equal(summarizeJournalLines(input.lines).balanced, true);
  assert.match(journalDraftRequestHash(input), /^[a-f0-9]{64}$/);
});

test("hash de borrador cambia cuando cambia el contenido pero no por campos ajenos", () => {
  const input = normalizeJournalDraftInput({
    fiscal_year_id: "year-id",
    entry_date: "2026-06-04",
    description: "Aportacion inicial",
    idempotency_key: "draft:2026:hash1",
    lines: [
      { account_id: "account-1", side: "debit", amount: "10" },
      { account_id: "account-2", side: "credit", amount: "10" },
    ],
  });
  assert.equal(journalDraftRequestHash(input), journalDraftRequestHash({ ...input, ignored: true }));
  assert.notEqual(journalDraftRequestHash(input), journalDraftRequestHash({
    ...input,
    description: "Otro contenido",
  }));
});

test("normaliza edicion de borrador sin cambiar ejercicio ni idempotencia", () => {
  const input = normalizeJournalDraftUpdateInput({
    entry_date: "2026-06-05",
    description: "Borrador ajustado",
    lines: [
      { account_id: "account-1", side: "debit", amount: "3" },
      { account_id: "account-2", side: "credit", amount: "3" },
    ],
  }, "year-id", "draft:2026:update1");
  assert.equal(input.entry_date, "2026-06-05");
  assert.equal(input.description, "Borrador ajustado");
  assert.equal(input.lines[0].amount, "3.000000");
  assert.equal(input.fiscal_year_id, undefined);
  assert.equal(input.idempotency_key, undefined);
});

test("normaliza solicitud de reverso con fecha, motivo e idempotencia", () => {
  const input = normalizeJournalReversalInput({
    entry_date: "2026-06-30",
    reason: "Correccion de asiento duplicado",
    idempotency_key: "journal-reverse:entry-1",
  });
  assert.deepEqual(input, {
    entry_date: "2026-06-30",
    reason: "Correccion de asiento duplicado",
    idempotency_key: "journal-reverse:entry-1",
  });
  assert.throws(() => normalizeJournalReversalInput({ entry_date: "2026-02-31", reason: "Correcto", idempotency_key: "journal-reverse:x" }), /fecha/);
  assert.throws(() => normalizeJournalReversalInput({ entry_date: "2026-06-30", reason: "x", idempotency_key: "journal-reverse:x" }), /reason/);
});

test("conversion monetaria conserva seis decimales sin float", () => {
  assert.equal(moneyToUnits("123.000001"), 123000001n);
  assert.equal(unitsToMoney(123000001n), "123.000001");
});

test("rechaza importes no positivos, demasiados decimales y fechas invalidas", () => {
  assert.throws(() => moneyToUnits("0"), /mayor que cero/);
  assert.throws(() => moneyToUnits("1.0000001"), /hasta 6 decimales/);
  assert.throws(() => normalizeJournalDraftInput({
    fiscal_year_id: "year-id",
    entry_date: "2026-02-31",
    description: "Asiento",
    idempotency_key: "draft:2026:0002",
    lines: [{}, {}],
  }), /fecha valida/);
});

test("contabilizacion rechaza asiento descuadrado", () => {
  assert.throws(() => assertBalancedJournal([
    { account_id: "a", debit_amount: "10.000000", credit_amount: "0" },
    { account_id: "b", debit_amount: "0", credit_amount: "9.000000" },
  ]), /descuadrado/);
  const summary = assertBalancedJournal([
    { account_id: "a", debit_amount: "10.000000", credit_amount: "0" },
    { account_id: "b", debit_amount: "0", credit_amount: "10.000000" },
  ]);
  assert.equal(summary.total_debit, "10.000000");
});

test("filtros de diario limitan estado y cantidad", () => {
  const filters = normalizeJournalQuery({
    status: "cancelled",
    limit: "900",
    date_from: "2026-01-01",
    date_to: "2026-01-31",
    q: " ajuste cierre ".repeat(20),
    format: "csv",
  });
  assert.deepEqual({
    ...filters,
    q: filters.q.slice(0, 13),
    q_length: filters.q.length,
  }, {
    fiscal_year_id: null,
    status: "cancelled",
    date_from: "2026-01-01",
    date_to: "2026-01-31",
    q: "ajuste cierre",
    q_length: 140,
    format: "csv",
    limit: 200,
  });
  assert.throws(() => normalizeJournalQuery({ status: "deleted" }), /no soportado/);
  assert.throws(() => normalizeJournalQuery({ date_from: "2026-02-01", date_to: "2026-01-31" }), /posterior/);
  assert.throws(() => normalizeJournalQuery({ format: "pdf" }), /format/);
});

test("cancelacion de borrador exige motivo suficiente", () => {
  assert.equal(normalizeCancellationReason(" Error de captura "), "Error de captura");
  assert.throws(() => normalizeCancellationReason("x"), /reason/);
});

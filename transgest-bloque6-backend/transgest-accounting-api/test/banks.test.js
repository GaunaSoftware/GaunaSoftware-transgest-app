const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeBankAccountInput,
  normalizeBankAccountQuery,
  normalizeBankReconciliationInput,
  normalizeBankReconciliationSuggestionQuery,
  normalizeBankReconciliationVoidInput,
  normalizeBankStatementImportInput,
  normalizeBankStatementImportQuery,
  normalizeBankTransactionInput,
  normalizeBankTransactionQuery,
  normalizeBankTransactionStatusInput,
  parseBankStatementCsv,
  scoreBankReconciliationCandidate,
} = require("../src/domain/banks");

test("normalizeBankAccountInput prepara una cuenta bancaria manual", () => {
  assert.deepEqual(normalizeBankAccountInput({
    name: "Banco principal",
    bank_name: "Banco Demo",
    iban: " ES12 3456 7890 1234 5678 9012 ",
    currency: "eur",
    opening_balance: "1200,50",
  }), {
    account_id: null,
    name: "Banco principal",
    bank_name: "Banco Demo",
    iban: "ES1234567890123456789012",
    swift_bic: null,
    currency: "EUR",
    opening_balance: "1200.500000",
    notes: null,
  });
});

test("normalizeBankAccountInput rechaza moneda e IBAN invalidos", () => {
  assert.throws(() => normalizeBankAccountInput({ name: "Banco", currency: "EURO" }), /currency/);
  assert.throws(() => normalizeBankAccountInput({ name: "Banco", iban: "123" }), /iban/);
});

test("normalizeBankTransactionInput prepara movimiento bancario", () => {
  assert.deepEqual(normalizeBankTransactionInput({
    bank_account_id: "bank-id",
    transaction_date: "2026-06-11",
    value_date: "2026-06-12",
    description: "Cobro transferencia",
    reference: "TRF-1",
    counterparty_name: "Cliente Demo",
    amount: "321,45",
    direction: "inflow",
  }), {
    bank_account_id: "bank-id",
    transaction_date: "2026-06-11",
    value_date: "2026-06-12",
    description: "Cobro transferencia",
    reference: "TRF-1",
    counterparty_name: "Cliente Demo",
    amount: "321.450000",
    direction: "inflow",
    source_system: "accounting",
    source_type: "manual",
    source_id: null,
    notes: null,
  });
});

test("normalizeBankTransactionInput rechaza direccion, fecha e importe invalidos", () => {
  assert.throws(() => normalizeBankTransactionInput({ bank_account_id: "b", transaction_date: "2026-06-11", description: "x", amount: "1", direction: "bad" }), /direction/);
  assert.throws(() => normalizeBankTransactionInput({ bank_account_id: "b", transaction_date: "2026-99-11", description: "x", amount: "1", direction: "inflow" }), /fecha valida/);
  assert.throws(() => normalizeBankTransactionInput({ bank_account_id: "b", transaction_date: "2026-06-11", description: "x", amount: "0", direction: "inflow" }), /mayor que cero/);
});

test("normalizeBankTransactionQuery limita filtros y formatos", () => {
  assert.deepEqual(normalizeBankTransactionQuery({
    bank_account_id: "bank-id",
    direction: "outflow",
    status: "unmatched",
    date_from: "2026-01-01",
    date_to: "2026-12-31",
    q: " banco ",
    format: "csv",
    limit: "900",
  }), {
    bank_account_id: "bank-id",
    direction: "outflow",
    status: "unmatched",
    date_from: "2026-01-01",
    date_to: "2026-12-31",
    q: "banco",
    format: "csv",
    limit: 500,
  });
  assert.throws(() => normalizeBankTransactionQuery({ status: "reconciled" }), /status/);
  assert.throws(() => normalizeBankTransactionQuery({ format: "pdf" }), /format/);
});

test("normalizeBankTransactionStatusInput controla ignorar y reabrir", () => {
  assert.deepEqual(normalizeBankTransactionStatusInput({
    action: "ignore",
    reason: "Movimiento no conciliable",
  }), {
    action: "ignore",
    reason: "Movimiento no conciliable",
  });
  assert.deepEqual(normalizeBankTransactionStatusInput({
    action: "reopen",
    reason: "Reabrir para conciliar",
  }), {
    action: "reopen",
    reason: "Reabrir para conciliar",
  });
  assert.throws(() => normalizeBankTransactionStatusInput({ action: "match", reason: "Motivo valido" }), /action/);
  assert.throws(() => normalizeBankTransactionStatusInput({ action: "ignore", reason: "no" }), /reason/);
});

test("normalizeBankAccountQuery acota busqueda", () => {
  assert.deepEqual(normalizeBankAccountQuery({ q: " principal ", active: "true", limit: "0" }), {
    q: "principal",
    active: true,
    limit: 1,
  });
});

test("normalizeBankReconciliationInput exige vencimiento y motivo", () => {
  assert.deepEqual(normalizeBankReconciliationInput({
    maturity_id: "maturity-id",
    reason: "Cobro identificado",
  }), {
    maturity_id: "maturity-id",
    reason: "Cobro identificado",
  });
  assert.throws(() => normalizeBankReconciliationInput({ maturity_id: "maturity-id", reason: "no" }), /reason/);
  assert.throws(() => normalizeBankReconciliationInput({ reason: "Cobro identificado" }), /maturity_id/);
});

test("normalizeBankReconciliationVoidInput exige motivo suficiente", () => {
  assert.deepEqual(normalizeBankReconciliationVoidInput({ reason: "Error de conciliacion manual" }), {
    reason: "Error de conciliacion manual",
  });
  assert.throws(() => normalizeBankReconciliationVoidInput({ reason: "no" }), /reason/);
});

test("normalizeBankReconciliationSuggestionQuery acota busqueda asistida", () => {
  assert.deepEqual(normalizeBankReconciliationSuggestionQuery({ limit: "99", days_window: "999" }), {
    limit: 20,
    days_window: 120,
  });
  assert.deepEqual(normalizeBankReconciliationSuggestionQuery({ limit: "0", days_window: "-2" }), {
    limit: 1,
    days_window: 0,
  });
});

test("scoreBankReconciliationCandidate puntua coincidencias exactas y texto", () => {
  const scoring = scoreBankReconciliationCandidate({
    direction: "inflow",
    transaction_date: new Date("2026-06-12T00:00:00.000Z"),
    description: "Transferencia Factura F-2026-18 Cliente Norte",
    reference: "F-2026-18",
    counterparty_name: "Cliente Norte",
    amount: "123.450000",
  }, {
    direction: "receivable",
    status: "pending",
    due_date: "2026-06-13",
    description: "Factura F-2026-18",
    document_ref: "F-2026-18",
    party_name: "Cliente Norte",
    open_amount: "123.450000",
  });
  assert.ok(scoring.score >= 90);
  assert.ok(scoring.reasons.includes("Importe exacto"));
  assert.ok(scoring.reasons.includes("Contraparte coincide"));
});

test("scoreBankReconciliationCandidate rechaza candidatos incompatibles", () => {
  assert.equal(scoreBankReconciliationCandidate({
    direction: "outflow",
    transaction_date: "2026-06-12",
    description: "Pago",
    amount: "50.000000",
  }, {
    direction: "receivable",
    status: "pending",
    due_date: "2026-06-12",
    description: "Cobro",
    open_amount: "50.000000",
  }).score, 0);
  assert.equal(scoreBankReconciliationCandidate({
    direction: "outflow",
    transaction_date: "2026-06-12",
    description: "Pago",
    amount: "50.000000",
  }, {
    direction: "payable",
    status: "pending",
    due_date: "2026-06-12",
    description: "Pago",
    open_amount: "51.000000",
  }).score, 0);
});

test("normalizeBankStatementImportInput exige cuenta y texto CSV", () => {
  assert.deepEqual(normalizeBankStatementImportInput({
    bank_account_id: "bank-id",
    filename: "extracto.csv",
    csv_text: "fecha;descripcion;importe\n2026-06-12;Cobro;10,50",
  }), {
    bank_account_id: "bank-id",
    filename: "extracto.csv",
    csv_text: "fecha;descripcion;importe\n2026-06-12;Cobro;10,50",
  });
  assert.throws(() => normalizeBankStatementImportInput({ csv_text: "x" }), /bank_account_id/);
  assert.throws(() => normalizeBankStatementImportInput({ bank_account_id: "bank-id" }), /csv_text/);
});

test("normalizeBankStatementImportQuery limita historial de importaciones", () => {
  assert.deepEqual(normalizeBankStatementImportQuery({
    bank_account_id: " bank-id ",
    limit: "900",
  }), {
    bank_account_id: "bank-id",
    limit: 100,
  });
  assert.deepEqual(normalizeBankStatementImportQuery({ limit: "0" }), {
    bank_account_id: null,
    limit: 1,
  });
});

test("parseBankStatementCsv normaliza extracto CSV bancario", () => {
  const parsed = parseBankStatementCsv([
    "fecha;fecha_valor;concepto;referencia;contraparte;importe;tipo",
    "2026-06-12;2026-06-13;Cobro cliente;TRF-1;Cliente Norte;1.234,56;",
    "2026-06-14;;Pago gasoil;CARD-1;Estacion;-45,67;",
  ].join("\n"));
  assert.equal(parsed.row_count, 2);
  assert.deepEqual(parsed.errors, []);
  assert.deepEqual(parsed.rows.map(row => ({
    transaction_date: row.transaction_date,
    value_date: row.value_date,
    description: row.description,
    reference: row.reference,
    counterparty_name: row.counterparty_name,
    amount: row.amount,
    direction: row.direction,
  })), [
    {
      transaction_date: "2026-06-12",
      value_date: "2026-06-13",
      description: "Cobro cliente",
      reference: "TRF-1",
      counterparty_name: "Cliente Norte",
      amount: "1234.560000",
      direction: "inflow",
    },
    {
      transaction_date: "2026-06-14",
      value_date: null,
      description: "Pago gasoil",
      reference: "CARD-1",
      counterparty_name: "Estacion",
      amount: "45.670000",
      direction: "outflow",
    },
  ]);
});

test("parseBankStatementCsv acumula errores de fila sin romper todo el lote", () => {
  const parsed = parseBankStatementCsv([
    "fecha,descripcion,importe,direction",
    "2026-06-12,Cobro,10.25,inflow",
    "2026-99-12,Mala fecha,1,outflow",
  ].join("\n"));
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.errors.length, 1);
  assert.equal(parsed.errors[0].row_number, 3);
  assert.match(parsed.errors[0].error, /fecha valida/);
});

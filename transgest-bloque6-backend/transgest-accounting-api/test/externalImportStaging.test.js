const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
  normalizeExternalImportApplyInput,
  nextBatchStatus,
  mapAccountStagingRow,
  mapBankTransactionStagingRow,
  mapJournalEntryStagingRow,
  mapMaturityStagingRow,
  mapPartyStagingRow,
  parseGenericCsv,
} = require("../src/domain/externalImportStaging");

const routeSource = fs.readFileSync(path.join(__dirname, "../src/routes/externalImportStaging.js"), "utf8");

test("parseGenericCsv normaliza cabeceras y avisa de campos vacios", () => {
  const rows = parseGenericCsv("Nombre fiscal;NIF;Email\nCliente Demo;B00000000;\nProveedor Demo;A00000000;proveedor@example.com");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].raw_payload.nombre_fiscal, "Cliente Demo");
  assert.equal(rows[0].status, "warning");
  assert.equal(rows[1].status, "valid");
});

test("parseGenericCsv rechaza cabeceras duplicadas y lotes sin filas", () => {
  assert.throws(() => parseGenericCsv("Nombre;Nombre\nA;B"), /duplicadas/);
  assert.throws(() => parseGenericCsv("Nombre;NIF"), /cabecera y al menos una fila/);
});

test("normalizeExternalImportBatchInput prepara lote staged idempotente", () => {
  const input = normalizeExternalImportBatchInput({
    provider_id: "contasol-factusol",
    import_type: "parties",
    source_format: "csv",
    original_filename: "terceros.csv",
    csv_text: "Nombre;NIF\nCliente Demo;B00000000",
  });
  assert.equal(input.provider_known, true);
  assert.equal(input.row_count, 1);
  assert.equal(input.valid_count, 1);
  assert.equal(input.error_count, 0);
  assert.match(input.request_hash, /^[a-f0-9]{64}$/);
  assert.match(input.rows[0].row_hash, /^[a-f0-9]{64}$/);
});

test("normalizeExternalImportBatchInput evita filas duplicadas", () => {
  assert.throws(() => normalizeExternalImportBatchInput({
    provider_id: "generic",
    import_type: "generic",
    rows: [{ codigo: "1" }, { codigo: "1" }],
  }), /filas duplicadas/);
});

test("consulta y revision de lotes limitan filtros y transiciones", () => {
  assert.deepEqual(normalizeExternalImportQuery({ status: "approved", limit: "999", format: "csv" }), {
    status: "approved",
    provider_id: null,
    import_type: null,
    limit: 100,
    format: "csv",
  });
  assert.throws(() => normalizeExternalImportQuery({ format: "xlsx" }), /format no soportado/);
  assert.deepEqual(normalizeExternalImportReviewInput({ action: "reject", reason: "Formato no confirmado" }), {
    action: "reject",
    reason: "Formato no confirmado",
  });
  assert.equal(nextBatchStatus("pending_review", { action: "approve" }), "approved");
  assert.equal(nextBatchStatus("pending_review", { action: "cancel" }), "cancelled");
  assert.throws(() => nextBatchStatus("approved", { action: "reject" }), /Solo se pueden revisar lotes pendientes/);
});

test("normalizeExternalImportApplyInput exige motivo operativo", () => {
  assert.deepEqual(normalizeExternalImportApplyInput({}), { reason: "Aplicacion de lote externo aprobado" });
  assert.deepEqual(normalizeExternalImportApplyInput({ reason: "Aplicacion revisada por administracion" }), {
    reason: "Aplicacion revisada por administracion",
  });
  assert.throws(() => normalizeExternalImportApplyInput({ reason: "bad" }), /reason/);
});

test("aplicacion externa de cuentas y diario respeta cierres operativos", () => {
  assert.match(routeSource, /SELECT id, year_label, status\s+FROM \$\{q\("fiscal_years"\)\}/);
  assert.match(routeSource, /ensureFiscalYearOpen\(preview\.fiscal_year, `aplicar lotes externos de \$\{batch\.import_type\}`\)/);
  assert.match(routeSource, /ensurePeriodOpen\(period\.rows\[0\], "aplicar lotes externos de diario"\)/);
});

test("preview externa senala ejercicios y periodos no abiertos", () => {
  assert.match(routeSource, /fiscal_year_not_open/);
  assert.match(routeSource, /period_not_found/);
  assert.match(routeSource, /period_not_open/);
  assert.match(routeSource, /period_status: targetPeriod\?\.status/);
});

test("mapPartyStagingRow mapea alias habituales y detecta errores", () => {
  const mapped = mapPartyStagingRow({
    raw_payload: {
      nombre: "Cliente Demo",
      nif: "B00000000",
      tipo: "Proveedor",
      correo: "demo@example.com",
      telefono: "600000000",
    },
  });
  assert.deepEqual(mapped.mapped, {
    party_type: "supplier",
    legal_name: "Cliente Demo",
    tax_id: "B00000000",
    email: "demo@example.com",
    phone: "600000000",
  });
  assert.equal(mapped.errors.length, 0);

  const invalid = mapPartyStagingRow({ raw_payload: { tipo: "desconocido" } });
  assert.equal(invalid.errors.some(error => error.code === "missing_legal_name"), true);
  assert.equal(invalid.errors.some(error => error.code === "unsupported_party_type"), true);
});

test("mapAccountStagingRow mapea plan contable y detecta errores", () => {
  const mapped = mapAccountStagingRow({
    raw_payload: {
      codigo: "43000001",
      nombre: "Clientes transporte",
      tipo: "Activo",
      movimiento: "si",
      notas: "Cuenta importada",
    },
  });
  assert.deepEqual(mapped.mapped, {
    code: "43000001",
    name: "Clientes transporte",
    account_type: "asset",
    is_postable: true,
    notes: "Cuenta importada",
  });
  assert.equal(mapped.errors.length, 0);

  const invalid = mapAccountStagingRow({ raw_payload: { codigo: "43A", tipo: "desconocido" } });
  assert.equal(invalid.errors.some(error => error.code === "invalid_account_code"), true);
  assert.equal(invalid.errors.some(error => error.code === "missing_account_name"), true);
  assert.equal(invalid.errors.some(error => error.code === "unsupported_account_type"), true);
});

test("mapMaturityStagingRow mapea vencimientos y detecta errores", () => {
  const mapped = mapMaturityStagingRow({
    raw_payload: {
      nif: "B00000000",
      tipo: "Cobro",
      vencimiento: "31/07/2026",
      factura: "F-100",
      concepto: "Servicio transporte",
      importe: "1250,50",
      forma_pago: "transferencia",
    },
  });
  assert.deepEqual(mapped.mapped, {
    party_id: "",
    party_tax_id: "B00000000",
    party_name: "",
    direction: "receivable",
    issue_date: null,
    due_date: "2026-07-31",
    document_ref: "F-100",
    description: "Servicio transporte",
    amount: "1250.50",
    payment_method: "transferencia",
    notes: "",
  });
  assert.equal(mapped.errors.length, 0);

  const invalid = mapMaturityStagingRow({ raw_payload: { tipo: "otro", importe: "0", vencimiento: "2026-99-01" } });
  assert.equal(invalid.errors.some(error => error.code === "missing_party_reference"), true);
  assert.equal(invalid.errors.some(error => error.code === "unsupported_maturity_direction"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_due_date"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_amount"), true);
});

test("mapBankTransactionStagingRow mapea movimientos bancarios y detecta errores", () => {
  const mapped = mapBankTransactionStagingRow({
    raw_payload: {
      iban: "ES91 2100 0418 4502 0005 1332",
      fecha: "29/06/2026",
      fecha_valor: "30/06/2026",
      concepto: "Cobro cliente ruta norte",
      referencia: "TRF-100",
      tercero: "Cliente Demo",
      importe: "-1.250,50",
    },
  });
  assert.deepEqual(mapped.mapped, {
    bank_account_id: "",
    iban: "ES9121000418450200051332",
    transaction_date: "2026-06-29",
    value_date: "2026-06-30",
    description: "Cobro cliente ruta norte",
    reference: "TRF-100",
    counterparty_name: "Cliente Demo",
    amount: "1250.50",
    direction: "outflow",
    notes: "",
  });
  assert.equal(mapped.errors.length, 0);

  const invalid = mapBankTransactionStagingRow({ raw_payload: { importe: "0", tipo: "otro" } });
  assert.equal(invalid.errors.some(error => error.code === "missing_bank_account_reference"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_transaction_date"), true);
  assert.equal(invalid.errors.some(error => error.code === "missing_description"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_amount"), true);
  assert.equal(invalid.errors.some(error => error.code === "unsupported_bank_transaction_direction"), true);
});

test("mapJournalEntryStagingRow mapea lineas de diario y detecta errores", () => {
  const debit = mapJournalEntryStagingRow({
    raw_payload: {
      asiento: "A-2026-001",
      fecha: "30/06/2026",
      concepto: "Importacion asiento inicial",
      cuenta: "43000001",
      debe: "1.250,50",
      concepto_linea: "Cliente",
    },
  });
  assert.deepEqual(debit.mapped, {
    entry_ref: "A-2026-001",
    entry_date: "2026-06-30",
    description: "Importacion asiento inicial",
    line_description: "Cliente",
    account_id: "",
    account_code: "43000001",
    side: "debit",
    amount: "1250.50",
  });
  assert.equal(debit.errors.length, 0);

  const credit = mapJournalEntryStagingRow({
    raw_payload: {
      entry_ref: "A-2026-001",
      entry_date: "2026-06-30",
      description: "Importacion asiento inicial",
      account_code: "70000001",
      side: "haber",
      amount: "1250.50",
    },
  });
  assert.equal(credit.mapped.side, "credit");
  assert.equal(credit.mapped.amount, "1250.50");

  const invalid = mapJournalEntryStagingRow({ raw_payload: { importe: "0", tipo: "otro", cuenta: "43A" } });
  assert.equal(invalid.errors.some(error => error.code === "missing_entry_ref"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_entry_date"), true);
  assert.equal(invalid.errors.some(error => error.code === "missing_description"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_account_code"), true);
  assert.equal(invalid.errors.some(error => error.code === "unsupported_journal_side"), true);
  assert.equal(invalid.errors.some(error => error.code === "invalid_amount"), true);
});

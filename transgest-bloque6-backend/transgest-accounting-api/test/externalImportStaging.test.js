const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeExternalImportBatchInput,
  normalizeExternalImportQuery,
  normalizeExternalImportReviewInput,
  nextBatchStatus,
  mapPartyStagingRow,
  parseGenericCsv,
} = require("../src/domain/externalImportStaging");

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
  assert.deepEqual(normalizeExternalImportQuery({ status: "approved", limit: "999" }), {
    status: "approved",
    provider_id: null,
    import_type: null,
    limit: 100,
  });
  assert.deepEqual(normalizeExternalImportReviewInput({ action: "reject", reason: "Formato no confirmado" }), {
    action: "reject",
    reason: "Formato no confirmado",
  });
  assert.equal(nextBatchStatus("pending_review", { action: "approve" }), "approved");
  assert.equal(nextBatchStatus("pending_review", { action: "cancel" }), "cancelled");
  assert.throws(() => nextBatchStatus("approved", { action: "reject" }), /Solo se pueden revisar lotes pendientes/);
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

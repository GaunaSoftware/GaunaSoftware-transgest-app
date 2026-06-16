const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeMaturityInput,
  normalizeMaturityQuery,
  normalizeMaturityStatusInput,
  nextStatusForAction,
} = require("../src/domain/maturities");

test("normalizeMaturityInput prepara un vencimiento de cobro", () => {
  assert.deepEqual(normalizeMaturityInput({
    party_id: "party-id",
    direction: "receivable",
    issue_date: "2026-06-01",
    due_date: "2026-07-01",
    description: "Factura proforma interna",
    amount: "123,45",
    payment_method: "transferencia",
  }), {
    party_id: "party-id",
    direction: "receivable",
    issue_date: "2026-06-01",
    due_date: "2026-07-01",
    document_ref: null,
    description: "Factura proforma interna",
    amount: "123.450000",
    open_amount: "123.450000",
    currency: "EUR",
    payment_method: "transferencia",
    source_system: "accounting",
    source_type: "manual",
    source_id: null,
    notes: null,
  });
});

test("normalizeMaturityInput rechaza direccion, fecha e importe invalidos", () => {
  assert.throws(() => normalizeMaturityInput({ party_id: "p", direction: "bad", due_date: "2026-07-01", description: "x", amount: "1" }), /direction/);
  assert.throws(() => normalizeMaturityInput({ party_id: "p", direction: "payable", due_date: "2026-99-01", description: "x", amount: "1" }), /fecha valida/);
  assert.throws(() => normalizeMaturityInput({ party_id: "p", direction: "payable", due_date: "2026-07-01", description: "x", amount: "0" }), /mayor que cero/);
});

test("normalizeMaturityQuery limita filtros y formatos", () => {
  assert.deepEqual(normalizeMaturityQuery({
    direction: "payable",
    status: "pending",
    due_from: "2026-01-01",
    due_to: "2026-12-31",
    q: " proveedor ",
    format: "csv",
    limit: "900",
  }), {
    direction: "payable",
    status: "pending",
    party_id: null,
    due_from: "2026-01-01",
    due_to: "2026-12-31",
    q: "proveedor",
    format: "csv",
    limit: 500,
  });
  assert.throws(() => normalizeMaturityQuery({ status: "partial" }), /status/);
  assert.throws(() => normalizeMaturityQuery({ format: "pdf" }), /format/);
});

test("normalizeMaturityStatusInput y transiciones controlan liquidacion", () => {
  assert.deepEqual(normalizeMaturityStatusInput({
    action: "settle",
    reason: "Cobro recibido",
    settled_date: "2026-07-02",
  }), {
    action: "settle",
    reason: "Cobro recibido",
    settled_date: "2026-07-02",
  });
  assert.equal(nextStatusForAction("pending", "settle"), "settled");
  assert.equal(nextStatusForAction("cancelled", "reopen"), "pending");
  assert.throws(() => nextStatusForAction("settled", "cancel"), /pendiente/);
  assert.throws(() => normalizeMaturityStatusInput({ action: "settle", reason: "no" }), /reason/);
});

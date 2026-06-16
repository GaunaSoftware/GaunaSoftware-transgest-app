const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizePartyInput,
  normalizePartyQuery,
  normalizePartyStatusInput,
  normalizePartyUpdateInput,
} = require("../src/domain/parties");

test("normalizePartyInput prepara un tercero contable", () => {
  assert.deepEqual(normalizePartyInput({
    party_type: " customer ",
    legal_name: " Cliente Norte S.L. ",
    tax_id: " B00000000 ",
    email: " admin@example.com ",
    phone: " 900100100 ",
  }), {
    source_system: "accounting",
    source_party_id: null,
    party_type: "customer",
    legal_name: "Cliente Norte S.L.",
    tax_id: "B00000000",
    email: "admin@example.com",
    phone: "900100100",
    default_account_id: null,
    notes: null,
  });
});

test("normalizePartyInput rechaza tipos y nombres invalidos", () => {
  assert.throws(() => normalizePartyInput({ party_type: "unknown", legal_name: "Tercero" }), /no soportado/);
  assert.throws(() => normalizePartyInput({ party_type: "customer", legal_name: "" }), /legal_name/);
  assert.throws(() => normalizePartyInput({ party_type: "customer", legal_name: "Tercero", source_system: "bad value" }), /source_system/);
});

test("normalizePartyUpdateInput no permite cambiar origen externo", () => {
  assert.deepEqual(normalizePartyUpdateInput({
    party_type: "supplier",
    legal_name: "Proveedor Sur",
    source_system: "transgest",
    source_party_id: "123",
  }), {
    party_type: "supplier",
    legal_name: "Proveedor Sur",
    tax_id: null,
    email: null,
    phone: null,
    default_account_id: null,
    notes: null,
  });
});

test("normalizePartyQuery limita filtros", () => {
  assert.deepEqual(normalizePartyQuery({ q: " norte ", active: "false", party_type: "supplier", limit: "900" }), {
    q: "norte",
    active: false,
    party_type: "supplier",
    limit: 500,
    format: "json",
  });
  assert.equal(normalizePartyQuery({ format: "csv" }).format, "csv");
  assert.throws(() => normalizePartyQuery({ party_type: "bad" }), /no soportado/);
  assert.throws(() => normalizePartyQuery({ format: "pdf" }), /format/);
});

test("cambiar estado de tercero exige boolean y motivo", () => {
  assert.deepEqual(normalizePartyStatusInput({ is_active: false, reason: "Duplicado" }), {
    is_active: false,
    reason: "Duplicado",
  });
  assert.throws(() => normalizePartyStatusInput({ is_active: "false", reason: "Duplicado" }), /boolean/);
  assert.throws(() => normalizePartyStatusInput({ is_active: false, reason: "No" }), /entre 5 y 300/);
});

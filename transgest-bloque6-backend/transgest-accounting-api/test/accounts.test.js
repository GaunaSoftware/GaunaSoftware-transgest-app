const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeAccountInput,
  normalizeAccountQuery,
  normalizeAccountStatusInput,
} = require("../src/domain/accounts");

test("normalizeAccountInput prepara una cuenta configurable", () => {
  assert.deepEqual(normalizeAccountInput({
    code: " 4300001 ",
    name: " Cliente principal ",
    account_type: "asset",
    is_postable: true,
  }), {
    code: "4300001",
    name: "Cliente principal",
    account_type: "asset",
    parent_account_id: null,
    is_postable: true,
    notes: null,
  });
});

test("normalizeAccountInput rechaza codigos y tipos no soportados", () => {
  assert.throws(() => normalizeAccountInput({ code: "43-A", name: "Cuenta", account_type: "asset" }), /digitos/);
  assert.throws(() => normalizeAccountInput({ code: "430", name: "Cuenta", account_type: "other" }), /no soportado/);
});

test("normalizeAccountQuery limita filtros", () => {
  assert.deepEqual(normalizeAccountQuery({ q: " cliente ", active: "true", limit: "900" }), {
    q: "cliente",
    active: true,
    fiscal_year_id: null,
    limit: 500,
  });
});

test("cambiar estado de cuenta exige boolean y motivo", () => {
  assert.deepEqual(normalizeAccountStatusInput({ is_active: false, reason: "Cuenta duplicada" }), {
    is_active: false,
    reason: "Cuenta duplicada",
  });
  assert.throws(() => normalizeAccountStatusInput({ is_active: "false", reason: "Cuenta duplicada" }), /boolean/);
  assert.throws(() => normalizeAccountStatusInput({ is_active: false, reason: "No" }), /entre 5 y 300/);
});

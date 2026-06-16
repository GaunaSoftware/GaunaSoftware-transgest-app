const test = require("node:test");
const assert = require("node:assert/strict");
const {
  auditCompanySelection,
  normalizeRequestedCompanyId,
} = require("../src/routes/companies");

test("normalizeRequestedCompanyId limita entradas no confiables", () => {
  assert.equal(normalizeRequestedCompanyId(" company-id "), "company-id");
  assert.equal(normalizeRequestedCompanyId(null), null);
  assert.equal(normalizeRequestedCompanyId("x".repeat(150)).length, 100);
  assert.equal(normalizeRequestedCompanyId({ unexpected: true }), "[object Object]");
});

test("la seleccion cross-company denegada queda auditada sin vincular entidad ajena", async () => {
  let captured;
  const client = {
    async query(sql, params) {
      captured = { sql, params };
    },
  };
  const req = {
    id: "request-1",
    accountingUser: { id: "11111111-1111-1111-1111-111111111111" },
  };
  const selected = {
    tenant_id: "22222222-2222-2222-2222-222222222222",
    company_id: "33333333-3333-3333-3333-333333333333",
  };

  await auditCompanySelection(client, req, {
    action: "company.selection_denied",
    selected,
    requestedCompanyId: "44444444-4444-4444-4444-444444444444",
  });

  assert.match(captured.sql, /INSERT INTO .*audit_log/);
  assert.equal(captured.params[3], "company.selection_denied");
  assert.equal(captured.params[4], null);
  assert.deepEqual(JSON.parse(captured.params[6]), {
    requested_company_id: "44444444-4444-4444-4444-444444444444",
  });
});

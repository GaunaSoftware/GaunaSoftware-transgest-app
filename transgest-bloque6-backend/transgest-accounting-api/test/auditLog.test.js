const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeAuditQuery } = require("../src/domain/auditLog");

test("normalizeAuditQuery aplica limite por defecto", () => {
  const query = normalizeAuditQuery({});
  assert.equal(query.limit, 25);
  assert.equal(query.action, null);
  assert.equal(query.entity_type, null);
});

test("normalizeAuditQuery limita valores fuera de rango", () => {
  assert.equal(normalizeAuditQuery({ limit: "0" }).limit, 1);
  assert.equal(normalizeAuditQuery({ limit: "300" }).limit, 100);
});

test("normalizeAuditQuery conserva filtros limpios", () => {
  const query = normalizeAuditQuery({
    limit: "50",
    action: " period.closed ",
    entity_type: " accounting_period ",
  });
  assert.equal(query.limit, 50);
  assert.equal(query.action, "period.closed");
  assert.equal(query.entity_type, "accounting_period");
});

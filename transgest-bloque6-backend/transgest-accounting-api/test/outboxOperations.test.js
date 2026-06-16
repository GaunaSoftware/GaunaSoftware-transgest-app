const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeOutboxQuery,
  validateOutboxRetry,
} = require("../src/domain/outboxOperations");

test("normalizeOutboxQuery aplica filtros y limite", () => {
  const result = normalizeOutboxQuery({
    status: " failed ",
    event_type: " AccountingPeriodClosed ",
    limit: "300",
  });
  assert.equal(result.status, "failed");
  assert.equal(result.event_type, "AccountingPeriodClosed");
  assert.equal(result.limit, 100);
});

test("normalizeOutboxQuery rechaza estados desconocidos", () => {
  assert.throws(() => normalizeOutboxQuery({ status: "lost" }), /Estado outbox no soportado/);
});

test("validateOutboxRetry solo permite eventos failed con motivo", () => {
  assert.equal(validateOutboxRetry({ status: "failed" }, "Revision operativa"), "Revision operativa");
  assert.throws(() => validateOutboxRetry({ status: "processed" }, "Revision operativa"), /Solo se pueden reintentar/);
  assert.throws(() => validateOutboxRetry({ status: "failed" }, "abc"), /al menos 5/);
});

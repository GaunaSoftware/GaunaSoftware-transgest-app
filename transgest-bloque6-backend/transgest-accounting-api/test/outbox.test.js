const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isSupportedEventType,
  normalizeOutboxError,
  retryDelaySeconds,
} = require("../src/domain/outbox");

test("outbox reconoce eventos internos actuales", () => {
  assert.equal(isSupportedEventType("AccountingFiscalYearOpened"), true);
  assert.equal(isSupportedEventType("AccountingPeriodClosed"), true);
  assert.equal(isSupportedEventType("UnknownEvent"), false);
});

test("retryDelaySeconds aplica backoff exponencial con limite", () => {
  assert.equal(retryDelaySeconds(1), 5);
  assert.equal(retryDelaySeconds(2), 10);
  assert.equal(retryDelaySeconds(10), 300);
});

test("normalizeOutboxError limita el error persistido", () => {
  const message = normalizeOutboxError(new Error("x".repeat(3000)));
  assert.equal(message.length, 2000);
});

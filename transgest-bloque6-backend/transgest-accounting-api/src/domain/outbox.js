const { EVENT_CONTRACTS } = require("./eventContracts");

const SUPPORTED_EVENT_TYPES = new Set(Object.keys(EVENT_CONTRACTS));

function isSupportedEventType(eventType) {
  return SUPPORTED_EVENT_TYPES.has(String(eventType || ""));
}

function retryDelaySeconds(attempts) {
  const normalizedAttempts = Math.max(Number(attempts) || 1, 1);
  return Math.min(5 * (2 ** (normalizedAttempts - 1)), 300);
}

function normalizeOutboxError(error) {
  const message = error instanceof Error ? error.message : String(error || "Error desconocido");
  return message.slice(0, 2000);
}

module.exports = {
  SUPPORTED_EVENT_TYPES,
  isSupportedEventType,
  normalizeOutboxError,
  retryDelaySeconds,
};

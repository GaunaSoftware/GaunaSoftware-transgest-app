const OUTBOX_STATUSES = ["pending", "processing", "retry", "processed", "failed"];
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function cleanFilter(value, maxLength = 140) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeOutboxQuery(query = {}) {
  const requestedLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(Math.max(requestedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;
  const status = cleanFilter(query.status, 30);
  if (status && !OUTBOX_STATUSES.includes(status)) {
    const error = new Error("Estado outbox no soportado");
    error.status = 400;
    throw error;
  }

  return {
    limit,
    status,
    event_type: cleanFilter(query.event_type),
  };
}

function validateOutboxRetry(event, reason) {
  if (!event) {
    const error = new Error("Evento outbox no encontrado");
    error.status = 404;
    throw error;
  }
  if (event.status !== "failed") {
    const error = new Error(`Solo se pueden reintentar eventos failed; estado actual: ${event.status}`);
    error.status = 409;
    throw error;
  }
  const normalizedReason = String(reason || "").trim();
  if (normalizedReason.length < 5) {
    const error = new Error("El motivo de reintento debe tener al menos 5 caracteres");
    error.status = 400;
    throw error;
  }
  return normalizedReason;
}

module.exports = {
  OUTBOX_STATUSES,
  normalizeOutboxQuery,
  validateOutboxRetry,
};

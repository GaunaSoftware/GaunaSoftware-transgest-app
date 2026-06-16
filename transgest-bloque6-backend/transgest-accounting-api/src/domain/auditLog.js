const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function cleanFilterValue(value, maxLength = 140) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function normalizeAuditQuery(query = {}) {
  const rawLimit = Number.parseInt(query.limit, 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  return {
    limit,
    action: cleanFilterValue(query.action),
    entity_type: cleanFilterValue(query.entity_type, 120),
  };
}

module.exports = {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  normalizeAuditQuery,
};

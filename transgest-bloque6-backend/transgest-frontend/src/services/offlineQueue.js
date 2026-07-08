export const OFFLINE_QUEUE_KEY = "tms_offline_queue";
const MAX_ITEMS = 150;
const MAX_ATTEMPTS = 12;

export function readOfflineQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]");
    return Array.isArray(raw) ? raw.map(normalizeQueueItem).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export function writeOfflineQueue(items = []) {
  const next = (Array.isArray(items) ? items : [])
    .map(normalizeQueueItem)
    .filter(Boolean)
    .slice(-MAX_ITEMS);
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(next));
  emitQueueChanged(next);
  return next;
}

export function enqueueOfflineItem(item) {
  const normalized = normalizeQueueItem(item);
  if (!normalized) return readOfflineQueue();
  const current = readOfflineQueue();
  const dedupeKey = normalized.dedupe_key || normalized.id;
  const filtered = current.filter(existing => (existing.dedupe_key || existing.id) !== dedupeKey);
  return writeOfflineQueue([...filtered, normalized]);
}

export function readyOfflineItems(now = Date.now()) {
  return readOfflineQueue().filter(item => {
    if (item.status === "blocked") return false;
    if (item.attempts >= MAX_ATTEMPTS) return false;
    if (!item.next_retry_at) return true;
    return Date.parse(item.next_retry_at) <= now;
  });
}

export function markOfflineAttempt(item, errorMessage = "") {
  const attempts = Number(item?.attempts || 0) + 1;
  const delayMs = Math.min(30 * 60 * 1000, 1000 * Math.pow(2, Math.min(attempts, 8)));
  return {
    ...normalizeQueueItem(item),
    attempts,
    status: attempts >= MAX_ATTEMPTS ? "blocked" : "pending",
    last_error: String(errorMessage || "No se pudo sincronizar").slice(0, 240),
    last_attempt_at: new Date().toISOString(),
    next_retry_at: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + delayMs).toISOString(),
  };
}

export function queueSummary(items = readOfflineQueue()) {
  const total = items.length;
  const blocked = items.filter(i => i.status === "blocked" || i.attempts >= MAX_ATTEMPTS).length;
  const pending = Math.max(0, total - blocked);
  return { total, pending, blocked };
}

function normalizeQueueItem(item) {
  if (!item || typeof item !== "object") return null;
  const tipo = String(item.tipo || item.kind || "").trim();
  if (!tipo && !item.url) return null;
  const createdAt = item.created_at || item.fecha || new Date().toISOString();
  return {
    ...item,
    id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    tipo: tipo || "fetch",
    created_at: createdAt,
    fecha: item.fecha || createdAt,
    attempts: Number.isFinite(Number(item.attempts)) ? Number(item.attempts) : 0,
    status: item.status || "pending",
    dedupe_key: item.dedupe_key || null,
  };
}

function emitQueueChanged(items) {
  try {
    window.dispatchEvent(new CustomEvent("tms:offline-queue-changed", { detail: items }));
  } catch {}
}

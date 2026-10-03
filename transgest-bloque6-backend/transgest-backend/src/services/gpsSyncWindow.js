// Share a provider read between LOCATE viewers of the same company. No timers
// or background collection: a request from an open view starts the read.
function createGpsSyncWindow({ intervalMs = 60000, now = Date.now } = {}) {
  const entries = new Map();
  return async function run(company, provider, sync) {
    if (!company) throw Object.assign(Error('Empresa no identificada'), { status: 401 });
    const key = JSON.stringify([String(company), provider]);
    for (const [id, entry] of entries) {
      if (entry.completedAt !== null && now() - entry.startedAt >= intervalMs) entries.delete(id);
    }
    const existing = entries.get(key);
    if (existing) return { ...await existing.promise, cached: true };
    if (entries.size >= 1000) throw Object.assign(Error('Actualización GPS ocupada. Vuelve a intentarlo en un minuto.'), { status: 429 });
    const entry = { startedAt: now(), completedAt: null, promise: null };
    entry.promise = Promise.resolve().then(sync).finally(() => { entry.completedAt = now(); });
    entries.set(key, entry);
    return { ...await entry.promise, cached: false };
  };
}
module.exports = { createGpsSyncWindow };

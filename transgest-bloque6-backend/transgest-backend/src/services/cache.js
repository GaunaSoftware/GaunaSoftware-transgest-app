// ══════════════════════════════════════════════════════
// src/services/cache.js — Cache en memoria (TTL simple)
// ══════════════════════════════════════════════════════
const store = new Map();

function get(key) {
  const item = store.get(key);
  if (!item) return null;
  if (Date.now() > item.expires) { store.delete(key); return null; }
  return item.value;
}

function set(key, value, ttlSeconds = 30) {
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

function del(key) { store.delete(key); }

function clear() { store.clear(); }

// Middleware factory: cache a route response
function cacheMiddleware(ttlSeconds = 30, keyFn = null) {
  return (req, res, next) => {
    const key = keyFn ? keyFn(req) : `${req.method}:${req.originalUrl}:${req.user?.empresa_id}`;
    const cached = get(key);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      return res.json(cached);
    }
    const origJson = res.json.bind(res);
    res.json = (data) => {
      set(key, data, ttlSeconds);
      res.setHeader("X-Cache", "MISS");
      return origJson(data);
    };
    next();
  };
}

// Clear all keys matching a prefix pattern
function clearPattern(prefix) {
  let count = 0;
  for (const key of store.keys()) {
    if (key.includes(prefix)) { store.delete(key); count++; }
  }
  return count;
}

// Invalidation middleware - clears cache after POST/PUT/PATCH/DELETE
function invalidateCache(...prefixes) {
  return (req, res, next) => {
    const origJson = res.json.bind(res);
    res.json = (data) => {
      if (res.statusCode < 400) {
        prefixes.forEach(p => clearPattern(p));
      }
      return origJson(data);
    };
    next();
  };
}

module.exports = { get, set, del, clear, cacheMiddleware, clearPattern, invalidateCache };

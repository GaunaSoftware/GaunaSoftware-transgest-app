const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { resolveApiKey, assertApiUsageAllowed, recordApiUsage } = require("../services/apiKeys");

const router = express.Router();

function normalizeKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickAddressPart(address = {}, keys = []) {
  for (const key of keys) {
    const value = cleanText(address[key]);
    if (value) return value;
  }
  return "";
}

// ── Diccionario local de respaldo (capitales de provincia + ciudades clave) ──
// Garantiza que las rutas nacionales habituales siempre resuelvan aunque los
// geocoders externos (HERE/Nominatim) esten caidos o limitando peticiones.
const SPAIN_CITIES = [
  ["A Coruna", 43.3623, -8.4115, ["coruna", "la coruna"]],
  ["Albacete", 38.9943, -1.8585],
  ["Alicante", 38.3452, -0.4907, ["alacant"]],
  ["Almeria", 36.8402, -2.4637],
  ["Avila", 40.6566, -4.6818],
  ["Badajoz", 38.8794, -6.9707],
  ["Barcelona", 41.3851, 2.1734],
  ["Bilbao", 43.2630, -2.9350],
  ["Burgos", 42.3439, -3.6969],
  ["Caceres", 39.4753, -6.3712],
  ["Cadiz", 36.5275, -6.2886],
  ["Castellon", 39.9864, -0.0513, ["castello", "castellon de la plana"]],
  ["Ciudad Real", 38.9861, -3.9273],
  ["Cordoba", 37.8882, -4.7794],
  ["Cuenca", 40.0704, -2.1374],
  ["Girona", 41.9794, 2.8214, ["gerona"]],
  ["Granada", 37.1773, -3.5986],
  ["Guadalajara", 40.6332, -3.1665],
  ["Huelva", 37.2614, -6.9447],
  ["Huesca", 42.1362, -0.4089],
  ["Jaen", 37.7796, -3.7903],
  ["Leon", 42.5987, -5.5671],
  ["Lleida", 41.6176, 0.6200, ["lerida"]],
  ["Logrono", 42.4627, -2.4456],
  ["Lugo", 43.0121, -7.5559],
  ["Madrid", 40.4168, -3.7038],
  ["Malaga", 36.7213, -4.4214],
  ["Murcia", 37.9922, -1.1307],
  ["Ourense", 42.3358, -7.8639, ["orense"]],
  ["Oviedo", 43.3619, -5.8494],
  ["Palencia", 42.0096, -4.5288],
  ["Palma", 39.5696, 2.6502, ["palma de mallorca"]],
  ["Las Palmas", 28.1235, -15.4363, ["las palmas de gran canaria"]],
  ["Pamplona", 42.8125, -1.6458, ["iruna"]],
  ["Pontevedra", 42.4310, -8.6444],
  ["Salamanca", 40.9701, -5.6635],
  ["San Sebastian", 43.3183, -1.9812, ["donostia"]],
  ["Santander", 43.4623, -3.8099],
  ["Segovia", 40.9429, -4.1088],
  ["Sevilla", 37.3891, -5.9845],
  ["Soria", 41.7665, -2.4790],
  ["Tarragona", 41.1189, 1.2445],
  ["Teruel", 40.3456, -1.1065],
  ["Toledo", 39.8628, -4.0273],
  ["Valencia", 39.4699, -0.3763],
  ["Valladolid", 41.6523, -4.7245],
  ["Vitoria", 42.8467, -2.6727, ["gasteiz", "vitoria-gasteiz"]],
  ["Zamora", 41.5033, -5.7446],
  ["Zaragoza", 41.6488, -0.8891],
  ["Santa Cruz de Tenerife", 28.4636, -16.2518, ["tenerife"]],
  ["Vigo", 42.2406, -8.7207],
  ["Gijon", 43.5322, -5.6611],
  ["Cartagena", 37.6257, -0.9966],
  ["Getafe", 40.3083, -3.7319],
  ["Alcala de Henares", 40.4810, -3.3640],
  ["Sabadell", 41.5433, 2.1094],
  ["Mostoles", 40.3223, -3.8649],
  ["Irun", 43.3382, -1.7894],
  ["Algeciras", 36.1408, -5.4562],
  ["Jerez", 36.6850, -6.1261, ["jerez de la frontera"]],
  ["Gandia", 38.9680, -0.1845],
].map(([name, lat, lng, aliases = []]) => ({
  name,
  lat,
  lng,
  keys: [normalizeKey(name), ...aliases.map(normalizeKey)].filter(Boolean),
}));

function localCityLookup(q) {
  const norm = normalizeKey(q);
  if (!norm) return null;
  // Coincidencia exacta primero; luego que el texto contenga el nombre de una ciudad.
  let match = SPAIN_CITIES.find(city => city.keys.includes(norm));
  if (!match) {
    match = SPAIN_CITIES
      .filter(city => city.keys.some(key => norm.includes(key)))
      .sort((a, b) => Math.max(...b.keys.map(k => k.length)) - Math.max(...a.keys.map(k => k.length)))[0];
  }
  if (!match) return null;
  return { provider: "local", municipio: match.name, provincia: "", pais: "Espana", lat: match.lat, lng: match.lng, label: match.name };
}

async function ensureSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_place_cache (
      id UUID PRIMARY KEY,
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      query_key TEXT NOT NULL,
      query TEXT NOT NULL,
      country_hint TEXT,
      region_hint TEXT,
      provider VARCHAR(40) NOT NULL DEFAULT 'local',
      result JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (empresa_id, query_key)
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_geo_place_cache_lookup ON geo_place_cache(empresa_id, query_key)");
}

function buildQuery(q, country, region) {
  return [q, region, country].map(cleanText).filter(Boolean).join(", ");
}

function formatResult(raw = {}) {
  const municipio = cleanText(raw.municipio || raw.city || raw.locality);
  const provincia = cleanText(raw.provincia || raw.region || raw.state || raw.county);
  const pais = cleanText(raw.pais || raw.country);
  const lat = raw.lat == null || raw.lat === "" ? null : Number(raw.lat);
  const lng = raw.lng == null || raw.lng === "" ? null : Number(raw.lng);
  return {
    municipio,
    provincia,
    pais,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    label: cleanText(raw.label || [municipio, provincia, pais].filter(Boolean).join(", ")),
  };
}

async function geocodeHere(empresaId, q, country, region) {
  const resolved = await resolveApiKey(empresaId, "here");
  if (!resolved.key) return null;
  await assertApiUsageAllowed(empresaId, "here");
  const attempts = [
    buildQuery(q, country, region),
    country || region ? cleanText(q) : "",
  ].filter(Boolean);
  for (const query of attempts) {
    const url = new URL("https://geocode.search.hereapi.com/v1/geocode");
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "1");
    url.searchParams.set("lang", "es-ES");
    url.searchParams.set("apiKey", resolved.key);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      const item = Array.isArray(data.items) ? data.items[0] : null;
      if (!item) continue;
      const address = item.address || {};
      await recordApiUsage(empresaId, "here", 1);
      return {
        provider: "here",
        ...formatResult({
          municipio: address.city || address.district || address.county,
          provincia: address.county || address.state,
          pais: address.countryName,
          lat: item.position?.lat,
          lng: item.position?.lng,
          label: item.title || address.label,
        }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

async function geocodeNominatim(q, country, region) {
  const attempts = [
    buildQuery(q, country, region),
    country || region ? cleanText(q) : "",
  ].filter(Boolean);
  for (const query of attempts) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "1");
    url.searchParams.set("accept-language", "es");
    url.searchParams.set("q", query);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "TransGestTMS/1.0 geocoding (app.gauna.es)",
        },
      });
      if (!res.ok) continue;
      const data = await res.json().catch(() => []);
      const item = Array.isArray(data) ? data[0] : null;
      if (!item) continue;
      const address = item.address || {};
      return {
        provider: "nominatim",
        ...formatResult({
          municipio: pickAddressPart(address, ["city", "town", "village", "municipality", "hamlet", "suburb"]),
          provincia: pickAddressPart(address, ["province", "state", "region", "county"]),
          pais: address.country,
          lat: item.lat,
          lng: item.lon,
          label: item.display_name,
        }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

// ── Resolucion robusta: cache -> HERE -> Nominatim -> diccionario local ──
async function resolvePlace(empresaId, q, country, region) {
  const cleaned = cleanText(q);
  if (cleaned.length < 2) return null;
  const queryKey = normalizeKey([cleaned, country, region].filter(Boolean).join("|"));

  await ensureSchema().catch(() => {});
  const cached = await db.query(
    "SELECT result, provider FROM geo_place_cache WHERE empresa_id=$1 AND query_key=$2 LIMIT 1",
    [empresaId, queryKey]
  ).catch(() => ({ rows: [] }));
  if (cached.rows[0]?.result && Number.isFinite(Number(cached.rows[0].result.lat))) {
    return { source: "cache", provider: cached.rows[0].provider, ...cached.rows[0].result };
  }

  let resolved = await geocodeHere(empresaId, cleaned, country, region).catch(() => null);
  if (!resolved || resolved.lat == null) {
    resolved = await geocodeNominatim(cleaned, country, region).catch(() => null);
  }
  if (!resolved || resolved.lat == null) {
    const local = localCityLookup(cleaned);
    if (local) resolved = local;
  }
  if (!resolved || resolved.lat == null) return null;

  const result = formatResult(resolved);
  // Solo cacheamos resultados de proveedores externos (el local es determinista).
  if (resolved.provider !== "local") {
    await db.query(`
      INSERT INTO geo_place_cache (id, empresa_id, query_key, query, country_hint, region_hint, provider, result, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
      ON CONFLICT (empresa_id, query_key) DO UPDATE SET
        query=EXCLUDED.query, country_hint=EXCLUDED.country_hint, region_hint=EXCLUDED.region_hint,
        provider=EXCLUDED.provider, result=EXCLUDED.result, updated_at=NOW()
    `, [crypto.randomUUID(), empresaId, queryKey, cleaned, country || null, region || null, resolved.provider || "nominatim", JSON.stringify(result)])
      .catch(() => {});
  }
  return { source: resolved.provider === "local" ? "local" : "provider", provider: resolved.provider || "nominatim", ...result };
}

function haversineKm(a, b) {
  const toRad = n => (Number(n) * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

// OSRM: distancia real por carretera + geometria. Gratuito, sin API key.
async function osrmRoute(puntos) {
  const coords = puntos.map(p => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.ROUTING_TIMEOUT_MS || 12000));
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json().catch(() => ({}));
    if (data?.code !== "Ok" || !data?.routes?.[0]) return null;
    const route = data.routes[0];
    const line = Array.isArray(route.geometry?.coordinates)
      ? route.geometry.coordinates.map(([lon, lat]) => [lat, lon])
      : [];
    return {
      km: Math.round(Number(route.distance || 0) / 1000),
      duration_min: Math.round(Number(route.duration || 0) / 60),
      geometry: line,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

router.get("/resolve", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });
    const q = cleanText(req.query.q);
    const country = cleanText(req.query.country || req.query.pais || "");
    const region = cleanText(req.query.region || req.query.provincia || "");
    if (q.length < 2) return res.status(400).json({ error: "Indica una poblacion o direccion" });

    const resolved = await resolvePlace(empresaId, q, country, region);
    if (!resolved) return res.status(404).json({ ok: false, error: "No se pudo localizar esa poblacion" });
    res.json({ ok: true, ...resolved });
  } catch (err) {
    next(err);
  }
});

// ── GET/POST /route ── Resuelve origen/destino y devuelve km + geometria ──
// GET (permiso "ver") para el mapa de solo lectura; POST admite payloads mayores.
// Robusto: geocodifica con fallback local y calcula distancia por OSRM; si OSRM
// falla, estima por distancia en linea recta x1.24 y dibuja linea directa.
function routeInputFromQuery(query = {}) {
  const input = {
    origen: query.origen || query.origin || "",
    destino: query.destino || query.destination || "",
    country: query.country || query.pais || "",
  };
  if (query.puntos) {
    try {
      const parsed = JSON.parse(query.puntos);
      if (Array.isArray(parsed)) input.puntos = parsed;
    } catch { /* ignora puntos mal formados */ }
  }
  if (query.waypoints) {
    try {
      const parsed = JSON.parse(query.waypoints);
      if (Array.isArray(parsed)) input.waypoints = parsed;
    } catch { /* ignora */ }
  }
  return input;
}

// Cache de rutas calculadas (km + geometria) por empresa, para que el mapa
// cargue al instante en visitas repetidas y dependa menos de OSRM/geocoders.
let routeCacheReady = false;
async function ensureRouteCacheSchema() {
  if (routeCacheReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS geo_route_cache (
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      route_key VARCHAR(64) NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (empresa_id, route_key)
    )
  `);
  routeCacheReady = true;
}

function routeCacheKey(country, points) {
  const norm = points.map(p => ({
    q: normalizeKey(p.q || ""),
    lat: p.lat != null ? Number(p.lat).toFixed(4) : null,
    lng: p.lng != null ? Number(p.lng).toFixed(4) : null,
    r: p.role || "",
  }));
  return crypto.createHash("sha1").update(JSON.stringify({ c: normalizeKey(country), p: norm })).digest("hex");
}

async function handleRoute(req, res, next) {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });

    const body = req.method === "GET" ? routeInputFromQuery(req.query || {}) : (req.body || {});
    const rawPoints = [];
    if (body.origen) rawPoints.push({ q: body.origen, role: "origen" });
    if (Array.isArray(body.waypoints)) body.waypoints.forEach(w => rawPoints.push({ q: w, role: "parada" }));
    if (body.destino) rawPoints.push({ q: body.destino, role: "destino" });
    if (Array.isArray(body.puntos)) {
      body.puntos.forEach((p, idx) => {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        rawPoints.push({
          q: cleanText(p?.label || p?.q || ""),
          role: p?.role || (idx === 0 ? "origen" : "destino"),
          lat: Number.isFinite(lat) ? lat : null,
          lng: Number.isFinite(lng) ? lng : null,
        });
      });
    }

    const cleanPoints = rawPoints.filter(p => (p.lat != null && p.lng != null) || cleanText(p.q).length >= 2);
    if (cleanPoints.length < 2) {
      return res.status(400).json({ error: "Indica al menos origen y destino." });
    }

    const country = cleanText(body.country || body.pais || "");

    // Cache-hit: si ya calculamos esta misma ruta (< 30 dias), la devolvemos ya.
    const cacheKey = routeCacheKey(country, cleanPoints);
    await ensureRouteCacheSchema().catch(() => {});
    const cached = await db.query(
      "SELECT payload FROM geo_route_cache WHERE empresa_id=$1 AND route_key=$2 AND updated_at > NOW() - INTERVAL '30 days' LIMIT 1",
      [empresaId, cacheKey]
    ).catch(() => ({ rows: [] }));
    if (cached.rows[0]?.payload) {
      return res.json({ ...cached.rows[0].payload, source: "cache" });
    }

    const puntos = [];
    const noLocalizados = [];
    for (const p of cleanPoints) {
      if (p.lat != null && p.lng != null) {
        puntos.push({ lat: p.lat, lng: p.lng, label: cleanText(p.q) || `${p.lat.toFixed(3)}, ${p.lng.toFixed(3)}`, role: p.role, source: "coords" });
        continue;
      }
      const resolved = await resolvePlace(empresaId, p.q, country, "");
      if (resolved && resolved.lat != null) {
        puntos.push({ lat: resolved.lat, lng: resolved.lng, label: resolved.label || cleanText(p.q), role: p.role, source: resolved.source });
      } else {
        noLocalizados.push(cleanText(p.q));
      }
    }

    if (puntos.length < 2) {
      return res.status(422).json({
        error: "No se pudieron localizar suficientes puntos para trazar la ruta.",
        no_localizados: noLocalizados,
      });
    }

    let warning = noLocalizados.length ? `No se localizaron: ${noLocalizados.join(", ")}.` : null;
    let source = "osrm";
    let osrm = await osrmRoute(puntos);
    if (!osrm) {
      const straightKm = puntos.slice(1).reduce((sum, p, idx) => sum + haversineKm(puntos[idx], p), 0);
      osrm = {
        km: straightKm ? Math.max(1, Math.round(straightKm * 1.24)) : null,
        duration_min: straightKm ? Math.round((straightKm * 1.24 / 68) * 60) : null,
        geometry: puntos.map(p => [p.lat, p.lng]),
      };
      source = "estimacion";
      warning = `${warning ? warning + " " : ""}Distancia estimada (el enrutador de carretera no respondio); validar antes de ejecutar.`;
    }

    const response = {
      ok: true,
      km: osrm.km,
      duration_min: osrm.duration_min,
      puntos,
      geometry: osrm.geometry,
      source,
      warning,
    };

    // Solo cacheamos rutas reales por carretera (no estimaciones), asi si OSRM
    // estaba caido se reintenta la proxima vez en lugar de servir una estimacion vieja.
    if (source === "osrm" && osrm.km) {
      db.query(
        `INSERT INTO geo_route_cache (empresa_id, route_key, payload, updated_at)
         VALUES ($1,$2,$3::jsonb,NOW())
         ON CONFLICT (empresa_id, route_key) DO UPDATE SET payload=EXCLUDED.payload, updated_at=NOW()`,
        [empresaId, cacheKey, JSON.stringify(response)]
      ).catch(() => {});
    }

    res.json(response);
  } catch (err) {
    next(err);
  }
}

router.get("/route", handleRoute);
router.post("/route", handleRoute);

// Alias ligero para el calculador de portes: devuelve solo km.
router.get("/distance", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });
    const origen = cleanText(req.query.origen || req.query.origin);
    const destino = cleanText(req.query.destino || req.query.destination);
    if (origen.length < 2 || destino.length < 2) return res.status(400).json({ error: "Indica origen y destino." });
    const country = cleanText(req.query.country || req.query.pais || "");

    const o = await resolvePlace(empresaId, origen, country, "");
    const d = await resolvePlace(empresaId, destino, country, "");
    if (!o || !d || o.lat == null || d.lat == null) {
      return res.status(422).json({ error: "No se pudo localizar alguna de las poblaciones." });
    }
    const puntos = [
      { lat: o.lat, lng: o.lng, label: o.label, role: "origen" },
      { lat: d.lat, lng: d.lng, label: d.label, role: "destino" },
    ];
    let osrm = await osrmRoute(puntos);
    let source = "osrm";
    if (!osrm) {
      const straightKm = haversineKm(puntos[0], puntos[1]);
      osrm = { km: Math.max(1, Math.round(straightKm * 1.24)), duration_min: Math.round((straightKm * 1.24 / 68) * 60) };
      source = "estimacion";
    }
    res.json({ ok: true, km: osrm.km, duration_min: osrm.duration_min, origen: puntos[0], destino: puntos[1], source });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

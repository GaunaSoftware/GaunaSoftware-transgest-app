const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { resolveApiKey, assertApiUsageAllowed, recordApiUsage } = require("../services/apiKeys");
const { fallbackPlaceForAddress } = require("../services/geoFallback");
const { coordsFromText, resolveMapsCoords } = require("../services/mapsLink");
const { googleGeocode } = require("../services/googleGeocode");
const {
  countryCodeFor,
  isCountryOnlyQuery,
  parsePlaceRequest,
  searchQueryFor,
  selectBestPlaceCandidate,
} = require("../services/geoPlaceMatch");

const router = express.Router();
const ROUTE_CACHE_DAYS = Math.max(1, Number(process.env.GEO_ROUTE_CACHE_DAYS || 30));
const EXTERNAL_TIMEOUT_MS = Math.max(2500, Number(process.env.GEO_EXTERNAL_TIMEOUT_MS || 9000));
const MAX_ROUTE_POINTS = 12;
const PLACE_CACHE_VERSION = "v6";
let schemaPromise = null;
let lastNominatimAt = 0;
let nominatimQueue = Promise.resolve();

function normalizeKey(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function numericCoordinate(value, min, max) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function directCoordinates(raw = {}) {
  const lat = numericCoordinate(raw.lat ?? raw.latitude ?? raw.latitud, -90, 90);
  const lng = numericCoordinate(raw.lng ?? raw.lon ?? raw.longitude ?? raw.longitud, -180, 180);
  if (lat !== null && lng !== null) return { lat, lng };
  const text = cleanText(raw.google_maps_url || raw.maps_url || raw.query || raw.label || raw.address || raw.direccion);
  const sharedParserCoords = coordsFromText(text);
  if (sharedParserCoords) return sharedParserCoords;
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsedLat = numericCoordinate(match[1], -90, 90);
    const parsedLng = numericCoordinate(match[2], -180, 180);
    if (parsedLat !== null && parsedLng !== null) return { lat: parsedLat, lng: parsedLng };
  }
  return null;
}

function pickAddressPart(address = {}, keys = []) {
  for (const key of keys) {
    const value = cleanText(address[key]);
    if (value) return value;
  }
  return "";
}

function formatPlace(raw = {}) {
  const municipio = cleanText(raw.municipio || raw.city || raw.locality);
  const provincia = cleanText(raw.provincia || raw.region || raw.state || raw.county);
  const pais = cleanText(raw.pais || raw.country);
  const lat = numericCoordinate(raw.lat, -90, 90);
  const lng = numericCoordinate(raw.lng, -180, 180);
  return {
    municipio,
    provincia,
    pais,
    lat,
    lng,
    label: cleanText(raw.label || [municipio, provincia, pais].filter(Boolean).join(", ")),
  };
}

function buildQuery(q, country, region) {
  return [q, region, country].map(cleanText).filter(Boolean).join(", ");
}

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS geo_place_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
      await db.query("ALTER TABLE geo_place_cache ALTER COLUMN id SET DEFAULT gen_random_uuid()");
      await db.query("CREATE INDEX IF NOT EXISTS idx_geo_place_cache_lookup ON geo_place_cache(empresa_id, query_key)");
      await db.query(`
        CREATE TABLE IF NOT EXISTS geo_route_cache (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          route_key TEXT NOT NULL,
          points JSONB NOT NULL DEFAULT '[]'::jsonb,
          distance_km NUMERIC(12,2),
          duration_min INTEGER,
          geometry JSONB NOT NULL DEFAULT '[]'::jsonb,
          provider VARCHAR(40) NOT NULL,
          truck_aware BOOLEAN NOT NULL DEFAULT false,
          warning TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          UNIQUE (empresa_id, route_key)
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_geo_route_cache_lookup ON geo_route_cache(empresa_id, route_key, expires_at)");
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

async function fetchJson(url, options = {}) {
  const { retries: retriesOption, timeoutMs, ...fetchOptions } = options;
  const retries = Math.max(0, Number(retriesOption ?? 1));
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(timeoutMs || EXTERNAL_TIMEOUT_MS));
    try {
      const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(data?.error?.message || data?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      lastError = error;
      if (attempt >= retries || (error.status && error.status < 500 && error.status !== 429)) throw error;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError || new Error("Servicio geografico no disponible");
}

async function withNominatimThrottle(task) {
  const run = nominatimQueue.then(async () => {
    const waitMs = Math.max(0, 1050 - (Date.now() - lastNominatimAt));
    if (waitMs) await new Promise(resolve => setTimeout(resolve, waitMs));
    try {
      return await task();
    } finally {
      lastNominatimAt = Date.now();
    }
  });
  nominatimQueue = run.catch(() => null);
  return run;
}

async function geocodeHere(empresaId, request) {
  const resolved = await resolveApiKey(empresaId, "here");
  if (!resolved.key) return null;
  await assertApiUsageAllowed(empresaId, "here");
  const url = new URL("https://geocode.search.hereapi.com/v1/geocode");
  url.searchParams.set("q", buildQuery(searchQueryFor(request), request.country, request.region));
  url.searchParams.set("limit", "6");
  url.searchParams.set("lang", "es-ES");
  url.searchParams.set("apiKey", resolved.key);
  const data = await fetchJson(url, { retries: 1 });
  await recordApiUsage(empresaId, "here", 1);
  const candidates = (Array.isArray(data.items) ? data.items : []).map(item => {
    const address = item.address || {};
    return {
      provider: "here",
      ...formatPlace({
        municipio: address.city || address.district || address.county,
        provincia: address.county || address.state,
        pais: address.countryName,
        lat: item.position?.lat,
        lng: item.position?.lng,
        label: item.title || address.label,
      }),
      country_code: String(address.countryCode || "").slice(0, 2).toLowerCase(),
      result_type: item.resultType || item.localityType || "",
      quality: Number(item.scoring?.queryScore || item.scoring?.fieldScore?.city || 0),
    };
  });
  return selectBestPlaceCandidate(request, candidates);
}

// Geocodificador de Google (Geocoding API). Autenticado por key, no depende de
// la IP: es el proveedor mas fiable para poblaciones/direcciones de cualquier pais.
async function geocodeGoogle(empresaId, request) {
  const resolved = await resolveApiKey(empresaId, "google");
  if (!resolved.key) return null;
  await assertApiUsageAllowed(empresaId, "google");
  const query = buildQuery(searchQueryFor(request), request.country, request.region);
  const place = await googleGeocode(resolved.key, query, { region: countryCodeFor(request.country) || "es", language: "es" });
  await recordApiUsage(empresaId, "google", 1).catch(() => {});
  if (!place || place.lat == null) return null;
  const candidate = {
    provider: "google",
    ...formatPlace({ municipio: place.municipio, provincia: place.provincia, pais: place.pais, lat: place.lat, lng: place.lng, label: place.label }),
    country_code: place.country_code,
  };
  return selectBestPlaceCandidate(request, [candidate]);
}

async function geocodeNominatim(request) {
  return withNominatimThrottle(async () => {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("namedetails", "1");
    url.searchParams.set("limit", "8");
    url.searchParams.set("accept-language", "es");
    url.searchParams.set("q", buildQuery(searchQueryFor(request), request.country, request.region));
    // App de transporte centrada en Espana: sin pista de pais, restringimos a ES
    // para que un nombre de poblacion ambiguo no resuelva a otro pais
    // (p.ej. "Guadalajara" -> Mexico, "Leon" -> EE.UU.).
    const countryCode = countryCodeFor(request.country) || "es";
    if (countryCode) url.searchParams.set("countrycodes", countryCode);
    const data = await fetchJson(url, {
      retries: 1,
      headers: { "User-Agent": "TransGestTMS/1.0 (https://app.gauna.es; soporte@gauna.es)" },
    });
    const candidates = (Array.isArray(data) ? data : []).map(item => {
      const address = item.address || {};
      return {
        provider: "nominatim",
        ...formatPlace({
          municipio: pickAddressPart(address, ["city", "town", "village", "municipality", "hamlet", "suburb"]),
          provincia: pickAddressPart(address, ["province", "state", "region", "county"]),
          pais: address.country,
          lat: item.lat,
          lng: item.lon,
          label: item.display_name,
        }),
        country_code: String(address.country_code || "").toLowerCase(),
        aliases: Object.values(item.namedetails || {}).filter(value => typeof value === "string"),
        result_type: item.addresstype || item.type || "",
        quality: Number(item.importance || 0),
      };
    });
    return selectBestPlaceCandidate(request, candidates);
  });
}

async function cachePlace(empresaId, queryKey, q, country, region, resolved) {
  const result = formatPlace(resolved);
  await db.query(`
    INSERT INTO geo_place_cache (empresa_id, query_key, query, country_hint, region_hint, provider, result, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (empresa_id, query_key) DO UPDATE SET
      query=EXCLUDED.query, country_hint=EXCLUDED.country_hint, region_hint=EXCLUDED.region_hint,
      provider=EXCLUDED.provider, result=EXCLUDED.result, updated_at=NOW()
  `, [empresaId, queryKey, q, country || null, region || null, resolved.provider || "local", JSON.stringify(result)]);
  return result;
}

async function resolvePlace({ empresaId, q, country = "", region = "", raw = {} }) {
  const direct = directCoordinates(raw);
  if (direct) return { provider: "coordinates", ...formatPlace({ ...raw, ...direct, label: raw.label || q }) };
  // Enlace corto de Google Maps (maps.app.goo.gl): se expande por red y se usa
  // el punto exacto, para no depender de geocodificar el texto.
  const shortLink = await resolveMapsCoords(raw.google_maps_url || raw.maps_url || raw.googleMapsUrl || "");
  if (shortLink) return { provider: "coordinates", ...formatPlace({ ...raw, lat: shortLink.lat, lng: shortLink.lng, label: raw.label || q }) };
  const request = parsePlaceRequest(cleanText(q), country, region);
  const query = request.query;
  if (query.length < 2) throw Object.assign(new Error("Indica una poblacion o direccion"), { status: 400 });
  if (isCountryOnlyQuery(query, request.country)) {
    throw Object.assign(new Error("Indica una poblacion o direccion, no solo el pais"), { status: 400 });
  }
  const queryKey = normalizeKey([PLACE_CACHE_VERSION, query, request.country, request.region].filter(Boolean).join("|"));
  const cached = await db.query(
    "SELECT result, provider FROM geo_place_cache WHERE empresa_id=$1 AND query_key=$2 LIMIT 1",
    [empresaId, queryKey]
  );
  if (cached.rows[0]?.result) {
    const cachedPlace = { ...formatPlace(cached.rows[0].result), provider: cached.rows[0].provider || "cache" };
    const validCached = selectBestPlaceCandidate(request, [cachedPlace]);
    if (validCached) return validCached;
  }

  // Google primero si hay clave configurada: fiable y sin depender de la IP.
  let resolved = await geocodeGoogle(empresaId, request).catch(() => null);
  const fallback = fallbackPlaceForAddress(buildQuery(query, request.country, request.region));
  const localResolved = fallback ? selectBestPlaceCandidate(request, [{ provider: "local", ...formatPlace(fallback) }]) : null;
  if (!resolved || resolved.lat == null || resolved.lng == null) {
    if (request.localityOnly) {
      resolved = localResolved;
      if (resolved?.lat == null || resolved?.lng == null) resolved = await geocodeNominatim(request).catch(() => null);
      if (resolved?.lat == null || resolved?.lng == null) resolved = await geocodeHere(empresaId, request).catch(() => null);
    } else {
      resolved = await geocodeHere(empresaId, request).catch(() => null);
      if (resolved?.lat == null || resolved?.lng == null) resolved = await geocodeNominatim(request).catch(() => null);
    }
  }
  if (resolved?.lat == null || resolved?.lng == null) {
    resolved = localResolved;
  }
  if (resolved?.lat == null || resolved?.lng == null) {
    throw Object.assign(
      new Error(`No se pudo localizar con seguridad "${query}". Indica la provincia o selecciona un punto guardado.`),
      { status: 422 }
    );
  }
  const result = await cachePlace(empresaId, queryKey, query, request.country, request.region, resolved);
  return { provider: resolved.provider || "local", ...result };
}

function normalizeRoutePoint(raw, index, total) {
  const point = typeof raw === "string" ? { label: raw } : (raw || {});
  const role = cleanText(point.role || point.tipo || (index === 0 ? "origen" : index === total - 1 ? "destino" : "parada"));
  const label = cleanText(point.label || point.nombre || point.name || point.address || point.direccion || point.query);
  const hasExplicitQuery = Object.prototype.hasOwnProperty.call(point, "query");
  const address = cleanText(point.address || point.direccion);
  const city = cleanText(point.city || point.ciudad || point.localidad || point.poblacion || point.municipio);
  const region = cleanText(point.region || point.provincia || point.state);
  const country = cleanText(point.country || point.pais);
  const structuredQuery = [address, city, region, country].filter(Boolean).join(", ");
  const query = cleanText(hasExplicitQuery ? point.query : (structuredQuery || label));
  return {
    ...point,
    role,
    label,
    query,
    address,
    direccion: address,
    city,
    ciudad: city,
    country,
    region,
  };
}

function parseRoutePoints(req) {
  let raw = req.body?.points || req.body?.puntos || req.query.points || req.query.puntos;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { raw = []; }
  }
  if (!Array.isArray(raw) || raw.length < 2) {
    const origin = cleanText(req.body?.origin || req.body?.origen || req.query.origin || req.query.origen);
    const destination = cleanText(req.body?.destination || req.body?.destino || req.query.destination || req.query.destino);
    raw = [origin, destination].filter(Boolean);
  }
  if (raw.length < 2) throw Object.assign(new Error("Indica al menos origen y destino"), { status: 400 });
  return raw.slice(0, MAX_ROUTE_POINTS).map((point, index, list) => normalizeRoutePoint(point, index, list.length));
}

function haversineKm(from, to) {
  const toRad = value => (Number(value) * Math.PI) / 180;
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(to.lng) - toRad(from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimatedRoute(points, reason = "") {
  const straightKm = points.slice(1).reduce((sum, point, index) => sum + haversineKm(points[index], point), 0);
  const km = Math.max(1, Math.round(straightKm * 1.24));
  return {
    km,
    duration_min: Math.round((km / 68) * 60),
    geometry: points.map(point => [point.lat, point.lng]),
    provider: "estimate",
    truck_aware: false,
    warning: `Distancia estimada temporalmente${reason ? `: ${reason}` : ""}. Recalcular antes de confirmar el viaje.`,
  };
}

async function routeOrsHgv(empresaId, points) {
  const resolved = await resolveApiKey(empresaId, "ors");
  if (!resolved.key) return null;
  await assertApiUsageAllowed(empresaId, "ors");
  const data = await fetchJson("https://api.openrouteservice.org/v2/directions/driving-hgv/geojson", {
    method: "POST",
    retries: 1,
    headers: { Authorization: resolved.key, "Content-Type": "application/json" },
    body: JSON.stringify({ coordinates: points.map(point => [point.lng, point.lat]), instructions: false }),
  });
  const feature = data?.features?.[0];
  const summary = feature?.properties?.summary || {};
  const coordinates = feature?.geometry?.coordinates || [];
  if (!summary.distance || coordinates.length < 2) return null;
  await recordApiUsage(empresaId, "ors", 1);
  return {
    km: Math.round((Number(summary.distance) / 1000) * 10) / 10,
    duration_min: Math.round(Number(summary.duration || 0) / 60),
    geometry: coordinates.map(([lng, lat]) => [lat, lng]),
    provider: "ors_hgv",
    truck_aware: true,
    warning: "",
  };
}

async function routeOsrm(points) {
  const coordinates = points.map(point => `${point.lng},${point.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=false`;
  const data = await fetchJson(url, { retries: 1 });
  const route = data?.routes?.[0];
  const geometry = route?.geometry?.coordinates || [];
  if (data?.code !== "Ok" || !route?.distance || geometry.length < 2) return null;
  return {
    km: Math.round((Number(route.distance) / 1000) * 10) / 10,
    duration_min: Math.round(Number(route.duration || 0) / 60),
    geometry: geometry.map(([lng, lat]) => [lat, lng]),
    provider: "osrm",
    truck_aware: false,
    warning: "Ruta orientativa: no contempla todas las restricciones especificas de camion.",
  };
}

function routeKey(points) {
  return crypto.createHash("sha256").update(points.map(point => (
    `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`
  )).join("|")).digest("hex");
}

async function cachedRoute(empresaId, key) {
  const { rows } = await db.query(`
    SELECT points, distance_km, duration_min, geometry, provider, truck_aware, warning
    FROM geo_route_cache
    WHERE empresa_id=$1 AND route_key=$2 AND expires_at > NOW()
    LIMIT 1
  `, [empresaId, key]);
  if (!rows[0]) return null;
  return {
    km: Number(rows[0].distance_km),
    duration_min: Number(rows[0].duration_min || 0),
    geometry: rows[0].geometry || [],
    provider: rows[0].provider,
    truck_aware: Boolean(rows[0].truck_aware),
    warning: rows[0].warning || "",
  };
}

async function saveRouteCache(empresaId, key, points, route) {
  if (!["ors_hgv", "osrm"].includes(route.provider)) return;
  await db.query(`
    INSERT INTO geo_route_cache
      (empresa_id, route_key, points, distance_km, duration_min, geometry, provider, truck_aware, warning, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()+($10::int * INTERVAL '1 day'))
    ON CONFLICT (empresa_id, route_key) DO UPDATE SET
      points=EXCLUDED.points, distance_km=EXCLUDED.distance_km, duration_min=EXCLUDED.duration_min,
      geometry=EXCLUDED.geometry, provider=EXCLUDED.provider, truck_aware=EXCLUDED.truck_aware,
      warning=EXCLUDED.warning, created_at=NOW(), expires_at=EXCLUDED.expires_at
  `, [
    empresaId, key, JSON.stringify(points), route.km, route.duration_min,
    JSON.stringify(route.geometry), route.provider, route.truck_aware, route.warning || null, ROUTE_CACHE_DAYS,
  ]);
}

async function handleResolve(req, res, next) {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });
    await ensureSchema();
    const q = cleanText(req.query.q);
    const country = cleanText(req.query.country || req.query.pais);
    const region = cleanText(req.query.region || req.query.provincia);
    const result = await resolvePlace({ empresaId, q, country, region, raw: req.query });
    res.json({ ok: true, source: result.provider === "local" ? "fallback" : "provider", ...result });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    next(error);
  }
}

async function handleRoute(req, res, next) {
  try {
    const empresaId = req.user?.empresa_id || req.empresaId;
    if (!empresaId) return res.status(401).json({ error: "Empresa no identificada" });
    await ensureSchema();
    const rawPoints = parseRoutePoints(req);
    const points = [];
    for (const raw of rawPoints) {
      const resolved = await resolvePlace({
        empresaId,
        q: raw.query,
        country: raw.country,
        region: raw.region,
        raw,
      });
      points.push({
        ...raw,
        lat: resolved.lat,
        lng: resolved.lng,
        label: raw.label || resolved.label,
        municipio: resolved.municipio,
        provincia: resolved.provincia,
        pais: resolved.pais,
        geocode_provider: resolved.provider,
      });
    }

    const key = routeKey(points);
    let route = await cachedRoute(empresaId, key);
    let source = "cache";
    if (!route) {
      source = "live";
      route = await routeOrsHgv(empresaId, points).catch(() => null);
      if (!route) route = await routeOsrm(points).catch(() => null);
      if (!route) route = estimatedRoute(points, "los motores de ruta no respondieron");
      await saveRouteCache(empresaId, key, points, route);
    }
    res.json({ ok: true, source, points, puntos: points, ...route });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ ok: false, error: error.message });
    next(error);
  }
}

router.get("/resolve", handleResolve);
router.get("/route", handleRoute);
router.post("/route", handleRoute);
router.get("/distance", handleRoute);
router.initializeSchema = ensureSchema;

module.exports = router;

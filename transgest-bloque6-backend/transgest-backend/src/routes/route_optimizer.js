const express = require("express");
const crypto = require("crypto");
const db = require("../services/db");
const { enviarEmail } = require("../services/email");
const { crearNotificacion } = require("../services/notificaciones");
const { resolveApiKey, getCompanyApiConfig, publicStatusForProvider, assertApiUsageAllowed, recordApiUsage } = require("../services/apiKeys");
const { resolveMapsCoords } = require("../services/mapsLink");
const { googleGeocode } = require("../services/googleGeocode");

const router = express.Router();

const DEFAULT_TRUCK = {
  height_m: 4,
  width_m: 2.55,
  length_m: 16.5,
  weight_t: 40,
  axleload_t: 11.5,
};

const PROVIDERS = {
  local: {
    label: "Local / enlace orientativo",
    tier: "base",
    needs_key: false,
    truck_aware: false,
  },
  ors: {
    label: "OpenRouteService Heavy Vehicle",
    tier: "free",
    needs_key: true,
    truck_aware: true,
  },
  here: {
    label: "HERE Routing API Truck",
    tier: "premium",
    needs_key: true,
    truck_aware: true,
  },
};

async function configuredProvider(empresaId) {
  const preferred = String(process.env.ROUTING_PROVIDER || "").trim().toLowerCase();
  if (preferred && preferred !== "local" && PROVIDERS[preferred]) {
    const keyInfo = await resolveRoutingApiKey(empresaId, preferred);
    if (keyInfo.key) return preferred;
  }
  if ((await resolveRoutingApiKey(empresaId, "here")).key) return "here";
  if ((await resolveRoutingApiKey(empresaId, "ors")).key) return "ors";
  return "local";
}

async function resolveRoutingApiKey(empresaId, provider) {
  if (!empresaId || !provider || provider === "local") return { key: "", source: "local" };
  const companyConfig = await getCompanyApiConfig(empresaId, provider);
  if (!companyConfig) return { key: "", source: "company_required" };
  return resolveApiKey(empresaId, provider);
}

function cleanAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function foldRouteText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const CITY_COORDINATES = [
  ["MADRID", -3.7038, 40.4168, ["COMUNIDAD DE MADRID"]],
  ["ALCALA DE HENARES", -3.3640, 40.4810, ["ALCALA HENARES"]],
  ["GETAFE", -3.7319, 40.3083],
  ["LEGANES", -3.7635, 40.3272],
  ["PINTO", -3.6994, 40.2415],
  ["ALICANTE", -0.4907, 38.3452, ["ALACANT"]],
  ["VALENCIA", -0.3763, 39.4699],
  ["GANDIA", -0.1845, 38.9680],
  ["QUART DE POBLET", -0.4450, 39.4814],
  ["LLIRIA", -0.5976, 39.6252, ["LIRIA"]],
  ["CASTELLON", -0.0513, 39.9864, ["CASTELLO"]],
  ["BARCELONA", 2.1734, 41.3851],
  ["TARRAGONA", 1.2445, 41.1189],
  ["LLEIDA", 0.6200, 41.6176, ["LERIDA"]],
  ["GIRONA", 2.8214, 41.9794, ["GERONA"]],
  ["ZARAGOZA", -0.8891, 41.6488],
  ["SEVILLA", -5.9845, 37.3891],
  ["MALAGA", -4.4214, 36.7213],
  ["CORDOBA", -4.7794, 37.8882],
  ["LUCENA", -4.4859, 37.4088],
  ["GRANADA", -3.5986, 37.1773],
  ["JAEN", -3.7903, 37.7796],
  ["ALMERIA", -2.4637, 36.8402],
  ["HUELVA", -6.9447, 37.2614],
  ["CADIZ", -6.2886, 36.5275],
  ["MURCIA", -1.1307, 37.9922],
  ["CARTAGENA", -0.9966, 37.6257],
  ["ABANILLA", -1.0413, 38.2067],
  ["AGOST", -0.6390, 38.4404],
  ["BACAROT", -0.5599, 38.3335],
  ["CAPARROSO", -1.6495, 42.3411],
  ["PAMPLONA", -1.6458, 42.8125, ["IRUNA"]],
  ["BILBAO", -2.9350, 43.2630],
  ["VITORIA", -2.6727, 42.8467, ["GASTEIZ"]],
  ["SAN SEBASTIAN", -1.9812, 43.3183, ["DONOSTIA"]],
  ["IRUN", -1.7894, 43.3382],
  ["LOGRONO", -2.4456, 42.4627],
  ["VALLADOLID", -4.7245, 41.6523],
  ["BURGOS", -3.6969, 42.3439],
  ["LEON", -5.5671, 42.5987],
  ["SALAMANCA", -5.6635, 40.9701],
  ["BADAJOZ", -6.9707, 38.8794],
  ["CACERES", -6.3712, 39.4753],
  ["ALBACETE", -1.8585, 38.9943],
  ["MUNERA", -2.4803, 39.0413, ["MINERA SANTA MARTA", "MINERA SANTA MARTA MSM", "MSM"]],
  ["TOLEDO", -4.0273, 39.8628],
  ["GUADALAJARA", -3.1665, 40.6332],
  ["CIUDAD REAL", -3.9273, 38.9861],
  ["CUENCA", -2.1374, 40.0704],
  ["A CORUNA", -8.4115, 43.3623, ["CORUNA"]],
  ["VIGO", -8.7207, 42.2406],
  ["SANTIAGO DE COMPOSTELA", -8.5448, 42.8782, ["SANTIAGO"]],
  ["OURENSE", -7.8639, 42.3358, ["ORENSE"]],
  ["VILLARRUBIA DE SANTIAGO", -3.3684, 39.9844],
].flatMap(([name, lon, lat, aliases = []]) => [name, ...aliases].map(alias => ({
  alias: foldRouteText(alias),
  label: name,
  lon,
  lat,
}))).sort((a, b) => b.alias.length - a.alias.length);

function htmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function publicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || process.env.FRONTEND_URL || "").replace(/\/$/, "");
  if (configured) return configured;
  return `${req.protocol}://${req.get("host")}`;
}

function routePage(title, body) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${htmlEscape(title)}</title>
  <style>
    body{margin:0;background:#f4f7f6;color:#13201f;font-family:Inter,Segoe UI,Arial,sans-serif}
    main{max-width:760px;margin:0 auto;padding:26px 16px}
    .box{background:#fff;border:1px solid #d8e2df;border-radius:10px;padding:22px;box-shadow:0 18px 40px rgba(15,23,42,.08)}
    h1{font-size:26px;margin:0 0 10px;font-weight:900} p{line-height:1.55}.muted{color:#64748b;font-size:13px}
    .stop{display:grid;grid-template-columns:34px 1fr;gap:10px;border:1px solid #e2e8f0;border-radius:8px;padding:10px;margin:8px 0}
    .n{height:28px;width:28px;border-radius:7px;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900}
    a.btn,button{display:inline-block;background:#0f766e;color:#fff;text-decoration:none;border:0;border-radius:8px;padding:12px 16px;font-weight:900;cursor:pointer}
  </style></head><body><main><div class="box">${body}</div></main></body></html>`;
}

let routeOptimizationSchemaPromise = null;
async function ensureRouteOptimizationSchema() {
  if (!routeOptimizationSchemaPromise) {
    routeOptimizationSchemaPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS route_optimizations (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
          pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
          provider VARCHAR(40) NOT NULL DEFAULT 'local',
          provider_label VARCHAR(120),
          preference VARCHAR(40) NOT NULL DEFAULT 'camion',
          truck_aware BOOLEAN NOT NULL DEFAULT false,
          distance_km NUMERIC(10,2),
          duration_min INTEGER,
          maps_url TEXT,
          stops JSONB NOT NULL DEFAULT '[]'::jsonb,
          truck JSONB NOT NULL DEFAULT '{}'::jsonb,
          waypoint_coordinates JSONB NOT NULL DEFAULT '[]'::jsonb,
          geometry JSONB,
          steps JSONB NOT NULL DEFAULT '[]'::jsonb,
          warning TEXT,
          created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await db.query("CREATE INDEX IF NOT EXISTS idx_route_optimizations_pedido ON route_optimizations(pedido_id, created_at DESC)");
      await db.query("CREATE INDEX IF NOT EXISTS idx_route_optimizations_empresa ON route_optimizations(empresa_id, created_at DESC)");
      await db.query("ALTER TABLE route_optimizations ADD COLUMN IF NOT EXISTS waypoint_coordinates JSONB NOT NULL DEFAULT '[]'::jsonb");
    })().catch(err => {
      routeOptimizationSchemaPromise = null;
      throw err;
    });
  }
  return routeOptimizationSchemaPromise;
}

async function ensureDispatchSchema() {
  await ensureRouteOptimizationSchema();
  await db.query(`
    CREATE TABLE IF NOT EXISTS route_dispatches (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
      pedido_id UUID NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      route_optimization_id UUID REFERENCES route_optimizations(id) ON DELETE SET NULL,
      recipient_type VARCHAR(30) NOT NULL,
      recipient_email VARCHAR(200) NOT NULL,
      recipient_name VARCHAR(200),
      status VARCHAR(30) NOT NULL DEFAULT 'enviada',
      token_hash VARCHAR(80) NOT NULL UNIQUE,
      route_url TEXT,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      opened_at TIMESTAMPTZ,
      accepted_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '30 days'),
      created_by UUID REFERENCES usuarios(id) ON DELETE SET NULL
    )
  `);
  await db.query("CREATE INDEX IF NOT EXISTS idx_route_dispatches_pedido ON route_dispatches(pedido_id, sent_at DESC)");
  await db.query("CREATE INDEX IF NOT EXISTS idx_route_dispatches_token ON route_dispatches(token_hash)");
}

function normalizeStops(stops) {
  if (!Array.isArray(stops)) return [];
  const seen = new Set();
  return stops.map((stop, idx) => {
    const raw = typeof stop === "string" ? { address: stop } : (stop || {});
    const address = cleanAddress(raw.address || raw.direccion || raw.lugar || raw.name || raw.nombre || "");
    const rawGoogleMapsUrl = cleanAddress(raw.google_maps_url || raw.googleMapsUrl || raw.maps_url || raw.url_maps || "");
    const googleMapsUrl = /^(https?:\/\/|geo:)/i.test(rawGoogleMapsUrl) ? rawGoogleMapsUrl : "";
    const lat = raw.lat ?? raw.latitude ?? raw.latitud ?? null;
    const lng = raw.lng ?? raw.lon ?? raw.longitude ?? raw.longitud ?? null;
    return {
      type: cleanAddress(raw.type || raw.tipo || (idx === 0 ? "Carga" : "Parada")),
      name: cleanAddress(raw.name || raw.nombre || address),
      address,
      google_maps_url: googleMapsUrl,
      lat,
      lng,
      date: raw.date || raw.fecha || null,
      time: raw.time || raw.hora || null,
      window: raw.window || raw.ventana || null,
    };
  }).filter(stop => {
    if (!stop.address && !stop.google_maps_url && (stop.lat == null || stop.lng == null)) return false;
    const key = `${stop.address || ""}|${stop.google_maps_url || ""}|${stop.lat || ""},${stop.lng || ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function stopCoordinate(stop) {
  if (!stop) return null;
  const hasLat = stop.lat !== null && stop.lat !== undefined && String(stop.lat).trim() !== "";
  const hasLng = stop.lng !== null && stop.lng !== undefined && String(stop.lng).trim() !== "";
  const lat = hasLat ? Number(stop.lat) : NaN;
  const lng = hasLng ? Number(stop.lng) : NaN;
  if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  return parseCoordinateAddress(stop.google_maps_url) || parseCoordinateAddress(stop.address);
}

function stopQuery(stop) {
  const coord = stopCoordinate(stop);
  if (coord) return `${coord[1]},${coord[0]}`;
  return stop?.address || stop?.google_maps_url || "";
}

// Como stopCoordinate pero, si no hay coords inline y el enlace de Google Maps
// es corto (maps.app.goo.gl), lo expande por red para sacar el punto exacto.
async function resolveStopCoordinate(stop) {
  const sync = stopCoordinate(stop);
  if (sync) return sync;
  const c = await resolveMapsCoords((stop && (stop.google_maps_url || stop.address)) || "");
  if (c) return [c.lng, c.lat];
  return null;
}

function mapsUrl(stops) {
  const addresses = stops.map(stopQuery).filter(Boolean);
  if (!addresses.length) return "";
  const params = new URLSearchParams({
    api: "1",
    origin: addresses[0],
    destination: addresses[addresses.length - 1] || addresses[0],
    travelmode: "driving",
  });
  const waypoints = addresses.slice(1, -1).join("|");
  if (waypoints) params.set("waypoints", waypoints);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function preferenceForProvider(preference, provider) {
  const pref = String(preference || "camion").toLowerCase();
  if (provider === "ors") {
    if (pref === "eficiente" || pref === "segura") return "recommended";
    if (pref === "rapida") return "fastest";
    return "recommended";
  }
  if (provider === "here") {
    if (pref === "eficiente") return "short";
    return "fast";
  }
  return pref;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.ROUTING_TIMEOUT_MS || 12000));
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = data?.error?.message || data?.message || `HTTP ${res.status}`;
      const err = new Error(detail);
      err.status = res.status;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// Sesgo a Espana para geocoders: salvo que la direccion mencione otro pais, se
// restringe la busqueda a ES para que un nombre ambiguo no salte al extranjero
// (p.ej. "Guadalupe" -> Caribe, "Leon" -> EE.UU.).
const OTRO_PAIS_RE = /(francia|france|portugal|italia|italy|alemania|germany|andorra|belgica|belgium|holanda|netherlands|paises bajos|suiza|switzerland|reino unido|united kingdom|uk|marruecos|morocco)/i;
function biasEspana(address) { return !OTRO_PAIS_RE.test(String(address || "")); }

async function geocodeOrs(address, key) {
  const direct = parseCoordinateAddress(address);
  if (direct) return direct;
  const params = new URLSearchParams({ api_key: key, text: address, size: "1" });
  if (biasEspana(address)) params.set("boundary.country", "ES");
  const data = await fetchJson(`https://api.openrouteservice.org/geocode/search?${params.toString()}`);
  const coords = data?.features?.[0]?.geometry?.coordinates;
  if (!Array.isArray(coords)) throw new Error(`No se pudo geocodificar: ${address}`);
  return coords; // [lon, lat]
}

async function geocodeHere(address, key) {
  const direct = parseCoordinateAddress(address);
  if (direct) return direct;
  const params = new URLSearchParams({ apiKey: key, q: address, limit: "1" });
  if (biasEspana(address)) params.set("in", "countryCode:ESP");
  const data = await fetchJson(`https://geocode.search.hereapi.com/v1/geocode?${params.toString()}`);
  const pos = data?.items?.[0]?.position;
  if (!pos) throw new Error(`No se pudo geocodificar: ${address}`);
  return [pos.lng, pos.lat]; // [lon, lat]
}

function parseCoordinateAddress(address) {
  const raw = String(address || "");
  const patterns = [
    /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query|ll)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const pattern of patterns) {
    const m = raw.match(pattern);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return [lng, lat];
  }
  return null;
}

function fallbackCoordinateForAddress(address) {
  const text = foldRouteText(address);
  if (!text) return null;
  const match = CITY_COORDINATES.find(city => text === city.alias || text.includes(city.alias));
  return match ? [match.lon, match.lat] : null;
}

function haversineKm(from, to) {
  if (!Array.isArray(from) || !Array.isArray(to)) return 0;
  const toRad = n => (Number(n) * Math.PI) / 180;
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);
  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function estimatedRouteFromCoordinates(coordinates, stops, reason = "") {
  const straightKm = coordinates.slice(1).reduce((sum, coord, idx) => sum + haversineKm(coordinates[idx], coord), 0);
  const distanceKm = straightKm ? Math.max(1, Math.round(straightKm * 1.24)) : null;
  return {
    provider: "local",
    provider_label: "Local / estimacion gratuita",
    truck_aware: false,
    distance_km: distanceKm,
    duration_min: distanceKm ? Math.round((distanceKm / 68) * 60) : null,
    waypoint_coordinates: coordinates.map(([lon, lat], idx) => ({ idx, lon, lat, address: stops[idx]?.address || stops[idx]?.name || "" })),
    geometry: null,
    steps: [],
    warning: `Calculo gratuito estimado por coordenadas locales${reason ? ` porque OSRM no respondio: ${reason}` : ""}. Validar con navegador de camion antes de ejecutar.`,
  };
}

async function geocodeLocal(address, googleKey) {
  const direct = parseCoordinateAddress(address);
  if (direct) return direct;
  if (googleKey) {
    const g = await googleGeocode(googleKey, cleanAddress(address), { region: "es", language: "es" }).catch(() => null);
    if (g && Number.isFinite(g.lat) && Number.isFinite(g.lng)) return [g.lng, g.lat];
  }
  const fallback = fallbackCoordinateForAddress(address);
  if (fallback) return fallback;
  const cleaned = cleanAddress(address);
  const queries = [cleaned];
  if (!/\b(spain|espana|españa)\b/i.test(cleaned)) queries.push(`${cleaned}, España`);
  let lastError = "";
  for (const q of queries) {
    const params = new URLSearchParams({ q, format: "json", limit: "1", addressdetails: "1" });
      if (biasEspana(q)) params.set("countrycodes", "es");
    try {
      const data = await fetchJson(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
          "Accept-Language": "es",
          "User-Agent": "TransGest-TMS/1.0 soporte@transgest.local",
        },
      });
      if (Array.isArray(data) && data[0]) return [Number(data[0].lon), Number(data[0].lat)];
    } catch (e) {
      lastError = e.message;
    }
  }
  throw new Error(`No se encontro la direccion "${cleaned}". Revisa que tenga localidad/provincia o usa un enlace de Google Maps con coordenadas.${lastError ? ` Detalle: ${lastError}` : ""}`);
}

async function routeLocal(stops, googleKey) {
  const coordinates = [];
  for (const stop of stops) coordinates.push(await resolveStopCoordinate(stop) || await geocodeLocal(stopQuery(stop) || stop?.name || "", googleKey));
  let data;
  try {
    data = await fetchJson(
      `https://router.project-osrm.org/route/v1/driving/${coordinates.map(([lon, lat]) => `${lon},${lat}`).join(";")}?overview=false&steps=true`
    );
  } catch (e) {
    return estimatedRouteFromCoordinates(coordinates, stops, e.message);
  }
  if (data?.code !== "Ok" || !data?.routes?.[0]) return estimatedRouteFromCoordinates(coordinates, stops, data?.message || "sin ruta OSRM");
  const route = data.routes[0];
  return {
    provider: "local",
    provider_label: "Local / OSRM orientativo",
    truck_aware: false,
    distance_km: route.distance ? Math.round(Number(route.distance) / 1000) : null,
    duration_min: route.duration ? Math.round(Number(route.duration) / 60) : null,
    waypoint_coordinates: coordinates.map(([lon, lat], idx) => ({ idx, lon, lat, address: stops[idx]?.address || "" })),
    geometry: null,
    steps: (route.legs || []).flatMap(l => l.steps || []).slice(0, 80),
  };
}

async function routeOrs(stops, preference, truck, apiKey) {
  if (!apiKey) throw new Error("ORS_API_KEY no configurada");
  const coordinates = [];
  for (const stop of stops) coordinates.push(await resolveStopCoordinate(stop) || await geocodeOrs(stopQuery(stop), apiKey));
  const body = {
    coordinates,
    preference: preferenceForProvider(preference, "ors"),
    instructions: true,
    options: {
      profile_params: {
        restrictions: {
          height: Number(truck.height_m || DEFAULT_TRUCK.height_m),
          width: Number(truck.width_m || DEFAULT_TRUCK.width_m),
          length: Number(truck.length_m || DEFAULT_TRUCK.length_m),
          weight: Number(truck.weight_t || DEFAULT_TRUCK.weight_t),
          axleload: Number(truck.axleload_t || DEFAULT_TRUCK.axleload_t),
        },
      },
    },
  };
  const data = await fetchJson("https://api.openrouteservice.org/v2/directions/driving-hgv/geojson", {
    method: "POST",
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const props = data?.features?.[0]?.properties || {};
  const summary = props.summary || {};
  return {
    provider: "ors",
    provider_label: PROVIDERS.ors.label,
    truck_aware: true,
    distance_km: summary.distance ? Math.round(summary.distance / 1000) : null,
    duration_min: summary.duration ? Math.round(summary.duration / 60) : null,
    waypoint_coordinates: coordinates.map(([lon, lat], idx) => ({ idx, lon, lat, address: stops[idx]?.address || "" })),
    geometry: data?.features?.[0]?.geometry || null,
    steps: props.segments?.flatMap(s => s.steps || []).slice(0, 80) || [],
  };
}

async function routeHere(stops, preference, truck, apiKey) {
  if (!apiKey) throw new Error("HERE_API_KEY no configurada");
  const coordinates = [];
  for (const stop of stops) coordinates.push(await resolveStopCoordinate(stop) || await geocodeHere(stopQuery(stop), apiKey));
  const params = new URLSearchParams({
    apiKey,
    transportMode: "truck",
    routingMode: preferenceForProvider(preference, "here"),
    origin: `${coordinates[0][1]},${coordinates[0][0]}`,
    destination: `${coordinates[coordinates.length - 1][1]},${coordinates[coordinates.length - 1][0]}`,
    return: "summary,polyline,actions",
  });
  coordinates.slice(1, -1).forEach(c => params.append("via", `${c[1]},${c[0]}`));
  params.set("truck[height]", String(Math.round(Number(truck.height_m || DEFAULT_TRUCK.height_m) * 100)));
  params.set("truck[width]", String(Math.round(Number(truck.width_m || DEFAULT_TRUCK.width_m) * 100)));
  params.set("truck[length]", String(Math.round(Number(truck.length_m || DEFAULT_TRUCK.length_m) * 100)));
  params.set("truck[grossWeight]", String(Math.round(Number(truck.weight_t || DEFAULT_TRUCK.weight_t) * 1000)));
  params.set("truck[weightPerAxle]", String(Math.round(Number(truck.axleload_t || DEFAULT_TRUCK.axleload_t) * 1000)));
  const data = await fetchJson(`https://router.hereapi.com/v8/routes?${params.toString()}`);
  const sections = data?.routes?.[0]?.sections || [];
  const distance = sections.reduce((sum, s) => sum + Number(s.summary?.length || 0), 0);
  const duration = sections.reduce((sum, s) => sum + Number(s.summary?.duration || 0), 0);
  return {
    provider: "here",
    provider_label: PROVIDERS.here.label,
    truck_aware: true,
    distance_km: distance ? Math.round(distance / 1000) : null,
    duration_min: duration ? Math.round(duration / 60) : null,
    waypoint_coordinates: coordinates.map(([lon, lat], idx) => ({ idx, lon, lat, address: stops[idx]?.address || "" })),
    geometry: sections.map(s => s.polyline).filter(Boolean),
    steps: sections.flatMap(s => s.actions || []).slice(0, 120),
  };
}

function localRoute(stops) {
  return {
    provider: "local",
    provider_label: PROVIDERS.local.label,
    truck_aware: false,
    distance_km: null,
    duration_min: null,
    geometry: null,
    steps: [],
  };
}

router.get("/providers", async (req, res, next) => {
  try {
  const active = await configuredProvider(req.user?.empresa_id);
  const hereStatus = await publicStatusForProvider("here", req.user?.empresa_id);
  const orsStatus = await publicStatusForProvider("ors", req.user?.empresa_id);
  const hereKey = await resolveRoutingApiKey(req.user?.empresa_id, "here");
  const orsKey = await resolveRoutingApiKey(req.user?.empresa_id, "ors");
  res.json({
    active,
    providers: Object.fromEntries(Object.entries(PROVIDERS).map(([key, meta]) => [key, {
      ...meta,
      configured: key === "local" || (key === "ors" && !!orsKey.key) || (key === "here" && !!hereKey.key),
      key_source: key === "local" ? "local" : key === "ors" ? orsKey.source : key === "here" ? hereKey.source : "none",
      requires_company_config: key !== "local",
    }])),
    status: { here: hereStatus, ors: orsStatus },
  });
  } catch (e) { next(e); }
});

router.get("/pedido/:pedidoId/latest", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada en sesion." });
    await ensureRouteOptimizationSchema();
    const { rows } = await db.query(
      `SELECT *
       FROM route_optimizations
       WHERE empresa_id=$1 AND pedido_id=$2
       ORDER BY created_at DESC
       LIMIT 1`,
      [empresaId, req.params.pedidoId]
    );
    res.json(rows[0] || null);
  } catch (e) {
    next(e);
  }
});

router.get("/pedido/:pedidoId/dispatches", async (req, res, next) => {
  try {
    await ensureDispatchSchema();
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada en sesion." });
    const { rows } = await db.query(
      `SELECT id, route_optimization_id, recipient_type, recipient_email, recipient_name,
              status, route_url, payload, sent_at, opened_at, accepted_at, expires_at
       FROM route_dispatches
       WHERE empresa_id=$1 AND pedido_id=$2
       ORDER BY sent_at DESC
       LIMIT 50`,
      [empresaId, req.params.pedidoId]
    );
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

router.post("/pedido/:pedidoId/send", async (req, res, next) => {
  try {
    await ensureDispatchSchema();
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada en sesion." });
    const recipientType = ["chofer", "chofer_app", "colaborador"].includes(String(req.body?.recipient_type || "").toLowerCase())
      ? String(req.body.recipient_type).toLowerCase()
      : "chofer";

    const { rows } = await db.query(
      `SELECT p.id, p.numero, p.origen, p.destino, p.fecha_carga, p.empresa_id,
              co.nombre AS colaborador_nombre, co.email AS colaborador_email,
              ch.nombre AS chofer_nombre, ch.apellidos AS chofer_apellidos, ch.email AS chofer_email,
              chu.id AS chofer_user_id, chu.email AS chofer_user_email, chu.nombre AS chofer_user_nombre
       FROM pedidos p
       LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
       LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id
       LEFT JOIN LATERAL (
         SELECT u.id, u.email, u.nombre
           FROM usuarios u
          WHERE u.empresa_id=p.empresa_id
            AND u.chofer_id=p.chofer_id
            AND u.rol::text='chofer'
            AND u.activo=true
          ORDER BY u.ultimo_acceso DESC NULLS LAST, u.created_at DESC NULLS LAST
          LIMIT 1
       ) chu ON true
       WHERE p.id=$1 AND p.empresa_id=$2
       LIMIT 1`,
      [req.params.pedidoId, empresaId]
    );
    const pedido = rows[0];
    if (!pedido) return res.status(404).json({ error: "Pedido no encontrado para esta empresa." });

    const routeRows = await db.query(
      `SELECT *
       FROM route_optimizations
       WHERE empresa_id=$1 AND pedido_id=$2
       ORDER BY created_at DESC
       LIMIT 1`,
      [empresaId, pedido.id]
    );
    const route = routeRows.rows[0] || null;
    const routeUrl = cleanAddress(req.body?.route_url || route?.maps_url || "");
    if (!routeUrl) return res.status(400).json({ error: "Calcula o genera una ruta antes de enviarla." });

    if (recipientType === "chofer_app" && !pedido.chofer_user_id) {
      return res.status(400).json({ error: "El chofer no tiene un usuario de app activo vinculado. Vincula la ficha de chofer con un usuario de rol chofer o envia la ruta por email." });
    }

    const fallbackEmail = recipientType === "chofer_app"
      ? (pedido.chofer_user_email || pedido.chofer_email || `app:${pedido.chofer_user_id}`)
      : recipientType === "chofer"
        ? pedido.chofer_email
        : pedido.colaborador_email;
    const recipientEmail = cleanAddress(req.body?.email || fallbackEmail);
    if (!recipientEmail) return res.status(400).json({ error: recipientType === "colaborador" ? "El colaborador no tiene email registrado." : "El chofer no tiene email registrado." });
    const recipientName = cleanAddress(req.body?.name || (recipientType === "chofer"
      ? [pedido.chofer_nombre, pedido.chofer_apellidos].filter(Boolean).join(" ")
      : recipientType === "chofer_app"
        ? (pedido.chofer_user_nombre || [pedido.chofer_nombre, pedido.chofer_apellidos].filter(Boolean).join(" "))
      : pedido.colaborador_nombre));

    const token = crypto.randomBytes(32).toString("hex");
    const publicUrl = `${publicBaseUrl(req)}/api/v1/route-optimizer/public/route/${token}`;
    const payload = {
      preference: req.body?.preference || route?.preference || "camion",
      distance_km: req.body?.distance_km || route?.distance_km || null,
      duration_label: req.body?.duration_label || null,
      stops: Array.isArray(req.body?.stops) && req.body.stops.length ? req.body.stops : route?.stops || [],
      maps_url: routeUrl,
      provider_label: route?.provider_label || req.body?.provider_label || null,
    };

    const saved = await db.query(
      `INSERT INTO route_dispatches
        (empresa_id,pedido_id,route_optimization_id,recipient_type,recipient_email,recipient_name,token_hash,route_url,payload,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
       RETURNING id, status, sent_at, expires_at`,
      [
        empresaId,
        pedido.id,
        route?.id || null,
        recipientType,
        recipientEmail,
        recipientName,
        hashToken(token),
        routeUrl,
        JSON.stringify(payload),
        req.user?.id || null,
      ]
    );

    if (recipientType === "chofer_app") {
      await crearNotificacion({
        empresa_id: empresaId,
        usuario_id: pedido.chofer_user_id,
        tipo: "ruta_chofer_app",
        titulo: `Ruta enviada ${pedido.numero || ""}`.trim(),
        mensaje: `Trafico ha enviado la ruta recomendada del viaje ${pedido.numero || ""}.`,
        data: {
          pedido_id: pedido.id,
          pedido_numero: pedido.numero || "",
          route_dispatch_id: saved.rows[0]?.id || null,
          route_url: publicUrl,
          maps_url: routeUrl,
          preference: payload.preference,
          distance_km: payload.distance_km || null,
          duration_label: payload.duration_label || "",
          dedupe_key: `ruta_chofer_app:${pedido.id}:${saved.rows[0]?.id || ""}`,
        },
        created_by: req.user?.id || null,
      });
    } else {
      await enviarEmail({
        trigger: `ruta_${recipientType}`,
        destinatario: recipientEmail,
        plantilla: "ruta_recomendada",
        empresa_id: empresaId,
        datos: {
          numero: pedido.numero || "",
          preferencia: payload.preference,
          km: payload.distance_km ? `${Number(payload.distance_km).toLocaleString("es-ES")} km` : "",
          tiempo: payload.duration_label || "",
          url: publicUrl,
        },
      });
    }

    res.json({ ok: true, dispatch: saved.rows[0], public_url: publicUrl, app_notification: recipientType === "chofer_app" });
  } catch (e) {
    next(e);
  }
});

async function getDispatchByToken(token) {
  await ensureDispatchSchema();
  const { rows } = await db.query(
    `SELECT d.*, p.numero, p.origen, p.destino, p.fecha_carga, e.nombre AS empresa_nombre
     FROM route_dispatches d
     JOIN pedidos p ON p.id=d.pedido_id AND p.empresa_id=d.empresa_id
     LEFT JOIN empresas e ON e.id=d.empresa_id
     WHERE d.token_hash=$1 AND d.expires_at > NOW()
     LIMIT 1`,
    [hashToken(token)]
  );
  return rows[0] || null;
}

router.get("/public/route/:token", async (req, res) => {
  try {
    const data = await getDispatchByToken(req.params.token);
    if (!data) return res.status(404).send(routePage("Ruta no disponible", "<h1>Ruta no disponible</h1><p>El enlace ha caducado o no existe.</p>"));
    if (!data.opened_at) {
      await db.query(
        "UPDATE route_dispatches SET opened_at=NOW(), status=CASE WHEN status='enviada' THEN 'abierta' ELSE status END WHERE id=$1 AND token_hash=$2",
        [data.id, data.token_hash]
      );
    }
    const payload = data.payload || {};
    const stops = Array.isArray(payload.stops) ? payload.stops : [];
    const stopsHtml = stops.map((s, idx) => `
      <div class="stop"><div class="n">${idx + 1}</div><div>
        <strong>${htmlEscape(s.type || (idx === 0 ? "Carga" : "Parada"))}</strong>
        <div>${htmlEscape(s.name || "")}</div>
        <div class="muted">${htmlEscape(s.address || s)}</div>
      </div></div>`).join("");
    res.send(routePage("Ruta recomendada", `
      <h1>Ruta recomendada</h1>
      <p><strong>${htmlEscape(data.empresa_nombre || "TransGest")}</strong> te ha enviado la ruta del pedido <strong>${htmlEscape(data.numero || "")}</strong>.</p>
      <p class="muted">${htmlEscape(data.origen || "")} -> ${htmlEscape(data.destino || "")}</p>
      ${stopsHtml || "<p class='muted'>No hay paradas detalladas registradas.</p>"}
      <p><a class="btn" href="${htmlEscape(data.route_url || payload.maps_url || "#")}" target="_blank" rel="noopener noreferrer">Abrir navegacion</a></p>
      <form method="post" action="/api/v1/route-optimizer/public/route/${htmlEscape(req.params.token)}/accept">
        <button type="submit">Marcar ruta aceptada</button>
      </form>
      <p class="muted">Antes de salir, valida galibo, MMA, ADR si aplica, restricciones urbanas y accesos al muelle.</p>
    `));
  } catch (e) {
    res.status(500).send(routePage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`));
  }
});

router.post("/public/route/:token/accept", async (req, res) => {
  try {
    const data = await getDispatchByToken(req.params.token);
    if (!data) return res.status(404).send(routePage("Ruta no disponible", "<h1>Ruta no disponible</h1><p>El enlace ha caducado o no existe.</p>"));
    await db.query(
      "UPDATE route_dispatches SET accepted_at=NOW(), opened_at=COALESCE(opened_at,NOW()), status='aceptada' WHERE id=$1 AND token_hash=$2",
      [data.id, data.token_hash]
    );
    res.send(routePage("Ruta aceptada", "<h1>Ruta aceptada</h1><p>Se ha registrado la aceptacion de la ruta. Buen viaje.</p>"));
  } catch (e) {
    res.status(500).send(routePage("Error", `<h1>Error</h1><p>${htmlEscape(e.message)}</p>`));
  }
});

router.post("/optimize", async (req, res, next) => {
  try {
    const empresaId = req.user?.empresa_id;
    if (!empresaId) return res.status(400).json({ error: "Empresa no encontrada en sesion." });
    const stops = normalizeStops(req.body?.stops);
    if (stops.length < 2) return res.status(400).json({ error: "Se necesitan al menos origen y destino." });
    const googleKey = (await resolveApiKey(empresaId, "google").catch(() => ({ key: "" }))).key || "";

    const requestedProvider = String(req.body?.provider || await configuredProvider(empresaId)).toLowerCase();
    const provider = PROVIDERS[requestedProvider] ? requestedProvider : await configuredProvider(empresaId);
    const keyInfo = provider === "local" ? { key:"", source:"local" } : await resolveRoutingApiKey(empresaId, provider);
    if (provider !== "local" && !keyInfo.key) {
      return res.status(400).json({
        error: `Configura la API ${PROVIDERS[provider]?.label || provider} en la empresa antes de calcular rutas reales.`,
        provider,
        key_source: keyInfo.source,
      });
    }
    if (provider !== "local") await assertApiUsageAllowed(empresaId, provider);
    const truck = { ...DEFAULT_TRUCK, ...(req.body?.truck || {}) };
    let result;
    let warning = null;

    try {
      if (provider === "here") result = await routeHere(stops, req.body?.preference, truck, keyInfo.key);
      else if (provider === "ors") result = await routeOrs(stops, req.body?.preference, truck, keyInfo.key);
      else result = await routeLocal(stops, googleKey);
      if (result.provider !== "local") await recordApiUsage(empresaId, result.provider, 1);
    } catch (e) {
      warning = `${PROVIDERS[provider]?.label || provider}: ${e.message}. Se intenta calculo orientativo con mapa gratuito.`;
      try {
        result = await routeLocal(stops, googleKey);
        warning = `${warning} Distancia calculada con mapa gratuito; revisar restricciones de camion.`;
      } catch (fallbackError) {
        warning = `${warning} No se pudo calcular distancia automatica: ${fallbackError.message}. Se usa enlace orientativo.`;
        result = localRoute(stops);
      }
    }

    const payload = {
      ok: true,
      preference: req.body?.preference || "camion",
      stops,
      maps_url: mapsUrl(stops),
      truck,
      warning,
      ...result,
      key_source: keyInfo.source,
    };

    if (req.body?.pedido_id) {
      try {
        await ensureRouteOptimizationSchema();
        const check = await db.query(
          "SELECT id FROM pedidos WHERE id=$1 AND empresa_id=$2 LIMIT 1",
          [req.body.pedido_id, empresaId]
        );
        if (!check.rows[0]) return res.status(404).json({ error: "Pedido no encontrado para esta empresa." });
        const saved = await db.query(
          `INSERT INTO route_optimizations
            (empresa_id,pedido_id,provider,provider_label,preference,truck_aware,distance_km,duration_min,maps_url,stops,truck,waypoint_coordinates,geometry,steps,warning,created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16)
           RETURNING id, created_at`,
          [
            empresaId,
            req.body.pedido_id,
            payload.provider,
            payload.provider_label,
            payload.preference,
            !!payload.truck_aware,
            payload.distance_km,
            payload.duration_min,
            payload.maps_url,
            JSON.stringify(payload.stops || []),
            JSON.stringify(payload.truck || {}),
            JSON.stringify(payload.waypoint_coordinates || []),
            JSON.stringify(payload.geometry || null),
            JSON.stringify(payload.steps || []),
            payload.warning,
            req.user?.id || null,
          ]
        );
        payload.saved = { id: saved.rows[0].id, created_at: saved.rows[0].created_at };
      } catch (saveError) {
        console.warn("[route_optimizer] ruta calculada sin guardar historico:", saveError.message);
        payload.warning = `${payload.warning ? `${payload.warning} ` : ""}Ruta calculada, pero no se pudo guardar el historico automaticamente.`;
      }
    }

    res.json(payload);
  } catch (e) {
    next(e);
  }
});

module.exports = router;

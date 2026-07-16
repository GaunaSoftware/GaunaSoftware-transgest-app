// Cliente de la Geocoding API de Google. Es una API autenticada (por key), asi
// que NO depende de la IP del servidor ni de bots: resuelve poblaciones y
// direcciones de forma fiable para cualquier pais (Espana, Francia, etc.).
// Requiere una API key de Google Maps Platform con "Geocoding API" habilitada.

function pickComponent(components, types) {
  const list = Array.isArray(components) ? components : [];
  const match = list.find(c => Array.isArray(c.types) && types.some(t => c.types.includes(t)));
  return match ? match.long_name : "";
}

// Geocodifica una direccion/poblacion. Devuelve {lat,lng,municipio,provincia,
// pais,country_code,label,place_id} o null.
async function googleGeocode(key, query, { region = "es", language = "es" } = {}) {
  const text = String(query || "").trim();
  if (!key || text.length < 2) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", text);
  url.searchParams.set("key", key);
  if (region) url.searchParams.set("region", region);
  if (language) url.searchParams.set("language", language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.GOOGLE_GEOCODE_TIMEOUT_MS || 8000));
  try {
    const res = await fetch(url, { signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (data.status && data.status !== "OK") return null;
    const r = Array.isArray(data.results) ? data.results[0] : null;
    const loc = r && r.geometry && r.geometry.location;
    if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) return null;
    const comps = r.address_components || [];
    return {
      lat: Number(loc.lat),
      lng: Number(loc.lng),
      municipio: pickComponent(comps, ["locality", "postal_town", "administrative_area_level_3", "administrative_area_level_4"]),
      provincia: pickComponent(comps, ["administrative_area_level_2", "administrative_area_level_1"]),
      pais: pickComponent(comps, ["country"]),
      country_code: (comps.find(c => (c.types || []).includes("country")) || {}).short_name?.toLowerCase() || "",
      label: r.formatted_address || text,
      place_id: r.place_id || "",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { googleGeocode };

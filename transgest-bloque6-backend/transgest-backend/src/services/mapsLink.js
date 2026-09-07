// Expansion segura de enlaces de Google Maps para obtener coordenadas exactas.
// Los enlaces cortos que comparte el movil (maps.app.goo.gl, goo.gl/maps) no
// llevan coordenadas en la URL: redirigen a la URL completa que si las lleva.
// Seguimos la redireccion y parseamos lat/lng. Guardas anti-SSRF: solo https/http
// hacia dominios de Google, nunca IPs ni otros hosts.

const COORD_PATTERNS = [
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|query|daddr|destination)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /\/(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
  /geo:(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/i,
  /^\s*(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
];

function matchCoords(raw) {
  for (const re of COORD_PATTERNS) {
    const m = raw.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      return { lat, lng };
    }
  }
  return null;
}

// Extrae {lat,lng} de un texto (URL de maps o "lat,lng"). Sincrono, sin red.
// Tambien prueba una version url-decodificada, porque el muro de consentimiento
// de Google envuelve la URL real (con las coords) en un parametro ?continue=...
function coordsFromText(text) {
  const raw = String(text || "");
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    const parsed = matchCoords(decoded);
    if (parsed) return parsed;
  } catch { /* URI mal formada: ignoramos */ }
  return matchCoords(raw);
}

function isMapsUrl(url) {
  return /^https?:\/\/[^\s]*(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/)/i.test(String(url || "").trim());
}

// Anade contexto España (gl/hl) a una URL de Google Maps para que la resolucion
// del sitio no dependa de la IP del servidor.
function withEsContext(u) {
  try {
    const url = new URL(u);
    if (/(^|\.)google\./i.test(url.hostname) && url.pathname.includes("/maps")) {
      if (!url.searchParams.has("gl")) url.searchParams.set("gl", "ES");
      if (!url.searchParams.has("hl")) url.searchParams.set("hl", "es");
    }
    return url.toString();
  } catch {
    return u;
  }
}

// Enlaces cortos que hay que expandir (no llevan coords inline).
function isShortMapsUrl(url) {
  return /^https?:\/\/([a-z0-9-]+\.)?(goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/)/i.test(String(url || "").trim());
}

const GOOGLE_HOST = /(^|\.)(google\.[a-z.]+|goo\.gl|g\.co|ggpht\.com|gstatic\.com)$/i;
function hostAllowed(u) {
  try {
    const url = new URL(u);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname)) return false; // sin IPs literales
    return GOOGLE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

// Sigue las redirecciones (solo hosts de Google) hasta encontrar coords en la URL.
async function expandForCoords(startUrl) {
  let current = String(startUrl || "").trim();
  if (!hostAllowed(current)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.MAPS_LINK_TIMEOUT_MS || 6000));
  try {
    for (let hop = 0; hop < 6; hop++) {
      const res = await fetch(withEsContext(current), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "TransGestTMS/1.0 maps-resolver (app.gauna.es)",
          "Accept-Language": "es-ES,es;q=0.9",
        },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        let next;
        try { next = new URL(loc, current).toString(); } catch { return null; }
        if (!hostAllowed(next)) return null;
        const inUrl = coordsFromText(next);
        if (inUrl) return inUrl;
        current = next;
        continue;
      }
      // El HTML puede contener el centro del mapa segun la IP, no el lugar.
      // Solo aceptamos coordenadas del enlace; sin ellas se geocodifica el texto.
      const inFinal = coordsFromText(current);
      if (inFinal) return inFinal;
      await res.body?.cancel();
      return null;
    }
    return coordsFromText(current);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Devuelve {lat,lng} de una URL de Google Maps. Si es corta, la expande por red.
async function resolveMapsCoords(url) {
  const t = String(url || "").trim();
  if (!t) return null;
  const direct = coordsFromText(t);
  if (direct) return direct;
  // Solo expandimos enlaces CORTOS (goo.gl / maps.app.goo.gl): redirigen a una URL
  // con coordenadas reales y fiables. Los enlaces largos por feature-ID
  // (place//data=!1s0x...) NO se scrapean: desde el servidor, Google devuelve un
  // centro por defecto (p.ej. Madrid) que falsea los km. Para esos es mas fiable
  // geocodificar la direccion/poblacion con la API de Google (fuera de aqui).
  if (!isShortMapsUrl(t)) return null;
  return expandForCoords(t);
}

module.exports = { coordsFromText, isMapsUrl, isShortMapsUrl, resolveMapsCoords };

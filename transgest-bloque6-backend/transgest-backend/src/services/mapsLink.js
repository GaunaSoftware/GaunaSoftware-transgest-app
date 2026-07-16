// Expansion segura de enlaces de Google Maps para obtener coordenadas exactas.
// Los enlaces cortos que comparte el movil (maps.app.goo.gl, goo.gl/maps) no
// llevan coordenadas en la URL: redirigen a la URL completa que si las lleva.
// Seguimos la redireccion y parseamos lat/lng. Guardas anti-SSRF: solo https/http
// hacia dominios de Google, nunca IPs ni otros hosts.

const COORD_PATTERNS = [
  /@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /[?&](?:q|query|ll|sll|daddr|destination|center|viewpoint)=(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/,
  /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/,
  /\/(-?\d{1,2}\.\d{3,}),(-?\d{1,3}\.\d{3,})/,
  /^\s*(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)\s*$/,
];

// Extrae {lat,lng} de un texto (URL de maps o "lat,lng"). Sincrono, sin red.
function coordsFromText(text) {
  const raw = String(text || "");
  if (!raw) return null;
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

function isMapsUrl(url) {
  return /^https?:\/\/[^\s]*(google\.[a-z.]+\/maps|maps\.google|goo\.gl\/maps|maps\.app\.goo\.gl|g\.co\/)/i.test(String(url || "").trim());
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
      const res = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "TransGestTMS/1.0 maps-resolver (app.gauna.es)" },
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        let next;
        try { next = new URL(loc, current).toString(); } catch { return null; }
        const inUrl = coordsFromText(next);
        if (inUrl) return inUrl;
        if (!hostAllowed(next)) return null;
        current = next;
        continue;
      }
      // Sin mas redirecciones: mira la URL final y, si hace falta, un trozo del body.
      const inFinal = coordsFromText(current);
      if (inFinal) return inFinal;
      const body = (await res.text().catch(() => "")).slice(0, 200000);
      return coordsFromText(body);
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
  if (!isShortMapsUrl(t)) return null;
  return expandForCoords(t);
}

module.exports = { coordsFromText, isMapsUrl, isShortMapsUrl, resolveMapsCoords };

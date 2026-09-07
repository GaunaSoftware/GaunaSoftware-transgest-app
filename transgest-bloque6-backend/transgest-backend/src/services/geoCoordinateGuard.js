const { fallbackMunicipioExacto, fallbackPlaceForAddress } = require('./geoFallback');
const { countryCodeFor } = require('./geoPlaceMatch');

function coordinate(value, min, max) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

function distanceKm(a, b) {
  const rad = n => n * Math.PI / 180;
  const dlat = rad(b.lat - a.lat);
  const dlng = rad(b.lng - a.lng);
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// Detecta contradicciones graves; nunca convierte el centro de una provincia
// en coordenadas del punto. Si falla, el llamador debe geocodificar o pedir datos.
function coordinatesCompatible(coords, context = {}) {
  const lat = coordinate(coords?.lat, -90, 90);
  const lng = coordinate(coords?.lng, -180, 180);
  if (lat === null || lng === null || (lat === 0 && lng === 0)) return false;
  const country = countryCodeFor(context.country || context.pais || 'Espana');
  if (country === 'es') {
    const mainland = lat >= 35.1 && lat <= 43.9 && lng >= -9.6 && lng <= 4.5;
    const canaries = lat >= 27.5 && lat <= 29.6 && lng >= -18.3 && lng <= -13.2;
    if (!mainland && !canaries) return false;
    const city = context.city || context.ciudad || context.municipio || context.locality || '';
    const region = context.region || context.provincia || '';
    const local = fallbackMunicipioExacto(city, region);
    if (local && distanceKm({ lat, lng }, local) > 60) return false;
    const provinceAnchor = region && (fallbackMunicipioExacto(region) || fallbackPlaceForAddress(region));
    if (!local && provinceAnchor && distanceKm({ lat, lng }, provinceAnchor) > 200) return false;
  }
  return true;
}

module.exports = { coordinate, coordinatesCompatible };

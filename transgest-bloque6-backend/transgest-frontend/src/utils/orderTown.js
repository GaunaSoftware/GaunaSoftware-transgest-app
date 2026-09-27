import municipios from '../data/municipios_provincia.json';
const clean = value => String(value || '').trim().replace(/\s+/g,' ');
const folded = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
// Common city aliases absent from the official municipality index.
const townAliases = { CASTELLON: 'CASTELLÓN', CASTELLO: 'CASTELLÓ', VINAROZ: 'VINARÒS' };
const isAddress = value => /\d|\b(calle|c\s*\/|avenida|avda|carretera|ctra|crta|camino|poligono|parcela|nave|s\/n|kilometro|km)\b/i.test(value);
const isMissingLabel = value => /^(?:poblaci[oó]n|ubicaci[oó]n)\s+(?:pendiente|desconocida|incompleta)$/i.test(clean(value));
export function orderTown(stop = {}, fallback = '') {
  for (const value of [stop.ciudad, stop.poblacion, stop.localidad, stop.municipio]) {
    const explicit = clean(value);
    if (explicit && !isAddress(explicit) && !isMissingLabel(explicit)) return explicit.toUpperCase();
  }
  // Only exact municipality names, never a street/company guessed as a town.
  for (const value of [stop.direccion, stop.lugar, stop.address, fallback]) {
    for (const part of clean(value).split(/,|;|\s+[-–>]\s+/).reverse()) {
      const town = clean(part);
      if (!town || isAddress(town)) continue;
      const key = folded(town);
      if (Object.prototype.hasOwnProperty.call(townAliases, key)) return townAliases[key];
      if (Object.prototype.hasOwnProperty.call(municipios, key)) return town.toUpperCase();
    }
  }
  return 'POBLACION PENDIENTE';
}

// Present the best verified location label without pretending that a company name
// is a municipality. The historic orderTown helper remains strict for town-only uses.
export function displayLocation(point = {}, fallback = '') {
  for (const value of [point.poblacion, point.ciudad, point.city, point.localidad, point.municipio]) {
    const town = clean(value);
    if (town && !isAddress(town) && !isMissingLabel(town)) return town.toUpperCase();
  }
  const fromAddress = orderTown({ direccion: point.direccion_normalizada || point.direccion || point.address || '' }, fallback);
  if (fromAddress !== 'POBLACION PENDIENTE') return fromAddress;
  const name = clean(point.nombre || point.cliente_nombre || point.name);
  if (name && !isMissingLabel(name)) return name;
  const legacyName = clean(fallback);
  if (legacyName && !isAddress(legacyName) && !isMissingLabel(legacyName)) return legacyName;
  return 'Ubicación incompleta';
}

export function displayOrderLocation(order = {}, kind = 'carga') {
  const isDelivery = kind === 'descarga' || kind === 'destino';
  const raw = isDelivery ? order.puntos_descarga : order.puntos_carga;
  let stops = raw;
  if (typeof stops === 'string') {
    try { stops = JSON.parse(stops); } catch { stops = []; }
  }
  const first = Array.isArray(stops) ? stops.find(stop => stop && typeof stop === 'object') : null;
  const fallback = isDelivery ? order.destino : order.origen;
  return displayLocation(first || {}, fallback);
}

export function missingLocationFields(point = {}) {
  const missing = [];
  if (![point.poblacion, point.ciudad, point.city, point.localidad, point.municipio].some(value => clean(value) && !isMissingLabel(value))) missing.push('población');
  if (!clean(point.codigo_postal || point.cp || point.postal_code)) missing.push('código postal');
  if (!clean(point.direccion_normalizada || point.direccion || point.address)) missing.push('dirección');
  return missing;
}

import municipios from '../data/municipios_provincia.json';
const clean = value => String(value || '').trim().replace(/\s+/g,' ');
const folded = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const isAddress = value => /\d|\b(calle|c\s*\/|avenida|avda|carretera|ctra|crta|camino|poligono|parcela|nave|s\/n|kilometro|km)\b/i.test(value);
export function orderTown(stop = {}, fallback = '') {
  const explicit = clean(stop.ciudad || stop.poblacion || stop.localidad || stop.municipio);
  if (explicit && !isAddress(explicit)) return explicit.toUpperCase();
  // Only exact municipality names, never a street/company guessed as a town.
  const raw = clean(fallback || stop.direccion || stop.lugar);
  for (const part of raw.split(/,|;|\s+[-–>]\s+/).reverse()) {
    const town = clean(part);
    if (town && !isAddress(town) && municipios[folded(town)]) return town.toUpperCase();
  }
  return 'POBLACION PENDIENTE';
}

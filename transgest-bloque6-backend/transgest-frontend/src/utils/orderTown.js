import municipios from '../data/municipios_provincia.json';
const clean = value => String(value || '').trim().replace(/\s+/g,' ');
const folded = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
// Common city aliases absent from the official municipality index.
const townAliases = { CASTELLON: 'CASTELLÓN', CASTELLO: 'CASTELLÓ', VINAROZ: 'VINARÒS' };
const isAddress = value => /\d|\b(calle|c\s*\/|avenida|avda|carretera|ctra|crta|camino|poligono|parcela|nave|s\/n|kilometro|km)\b/i.test(value);
export function orderTown(stop = {}, fallback = '') {
  for (const value of [stop.ciudad, stop.poblacion, stop.localidad, stop.municipio]) {
    const explicit = clean(value);
    if (explicit && !isAddress(explicit)) return explicit.toUpperCase();
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

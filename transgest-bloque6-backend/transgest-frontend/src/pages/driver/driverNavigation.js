import {driverStops, stopData, stopDone} from './driverStops';

// Navigate to the next operational stop. The navigation app supplies the origin;
// the driver's current position must never be used as the destination.
export function nextStopDirections(order, steps, selectedStop) {
  const stops = driverStops(order);
  const stop = selectedStop || stops.find(s => !stopDone(s, stopData(s, steps, stops)));
  if (!stop) return null;
  const lat = stop.lat ?? stop.latitude ?? stop.latitud ?? stop.metadata?.lat;
  const lng = stop.lng ?? stop.lon ?? stop.longitude ?? stop.longitud ?? stop.metadata?.lng;
  const coordinates = lat != null && lat !== '' && lng != null && lng !== '' &&
    Number.isFinite(Number(lat)) && Math.abs(Number(lat)) <= 90 &&
    Number.isFinite(Number(lng)) && Math.abs(Number(lng)) <= 180 &&
    !(Number(lat) === 0 && Number(lng) === 0);
  const address = [stop.direccion || stop.direccion_normalizada, stop.codigo_postal || stop.cp,
    stop.ciudad || stop.municipio || stop.poblacion || stop.localidad || stop.metadata?.municipio,
    stop.provincia, stop.pais].filter(Boolean).join(', ');
  // Do not navigate to a province or business name alone: it may point to
  // another city when the actual loading point has no verified address.
  const hasPlace = Boolean(stop.direccion || stop.direccion_normalizada || stop.codigo_postal || stop.cp ||
    stop.ciudad || stop.municipio || stop.poblacion || stop.localidad || stop.metadata?.municipio);
  const destination = coordinates ? `${Number(lat)},${Number(lng)}` : hasPlace ? address : '';
  if (!destination || /^https?:/i.test(destination)) return null;
  return `https://www.google.com/maps/dir/?${new URLSearchParams({api:'1', destination, travelmode:'driving', dir_action:'navigate'})}`;
}

export function plannedLoadWeight(order, stop, data = {}) {
  if (!stop || stop.tipo !== 'carga') return null;
  const raw = Object.hasOwn(data, 'peso_planificado_kg') ? data.peso_planificado_kg :
    stop.peso_kg ?? (!data.mercancia_confirmada && driverStops(order).filter(s=>s.tipo==='carga').length===1 ? order.peso_kg : null);
  const weight = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(weight) && weight > 0 ? weight : null;
}

export function canPhotographCargo(order, steps = {}) {
  const stops = driverStops(order);
  return stops.some(s => s.tipo==='carga' && stopData(s, steps, stops).carga_ok === true);
}

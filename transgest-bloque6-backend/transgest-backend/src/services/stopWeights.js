function parseStops(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function weightKg(value) {
  // Los valores numéricos ya están almacenados en kg. Solo el texto de entrada
  // admite la abreviatura en toneladas (por ejemplo, «8,0»).
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const raw = String(value).trim().replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(raw)) return null;
  const number = parseLocaleNumber(raw);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(((/[.,]/.test(raw) && number < 1000) ? number * 1000 : number) * 1000) / 1000;
}

function stopTotal(value) {
  const weights = parseStops(value).map(stop => weightKg(stop?.peso_kg)).filter(n => n !== null && n > 0);
  return { sum: weights.reduce((total, n) => total + n, 0), count: weights.length };
}

function derivedOrderWeight(loads, unloads) {
  const load = stopTotal(loads), unload = stopTotal(unloads);
  if (!load.count && !unload.count) return null;
  // Las dos caras del mismo transporte nunca se suman entre sí.
  if (load.count && unload.count) return Math.max(load.sum, unload.sum);
  return load.count ? load.sum : unload.sum;
}

function documentOrderWeight(order) {
  const saved = Number(order?.peso_kg || order?.kg || 0);
  if (Number.isFinite(saved) && saved > 0) return saved;
  const sides = [order?.puntos_carga, order?.puntos_descarga].map(value => {
    const stops = parseStops(value);
    const total = stopTotal(stops);
    return { ...total, complete: stops.length > 0 && total.count === stops.length };
  });
  const complete = sides.filter(side => side.complete);
  if (!complete.length) return null;
  const total = complete[0].sum;
  // Un total documental no se obtiene de una suma parcial ni de repartos
  // contradictorios. Las cargas y descargas son dos caras del mismo peso.
  if (complete.some(side => Math.abs(side.sum - total) > .01) ||
      sides.some(side => side.sum > total + .01)) return null;
  return total;
}

function fillMissingOrderWeight(body, loads = body?.puntos_carga, unloads = body?.puntos_descarga) {
  if (!body || (body.peso_kg !== null && body.peso_kg !== undefined && String(body.peso_kg).trim() !== '' && Number(body.peso_kg) !== 0)) return body;
  const calculated = derivedOrderWeight(loads, unloads);
  if (calculated !== null) body.peso_kg = calculated;
  return body;
}

module.exports = { parseStops, weightKg, stopTotal, derivedOrderWeight, documentOrderWeight, fillMissingOrderWeight };
const { parseLocaleNumber } = require('../utils/number');

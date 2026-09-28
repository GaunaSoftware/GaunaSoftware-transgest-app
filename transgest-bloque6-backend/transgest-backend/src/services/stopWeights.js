function parseStops(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

function weightKg(value) {
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

function fillMissingOrderWeight(body, loads = body?.puntos_carga, unloads = body?.puntos_descarga) {
  if (!body || (body.peso_kg !== null && body.peso_kg !== undefined && String(body.peso_kg).trim() !== '' && Number(body.peso_kg) !== 0)) return body;
  const calculated = derivedOrderWeight(loads, unloads);
  if (calculated !== null) body.peso_kg = calculated;
  return body;
}

module.exports = { parseStops, weightKg, stopTotal, derivedOrderWeight, fillMissingOrderWeight };
const { parseLocaleNumber } = require('../utils/number');

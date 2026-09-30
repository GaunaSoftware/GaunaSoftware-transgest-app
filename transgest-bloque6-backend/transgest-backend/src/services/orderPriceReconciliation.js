const { parseLocaleNumber } = require("../utils/number");

function stops(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(String(value || "")); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
}
function stopPrice(stop) {
  const amount = parseLocaleNumber(stop?.precio ?? stop?.importe ?? stop?.precio_cliente);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}
function sumAdditionalStopPrices(value) {
  return stops(value).reduce((total, stop) => total + stopPrice(stop), 0);
}
function canonicalOrderAmount(payload = {}) {
  const type = String(payload.tipo_precio || "viaje").trim().toLowerCase();
  const price = parseLocaleNumber(payload.precio_unitario);
  if (!Number.isFinite(price) || price < 0) return null;
  const quantity = parseLocaleNumber(payload.cantidad);
  const extra = Math.max(0, parseLocaleNumber(payload.extracostes_importe ?? payload.extracostes) || 0);
  const stopsExtra = sumAdditionalStopPrices(payload.puntos_descarga) + sumAdditionalStopPrices(payload.puntos_carga);
  const minimum = Math.max(0, parseLocaleNumber(payload.importe_minimo) || 0);
  const minimumUnits = Math.max(0, parseLocaleNumber(payload.minimo_unidades) || 0);
  if (type === "viaje") return Math.round((Math.max(price, minimum) + extra + stopsExtra) * 100) / 100;
  const units = Math.max(Number.isFinite(quantity) ? quantity : 0, minimumUnits);
  if (!Number.isFinite(units) || units <= 0) return null;
  const base = type === "kg" ? (units / 100) * price : units * price;
  return Math.round((base + extra + stopsExtra) * 100) / 100;
}
function correctedLegacyOrderAmount(order = {}) {
  const current = parseLocaleNumber(order.importe);
  const corrected = canonicalOrderAmount(order);
  const firstStopPrice = stopPrice(stops(order.puntos_descarga)[0]) + stopPrice(stops(order.puntos_carga)[0]);
  // Solo corrige el error histórico de omitir la primera parada con suplemento.
  // Cualquier otra discrepancia puede ser un precio negociado y exige revisión humana.
  if (!Number.isFinite(current) || current <= 0 || !Number.isFinite(corrected) || firstStopPrice <= 0) return null;
  return Math.abs(corrected - current - firstStopPrice) <= 0.01 ? corrected : null;
}

async function legacyUnbilledClientDelta(db, empresaId, clienteId) {
  // El riesgo ya agrega todos los pedidos en SQL. Solo se leen candidatos con
  // suplemento en la primera parada para reconciliar el error histórico.
  const { rows } = await db.query(`
    SELECT p.* FROM pedidos p
    WHERE p.empresa_id=$1 AND p.cliente_id=$2
      AND p.estado::text IN ('confirmado','en_curso','descarga','entregado')
      AND p.factura_id IS NULL
      AND (
        COALESCE(p.puntos_descarga->0->>'precio', p.puntos_descarga->0->>'importe', p.puntos_descarga->0->>'precio_cliente') IS NOT NULL
        OR COALESCE(p.puntos_carga->0->>'precio', p.puntos_carga->0->>'importe', p.puntos_carga->0->>'precio_cliente') IS NOT NULL
      )`, [empresaId, clienteId]);
  return Math.round(rows.reduce((delta, order) => {
    const corrected = correctedLegacyOrderAmount(order);
    return delta + (corrected === null ? 0 : corrected - parseLocaleNumber(order.importe));
  }, 0) * 100) / 100;
}

module.exports = { canonicalOrderAmount, correctedLegacyOrderAmount, sumAdditionalStopPrices, legacyUnbilledClientDelta };

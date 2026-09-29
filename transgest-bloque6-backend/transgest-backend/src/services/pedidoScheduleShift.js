const date = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);

function addDays(value, days) {
  const raw = date(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || !Number.isInteger(days) || days < 1 || days > 365) {
    throw Object.assign(new Error('Fecha o días de retraso no válidos.'), { status: 400 });
  }
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw Object.assign(new Error('Fecha del pedido no válida.'), { status: 400 });
  }
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function shiftStops(value, days) {
  if (value == null) return null;
  const stops = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(stops)) throw Object.assign(new Error('Paradas del pedido no válidas.'), { status: 400 });
  return stops.map(stop => {
    if (!stop || typeof stop !== 'object') return stop;
    const next = { ...stop };
    for (const field of ['fecha', 'fecha_carga', 'fecha_descarga']) {
      if (next[field]) next[field] = addDays(next[field], days);
    }
    return next;
  });
}

function shiftPedidoSchedule(order, days) {
  if (!order.fecha_carga) throw Object.assign(new Error('El pedido no tiene fecha de carga que retrasar.'), { status: 400 });
  return {
    fecha_carga: addDays(order.fecha_carga, days),
    fecha_descarga: order.fecha_descarga ? addDays(order.fecha_descarga, days) : null,
    fecha_entrega: order.fecha_entrega ? addDays(order.fecha_entrega, days) : null,
    puntos_carga: shiftStops(order.puntos_carga, days),
    puntos_descarga: shiftStops(order.puntos_descarga, days),
  };
}

module.exports = { addDays, shiftPedidoSchedule };

// Order dates are calendar days, not instants. Local midnight converted to UTC
// can move a Spanish date back one day (including when adding just one day).
export function addIsoDays(value, days) {
  const raw = String(value || "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match || !Number.isInteger(Number(days))) throw new Error("Fecha o número de días no válido para reprogramar.");
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.toISOString().slice(0, 10) !== raw) throw new Error("Fecha no válida para reprogramar.");
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString().slice(0, 10);
}

function shiftStops(value, days) {
  if (value == null || value === "") return undefined;
  let stops = value;
  if (typeof value === "string") {
    try { stops = JSON.parse(value); } catch { throw new Error("No se pudieron leer las paradas del pedido."); }
  }
  if (!Array.isArray(stops)) throw new Error("Las paradas del pedido no son válidas.");
  return stops.map(stop => {
    if (!stop || typeof stop !== "object") return stop;
    const shifted = { ...stop };
    for (const key of ["fecha", "fecha_carga", "fecha_descarga"]) {
      if (shifted[key]) shifted[key] = addIsoDays(shifted[key], days);
    }
    return shifted;
  });
}

export function buildOrderScheduleShift(order, days) {
  if (!order?.fecha_carga) throw new Error("El pedido no tiene fecha de carga que retrasar.");
  const payload = { fecha_carga: addIsoDays(order.fecha_carga, days) };
  for (const key of ["fecha_descarga", "fecha_entrega"]) {
    if (order[key]) payload[key] = addIsoDays(order[key], days);
  }
  for (const key of ["puntos_carga", "puntos_descarga"]) {
    const stops = shiftStops(order[key], days);
    if (stops !== undefined) payload[key] = stops;
  }
  return payload;
}

export function orderScheduleMatches(saved, expected) {
  return Boolean(saved) && ["fecha_carga", "fecha_descarga", "fecha_entrega"]
    .filter(key => key in expected)
    .every(key => String(saved[key] || "").slice(0, 10) === expected[key]);
}

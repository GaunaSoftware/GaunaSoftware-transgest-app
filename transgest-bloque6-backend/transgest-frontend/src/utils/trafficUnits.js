// Presentation only. Child orders remain the source for commercial totals.
export function trafficUnits(orders) {
  const groups = new Map(), result = [];
  for (const order of orders) {
    if (!order.viaje_operativo) { result.push(order); continue; }
    const key = order.viaje_operativo.id;
    let unit = groups.get(key);
    if (!unit) {
      unit = { ...order, numero: `Grupaje · ${order.viaje_operativo.pedidos_count} pedidos`,
        fecha_carga: order.viaje_operativo.fecha_inicio || order.fecha_carga,
        _pedidos: [], _unidad_operativa: true };
      groups.set(key, unit); result.push(unit);
    }
    unit._pedidos.push(order);
  }
  return result;
}

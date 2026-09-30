export function pendingOrdersForWeek(orders = [], days = []) {
  const visible = new Set(days);
  const byId = new Map();
  for (const order of orders) {
    const state = String(order.estado || '').toLowerCase();
    if (['borrador', 'cancelado', 'entregado', 'facturado'].includes(state)) continue;
    if (order.colaborador_id) continue;
    const loadDate = String(order.fecha_carga || order.fecha_pedido || '').slice(0, 10);
    if (!visible.has(loadDate) || (order.vehiculo_id && order.chofer_id)) continue;
    byId.set(String(order.id), order);
  }
  return [...byId.values()].sort((a, b) => String(a.fecha_carga || '').localeCompare(String(b.fecha_carga || '')) || String(a.numero || '').localeCompare(String(b.numero || ''), 'es'));
}

export async function assignPendingOrders({ ids, pending, vehicle, save }) {
  const eligible = new Map(pending.map(order => [String(order.id), order]));
  const ok = [], failed = [];
  for (const id of new Set(ids.map(String))) {
    const order = eligible.get(id);
    if (!order) { failed.push({ numero: id, error: 'Pedido fuera de los pendientes visibles' }); continue; }
    try {
      await save(order.id, {
        vehiculo_id: vehicle.id,
        chofer_id: vehicle.chofer_id || order.chofer_id || '',
        remolque_id: vehicle.remolque_id || order.remolque_id || '',
      });
      ok.push(order.id);
    } catch (error) { failed.push({ numero: order.numero || id, error: error.message || 'Error al asignar' }); }
  }
  return { ok, failed };
}

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function pendingClosureRows(orders, now = new Date()) {
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return orders.flatMap(order => {
    if (['entregado', 'facturado', 'cancelado'].includes(order.estado)) return [];
    const date = String(order.fecha_descarga || order.fecha_entrega || order.fecha_carga || order.fecha_pedido || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const time = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== date) return [];
    const days = Math.round((today - time) / 86400000);
    if (days <= 0) return [];
    return [{ order, date, days, dateLabel: order.fecha_descarga || order.fecha_entrega ? 'Entrega prevista' : order.fecha_carga ? 'Carga prevista' : 'Fecha del pedido' }];
  }).sort((a, b) => a.days - b.days || String(a.order.numero).localeCompare(String(b.order.numero)));
}
export function filterPendingClosures(rows, filter, query, sort) {
  const text = normalize(query).trim();
  return rows.filter(row => {
    if (filter === 'recent' && row.days > 7) return false;
    if (filter === 'older' && row.days <= 7) return false;
    if (filter === 'incident' && row.order.estado !== 'incidencia') return false;
    return !text || normalize([row.order.numero, row.order.cliente_nombre, row.order.origen, row.order.destino, row.order.incidencia_descripcion].join(' ')).includes(text);
  }).sort((a, b) => (sort === 'oldest' ? b.days - a.days : a.days - b.days) || String(a.order.numero).localeCompare(String(b.order.numero)));
}

export function pedidoOriginalMonth(pedido = {}) {
  for (const value of [pedido.fecha_descarga, pedido.fecha_carga, pedido.fecha_entrega, pedido.fecha_pedido]) {
    const date = String(value || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    return date.slice(0, 7);
  }
  return "";
}

// Monetary components are stored on the order; do not reapply its percentage to extras/minima.
const cents = value => Math.round((Number(value) || 0) * 100);
const line = (concepto, amount) => ({ concepto, cantidad: 1, precio_unit: amount / 100 });
export function buildTransportInvoiceLines(orders, mode, concept) {
  const parts = orders.map(order => ({ order, total: cents(order.importe), fuel: cents(order.importe_revision_combustible) }));
  const fuel = parts.reduce((sum, p) => sum + p.fuel, 0);
  const transport = parts.reduce((sum, p) => sum + p.total - p.fuel, 0);
  if (!parts.length) return [];
  if (['linea', 'agrupada_linea'].includes(mode)) {
    return [line(concept, transport), ...(fuel ? [line('Recargo de combustible', fuel)] : [])];
  }
  if (['kg', 'agrupada_kg'].includes(mode)) {
    const groups = new Map();
    for (const p of parts) {
      const rate = Number(p.order.precio_base_sin_combustible || p.order.precio_unitario || 0);
      const group = groups.get(rate) || { rate, kg: 0, amount: 0, count: 0 };
      group.kg += Number(p.order.peso_kg || p.order.kg || 0);
      group.amount += p.total - p.fuel;
      group.count++;
      groups.set(rate, group);
    }
    return [...Array.from(groups.values(), g => {
      // Preserve agreed totals when minimum charges or extras differ from weight * rate.
      const exact = g.rate > 0 && g.kg > 0 && cents(g.kg / 1000 * g.rate) === g.amount;
      const description = `Transporte ${g.kg.toLocaleString('es-ES')} kg (${g.count} viajes)`;
      return exact ? { concepto: description, cantidad: g.kg / 1000, precio_unit: g.rate } : line(description, g.amount);
    }), ...(fuel ? [line('Recargo de combustible', fuel)] : [])];
  }
  return parts.flatMap(({ order: p, total, fuel: surcharge }) => {
    const ref = `${p.numero || ''}${p.referencia_cliente ? ' / Ref. ' + p.referencia_cliente : ''}`;
    const description = `${ref} - ${p.origen || ''}${p.destino ? ' → ' + p.destino : ''} (${p.fecha_carga ? new Date(p.fecha_carga).toLocaleDateString('es-ES') : '-'})`;
    return [line(description, total - surcharge), ...(surcharge ? [line(`Recargo de combustible · ${ref}`, surcharge)] : [])];
  });
}

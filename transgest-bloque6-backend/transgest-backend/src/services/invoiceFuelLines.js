const cents = value => Math.round(Number(value || 0) * 100);
const fail = message => { throw Object.assign(new Error(message), { status: 409, code: 'RECARGO_COMBUSTIBLE_FACTURA' }); };
function fuelParts(order, total = order.importe) {
  const amount = cents(total), fuel = cents(order.importe_revision_combustible);
  if (!Number.isFinite(amount) || !Number.isFinite(fuel) || fuel < 0 || fuel > amount) {
    fail(`Revisa el recargo de combustible del pedido ${order.numero || ''}: no puede superar su importe ni ser negativo.`);
  }
  return { transport: (amount - fuel) / 100, fuel: fuel / 100 };
}
function fuelInvoiceLines(order, total = order.importe) {
  const parts = fuelParts(order, total);
  return [
    { concepto: `Porte ${order.numero || ''} ${order.origen || ''} - ${order.destino || ''}`.trim(), cantidad: 1, precio_unit: parts.transport },
    ...(parts.fuel ? [{ concepto: `Recargo de combustible · ${order.numero || ''}`, cantidad: 1, precio_unit: parts.fuel }] : []),
    ...(cents(order.importe_paralizacion)>0?[{concepto:`Paralización · ${order.numero || ''}`,cantidad:1,precio_unit:cents(order.importe_paralizacion)/100,paralizacion_pedido_id:order.id}]:[]),
  ];
}
function fuelClause(orders, percentage) {
  if (percentage === undefined) return null;
  if (percentage === null || String(percentage).trim() === '') fail('Indica el porcentaje pactado de la cláusula de gasóleo.');
  const rate = Number(percentage);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(rate * 100 - Math.round(rate * 100)) > 0.000001) {
    fail('La cláusula de gasóleo debe ser un porcentaje entre 0 y 100 con hasta dos decimales.');
  }
  const transportCents = orders.reduce((sum, order) => sum + cents(fuelParts(order).transport), 0);
  const previousFuelCents = orders.reduce((sum, order) => sum + cents(fuelParts(order).fuel), 0);
  return { percentage: rate, transport_base: transportCents / 100, previous_fuel: previousFuelCents / 100,
    applied_fuel: Math.round(transportCents * rate / 100) / 100 };
}
function fuelInvoiceLinesForOrders(orders, clause = null) {
  if (!clause) return orders.flatMap(order => fuelInvoiceLines(order));
  const base = cents(clause.transport_base), applied = cents(clause.applied_fuel);
  let cumulative = 0, apportioned = 0;
  return orders.flatMap((order, index) => {
    const transport = cents(fuelParts(order).transport);
    cumulative += transport;
    const next = index === orders.length - 1 ? applied : base ? Math.round(cumulative * applied / base) : 0;
    const fuel = next - apportioned;
    apportioned = next;
    return fuelInvoiceLines({ ...order, importe: (transport + fuel) / 100, importe_revision_combustible: fuel / 100 })
      .map(line => line.concepto.startsWith('Recargo de combustible')
        ? { ...line, concepto: `Variación de gasoil (${clause.percentage.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %) · ${order.numero || ''}`.trim() }
        : line);
  });
}
function validateFuelInvoiceLines(orders, lines, clause = null) {
  const expected = clause ? cents(clause.applied_fuel) : orders.reduce((sum, order) => sum + cents(fuelParts(order).fuel), 0);
  const fuelLines = lines.filter(l => /(?:(?:recargo|revision|variacion).*combustible|(?:recargo|revision|variacion|clausula).*gaso|gasoil.*(?:recargo|revision|variacion))/.test(String(l.concepto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
  const actual = fuelLines.reduce((sum, l) => sum + cents(Number(l.cantidad) * Number(l.precio_unit)), 0);
  if (expected !== actual) fail('El recargo de combustible debe figurar en una línea separada por su importe exacto. Regenera las líneas del borrador para separar el porte sin duplicar el recargo.');
  for(const order of orders){
    const detention=cents(order.importe_paralizacion),matched=lines.filter(l=>l.paralizacion_pedido_id && l.paralizacion_pedido_id===order.id);
    if(detention>0 && !order.id)fail('Falta la identidad del pedido para enlazar la paralización.');
    if(matched.length>1||matched.reduce((n,l)=>n+cents(Number(l.cantidad)*Number(l.precio_unit)),0)!==detention)fail('La paralización debe figurar por su importe exacto en una línea separada enlazada a su pedido. Regenera las líneas.');
    if(matched.some(l=>l.concepto!==`Paralización · ${order.numero||''}`))fail('Conserva la identificación de la paralización en su línea.');
  }
  if(lines.some(l=>l.paralizacion_pedido_id&&!orders.some(o=>o.id===l.paralizacion_pedido_id)))fail('La paralización no pertenece a los pedidos de la factura.');
}
module.exports = { fuelParts, fuelInvoiceLines, fuelInvoiceLinesForOrders, fuelClause, validateFuelInvoiceLines };

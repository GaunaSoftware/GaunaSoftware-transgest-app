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
function validateFuelInvoiceLines(orders, lines) {
  const expected = orders.reduce((sum, order) => sum + cents(fuelParts(order).fuel), 0);
  const fuelLines = lines.filter(l => /(?:recargo|revision).*combustible/.test(String(l.concepto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
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
module.exports = { fuelParts, fuelInvoiceLines, validateFuelInvoiceLines };

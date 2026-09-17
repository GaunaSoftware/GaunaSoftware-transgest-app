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
  ];
}
function validateFuelInvoiceLines(orders, lines) {
  const expected = orders.reduce((sum, order) => sum + cents(fuelParts(order).fuel), 0);
  const fuelLines = lines.filter(l => /(?:recargo|revision).*combustible/.test(String(l.concepto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()));
  const actual = fuelLines.reduce((sum, l) => sum + cents(Number(l.cantidad) * Number(l.precio_unit)), 0);
  if (expected !== actual) fail('El recargo de combustible debe figurar en una línea separada por su importe exacto. Regenera las líneas del borrador para separar el porte sin duplicar el recargo.');
}
module.exports = { fuelParts, fuelInvoiceLines, validateFuelInvoiceLines };

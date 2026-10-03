// Forecasts are net; invoice balances include tax. Unnumbered forecasts are not received invoices.
function supplierLedgerSummary(viajes = [], facturas = [], pagos = []) {
  const received = facturas.filter(f => f.factura_proveedor_id || String(f.numero_factura || f.num_factura || '').trim());
  const sum = (rows, value) => rows.reduce((n, row) => n + Math.round(Number(value(row) || 0) * 100), 0) / 100;
  const totalViajes = sum(viajes, p => p.importe_colaborador ?? p.precio_colaborador);
  const totalFacturado = sum(received, f => f.total);
  const tripIds = new Set(viajes.map(p => p.id));
  const totalBase = sum(received.filter(f => f.pedido_id && tripIds.has(f.pedido_id)), f => f.base);
  const totalPagado = sum(pagos.filter(p => ['pagado','pagada'].includes(String(p.estado || '').toLowerCase())), p => p.importe);
  return { totalViajes, totalFacturado, totalPagado, pendientePago: Math.max(0, Math.round((totalFacturado - totalPagado) * 100) / 100), pendienteFactura: Math.max(0, Math.round((totalViajes - totalBase) * 100) / 100), received };
}
module.exports = { supplierLedgerSummary };

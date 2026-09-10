const number = value => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

export function supplierPriceType(order = {}) {
  if (order.tipo_precio_colaborador) return order.tipo_precio_colaborador;
  return number(order.precio_colaborador_unitario) > 0 && order.tipo_precio === 'tonelada'
    ? 'tonelada' : 'viaje';
}

export function supplierTonneAgreement(order = {}) {
  if (supplierPriceType(order) !== 'tonelada') return null;
  const rate = number(order.precio_colaborador_unitario);
  if (!rate) return null;
  const minimum = number(order.minimo_colaborador_unidades) || (!order.tipo_precio_colaborador ? number(order.minimo_unidades) : 0);
  const tonnes = number(order.peso_kg) / 1000 || (!order.tipo_precio_colaborador ? number(order.cantidad) : 0);
  return { precioTonelada: rate, minimoToneladas: minimum,
    toneladasFacturables: Math.max(tonnes, minimum) };
}

export function canIssueSupplierOrder(order = {}, fleet = []) {
  if (!order.colaborador_id || order.vehiculo_id) return false;
  const plate = value => String(value || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
  const assigned = plate(order.matricula_colaborador || order.matricula_manual || order.vehiculo_matricula);
  return !assigned || !fleet.some(vehicle => plate(vehicle.matricula) === assigned);
}

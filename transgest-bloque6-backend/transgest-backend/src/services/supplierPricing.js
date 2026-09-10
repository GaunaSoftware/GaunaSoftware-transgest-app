const number = value => {
  const n = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, n) : 0;
};

function supplierPriceType(order = {}) {
  if (order.tipo_precio_colaborador) return order.tipo_precio_colaborador;
  // Legacy unit prices used the customer's unit. Never migrate a closed price.
  return number(order.precio_colaborador_unitario) > 0 && order.tipo_precio === 'tonelada'
    ? 'tonelada' : 'viaje';
}

function supplierTonneAgreement(order = {}) {
  if (supplierPriceType(order) !== 'tonelada') return null;
  const rate = number(order.precio_colaborador_unitario);
  if (!rate) return null;
  const minimum = number(order.minimo_colaborador_unidades) || (!order.tipo_precio_colaborador ? number(order.minimo_unidades) : 0);
  const tonnes = number(order.peso_kg) / 1000 || (!order.tipo_precio_colaborador ? number(order.cantidad) : 0);
  return { precioTonelada: rate, minimoToneladas: minimum,
    toneladasFacturables: Math.max(tonnes, minimum) };
}

function applySupplierPricing(target, changes = {}, previous = {}) {
  const touched = ['tipo_precio_colaborador','precio_colaborador_unitario','minimo_colaborador_unidades','peso_kg','precio_colaborador'];
  if (!touched.some(key => Object.hasOwn(changes, key))) return false;
  const effective = { ...previous };
  for (const key of Object.keys(changes)) effective[key] = target[key] === undefined ? changes[key] : target[key];
  if (effective.tipo_precio_colaborador && !['viaje','tonelada'].includes(effective.tipo_precio_colaborador)) {
    throw Object.assign(new Error('Tipo de tarifa del proveedor no valido'), { status: 400 });
  }
  if (supplierPriceType(effective) !== 'tonelada') return false;
  const agreement = supplierTonneAgreement(effective);
  target.precio_colaborador = agreement
    ? Math.round(agreement.precioTonelada * agreement.toneladasFacturables * 100) / 100 : 0;
  return true;
}

module.exports = { supplierPriceType, supplierTonneAgreement, applySupplierPricing };

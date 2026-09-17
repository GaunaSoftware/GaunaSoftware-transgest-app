export const assignmentFields = ['vehiculo_id', 'chofer_id', 'chofer2_id', 'remolque_id', 'colaborador_id',
  'matricula_manual', 'remolque_matricula_manual', 'matricula_colaborador', 'remolque_matricula_colaborador',
  'conductor_efectivo_nombre', 'conductor_efectivo_apellidos', 'conductor_efectivo_dni', 'conductor_efectivo_telefono'];

export function clearAssignmentPatch() {
  return Object.fromEntries(assignmentFields.map(key => [key, null]));
}

export function hasAssignment(order) {
  return assignmentFields.some(key => Boolean(order?.[key]));
}

export function parseAssignmentMoney(raw) {
  const text = String(raw ?? '').trim().replace(/\s/g, '');
  if (!text) return null;
  const value = Number(text.includes(',') ? text.replace(/\./g, '').replace(',', '.') : text);
  return Number.isFinite(value) && value >= 0 ? value : NaN;
}

// Prices are optional partial edits. Changing a total explicitly switches to €/trip.
export function assignmentPricePatch(sale, purchase) {
  const patch = {};
  if (String(sale).trim()) {
    const amount = parseAssignmentMoney(sale);
    if (!Number.isFinite(amount)) throw new Error('Indica un precio de venta válido.');
    Object.assign(patch, { precio_venta_total:amount, tipo_precio: 'viaje', precio_unitario: amount, importe: amount,
      precio_cliente_col: amount, importe_minimo: 0, minimo_unidades: 0 });
  }
  if (String(purchase).trim()) {
    const amount = parseAssignmentMoney(purchase);
    if (!Number.isFinite(amount)) throw new Error('Indica un coste de transporte válido.');
    Object.assign(patch, { tipo_precio_colaborador: 'viaje', precio_colaborador: amount,
      precio_colaborador_unitario: amount, minimo_colaborador_unidades: 0 });
  }
  return patch;
}

import { parseLocaleNumber as number, toneladasDesdePeso } from './number';

const RESOURCE_FIELDS = ['vehiculo_id', 'chofer_id', 'chofer2_id', 'remolque_id', 'colaborador_id',
  'matricula_manual', 'remolque_matricula_manual', 'matricula_colaborador', 'remolque_matricula_colaborador',
  'conductor_efectivo_nombre', 'conductor_efectivo_apellidos', 'conductor_efectivo_dni', 'conductor_efectivo_telefono'];

export const clearAssignmentPatch = () => Object.fromEntries(RESOURCE_FIELDS.map(key => [key, null]));
export const hasAssignment = order => RESOURCE_FIELDS.some(key => Boolean(order[key]));

function stopExtras(raw) {
  let stops = raw;
  if (typeof raw === 'string') { try { stops = JSON.parse(raw); } catch { stops = []; } }
  return (Array.isArray(stops) ? stops : []).reduce((sum, stop) => sum + Math.max(0, number(stop.precio ?? stop.importe ?? stop.precio_cliente)), 0);
}

// Same tariff units and extras as the order form. The API recalculates on save.
export function quickSaleTotal(order, price) {
  let quantity = number(order.cantidad);
  if (order.tipo_precio === 'tonelada' && number(order.peso_kg) > 0 && (quantity <= 0 || (quantity < 1 && number(order.peso_kg) > 45))) {
    quantity = toneladasDesdePeso(order.peso_kg);
  }
  const units = Math.max(quantity, number(order.minimo_unidades));
  const rate = number(price);
  const base = order.tipo_precio === 'viaje' || !order.tipo_precio
    ? Math.max(rate, number(order.importe_minimo))
    : rate * (order.tipo_precio === 'kg' ? units / 100 : units);
  return Math.round((base + number(order.extracostes_importe) + stopExtras(order.puntos_carga) + stopExtras(order.puntos_descarga)) * 100) / 100;
}

export function recordedCosts(order, external, supplierPrice) {
  const extras = ['coste_peajes', 'coste_dietas', 'coste_otros'].reduce((sum, key) => sum + number(order[key]), 0);
  return extras + (external ? number(supplierPrice) : number(order.coste_gasoil));
}

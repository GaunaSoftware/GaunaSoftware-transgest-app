const clean = value => String(value || '').trim();
export function driverName(driver = {}, order = {}) {
  const alias = clean(driver.alias || order.chofer_alias);
  if (alias) return alias;
  const name = clean(driver.nombre || order.chofer_nombre || order.chofer_nombre_manual);
  const surname = clean(driver.apellidos || order.chofer_apellidos);
  return [name, surname && !name.toLowerCase().endsWith(surname.toLowerCase()) ? surname : ''].filter(Boolean).join(' ') || (order.colaborador_id ? 'Gestionado por el colaborador' : 'Sin asignar');
}
export function driverOption(driver = {}, vehicles = []) {
  const truck = vehicles.find(v => String(v.id) === String(driver.vehiculo_id));
  const trailer = vehicles.find(v => String(v.id) === String(driver.remolque_id || truck?.remolque_id || driver.vehiculo_remolque_id));
  return [driverName(driver), truck?.matricula || driver.vehiculo_matricula, trailer?.matricula || driver.remolque_matricula].filter(Boolean).join(' · ');
}
export function orderRig(order = {}, vehicles = []) {
  const truck = vehicles.find(v => String(v.id) === String(order.vehiculo_id));
  const trailerId = order.remolque_id_manual || order.remolque_id || truck?.remolque_id;
  const trailer = vehicles.find(v => String(v.id) === String(trailerId));
  return [order.vehiculo_matricula || order.matricula_manual || order.matricula_colaborador || truck?.matricula,
    order.remolque_matricula_manual || order.remolque_matricula_colaborador || order.remolque_matricula || trailer?.matricula].filter(Boolean).join(' · ') || (order.colaborador_id ? 'Asignado a colaborador' : 'Sin asignar');
}
export function incidentDescription(order = {}) {
  return clean(order.incidencia_descripcion || order.motivo_incidencia) ||
    (order.estado === 'incidencia' ? 'Pedido marcado con incidencia, sin descripción registrada. Abre el pedido para consultar o completar el motivo.' : '');
}

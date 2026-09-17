const clean = value => String(value || '').trim();
export function stopSchedule(stop = {}) {
  const day = clean(stop.fecha).slice(0,10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.split('-').reverse().join('/') : day;
  const window = clean(stop.ventana) || [stop.ventana_inicio,stop.ventana_fin].filter(Boolean).map(v=>String(v).slice(0,5)).join('–');
  return [date,clean(stop.hora).slice(0,5),window && `Ventana: ${window}`].filter(Boolean).join(' · ');
}
export function assignDriver(form, id, drivers, vehicles) {
  const selected = drivers.find(d=>String(d.id)===String(id));
  const previous = drivers.find(d=>String(d.id)===String(form.chofer_id));
  const linked = d => d && (vehicles.find(v=>String(v.id)===String(d.vehiculo_id)) || vehicles.find(v=>String(v.chofer_id)===String(d.id)));
  const truck = linked(selected), oldTruck = linked(previous);
  const replaceTruck = !form.vehiculo_id || form.vehiculo_id === oldTruck?.id;
  const targetTruck = replaceTruck ? truck : vehicles.find(v=>v.id===form.vehiculo_id);
  const replaceTrailer = !form.remolque_id_manual || form.remolque_id_manual === (previous?.remolque_id || oldTruck?.remolque_id);
  return {...form,chofer_id:id,
    ...(id ? {
      vehiculo_id: replaceTruck ? truck?.id || '' : form.vehiculo_id,
      remolque_id_manual: replaceTrailer ? ((targetTruck === truck ? selected?.remolque_id : '') || targetTruck?.remolque_id || '') : form.remolque_id_manual,
      colaborador_id:'',colaborador_nombre:'',precio_cliente_col:'',precio_colaborador:'',precio_colaborador_unitario:'',minimo_colaborador_unidades:'',
      ...(targetTruck ? {matricula_manual:'',remolque_matricula_manual:''} : {}),
    } : {}),
  };
}
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
const incidentTypes = {
  operativa: ['Operativa', 'Incidencia relacionada con la ejecución del transporte.'],
  sin_completar: ['Entrega sin confirmar', 'La fecha prevista ha pasado y el pedido sigue sin marcarse como entregado.'],
  taller: ['Taller', 'Vehículo en taller o no disponible por mantenimiento.'],
  carga: ['Carga', 'Problema durante la recogida o carga de la mercancía.'],
  descarga: ['Descarga', 'Problema durante la entrega o descarga de la mercancía.'],
  retraso: ['Retraso', 'Desviación del horario previsto de carga, tránsito o entrega.'],
  documentacion: ['Documentación', 'Incidencia con los documentos del viaje: albarán, POD, CMR o DCD.'],
  cliente: ['Cliente', 'Incidencia relacionada con el cliente o sus instrucciones.'],
  colaborador: ['Colaborador', 'Incidencia relacionada con el transporte subcontratado.'],
  gps: ['Localización', 'Incidencia con la posición o el seguimiento GPS del vehículo.'],
  paralizacion: ['Paralización', 'Espera o inmovilización durante el servicio.'],
  cancelado_cliente: ['Cancelado por el cliente', 'El cliente ha solicitado cancelar el servicio.'],
  duplicado: ['Duplicado', 'El pedido se ha identificado como duplicado.'],
  error_datos: ['Datos incorrectos', 'Hay información del pedido que necesita corregirse.'],
  no_realizado: ['No realizado', 'El viaje se ha registrado como no realizado.'],
};
export function incidentLabel(order = {}) {
  const type = clean(order.incidencia_tipo).toLowerCase();
  return incidentTypes[type]?.[0] || type.replace(/_/g, ' ') || (order.estado === 'incidencia' ? 'Incidencia operativa' : '');
}
export function incidentDescription(order = {}) {
  const detail = clean(order.incidencia_descripcion || order.motivo_incidencia);
  if (detail) return detail;
  const type = clean(order.incidencia_tipo).toLowerCase();
  if (type) return `${incidentTypes[type]?.[1] || 'Incidencia clasificada como '+type.replace(/_/g, ' ')+'.'} No hay un motivo concreto registrado; abre el pedido para consultarlo o completarlo.`;
  return order.estado === 'incidencia' ? 'Pedido marcado con incidencia, sin descripción registrada. Abre el pedido para consultar o completar el motivo.' : '';
}

export function dashboardAssignment(order = {}) {
  if (order.colaborador_id || clean(order.colaborador_nombre)) {
    const assigned = `Asignado a ${clean(order.colaborador_nombre) || 'colaborador'}`;
    const plate = order.vehiculo_matricula || order.matricula_manual || order.matricula_colaborador;
    return plate ? `${assigned} · ${orderRig(order)}` : assigned;
  }
  return `${orderRig(order)} · ${driverName({}, order)}`;
}

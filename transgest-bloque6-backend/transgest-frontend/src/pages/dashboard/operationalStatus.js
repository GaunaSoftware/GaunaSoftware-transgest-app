export function overdueOrder(p, now = new Date()) {
  if (['entregado','facturado','cancelado'].includes(p.estado)) return false;
  const date = String(p.fecha_descarga || p.fecha_entrega || p.fecha_carga || p.fecha_pedido || '').slice(0,10);
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date < today;
}
export function incidentDescription(p) {
  return [p.incidencia_tipo && String(p.incidencia_tipo).replace(/_/g,' '),p.incidencia_descripcion].filter(Boolean).join(': ') || (p.estado === 'incidencia' ? 'Incidencia sin descripción registrada' : '');
}

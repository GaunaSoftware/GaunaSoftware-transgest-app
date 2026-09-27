function loadDateChoice(order, nextState, role, input = {}, now = new Date()) {
  const transition = nextState === 'en_curso' && ['confirmado','espera_carga','cargando'].includes(order.estado) && !order.carga_real_at;
  if (!transition) return {recordActual:false, choice:null};
  if (role === 'chofer') return {recordActual:true, choice:'observada'};
  const choice = input.fecha_carga_accion;
  if (choice != null && !['conservar','hoy'].includes(choice)) throw Object.assign(new Error('Opción de fecha de carga no válida.'), {status:400});
  const value=order.fecha_carga_planificada || order.fecha_carga;
  const planned = value instanceof Date ? value.toISOString().slice(0,10) : String(value||'').slice(0,10);
  const today = new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if (planned && planned!==today && !choice && input.confirmar_carga_real!==true) {
    throw Object.assign(new Error(`El pedido estaba planificado para ${planned}. Elige conservar su fecha o registrar la carga de hoy (${today}).`), {status:409,code:'FECHA_REAL_CARGA_CONFIRMAR',fecha_planificada:planned,fecha_real:today});
  }
  // Keeping the planned date is not evidence of an actual loading timestamp.
  return {recordActual:choice!=='conservar',choice:choice || 'hoy'};
}
module.exports={loadDateChoice};

// Loaded and departed are separate persisted operational states.
const ACTIVE_STATES = Object.freeze(['espera_carga','cargando','cargado','en_curso','espera_descarga','descarga']);
const WRITABLE_STATES = Object.freeze(['pendiente','confirmado',...ACTIVE_STATES,'entregado','cancelado','incidencia']);
function assertTransportTransition(from, to, { actor = 'chofer', correction = false } = {}) {
  if (!WRITABLE_STATES.includes(to)) throw Object.assign(new Error('Estado de transporte no válido'), {status:400,code:'TRANSPORT_STATE_INVALID'});
  if (from === to) return { changed: false };
  if (from === 'facturado' || (['entregado','cancelado'].includes(from) && !(actor === 'gerente' && correction))) {
    throw Object.assign(new Error('Este viaje ya no admite cambios operativos. Solicita a gerencia la revisión.'), {status:409,code:'TRANSPORT_STATE_TERMINAL'});
  }
  return { changed: true };
}

// Arrival, loading, loaded goods and departure are different events. Completion
// is supplied by the existing workflow (all signed stops or legacy protocol).
function stateFromProgress(data = {}, { deliveryComplete = false } = {}) {
  if (deliveryComplete) return 'entregado';
  if (data.descarga_iniciada || data.descarga_ok) return 'descarga';
  if (data.posicionado_descarga || data.aviso_espera_descarga) return 'espera_descarga';
  if (data.viaje_iniciado) return 'en_curso';
  if (data.carga_ok) return 'cargado';
  if (data.carga_proceso) return 'cargando';
  if (data.carga_iniciada || data.aviso_espera_carga) return 'espera_carga';
  return null;
}

function stateFromStop(stop, data, deliveryComplete) {
  if (deliveryComplete) return 'entregado';
  if (stop.tipo === 'descarga' && data.firma_entrega) return 'en_curso';
  return stateFromProgress(data) || (stop.tipo === 'descarga' ? 'en_curso' : 'espera_carga');
}
module.exports = { ACTIVE_STATES, WRITABLE_STATES, assertTransportTransition, stateFromProgress, stateFromStop };

const day = value => value instanceof Date ? value.toISOString().slice(0, 10) : String(value || '').slice(0, 10);
const madridDay = now => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

function loadDateChoice(order, nextState, role, input = {}, now = new Date()) {
  const state = String(nextState || '').toLowerCase();
  const current = String(order.estado || '').toLowerCase();
  if (state === 'en_curso' && (current === 'cargado' || order.carga_real_at)) return { recordActual:false, choice:null };
  const load = ['espera_carga', 'cargando', 'cargado', 'en_curso'].includes(state);
  const delivery = ['espera_descarga', 'descarga', 'entregado'].includes(state);
  const finishingLoad = ['cargado', 'en_curso'].includes(state) && ['confirmado', 'espera_carga', 'cargando'].includes(current) && !order.carga_real_at;
  if ((!load && !delivery) || current === state) return { recordActual: false, choice: null };
  // Driver events describe what happened; they never rewrite agreed dates.
  if (role === 'chofer') return { recordActual: finishingLoad, choice: finishingLoad ? 'observada' : null };

  const phase = load ? 'carga' : 'descarga';
  const key = load ? 'fecha_carga_accion' : 'fecha_descarga_accion';
  const explicitChoice = input[key];
  const originalChoice = explicitChoice || (finishingLoad && input.confirmar_carga_real === true ? 'observada' : null);
  if (explicitChoice != null && !['conservar', 'hoy'].includes(explicitChoice)) {
    throw Object.assign(new Error(`Opción de fecha de ${phase} no válida.`), { status: 400 });
  }
  const planned = day(load
    ? order.fecha_carga_planificada || order.fecha_carga
    : order.fecha_descarga_planificada || order.fecha_descarga || order.fecha_entrega);
  const today = madridDay(now);
  if (planned && planned !== today && !originalChoice) {
    throw Object.assign(new Error(`La ${phase} estaba prevista para ${planned}. Elige cambiar la fecha a hoy (${today}) o conservar la prevista.`), {
      status: 409, code: load ? 'FECHA_CARGA_REPLANIFICAR' : 'FECHA_DESCARGA_REPLANIFICAR',
      fecha_planificada: planned, fecha_real: today,
    });
  }
  const rescheduleDate = originalChoice === 'hoy' && planned !== today ? today : null;
  if (rescheduleDate && load && day(order.fecha_descarga || order.fecha_entrega) < today &&
      day(order.fecha_descarga || order.fecha_entrega)) {
    throw Object.assign(new Error('La descarga quedaría antes de la carga. Reprograma primero la descarga o conserva la fecha prevista.'), {
      status: 409, code: 'FECHA_DESCARGA_ANTERIOR',
    });
  }
  if (rescheduleDate && delivery && day(order.fecha_carga) > today) {
    throw Object.assign(new Error('La descarga quedaría antes de la carga. Reprograma primero la carga o conserva la fecha prevista.'), {
      status: 409, code: 'FECHA_CARGA_POSTERIOR',
    });
  }
  return {
    recordActual: finishingLoad && originalChoice !== 'conservar',
    choice: originalChoice,
    phase,
    rescheduleDate,
  };
}

function replanPrimaryStop(value, date, phase = 'carga') {
  if (!date) return null;
  const stops = Array.isArray(value) ? value : (() => { try { return JSON.parse(value || '[]'); } catch { return []; } })();
  if (!Array.isArray(stops) || !stops.length) return null;
  const phaseKey = phase === 'carga' ? 'fecha_carga' : 'fecha_descarga';
  return stops.map((stop, index) => index === 0 ? {
    ...stop,
    fecha: date,
    ...(stop?.[phaseKey] ? { [phaseKey]: date } : {}),
  } : stop);
}

module.exports = { loadDateChoice, replanPrimaryStop, replanPrimaryLoadStop: replanPrimaryStop };

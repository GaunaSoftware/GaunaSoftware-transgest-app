// Presentation metadata for transport progress. Assignment to a collaborator
// is an execution attribute, never the primary operational state.
import './transportStates.css';

const states = {
  pendiente: { label:'Pendiente de asignar', color:'#64748b', bg:'rgba(100,116,139,.15)', border:'rgba(100,116,139,.4)', icon:'clock', description:'Viaje pendiente de asignación', final:false },
  confirmado: { label:'Confirmado', color:'#2563eb', bg:'rgba(37,99,235,.15)', border:'rgba(37,99,235,.4)', icon:'check', description:'Viaje confirmado y pendiente de carga', final:false },
  espera_carga: { label:'Espera de carga', color:'#a16207', bg:'rgba(161,98,7,.15)', border:'rgba(161,98,7,.4)', icon:'clock', description:'Vehículo a la espera de iniciar la carga', final:false },
  cargando: { label:'Cargando', color:'#7c3aed', bg:'rgba(124,58,237,.15)', border:'rgba(124,58,237,.4)', icon:'box', description:'Carga en curso', final:false },
  cargado: { label:'Cargado', color:'#0f766e', bg:'rgba(15,118,110,.15)', border:'rgba(15,118,110,.4)', icon:'check', description:'Carga finalizada; todavía no consta salida hacia destino', final:false },
  en_curso: { label:'En tránsito', color:'#c2410c', bg:'rgba(194,65,12,.15)', border:'rgba(194,65,12,.4)', icon:'truck', description:'Viaje en tránsito hacia la descarga', final:false },
  en_transito: { label:'En tránsito', color:'#c2410c', border:'rgba(194,65,12,.4)', icon:'truck', description:'Salida hacia la descarga actual registrada por el chófer', final:false, readOnly:true },
  espera_descarga: { label:'Espera de descarga', color:'#a21caf', bg:'rgba(162,28,175,.15)', border:'rgba(162,28,175,.4)', icon:'clock', description:'Vehículo a la espera de descargar', final:false },
  descarga: { label:'Descargando', color:'#6d28d9', bg:'rgba(109,40,217,.15)', border:'rgba(109,40,217,.4)', icon:'box', description:'Descarga en curso', final:false },
  entregado: { label:'Entregado', color:'#047857', bg:'rgba(4,120,87,.15)', border:'rgba(4,120,87,.4)', icon:'check', description:'Entrega confirmada', final:true },
  facturado: { label:'Facturado', color:'#047857', bg:'rgba(4,120,87,.15)', border:'rgba(4,120,87,.4)', icon:'file', description:'Servicio facturado', final:true },
  incidencia: { label:'Incidencia', color:'#b91c1c', bg:'rgba(185,28,28,.15)', border:'rgba(185,28,28,.4)', icon:'alert', description:'Requiere revisión operativa', final:false, incident:true },
  cancelado: { label:'Cancelado', color:'#475569', bg:'rgba(71,85,105,.15)', border:'rgba(71,85,105,.4)', icon:'close', description:'Servicio cancelado', final:true },
};

// Keep literal marker colors for map providers; text and surfaces follow the theme.
export const TRANSPORT_STATES = Object.freeze(Object.fromEntries(Object.entries(states).map(([key, meta]) => [key, Object.freeze({
  ...meta,
  textColor: `var(--transport-${key}-text)`,
  bg: `var(--transport-${key}-bg)`,
})])));

export const RECOMMENDED_STATE_FLOW = Object.freeze({
  pendiente:'confirmado', confirmado:'espera_carga', espera_carga:'cargando',
  cargando:'cargado', cargado:'en_curso', en_curso:'espera_descarga', espera_descarga:'descarga',
  descarga:'entregado',
});

export function transportStateKey(value) {
  if (value && typeof value === 'object') {
    const projected = value.estado_operativo?.codigo;
    const current = value.estado_operativo?.estado_legacy === value.estado;
    return current && TRANSPORT_STATES[projected] ? projected : String(value.estado || '').toLowerCase();
  }
  return String(value || '').toLowerCase();
}

export function transportStateMeta(value) {
  const key = transportStateKey(value);
  return TRANSPORT_STATES[key] || { ...TRANSPORT_STATES.cancelado, label:key ? key.replace(/_/g,' ') : 'Sin estado', icon:'clock', description:'Estado no catalogado', final:false };
}

export function transportStateStyle(value) {
  const meta = transportStateMeta(value);
  return { color: meta.textColor, background: meta.bg, border: `1px solid ${meta.border}` };
}

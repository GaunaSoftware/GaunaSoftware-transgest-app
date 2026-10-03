const escape = value => String(value || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels = {pendiente:'Pendiente de asignar',confirmado:'Confirmado',espera_carga:'Espera de carga',cargando:'Cargando',cargado:'Cargado',en_curso:'En tránsito',espera_descarga:'Espera de descarga',descarga:'Descargando',entregado:'Entregado',facturado:'Facturado',cancelado:'Cancelado',incidencia:'Incidencia'};
function customerTripEmail(data = {}) {
  const title = data.albaranes ? 'Albaranes del viaje disponibles' : labels[data.estado] || 'Viaje actualizado';
  return {
    asunto:`${title} · ${String(data.numero || '').replace(/[\r\n]/g,' ')}`,
    html:`<div style="background:#f3f7f7;padding:24px;font-family:Arial,sans-serif;color:#183b40"><div style="max-width:620px;margin:auto;background:#fff;border:1px solid #d5e4e3;border-radius:14px;overflow:hidden"><div style="background:#008c85;color:#fff;padding:22px;font-size:20px;font-weight:bold">${escape(data.empresa || 'TransGest')}</div><div style="padding:24px"><h1 style="font-size:22px">${escape(title)}</h1><p>Pedido <strong>${escape(data.numero)}</strong></p><div style="background:#eef9f8;padding:16px;border-radius:10px"><strong>Carga</strong><p>${escape(data.origen)}</p><strong>Entrega</strong><p>${escape(data.destino)}</p></div><p>${data.documentos > 0 ? `Adjuntamos ${Number(data.documentos)} documento(s) del viaje.` : data.estado === 'entregado' ? 'La entrega está registrada. Te enviaremos los albaranes cuando termine su subida.' : 'Te mantendremos informado de los siguientes cambios de estado.'}</p><small>Información enviada por ${escape(data.empresa || 'TransGest')}.</small></div></div></div>`,
  };
}
module.exports = { customerTripEmail };

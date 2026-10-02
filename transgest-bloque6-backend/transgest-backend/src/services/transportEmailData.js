const { fullStopAddress, stopPointName } = require('./stopAddress');
const { formatCompanyPaymentTerms } = require('./companyPayment');
const clean = value => String(value ?? '').trim();
function list(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}
function dateLabel(value) {
  if (!value) return '';
  const raw = value instanceof Date ? value.toISOString().slice(0, 10) : clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(raw);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}
function measure(value, unit) {
  if (value === '' || value == null || !Number.isFinite(Number(value))) return '';
  return `${Number(value).toLocaleString('es-ES', { maximumFractionDigits:3, useGrouping:true })} ${unit}`;
}
function mailStops(order, type) {
  const loading = type === 'carga';
  const stops = list(loading ? order.puntos_carga : order.puntos_descarga).filter(stop => stop && typeof stop === 'object');
  const fallback = loading ? order.origen : order.destino;
  return (stops.length ? stops : fallback ? [{}] : []).map((stop, index) => {
    const first = index === 0;
    const address = fullStopAddress({ ...stop, direccion:stop.direccion || stop.direccion_completa || stop.address });
    const day = stop.fecha || stop[`fecha_${type}`] || (!loading ? stop.fecha_entrega : '') || (first ? (loading ? order.fecha_carga : order.fecha_descarga || order.fecha_entrega) : '');
    const time = stop.hora || stop[`hora_${type}`] || (first ? order[`hora_${type}`] : '');
    const window = stop.ventana || stop[`ventana_${type}`] || [stop.ventana_inicio, stop.ventana_fin].filter(Boolean).join(' - ') || (first ? order[`ventana_${type}`] : '');
    const direct = stop.google_maps_url || stop.googleMapsUrl || stop.maps_url || stop.metadata?.google_maps_url || (first ? order[`google_maps_${loading ? 'origen' : 'destino'}`] : '');
    const latRaw = stop.lat ?? stop.latitud ?? stop.metadata?.lat;
    const lngRaw = stop.lng ?? stop.longitud ?? stop.metadata?.lng;
    const coordinates = latRaw != null && latRaw !== '' && lngRaw != null && lngRaw !== ''
      && Number.isFinite(Number(latRaw)) && Number.isFinite(Number(lngRaw)) && Math.abs(Number(latRaw)) <= 90 && Math.abs(Number(lngRaw)) <= 180;
    const query = coordinates ? `${Number(latRaw)},${Number(lngRaw)}` : address || (first ? fallback : '');
    return {
      nombre:stopPointName(stop) || clean(stop.punto_nombre) || (first ? clean(fallback) : ''),
      direccion:address,
      cuando:[dateLabel(day), clean(time), clean(window)].filter(Boolean).join(' · '),
      referencia:clean(stop.referencia || stop.referencia_cliente),
      contacto:[stop.contacto || stop.contacto_nombre, stop.telefono || stop.contacto_telefono, stop.email].map(clean).filter(Boolean).join(' · '),
      mercancia:clean(stop.mercancia || stop.descripcion_mercancia || order.mercancia),
      cantidad:[measure(stop.peso_kg, 'kg'), measure(stop.bultos, 'bultos')].filter(Boolean).join(' · '),
      instrucciones:clean(stop.notas || stop.instrucciones || stop.observaciones),
      map_url:clean(direct) || (query ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}` : ''),
    };
  });
}
function supplierEmailData(order = {}) {
  const cfg = order.empresa_cfg_precios || {};
  const profile = order.empresa_perfil || cfg.empresa_perfil || cfg;
  return {
    referencia_cliente:clean(order.referencia_cliente),
    fecha_descarga:dateLabel(order.fecha_descarga || order.fecha_entrega),
    cargas:mailStops(order, 'carga'),
    descargas:mailStops(order, 'descarga'),
    mercancia:clean(order.mercancia),
    cantidad:[measure(order.peso_kg, 'kg'), measure(order.bultos, 'bultos'), measure(order.metros_lineales, 'm lineales')].filter(Boolean).join(' · '),
    instrucciones:clean(order.notas),
    condiciones:clean(order.condiciones_adicionales),
    pago:formatCompanyPaymentTerms(profile, 'colaboradores'),
    tipo_vehiculo:clean(order.tipo_vehiculo || order.vehiculo_solicitado),
  };
}
module.exports = { supplierEmailData, mailStops, dateLabel };

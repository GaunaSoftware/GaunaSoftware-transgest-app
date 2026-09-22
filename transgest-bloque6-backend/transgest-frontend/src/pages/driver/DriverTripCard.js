import { DriverIcon } from './DriverUI';
const date = value => value ? new Date(String(value).slice(0,10)+'T12:00:00').toLocaleDateString('es-ES') : 'Fecha pendiente';
export default function DriverTripCard({ pedido, state, expanded, onToggle, featured }) {
  const Tag = expanded ? 'section' : 'button';
  return <Tag {...(expanded?{}:{type:'button','aria-expanded':false,'aria-label':`Ver detalles del viaje ${pedido.numero || ''}`,onClick:onToggle})} className={`driver-trip-card ${featured?'driver-trip-featured':''}`} style={{'--trip-color':state.c}}>
    <span className="driver-trip-card-top"><strong>{pedido.numero}</strong><span className="driver-status" style={{color:state.c,background:state.bg}}>{state.l}</span></span>
    <strong className="driver-trip-route">{pedido.origen||'Origen pendiente'} → {pedido.destino||'Destino pendiente'}</strong>
    <span className="driver-trip-client">{pedido.cliente_nombre || 'Cliente pendiente'}</span>
    {pedido.referencia_cliente && <span className="driver-trip-reference"><small>Referencia de carga</small><strong>{pedido.referencia_cliente}</strong></span>}
    <span className="driver-trip-card-meta"><span><DriverIcon name="vacaciones" size={20}/><span><small>Carga</small>{date(pedido.fecha_carga)}{pedido.hora_carga ? ` · ${pedido.hora_carga}`:''}</span></span><span><DriverIcon name="documento" size={20}/><span><small>Descarga</small>{date(pedido.fecha_descarga||pedido.fecha_entrega)}{pedido.hora_descarga?` · ${pedido.hora_descarga}`:''}</span></span></span>
    {featured && !expanded && <span className="driver-trip-goods"><span>{pedido.mercancia||pedido.descripcion_carga||'Mercancía pendiente'}</span><strong>{pedido.peso_kg ? `${Number(pedido.peso_kg).toLocaleString('es-ES')} kg`:'—'}</strong></span>}
    {!expanded && <span className={featured?'driver-trip-cta':'driver-trip-more'}>Ver detalles del viaje <span aria-hidden="true">→</span></span>}
  </Tag>;
}

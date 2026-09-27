import {displayOrderLocation} from '../../utils/orderTown';
export default function WeeklyPendingPanel({orders,open,onToggle,onOpen,onDragStart,canEdit}) {
 return <aside className={`traffic-week-pending ${open?'is-open':'is-closed'}`} aria-label="Pendientes de asignar">
  <button type="button" className="tgui-button" aria-expanded={open} onClick={onToggle}>
   {open?'Ocultar pendientes':'Mostrar pendientes'} ({orders.length})
  </button>
  {open&&<><h2>Pendientes de asignar ({orders.length})</h2><p>Semana seleccionada. Arrastra a vehículo y día, o abre el pedido para asignarlo.</p>
   {!orders.length&&<p>Sin pedidos pendientes en esta semana.</p>}
   {orders.map(order=><div key={order.id} className="traffic-week-pending-item" draggable={canEdit} onDragStart={event=>onDragStart(event,order)}>
    <button type="button" onClick={()=>onOpen(order)}><strong>{order.numero}</strong><span>{order.cliente_nombre||'Cliente pendiente'}</span>
     <span>{displayOrderLocation(order,'carga')} → {displayOrderLocation(order,'descarga')}</span></button>
   </div>)}
  </>}
 </aside>;
}

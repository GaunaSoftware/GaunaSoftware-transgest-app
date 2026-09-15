import { useState } from 'react';
import { Badge, Button, EmptyState, Icon, Modal, SearchInput, Select } from '../../ui';
import { pendingClosureRows, filterPendingClosures } from './closureQueue';
import './pending-closures.css';

const PAGE_SIZE = 8;
const status = { pendiente:'Pendiente', confirmado:'Confirmado', espera_carga:'Espera de carga', cargando:'Cargando', en_curso:'En ruta', espera_descarga:'Espera de descarga', descarga:'Descargando', incidencia:'Incidencia registrada' };
const dateText = value => new Date(`${value}T12:00:00`).toLocaleDateString('es-ES', { day:'2-digit', month:'short', year:'numeric' });

export default function PendingClosures({ orders, openOrder }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [page, setPage] = useState(1);
  const rows = pendingClosureRows(orders);
  const recent = rows.filter(row => row.days <= 7).length;
  const incidents = rows.filter(row => row.order.estado === 'incidencia').length;
  const filters = [
    { id:'all', label:'Todos', count:rows.length },
    { id:'recent', label:'Últimos 7 días', count:recent },
    { id:'older', label:'Más de 7 días', count:rows.length - recent },
    { id:'incident', label:'Con incidencia', count:incidents },
  ];
  const filtered = filterPendingClosures(rows, filter, query, sort);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const shown = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const selectFilter = value => { setFilter(value); setPage(1); };
  function review(value = 'all') {
    selectFilter(value); setQuery(''); setSort('recent'); setOpen(true);
  }
  function reviewOrder(order) {
    setOpen(false);
    openOrder({ pedido_id:order.id, numero:order.numero, ...(order.estado === 'incidencia' ? { action:'incidencia' } : {}) });
  }
  if (!rows.length && !open) return null;
  return <>
    <section className="pending-closures" aria-label="Pedidos pendientes de revisar">
      <div className="pending-closures-icon"><Icon name="clock" size={24}/></div>
      <div className="pending-closures-copy">
        <h3>Pedidos pendientes de revisar <span>{rows.length}</span></h3>
        <p>La fecha prevista ha pasado. Comprueba la entrega o actualiza la planificación.</p>
        <div className="pending-closures-counts">
          {filters.slice(1).map(item => <button type="button" key={item.id} onClick={() => review(item.id)}>{item.label} <strong>{item.count}</strong></button>)}
        </div>
      </div>
      <Button variant="primary" onClick={() => review()}>Revisar pedidos <Icon name="chevron" size={16}/></Button>
    </section>
    {open && <Modal title="Revisar pedidos pendientes" width={1040} onClose={() => setOpen(false)}>
      <div className="closure-review">
        <p className="closure-review-intro">Abre el pedido para registrar la entrega, reprogramar sus fechas o revisar la incidencia. Una fecha vencida no confirma por sí sola que el transporte haya sufrido un retraso.</p>
        <div className="closure-review-filters" role="group" aria-label="Antigüedad de pedidos">
          {filters.map(item => <Button key={item.id} aria-pressed={filter === item.id} onClick={() => selectFilter(item.id)}>{item.label}<span>{item.count}</span></Button>)}
        </div>
        <div className="closure-review-search">
          <SearchInput label="Buscar pedidos pendientes" placeholder="Pedido, cliente, ruta o motivo…" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}/>
          <Select label="Orden de revisión" value={sort} onChange={e => { setSort(e.target.value); setPage(1); }}><option value="recent">Más recientes primero</option><option value="oldest">Más antiguos primero</option></Select>
        </div>
        <div className="closure-review-columns" aria-hidden="true"><span>Pedido y ruta</span><span>Fecha pendiente</span><span>Situación registrada</span><span/></div>
        {shown.length ? <ul className="closure-review-list">{shown.map(({order, date, days, dateLabel}) => <li key={order.id}>
          <div className="closure-review-order"><strong>{order.numero || 'Pedido sin número'}</strong><span>{order.cliente_nombre || 'Cliente sin indicar'}</span><small title={`${order.origen || 'Origen sin indicar'} → ${order.destino || 'Destino sin indicar'}`}>{order.origen || 'Origen sin indicar'} → {order.destino || 'Destino sin indicar'}</small></div>
          <div className="closure-review-date"><span>{days === 1 ? 'Hace 1 día' : `Hace ${days} días`}</span><time dateTime={date}>{dateText(date)}</time><small>{dateLabel}</small></div>
          <div className="closure-review-reason"><Badge tone={order.estado === 'incidencia' ? 'danger' : 'neutral'}>{status[order.estado] || order.estado || 'Sin estado'}</Badge><p title={order.incidencia_descripcion || ''}>{order.incidencia_descripcion || (order.estado === 'incidencia' ? 'Revisar incidencia sin descripción.' : 'Entrega pendiente de confirmar.')}</p></div>
          <Button className="closure-review-action" aria-label={`Revisar ${order.numero || 'pedido'}`} onClick={() => reviewOrder(order)}>Revisar <Icon name="chevron" size={14}/></Button>
        </li>)}</ul> : <EmptyState title={rows.length ? 'No hay pedidos con estos filtros' : 'No quedan pedidos pendientes'} text={rows.length ? 'Prueba otra búsqueda o consulta todos los periodos.' : 'Las fechas y los estados están al día.'} action={rows.length ? <Button onClick={() => { selectFilter('all'); setQuery(''); }}>Limpiar filtros</Button> : null}/>}
        <footer className="closure-review-footer"><span>{filtered.length ? `${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, filtered.length)} de ${filtered.length} pedidos` : '0 pedidos'}</span><div><Button aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Anterior</Button><span>{currentPage} / {pages}</span><Button aria-label="Página siguiente" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>Siguiente</Button></div></footer>
      </div>
    </Modal>}
  </>;
}

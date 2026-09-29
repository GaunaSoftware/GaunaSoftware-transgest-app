import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Drawer } from '../../ui';
import { getViajesSinFacturar, getViajesSinFacturarCliente } from '../../services/api';
import './unbilled-trips.css';

const money = value => Number(value || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = value => value ? new Date(value).toLocaleDateString('es-ES') : 'Sin fecha';

export default function UnbilledTripsDrawer({ open, onClose, onInvoice, canEdit, onSummary }) {
  const [groups, setGroups] = useState([]);
  const [groupPage, setGroupPage] = useState(1);
  const [groupTotal, setGroupTotal] = useState(0);
  const [summary, setSummary] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [trips, setTrips] = useState([]);
  const [tripPage, setTripPage] = useState(1);
  const [tripTotal, setTripTotal] = useState(0);
  const [selected, setSelected] = useState({});
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [loadingTrips, setLoadingTrips] = useState(false);
  const [error, setError] = useState('');
  const tripRequest = useRef(0);

  const loadGroups = useCallback(async (page = 1) => {
    setLoadingGroups(true);
    setError('');
    try {
      const result = await getViajesSinFacturar({ page, limit: 50 });
      setGroups(previous => page === 1 ? result.data : [...previous, ...result.data]);
      setGroupPage(page);
      setGroupTotal(Number(result.total || 0));
      setSummary(result.resumen);
      onSummary?.(result.resumen);
    } catch (cause) {
      setError(cause.message || 'No se pudieron cargar los viajes pendientes.');
    } finally {
      setLoadingGroups(false);
    }
  }, [onSummary]);

  const loadTrips = useCallback(async (clientId, page = 1) => {
    const request = ++tripRequest.current;
    setLoadingTrips(true);
    setError('');
    try {
      const result = await getViajesSinFacturarCliente(clientId, { page, limit: 50 });
      if (request !== tripRequest.current) return;
      setTrips(previous => page === 1 ? result.data : [...previous, ...result.data]);
      setTripPage(page);
      setTripTotal(Number(result.total || 0));
    } catch (cause) {
      if (request === tripRequest.current) setError(cause.message || 'No se pudieron cargar los viajes del cliente.');
    } finally {
      if (request === tripRequest.current) setLoadingTrips(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    tripRequest.current++;
    setCustomer(null);
    setTrips([]);
    setSelected({});
    loadGroups(1);
  }, [open, loadGroups]);

  const chosen = useMemo(() => Object.values(selected), [selected]);
  const chosenTotal = chosen.reduce((total, trip) => total + Number(trip.importe_registrado || 0), 0);
  const selectable = trips.filter(trip => !['ausente', 'no_finito'].includes(trip.estado_importe));
  const allVisibleSelected = selectable.length > 0 && selectable.every(trip => selected[trip.id]);

  function openCustomer(group) {
    if (!group.cliente_id) return;
    if (customer?.cliente_id === group.cliente_id) {
      tripRequest.current++;
      setCustomer(null);
      setTrips([]);
      setSelected({});
      return;
    }
    setCustomer(group);
    setTrips([]);
    setSelected({});
    loadTrips(group.cliente_id, 1);
  }

  function toggleTrip(trip) {
    setSelected(previous => {
      const next = { ...previous };
      if (next[trip.id]) delete next[trip.id];
      else next[trip.id] = trip;
      return next;
    });
  }

  function toggleVisible() {
    setSelected(previous => {
      const next = { ...previous };
      for (const trip of selectable) {
        if (allVisibleSelected) delete next[trip.id];
        else next[trip.id] = trip;
      }
      return next;
    });
  }

  return <Drawer open={open} title="Viajes entregados pendientes de emitir" width={760} onClose={onClose}
    footer={<div className="unbilled-footer">
      <span>{chosen.length ? `${chosen.length} seleccionados · ${money(chosenTotal)} €` : `${Number(summary?.viajes || 0)} viajes pendientes · ${money(summary?.importe_registrado)} €`}</span>
      <Button onClick={() => { setSelected({}); setCustomer(null); setTrips([]); loadGroups(1); }}>Actualizar</Button>
      {canEdit && <Button variant="primary" disabled={!customer || !chosen.length} onClick={() => onInvoice(customer.cliente_id, chosen)}>Preparar factura</Button>}
    </div>}>
    <div className="unbilled-drawer">
      <p className="unbilled-intro">Selecciona un cliente, marca uno o varios viajes y revisa las líneas antes de emitir. Los borradores siguen pendientes de emisión.</p>
      {!!error && <div className="unbilled-error" role="alert">{error} <Button onClick={() => customer ? loadTrips(customer.cliente_id, tripPage) : loadGroups(groupPage)}>Reintentar</Button></div>}
      <div className="unbilled-summary">
        <strong>{Number(summary?.clientes || 0)} clientes</strong>
        <strong>{Number(summary?.viajes || 0)} viajes</strong>
        <strong>{money(summary?.importe_registrado)} €</strong>
      </div>
      {(Number(summary?.importe_ausente || 0) + Number(summary?.importe_no_finito || 0)) > 0 &&
        <p className="unbilled-warning">{Number(summary.importe_ausente || 0) + Number(summary.importe_no_finito || 0)} viajes sin importe válido requieren revisión y no se pueden seleccionar.</p>}
      <div className="unbilled-groups">
        {groups.map(group => <section className="unbilled-group" key={group.cliente_id}>
          <button type="button" className="unbilled-group-toggle" aria-expanded={customer?.cliente_id === group.cliente_id} onClick={() => openCustomer(group)}>
            <span className="unbilled-group-name"><span aria-hidden="true">{customer?.cliente_id === group.cliente_id ? '⌄' : '›'}</span> {group.cliente_nombre}</span>
            <span className="unbilled-group-meta">{group.viajes} viajes · {money(group.importe_registrado)} €</span>
          </button>
          {customer?.cliente_id === group.cliente_id && <div className="unbilled-group-body">
            <div className="unbilled-select-row">
              <span>{tripTotal} viajes pendientes · {chosen.length} seleccionados</span>
              {canEdit && selectable.length > 0 && <Button onClick={toggleVisible}>{allVisibleSelected ? 'Deseleccionar viajes mostrados' : 'Seleccionar viajes mostrados'}</Button>}
            </div>
            {trips.map(trip => <label className="unbilled-trip" key={trip.id}>
              {canEdit && <input type="checkbox" checked={!!selected[trip.id]} disabled={['ausente', 'no_finito'].includes(trip.estado_importe)} onChange={() => toggleTrip(trip)} aria-label={`Seleccionar ${trip.numero}`} />}
              <span className="unbilled-trip-main">
                <strong>{trip.numero}</strong>
                <span>{trip.origen || 'Origen pendiente'} → {trip.destino || 'Destino pendiente'}</span>
                <small>{date(trip.fecha_carga || trip.fecha_periodo)}{trip.referencia_cliente ? ` · Ref. ${trip.referencia_cliente}` : ''}{trip.factura_estado === 'borrador' ? ' · Borrador existente' : ''}</small>
              </span>
              <strong className="unbilled-trip-amount">{['ausente', 'no_finito'].includes(trip.estado_importe) ? 'Sin importe' : `${money(trip.importe_registrado)} €`}</strong>
            </label>)}
            {!loadingTrips && !trips.length && <p className="unbilled-empty">No hay viajes pendientes para este cliente.</p>}
            {tripTotal > trips.length && <Button disabled={loadingTrips} onClick={() => loadTrips(group.cliente_id, tripPage + 1)}>Cargar más viajes</Button>}
            {loadingTrips && <p role="status">Cargando viajes…</p>}
          </div>}
        </section>)}
      </div>
      {!loadingGroups && !groups.length && !error && <p className="unbilled-empty">No hay viajes entregados pendientes de emitir.</p>}
      {groupTotal > groups.length && <Button disabled={loadingGroups} onClick={() => loadGroups(groupPage + 1)}>Cargar más clientes</Button>}
      {loadingGroups && <p role="status">Cargando clientes…</p>}
    </div>
  </Drawer>;
}

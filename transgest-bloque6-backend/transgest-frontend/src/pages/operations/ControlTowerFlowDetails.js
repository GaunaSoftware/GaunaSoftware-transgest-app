import { useEffect, useState } from 'react';
import { Modal, Button } from '../../ui';
import { getControlTowerFlow } from '../../services/api';
import { displayOrderLocation } from '../../utils/orderTown';
import VehicleTrackingPanel from '../../components/VehicleTrackingPanel';

export default function ControlTowerFlowDetails({ selection, onClose, onSelect }) {
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [tracking,setTracking]=useState(null);
  useEffect(() => {
    let active = true;
    setLoading(true); setResult(null); setError('');
    const request = selection.remote
      ? getControlTowerFlow(selection.key, page)
      : Promise.resolve({ items: selection.trips, total: selection.total, page_size: 160 });
    request.then(value => { if (active) setResult(value); })
      .catch(e => { if (active) setError(e.message || 'No se pudieron cargar los viajes.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selection, page, retry]);
  const totalPages = Math.max(1, Math.ceil((result?.total || 0) / (result?.page_size || 40)));
  return <Modal title={selection.label} onClose={onClose} width={680}>
    <p>Selecciona un viaje para abrirlo en Mesa de tráfico.</p>
    {loading && <p role="status">Cargando viajes…</p>}
    {error && <div role="alert">{error} <Button onClick={() => setRetry(value => value + 1)}>Reintentar</Button></div>}
    {!loading && !error && result && <>
      <p role="status">{result.total} viajes · Página {page} de {totalPages}</p>
      {!result.items.length && <p>No hay viajes en este estado. Los estados pueden haber cambiado desde la última actualización.</p>}
      <div style={{ display: 'grid', gap: 8 }}>
        {result.items.map(trip => <div key={trip.id}><button type="button" onClick={() => onSelect(trip)}
          style={{ textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg3)', color: 'var(--text)', borderRadius: 10, padding: 12, overflowWrap: 'anywhere' }}>
          <strong>{trip.numero || 'Pedido'} · {trip.cliente_nombre || 'Cliente'}</strong>
          <div>{trip.vehiculo_matricula || trip.colaborador_nombre || 'Sin matrícula'}</div>
          <div>{displayOrderLocation(trip, 'carga')} → {displayOrderLocation(trip, 'descarga')}</div>
        </button><Button onClick={()=>setTracking(tracking===trip.id?null:trip.id)}>{tracking===trip.id?'Ocultar seguimiento':'Ver seguimiento'}</Button>{tracking===trip.id&&<VehicleTrackingPanel pedidoId={trip.id}/>}</div>)}
      </div>
      {selection.remote && <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <Button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Anterior</Button>
        <Button disabled={page >= totalPages} onClick={() => setPage(value => value + 1)}>Siguiente</Button>
      </div>}
      {!selection.remote && result.total > result.items.length && <p>Se muestran {result.items.length} de {result.total}. El servidor utiliza el detalle anterior sin paginación.</p>}
    </>}
  </Modal>;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { getTeletrabajoSolicitudes, crearTeletrabajoSolicitud, resolverTeletrabajoSolicitud,
  getOfficeVacationRequests, createOfficeVacationRequest, resolveOfficeVacationRequest } from '../../services/api';
import { notify } from '../../services/notify';

const kinds = {
  teletrabajo: { title: 'Teletrabajo', list: getTeletrabajoSolicitudes, create: crearTeletrabajoSolicitud, resolve: resolverTeletrabajoSolicitud },
  vacaciones: { title: 'Vacaciones', list: getOfficeVacationRequests, create: createOfficeVacationRequest, resolve: resolveOfficeVacationRequest },
};
const day = value => new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES');

export default function OfficeLeaveRequests({ canManage, today }) {
  return <div className="office-requests-grid">{Object.keys(kinds).map(kind => <RequestCard key={kind} kind={kind} canManage={canManage} today={today}/>)}</div>;
}

function RequestCard({ kind, canManage, today }) {
  const config = kinds[kind];
  const [form, setForm] = useState({ fecha: today, desde: today, hasta: today, motivo: '' });
  const [period, setPeriod] = useState({ desde: `${today.slice(0, 4)}-01-01`, hasta: `${Number(today.slice(0, 4)) + 1}-12-31` });
  const [rows, setRows] = useState([]), [error, setError] = useState(''), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const id = ++sequence.current;
    setLoading(true); setError('');
    try {
      const data = await config.list(period);
      if (id === sequence.current) setRows(data);
    } catch (e) { if (id === sequence.current) setError(e.message || 'No se pudieron cargar las solicitudes.'); }
    finally { if (id === sequence.current) setLoading(false); }
  }, [config, period]);
  useEffect(() => { const requests = sequence; load(); return () => { requests.current++; }; }, [load]);
  async function submit(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true);
    try {
      await config.create(kind === 'teletrabajo' ? { fecha: form.fecha, motivo: form.motivo } : { desde: form.desde, hasta: form.hasta, motivo: form.motivo });
      notify('Solicitud enviada a gerencia.', 'success');
      setForm(previous => ({ ...previous, motivo: '' }));
      const from = kind === 'teletrabajo' ? form.fecha : form.desde, to = kind === 'teletrabajo' ? form.fecha : form.hasta;
      if (from < period.desde || to > period.hasta) setPeriod({ desde: from < period.desde ? from : period.desde, hasta: to > period.hasta ? to : period.hasta });
      else await load();
    } catch (e) { notify(e.message || 'No se pudo enviar la solicitud.', 'error'); }
    finally { setBusy(false); }
  }
  async function resolve(id, estado) {
    if (busy) return; setBusy(true);
    try { await config.resolve(id, { estado }); await load(); }
    catch (e) { notify(e.message || 'No se pudo resolver la solicitud.', 'error'); }
    finally { setBusy(false); }
  }
  return <section className="personnel-card office-requests" aria-label={config.title}>
    <h2>{config.title}</h2>
    <p>{canManage ? 'Revisa y resuelve las solicitudes del personal de oficina.' : 'Envía tu solicitud. Gerencia confirmará su aprobación o rechazo.'}</p>
    {!canManage && <form onSubmit={submit}>
      <div className="office-request-dates">
        {kind === 'teletrabajo' ? <label>Día de teletrabajo<input aria-label="Día de teletrabajo" type="date" required value={form.fecha} onChange={e => setForm(previous => ({ ...previous, fecha: e.target.value }))}/></label>
          : <><label>Inicio de vacaciones<input aria-label="Inicio de vacaciones" type="date" required value={form.desde} onChange={e => setForm(previous => ({ ...previous, desde: e.target.value }))}/></label>
            <label>Fin de vacaciones<input aria-label="Fin de vacaciones" type="date" required min={form.desde} value={form.hasta} onChange={e => setForm(previous => ({ ...previous, hasta: e.target.value }))}/></label></>}
      </div>
      <label>Motivo (opcional)<input aria-label={`Motivo de ${kind}`} maxLength={500} value={form.motivo} onChange={e => setForm(previous => ({ ...previous, motivo: e.target.value }))}/></label>
      <button type="submit" disabled={busy}>Solicitar {kind}</button>
    </form>}
    <details><summary>Periodo de solicitudes</summary><div className="office-request-dates">
      <label>Desde<input aria-label={`Solicitudes de ${kind} desde`} type="date" value={period.desde} onChange={e => setPeriod(previous => ({ ...previous, desde: e.target.value }))}/></label>
      <label>Hasta<input aria-label={`Solicitudes de ${kind} hasta`} type="date" value={period.hasta} onChange={e => setPeriod(previous => ({ ...previous, hasta: e.target.value }))}/></label>
    </div></details>
    {loading ? <p role="status">Cargando solicitudes…</p> : error ? <div role="alert">{error} <button onClick={load}>Reintentar solicitudes</button></div> : <ul className="office-request-list">
      {rows.map(row => <li key={row.id}>
        <div><strong>{canManage ? `${row.usuario_nombre || 'Empleado'} · ` : ''}{kind === 'teletrabajo' ? day(row.fecha) : `${day(row.desde)} – ${day(row.hasta)}`}</strong>
          <span className={`office-request-status status-${row.estado}`}>{row.estado}</span>
          {row.motivo && <p>{row.motivo}</p>}{row.comentario_resolucion && <p>Gerencia: {row.comentario_resolucion}</p>}</div>
        {canManage && row.estado === 'pendiente' && <div className="office-request-actions"><button disabled={busy} onClick={() => resolve(row.id, 'aprobada')}>Aprobar</button><button disabled={busy} onClick={() => resolve(row.id, 'rechazada')}>Rechazar</button></div>}
      </li>)}
      {!rows.length && <li>Sin solicitudes en el periodo seleccionado.</li>}
    </ul>}
  </section>;
}

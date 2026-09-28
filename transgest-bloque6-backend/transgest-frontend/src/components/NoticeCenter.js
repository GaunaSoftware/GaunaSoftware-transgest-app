import React, { useEffect, useState } from 'react';
import { Button, EmptyState } from '../ui';
import { getCentroAvisos, guardarConfiguracionAvisos } from '../services/api';
import { openNotice } from '../services/noticeNavigation';

export function useNoticeCenter(enabled = true) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setError('');
    getCentroAvisos().then(d => { if (active) setData(d); }).catch(e => { if (active) setError(e.message || 'No se pudieron consultar los vencimientos.'); });
    return () => { active = false; };
  }, [enabled, revision]);
  return { data, error, reload:() => setRevision(n => n + 1) };
}
export function NoticeList({ data, category, categories, limit, error, reload }) {
  const [search, setSearch] = useState('');
  const rows = (data?.items || []).filter(i => (!category || i.category === category) && (!categories || categories.includes(i.category)) && `${i.title} ${i.entity || ''}`.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return <section className="notices-center" aria-label="Vencimientos por tipo">
    <div className="notices-tools"><label>Buscar aviso<input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Pedido, factura, matrícula o conductor"/></label><Button onClick={reload}>Actualizar</Button></div>
    {error && <p role="alert" className="notices-error">{error}</p>}
    {data?.errors?.length > 0 && <p role="alert" className="notices-error">Consulta parcial: no se pudieron leer {data.errors.map(e=>e.source).join(', ')}. Actualiza para reintentar.</p>}
    {!data && !error && <p role="status">Consultando vencimientos…</p>}
    {data && <p className="notices-caption">{rows.length} avisos · Fecha de consulta: {new Date(`${data.date}T12:00:00`).toLocaleDateString('es-ES')}. Incidencias y vencimientos según tus permisos y la configuración de cada tipo.</p>}
    {rows.slice(0,limit || rows.length).map(item => <article key={item.id} className="notices-entry">
      <div><span className={`notice-status ${item.severity}`}>{item.category === 'operativa' ? 'Requiere atención' : item.days < 0 ? `Vencido hace ${Math.abs(item.days)} días` : item.days === 0 ? 'Vence hoy' : `Vence en ${item.days} días`}</span><h3>{item.title}</h3><p>{item.entity}</p>{item.amount != null && <strong>{Number(item.amount).toLocaleString('es-ES',{style:'currency',currency:'EUR'})} · Total factura</strong>}{item.description && <p className="notices-caption">{item.description}</p>}</div>
      <div className="notices-entry-action"><time>{new Date(`${item.date}T12:00:00`).toLocaleDateString('es-ES')}</time><Button onClick={()=>openNotice(item)}>{item.category === 'facturas' ? 'Ver factura' : item.category === 'seguros' ? 'Ver póliza' : item.category === 'operativa' ? 'Abrir pedido' : 'Abrir ficha'}</Button></div>
    </article>)}
    {data && !rows.length && !error && <EmptyState title="Sin avisos para este filtro" description={data.errors?.length ? 'Hay fuentes pendientes de consultar.' : 'Puedes cambiar los plazos en Configuración.'}/>}
  </section>;
}
export function NoticeSettings({ data, canEdit, onSaved }) {
  const [rows, setRows] = useState(data?.categories || []), [busy,setBusy]=useState(false), [message,setMessage]=useState('');
  useEffect(()=>setRows(data?.categories || []),[data]);
  async function save(e) {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await guardarConfiguracionAvisos(rows.map(({key,enabled,days})=>({key,enabled,days}))); setMessage('Configuración guardada.'); onSaved(); }
    catch(e) { setMessage(e.message); } finally { setBusy(false); }
  }
  return <form className="notices-settings" onSubmit={save}><h2>Vencimientos por tipo</h2><p>La antelación se aplica en Dashboard, Avisos e Intelligence. Los vencidos siguen apareciendo mientras el tipo esté activo.</p>
    {rows.map((r,index)=><fieldset key={r.key} disabled={!canEdit || busy}><legend>{r.label}</legend><label><input type="checkbox" checked={r.enabled} onChange={e=>setRows(prev=>prev.map((v,i)=>i===index?{...v,enabled:e.target.checked}:v))}/> Mostrar avisos</label><label>Antelación (días)<input type="number" min="0" max="365" required value={r.days} onChange={e=>setRows(prev=>prev.map((v,i)=>i===index?{...v,days:e.target.value===''?'':Number(e.target.value)}:v))}/></label></fieldset>)}
    {canEdit ? <Button type="submit" variant="primary" disabled={busy || !rows.length}>{busy?'Guardando…':'Guardar configuración'}</Button> : <p>Gerencia puede modificar esta configuración.</p>}{message && <p role="status">{message}</p>}
  </form>;
}

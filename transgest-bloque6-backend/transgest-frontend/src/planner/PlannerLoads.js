import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getPedidos, getPedido, getClientes, getColaboradores, crearPedido, editarPedido, enviarWorkflowColaborador } from '../services/api';
import { supplierPriceType } from '../utils/supplierPricing';
import { orderTown } from '../utils/orderTown';

const rowsOf = data => Array.isArray(data) ? data : data?.data || [];
const localDate = () => new Date().toLocaleDateString('en-CA');
const statusLabels = { pendiente:'Sin confirmar', confirmado:'Confirmado', en_carga:'En carga', en_ruta:'En ruta', descargando:'Descargando', entregado:'Entregado', facturado:'Facturado', incidencia:'Incidencia', cancelado:'Cancelado' };
const parseStops = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || []; } catch { return []; } };
const empty = () => ({ cliente_id:'', colaborador_id:'', referencia_cliente:'', fecha_carga:localDate(), fecha_descarga:'', mercancia:'', peso_kg:'', bultos:'', notas:'', tipo_precio_colaborador:'viaje', precio_colaborador:'', precio_colaborador_unitario:'', minimo_colaborador_unidades:'', puntos_carga:[{nombre:'',direccion:'',ciudad:'',provincia:'',pais:'España'}], puntos_descarga:[{nombre:'',direccion:'',ciudad:'',provincia:'',pais:'España'}] });

export default function PlannerLoads() {
  const { puedeEditar, puedeVer } = useAuth();
  const [orders,setOrders] = useState([]), [clients,setClients] = useState([]), [agencies,setAgencies] = useState([]);
  const [month,setMonth] = useState(localDate().slice(0,7)), [page,setPage] = useState(1), [hasNext,setHasNext] = useState(false);
  const [draft,setDraft] = useState(null), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(false);
  const request = useRef(0), baseline = useRef('');
  const canEdit = puedeEditar('pedidos');
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      const [y,m] = month.split('-').map(Number);
      const end = `${month}-${new Date(y,m,0).getDate()}`;
      const data = await getPedidos({ desde:`${month}-01`, hasta:end, page, limit:50 });
      if (version !== request.current) return;
      const rows = rowsOf(data); setOrders(rows);
      setHasNext(data?.pagination?.hasNext ?? (data?.pagination?.totalPages ? page < data.pagination.totalPages : rows.length === 50));
    } catch (err) { if (version === request.current) setError(err.message); }
    finally { if (version === request.current) setLoading(false); }
  }, [month,page]);
  const cancelLoad = useCallback(() => { request.current++; }, []);
  useEffect(() => { load(); return cancelLoad; }, [load,cancelLoad]);
  useEffect(() => {
    let active = true;
    async function fetchCatalogs() {
      try {
        const c = puedeVer('clientes') ? await getClientes('', 'true', 1, 1000) : [];
        const a = puedeVer('colaboradores') ? await getColaboradores() : [];
        if (active) { setClients(rowsOf(c)); setAgencies(rowsOf(a)); }
      } catch (err) { if (active) setError(err.message); }
    }
    fetchCatalogs(); return () => { active = false; };
  }, [puedeVer]);
  function open(value) { baseline.current = JSON.stringify(value); setDraft(value); setError(''); }
  function close() {
    if (busy) return;
    if (JSON.stringify(draft) !== baseline.current && !window.confirm('Hay cambios sin guardar. ¿Descartar los cambios?')) return;
    setDraft(null);
  }
  async function edit(order) {
    setBusy(true);
    try { const full = await getPedido(order.id); open({...full, puntos_carga:parseStops(full.puntos_carga), puntos_descarga:parseStops(full.puntos_descarga), tipo_precio_colaborador:supplierPriceType(full)}); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  function change(key,value) { setDraft(d => ({...d,[key]:value})); }
  function changeStop(key,index,field,value) { setDraft(d => ({...d,[key]:d[key].map((stop,i) => i === index ? {...stop,[field]:value} : stop)})); }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    if (draft.id && JSON.stringify(draft) === baseline.current) { setDraft(null); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const keys = ['cliente_id','colaborador_id','referencia_cliente','fecha_carga','fecha_descarga','mercancia','peso_kg','bultos','notas','tipo_precio_colaborador','precio_colaborador','precio_colaborador_unitario','minimo_colaborador_unidades','puntos_carga','puntos_descarga'];
      const payload = Object.fromEntries(keys.map(key => [key,draft[key] ?? null]));
      payload.origen = draft.puntos_carga[0]?.nombre || draft.puntos_carga[0]?.ciudad;
      payload.destino = draft.puntos_descarga[0]?.nombre || draft.puntos_descarga[0]?.ciudad;
      payload.puntos_carga = payload.puntos_carga.map((stop,i) => ({...stop,orden:i+1,fecha:stop.fecha || draft.fecha_carga}));
      payload.puntos_descarga = payload.puntos_descarga.map((stop,i) => ({...stop,orden:i+1,fecha:stop.fecha || draft.fecha_descarga}));
      if (draft.id) {
        const initial = JSON.parse(baseline.current);
        const patch = Object.fromEntries(Object.entries(payload).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(initial[key] ?? null)));
        if (Object.keys(patch).length) await editarPedido(draft.id,patch);
      } else await crearPedido({...payload,estado:'pendiente',tipo_precio:'viaje',tipo_carga:'completa',importe:0,precio_unitario:0});
      setDraft(null); setNotice('Carga guardada.'); await load();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function notifyAgency(order) {
    if (!window.confirm(`¿Enviar el encargo ${order.numero} a la agencia asignada?`)) return;
    setBusy(true); setError('');
    try { await enviarWorkflowColaborador(order.id); setNotice('Encargo enviado a la agencia.'); await load(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <section className="planner-loads">
    <div className="planner-toolbar"><h1>Cargas</h1><label>Mes<input type="month" value={month} required onChange={e=>{if(e.target.value){setMonth(e.target.value);setPage(1);}}}/></label><button disabled={loading} onClick={load}>Actualizar</button>{canEdit && <button className="primary" onClick={()=>open(empty())}>Nueva carga</button>}</div>
    {error && !draft && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="planner-table" aria-busy={loading}><table><thead><tr><th>Referencia</th><th>Carga</th><th>Destino</th><th>Agencia</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {orders.map(order=><tr key={order.id}><td><button disabled={busy} onClick={()=>edit(order)}>{order.numero}</button><small>{order.referencia_cliente}</small></td><td>{order.fecha_carga?.slice(0,10)}<small>{orderTown(parseStops(order.puntos_carga)[0] || {}, order.origen)}</small></td><td>{orderTown(parseStops(order.puntos_descarga)[0] || {}, order.destino)}</td><td>{order.colaborador_nombre || agencies.find(a=>a.id===order.colaborador_id)?.nombre || 'Sin asignar'}</td><td>{statusLabels[order.estado] || order.estado}</td><td>{canEdit && <button disabled={busy} onClick={()=>edit(order)}>Editar / asignar</button>}{canEdit && order.colaborador_id && !['cancelado','entregado','facturado'].includes(order.estado) && <button disabled={busy} onClick={()=>notifyAgency(order)}>Enviar encargo</button>}</td></tr>)}
      {!orders.length && <tr><td colSpan="6">{loading ? 'Cargando...' : 'No hay cargas en este periodo.'}</td></tr>}
    </tbody></table></div>
    <div className="planner-pagination"><button disabled={page===1 || loading} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button disabled={!hasNext || loading} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    {draft && <div className="planner-overlay"><form className="planner-dialog" role="dialog" aria-modal="true" aria-labelledby="planner-load-title" onSubmit={save}>
      <header><h2 id="planner-load-title">{draft.id ? draft.numero : 'Nueva carga'}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></header>
      <div className="planner-dialog-body">
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={!canEdit || busy}>
          <div className="planner-grid"><label>Destinatario<select aria-label="Destinatario" required value={draft.cliente_id || ''} onChange={e=>change('cliente_id',e.target.value)}><option value="">Seleccionar</option>{clients.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <label>Agencia de transporte<select aria-label="Agencia de transporte" value={draft.colaborador_id || ''} onChange={e=>change('colaborador_id',e.target.value)}><option value="">Sin asignar</option>{agencies.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
          <label>Referencia<input value={draft.referencia_cliente || ''} onChange={e=>change('referencia_cliente',e.target.value)}/></label>
          <label>Fecha de carga<input type="date" min="2000-01-01" max="2100-12-31" required value={draft.fecha_carga?.slice(0,10) || ''} onChange={e=>change('fecha_carga',e.target.value)}/></label>
          <label>Fecha de descarga<input type="date" min={draft.fecha_carga?.slice(0,10) || '2000-01-01'} max="2100-12-31" value={draft.fecha_descarga?.slice(0,10) || ''} onChange={e=>change('fecha_descarga',e.target.value)}/></label></div>
          {['puntos_carga','puntos_descarga'].map(key=><section className="planner-stops" key={key}><h3>{key === 'puntos_carga' ? 'Cargas' : 'Descargas'}</h3>{draft[key].map((stop,index)=><div className="planner-stop" key={index}><strong>{index+1}</strong><div className="planner-grid">{[['nombre','Nombre del punto'],['direccion','Dirección'],['ciudad','Población'],['provincia','Provincia'],['pais','País'],['ventana','Ventana horaria'],['referencia','Referencia']].map(([field,label])=><label key={field}>{label}<input required={['nombre','ciudad','pais'].includes(field)} value={stop[field] || ''} onChange={e=>changeStop(key,index,field,e.target.value)}/></label>)}</div>{draft[key].length>1 && <button type="button" onClick={()=>change(key,draft[key].filter((_,i)=>i!==index))}>Quitar parada</button>}</div>)}<button type="button" onClick={()=>change(key,[...draft[key],{nombre:'',ciudad:'',pais:'España'}])}>Añadir {key==='puntos_carga' ? 'carga' : 'descarga'}</button></section>)}
          <div className="planner-grid">{[['mercancia','Mercancía'],['peso_kg','Peso (kg)'],['bultos','Bultos']].map(([key,label])=><label key={key}>{label}<input value={draft[key] ?? ''} inputMode={key==='mercancia' ? 'text' : 'decimal'} onChange={e=>change(key,e.target.value)}/></label>)}
          <label>Tarifa de la agencia<select aria-label="Tarifa de la agencia" value={draft.tipo_precio_colaborador} onChange={e=>setDraft(d=>({...d,tipo_precio_colaborador:e.target.value,precio_colaborador:'',precio_colaborador_unitario:'',minimo_colaborador_unidades:''}))}><option value="viaje">Por viaje</option><option value="tonelada">Por tonelada cargada</option></select></label>
          {draft.tipo_precio_colaborador==='tonelada' ? <><label>EUR / tonelada<input inputMode="decimal" value={draft.precio_colaborador_unitario ?? ''} onChange={e=>change('precio_colaborador_unitario',e.target.value)}/></label><label>Mínimo de toneladas<input inputMode="decimal" value={draft.minimo_colaborador_unidades ?? ''} onChange={e=>change('minimo_colaborador_unidades',e.target.value)}/></label></> : <label>Precio del transporte (EUR)<input inputMode="decimal" value={draft.precio_colaborador ?? ''} onChange={e=>change('precio_colaborador',e.target.value)}/></label>}</div>
          <label>Observaciones<textarea value={draft.notas || ''} onChange={e=>change('notas',e.target.value)}/></label>
        </fieldset>
      </div><footer><button type="button" onClick={close} disabled={busy}>Cerrar</button>{canEdit && <button className="primary" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar carga'}</button>}</footer>
    </form></div>}
  </section>;
}

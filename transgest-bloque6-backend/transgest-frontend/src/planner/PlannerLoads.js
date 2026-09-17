import RutaMapa from '../components/RutaMapa';
import RemolqueGrupaje from '../components/RemolqueGrupaje';
import PlannerWarehouse from './PlannerWarehouse';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { getPedidos, getPedido, getClientes, getColaboradores, crearPedido, editarPedido, enviarWorkflowColaborador,transportExchange,plannerApi } from '../services/api';
import { supplierPriceType } from '../utils/supplierPricing';
import { orderTown } from '../utils/orderTown';
import PlannerSlots from './PlannerSlots';
import {PageHead,Metrics,Panel,Badge} from './PlannerUI';
import { loadPlannerClients } from './catalogs';

const rowsOf = data => Array.isArray(data) ? data : data?.data || [];
const localDate = () => new Date().toLocaleDateString('en-CA');
const statusLabels = { espera_carga:'En espera de carga',cargando:'Cargando',en_curso:'En ruta',espera_descarga:'En espera de descarga',descarga:'Descargando',pendiente:'Sin confirmar', confirmado:'Confirmado', en_carga:'En carga', en_ruta:'En ruta', descargando:'Descargando', entregado:'Entregado', facturado:'Facturado', incidencia:'Incidencia', cancelado:'Cancelado' };
const parseStops = value => { try { return typeof value === 'string' ? JSON.parse(value) : value || []; } catch { return []; } };
const empty = () => ({ cliente_id:'', colaborador_id:'', referencia_cliente:'', tipo_carga:'completa', fecha_carga:localDate(), fecha_descarga:'', mercancia:'', peso_kg:'', bultos:'', notas:'', tipo_precio_colaborador:'viaje', precio_colaborador:'', precio_colaborador_unitario:'', minimo_colaborador_unidades:'', puntos_carga:[{nombre:'',direccion:'',ciudad:'',provincia:'',pais:'España'}], puntos_descarga:[{nombre:'',direccion:'',ciudad:'',provincia:'',pais:'España'}] });

export default function PlannerLoads({onPlan,onPrepare,focusOrder,onFocusConsumed}) {
  const { puedeEditar, puedeVer } = useAuth();
  const [summary,setSummary]=useState(null);
  const [preparing,setPreparing]=useState('');
  const prepare=id=>setPreparing(id);
  const [orders,setOrders] = useState([]), [clients,setClients] = useState([]), [agencies,setAgencies] = useState([]);
  const [day,setDay] = useState(localDate()), [month,setMonth] = useState(localDate().slice(0,7)), [page,setPage] = useState(1), [hasNext,setHasNext] = useState(false);
  const [draft,setDraft] = useState(null), [error,setError] = useState(''), [notice,setNotice] = useState(''), [busy,setBusy] = useState(false), [loading,setLoading] = useState(false);
  const request = useRef(0), baseline = useRef('');
  const canEdit = puedeEditar('pedidos');
  const load = useCallback(async () => {
    const version = ++request.current;
    setLoading(true); setError('');
    try {
      if(canEdit)await transportExchange('/sincronizar',{method:'POST',body:{}});
      const [y,m] = month.split('-').map(Number);
      const end = `${month}-${new Date(y,m,0).getDate()}`;
      const [data,stats]=await Promise.all([getPedidos({workspace:'planner',desde:day||`${month}-01`,hasta:day||end,page,limit:50}),plannerApi(`/resumen?mes=${month}`)]);
      if (version !== request.current) return;
      const rows = rowsOf(data); setOrders(rows);setSummary(stats);
      setHasNext(data?.pagination?.hasNext ?? (data?.pagination?.totalPages ? page < data.pagination.totalPages : rows.length === 50));
    } catch (err) { if (version === request.current) setError(err.message); }
    finally { if (version === request.current) setLoading(false); }
  }, [month,day,page,canEdit]);
  const cancelLoad = useCallback(() => { request.current++; }, []);
  useEffect(() => { load();const timer=setInterval(()=>{if(!document.hidden)load();},60000); return ()=>{clearInterval(timer);cancelLoad();}; }, [load,cancelLoad]);
  useEffect(() => {
    let active = true;
    async function fetchCatalogs() {
      try {
        const c = puedeVer('clientes') ? await loadPlannerClients((page,limit)=>getClientes('', 'true', page, limit),()=>active) : [];
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
  useEffect(()=>{if(!focusOrder)return;let alive=true;getPedido(focusOrder).then(full=>{if(alive){open({...full,puntos_carga:parseStops(full.puntos_carga),puntos_descarga:parseStops(full.puntos_descarga),tipo_precio_colaborador:supplierPriceType(full)});onFocusConsumed?.();}}).catch(err=>{if(alive)setError(err.message);});return()=>{alive=false;};},[focusOrder,onFocusConsumed]);
  function change(key,value) { setDraft(d => ({...d,[key]:value})); }
  function changeStop(key,index,field,value) { setDraft(d => ({...d,[key]:d[key].map((stop,i) => i === index ? {...stop,[field]:value} : stop)})); }
  async function save(event) {
    event.preventDefault(); if (busy) return;
    if (draft.id && JSON.stringify(draft) === baseline.current) { setDraft(null); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const keys = ['tipo_carga','cliente_id','colaborador_id','referencia_cliente','fecha_carga','fecha_descarga','mercancia','peso_kg','bultos','notas','tipo_precio_colaborador','precio_colaborador','precio_colaborador_unitario','minimo_colaborador_unidades','puntos_carga','puntos_descarga'];
      const payload = Object.fromEntries(keys.map(key => [key,draft[key] ?? null]));
      payload.origen = draft.puntos_carga[0]?.nombre || draft.puntos_carga[0]?.ciudad;
      payload.destino = draft.puntos_descarga[0]?.nombre || draft.puntos_descarga[0]?.ciudad;
      payload.puntos_carga = payload.puntos_carga.map((stop,i) => ({...stop,orden:i+1,fecha:stop.fecha || draft.fecha_carga}));
      payload.puntos_descarga = payload.puntos_descarga.map((stop,i) => ({...stop,orden:i+1,fecha:stop.fecha || draft.fecha_descarga}));
      if (draft.id) {
        const initial = JSON.parse(baseline.current);
        const patch = Object.fromEntries(Object.entries(payload).filter(([key,value]) => JSON.stringify(value) !== JSON.stringify(initial[key] ?? null)));
        if (Object.keys(patch).length) await editarPedido(draft.id,patch);
      } else {
        const created=await crearPedido({...payload,workspace:'planner',estado:'pendiente',tipo_precio:'viaje',importe:0,precio_unitario:0});
        if(event.nativeEvent?.submitter?.value==='prepare')prepare(created.id||created.pedido?.id);
      }
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
    <PageHead icon="truck" title="Planificación de cargas" description="Organiza las cargas, prepara la mercancía y coordina la aceptación de los transportistas.">{canEdit&&<button className="primary" onClick={()=>open(empty())}>+ Nueva carga</button>}</PageHead>
    <Metrics items={[{label:'Cargas del mes',value:summary?.cargas??'—',icon:'truck',note:'Todas las cargas del mes seleccionado'},{label:'Sin transportista',value:summary?.sin_asignar??'—',icon:'alert',tone:'amber'},{label:'Aceptadas por proveedor',value:summary?.aceptadas??'—',icon:'file',tone:'blue'},{label:'Incidencias',value:summary?.incidencias??'—',icon:'alert',tone:'red'}]}/>
    <PlannerSlots compact selectedDay={day||undefined} onDayChange={value=>{setDay(value);setMonth(value.slice(0,7));setPage(1);}} onOrder={id=>{const order=orders.find(o=>o.id===id);edit(order||{id});}}/>
    <Panel title="Cargas y asignación de transporte" icon="truck"><div className="pl-filters"><label>Mes<input type="month" value={month} required onChange={e=>{if(e.target.value){setMonth(e.target.value);setDay('');setPage(1);}}}/></label><label>Día<input type="date" value={day} onChange={e=>{setDay(e.target.value);if(e.target.value)setMonth(e.target.value.slice(0,7));setPage(1);}}/></label><button onClick={()=>{setDay(localDate());setMonth(localDate().slice(0,7));setPage(1);}}>Hoy</button><button aria-pressed={!day} onClick={()=>{setDay('');setPage(1);}}>Todo el mes</button><button disabled={loading} onClick={load}>Actualizar</button></div>
    {error && !draft && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <div className="planner-table" aria-busy={loading}><table><thead><tr><th>Referencia / cliente</th><th>Carga</th><th>Destino</th><th>Transportista / flota</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {orders.map(order=><tr key={order.id}><td><button disabled={busy} onClick={()=>edit(order)}>{order.numero}</button><small>{order.cliente_nombre || order.cliente || clients.find(c=>c.id===order.cliente_id)?.nombre || 'Cliente no disponible'}</small><small>{order.referencia_cliente}</small></td><td>{order.fecha_carga?.slice(0,10)}<small>{orderTown(parseStops(order.puntos_carga)[0] || {}, order.origen)}</small></td><td>{orderTown(parseStops(order.puntos_descarga)[0] || {}, order.destino)}</td><td>{order.colaborador_nombre || agencies.find(a=>a.id===order.colaborador_id)?.nombre || (order.vehiculo_id?`Flota propia · ${order.vehiculo_matricula||'Vehículo asignado'}`:'Pendiente asignación colaborador')}</td><td><Badge value={order.estado}>{statusLabels[order.estado] || order.estado}</Badge></td><td>{canEdit&&puedeEditar('palets')&&<button onClick={()=>prepare(order.id)}>Preparar mercancía</button>}{canEdit && <button disabled={busy} onClick={()=>edit(order)}>Editar / asignar</button>}{canEdit && order.colaborador_id && !['cancelado','entregado','facturado'].includes(order.estado) && <button disabled={busy} onClick={()=>notifyAgency(order)}>Enviar encargo</button>}</td></tr>)}
      {!orders.length && <tr><td colSpan="6">{loading ? 'Cargando...' : 'No hay cargas en este periodo.'}</td></tr>}
    </tbody></table></div>
    <div className="planner-pagination"><button disabled={page===1 || loading} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>Página {page}</span><button disabled={!hasNext || loading} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
    </Panel>
    {draft && <div className="planner-overlay"><form className="planner-dialog" role="dialog" aria-modal="true" aria-labelledby="planner-load-title" onSubmit={save}>
      <header><h2 id="planner-load-title">{draft.id ? draft.numero : 'Nueva carga'}</h2><button type="button" onClick={close} aria-label="Cerrar">×</button></header>
      <div className="planner-dialog-body">
        {error && <p role="alert">{error}</p>}
        <fieldset disabled={!canEdit || busy}>
          <div className="planner-grid"><label>Destinatario<select aria-label="Destinatario" required value={draft.cliente_id || ''} onChange={e=>change('cliente_id',e.target.value)}><option value="">Seleccionar</option>{clients.map(c=><option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <label>Agencia de transporte<select aria-label="Agencia de transporte" value={draft.colaborador_id || ''} onChange={e=>change('colaborador_id',e.target.value)}><option value="">Sin asignar</option>{agencies.map(a=><option key={a.id} value={a.id}>{a.nombre}</option>)}</select></label>
          <label>Referencia<input value={draft.referencia_cliente || ''} onChange={e=>change('referencia_cliente',e.target.value)}/></label>
          <label>Fecha de carga<input type="date" min="2000-01-01" max="2100-12-31" required value={draft.fecha_carga?.slice(0,10) || ''} onChange={e=>change('fecha_carga',e.target.value)}/></label>
          <label>Tipo de carga<select value={draft.tipo_carga||'completa'} onChange={e=>change('tipo_carga',e.target.value)}><option value="completa">Carga completa</option><option value="grupaje">Grupaje / varios repartos</option></select></label><label>Fecha de descarga<input type="date" min={draft.fecha_carga?.slice(0,10) || '2000-01-01'} max="2100-12-31" value={draft.fecha_descarga?.slice(0,10) || ''} onChange={e=>change('fecha_descarga',e.target.value)}/></label></div>
          {['puntos_carga','puntos_descarga'].map(key=><section className="planner-stops" key={key}><h3>{key === 'puntos_carga' ? 'Cargas' : 'Descargas'}</h3>{draft[key].map((stop,index)=><div className="planner-stop" key={index}><strong>{index+1}</strong><div className="planner-grid">{[['nombre','Nombre del punto'],['direccion','Dirección'],['codigo_postal','Código postal'],['google_maps_url','Enlace del mapa'],['ciudad','Población'],['provincia','Provincia'],['pais','País'],['ventana','Ventana horaria'],['referencia','Referencia']].map(([field,label])=><label key={field}>{label}<input required={['nombre','ciudad','pais'].includes(field)} value={stop[field] || ''} onChange={e=>changeStop(key,index,field,e.target.value)}/></label>)}</div>{draft[key].length>1 && <button type="button" onClick={()=>change(key,draft[key].filter((_,i)=>i!==index))}>Quitar parada</button>}</div>)}<button type="button" onClick={()=>change(key,[...draft[key],{nombre:'',ciudad:'',pais:'España'}])}>Añadir {key==='puntos_carga' ? 'carga' : 'descarga'}</button></section>)}
          <div className="planner-grid">{[['mercancia','Mercancía'],['peso_kg','Peso (kg)'],['bultos','Bultos']].map(([key,label])=><label key={key}>{label}<input value={draft[key] ?? ''} inputMode={key==='mercancia' ? 'text' : 'decimal'} onChange={e=>change(key,e.target.value)}/></label>)}
          <label>Tarifa de la agencia<select aria-label="Tarifa de la agencia" value={draft.tipo_precio_colaborador} onChange={e=>setDraft(d=>({...d,tipo_precio_colaborador:e.target.value,precio_colaborador:'',precio_colaborador_unitario:'',minimo_colaborador_unidades:''}))}><option value="viaje">Por viaje</option><option value="tonelada">Por tonelada cargada</option></select></label>
          {draft.tipo_precio_colaborador==='tonelada' ? <><label>EUR / tonelada<input inputMode="decimal" value={draft.precio_colaborador_unitario ?? ''} onChange={e=>change('precio_colaborador_unitario',e.target.value)}/></label><label>Mínimo de toneladas<input inputMode="decimal" value={draft.minimo_colaborador_unidades ?? ''} onChange={e=>change('minimo_colaborador_unidades',e.target.value)}/></label></> : <label>Precio del transporte (EUR)<input inputMode="decimal" value={draft.precio_colaborador ?? ''} onChange={e=>change('precio_colaborador',e.target.value)}/></label>}</div>
          <section className="planner-stops"><h3>Ruta y puntos de carga / entrega</h3><RutaMapa points={[...draft.puntos_carga.map(p=>({...p,tipo:'origen'})),...draft.puntos_descarga.map(p=>({...p,tipo:'destino'}))].filter(p=>p.ciudad||p.direccion||p.google_maps_url)}/></section>
          <section className="planner-stops"><h3>Distribución orientativa del camión</h3><RemolqueGrupaje pedidos={[{...draft,id:draft.id||'nueva',numero:draft.numero||'Nueva carga',palets_cantidad:draft.palets_cantidad||draft.bultos||0,palets_tipo:'europeo'}]}/><p>Selecciona los artículos y reparte la mercancía entre los destinos en el siguiente paso.</p></section>
          <label>Observaciones<textarea value={draft.notas || ''} onChange={e=>change('notas',e.target.value)}/></label>
        </fieldset>
      </div><footer><button type="button" onClick={close} disabled={busy}>Cerrar</button>{canEdit&&!draft.id&&puedeEditar('palets')&&<button type="submit" value="prepare" disabled={busy}>Guardar y preparar mercancía</button>}{canEdit && <button className="primary" type="submit" disabled={busy}>{busy ? 'Guardando...' : 'Guardar carga'}</button>}</footer>
    </form></div>}
    {preparing&&<PlannerWarehouse embedded focusOrder={preparing} onClosePreparation={()=>setPreparing('')} />}
  </section>;
}

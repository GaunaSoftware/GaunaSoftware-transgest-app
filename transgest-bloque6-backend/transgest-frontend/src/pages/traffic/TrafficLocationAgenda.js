import {useCallback,useEffect,useMemo,useState} from 'react';
import {editarPedido,getEmpresaConfig,getPedidosResumenLista,getPlanDiario} from '../../services/api';
import {useAuth} from '../../context/AuthContext';
import {setRuntimeFocus} from '../../services/runtimeFocus';
import {assignPendingOrders,pendingOrdersForWeek} from './dailyPlanAssignment';
import {projectedLocation,locationAgendaRows} from './trafficLocationProjection';
import './trafficLocationAgenda.css';

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const add=(date,days)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const firstDay=()=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d);};
const phases={salida:'Salida / carga',ruta:'En ruta prevista',destino:'Destino previsto',descarga:'Descarga prevista'};

export default function TrafficLocationAgenda(){
 const {puedeEditar}=useAuth();const canEdit=puedeEditar('plan_diario');
 const [week,setWeek]=useState(firstDay),[orders,setOrders]=useState([]),[fleet,setFleet]=useState([]),[settings,setSettings]=useState({});
 const [selected,setSelected]=useState([]),[sidebarOpen,setSidebarOpen]=useState(true),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[partial,setPartial]=useState(false),[revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(x=>x+1),[]);
 useEffect(()=>{window.addEventListener('tms:pedidos-changed',reload);return()=>window.removeEventListener('tms:pedidos-changed',reload);},[reload]);
 useEffect(()=>{let active=true;setLoading(true);setError('');setPartial(false);
  (async()=>{const [cfg,plan]=await Promise.all([getEmpresaConfig(),getPlanDiario({fecha:week})]);const found=[];let page=1,more=true;
   while(more&&page<=12){const result=await getPedidosResumenLista({desde:add(week,-14),hasta:add(week,6),limit:500,page},{silentError:true});found.push(...(result.data||[]));more=result.pagination?.hasNext===true;page++;}
   if(active){setSettings(cfg?.cfg_trafico||{});setOrders(found);setFleet(plan?.rows||[]);setPartial(more);setSelected([]);}
  })().catch(e=>{if(active)setError(e.message||'No se pudo cargar el plan diario.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[week,revision]);
 const days=useMemo(()=>Array.from({length:7},(_,i)=>add(week,i)),[week]);
 const pending=useMemo(()=>pendingOrdersForWeek(orders,days),[orders,days]);
 const rows=useMemo(()=>{const by=new Map(locationAgendaRows(orders,days,settings).map(row=>[row.id,row]));
  for(const vehicle of fleet){const key=`propio:${vehicle.id}`;by.set(key,{...(by.get(key)||{id:key,orders:[]}),label:vehicle.matricula,vehicle,disabled:['taller','inactivo'].includes(String(vehicle.estado||'').toLowerCase())});}
  return [...by.values()].sort((a,b)=>a.label.localeCompare(b.label,'es'));
 },[orders,days,settings,fleet]);
 function open(order){setRuntimeFocus('tms_pedidos_focus',{source:'agenda_trafico',pedido_id:order.id});window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'}));}
 const toggleSelected=id=>setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
 async function assign(row,ids=selected){if(!canEdit||!row.vehicle||row.disabled||saving||!ids.length)return;
  setSaving(true);setError('');setNotice('');const result=await assignPendingOrders({ids,pending,vehicle:row.vehicle,save:editarPedido});setSaving(false);
  if(result.ok.length){setNotice(`${result.ok.length} viaje(s) asignado(s) a ${row.label}.`);reload();}
  if(result.failed.length)setError(`${result.failed.length} viaje(s) no se asignaron: ${result.failed.map(item=>`${item.numero}: ${item.error}`).join('; ')}`);
 }
 function startDrag(event,order){const ids=selected.includes(order.id)?selected:[order.id];event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/transgest-pedidos',JSON.stringify(ids));event.dataTransfer.setData('text/plain',ids.join(','));}
 function onDrop(event,row){event.preventDefault();let ids;try{ids=JSON.parse(event.dataTransfer.getData('application/transgest-pedidos'));}catch{return;}if(Array.isArray(ids))assign(row,ids);}
 return <section className="traffic-location-agenda" aria-label="Plan diario y ubicación prevista de vehículos">
  <header><div><h2>Plan diario</h2><p>Ubicación y llegada orientativas según viajes y kilómetros. La posición real puede variar.</p></div><div className="traffic-location-controls">
   <button type="button" onClick={()=>setWeek(add(week,-7))}>← Semana anterior</button><input type="date" aria-label="Semana a consultar" value={week} onChange={e=>e.target.value&&setWeek(e.target.value)}/>
   <button type="button" onClick={()=>setWeek(add(week,7))}>Semana siguiente →</button><button type="button" onClick={reload}>Actualizar</button>
   <button type="button" aria-expanded={sidebarOpen} aria-controls="plan-pendientes" onClick={()=>setSidebarOpen(value=>!value)}>{sidebarOpen?'Ocultar pendientes':`Mostrar pendientes (${pending.length})`}</button>
  </div></header>
  <div className="traffic-location-legend"><span className="outbound">Salida</span><span className="return">Retorno</span><span className="transit">En ruta estimada</span><span className="destination">Destino / descarga previstos</span></div>
  {loading&&<p role="status">Cargando planificación…</p>}{error&&<p role="alert">{error} <button type="button" onClick={reload}>Reintentar</button></p>}{notice&&<p role="status">{notice}</p>}{partial&&<p role="note">Hay más de 6.000 viajes en este intervalo; el plan podría estar incompleto.</p>}
  {!loading&&<div className={`traffic-location-layout ${sidebarOpen?'sidebar-visible':''}`}><div className="traffic-location-scroll"><table><thead><tr><th scope="col">Vehículo</th>{days.map(date=><th scope="col" key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('es-ES',{weekday:'short',day:'2-digit',month:'short'})}</th>)}</tr></thead><tbody>
   {rows.length?rows.map(row=><tr key={row.id} onDragOver={e=>{if(canEdit&&row.vehicle&&!row.disabled)e.preventDefault();}} onDrop={e=>onDrop(e,row)}><th scope="row"><div className="traffic-location-vehicle"><strong>{row.label}</strong>{row.vehicle?.chofer_nombre&&<small>{row.vehicle.chofer_nombre}</small>}{canEdit&&row.vehicle&&<button type="button" disabled={saving||row.disabled} title={row.disabled?'Vehículo no disponible':selected.length?'Asignar viajes seleccionados':'Selecciona viajes en la barra lateral'} onClick={()=>selected.length?assign(row):setSidebarOpen(true)}>← Añadir viaje{selected.length>1?`s (${selected.length})`:''}</button>}</div></th>
    {days.map(date=>{const trips=row.orders.map(order=>({order,projection:projectedLocation(order,date,settings)})).filter(item=>item.projection);return <td key={date}>{trips.length?trips.map(({order,projection})=><button key={order.id} type="button" className={`traffic-location-trip ${projection.direction} ${projection.phase}`} onClick={()=>open(order)} title="Abrir pedido y ajustar su planificación"><strong>{order.numero||'Pedido'} · {phases[projection.phase]}</strong><span>{projection.origin} → {projection.destination}</span><small>{projection.estimate&&projection.arrival?`Llegada calculada: ${projection.arrival.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Hora no calculable: faltan kilómetros'}{projection.plannedDay?` · Descarga programada: ${projection.plannedDay}`:''}</small></button>):<span className="traffic-location-empty">Sin viaje planificado</span>}</td>;})}</tr>):<tr><td colSpan={8}>No hay vehículos en esta semana.</td></tr>}
   </tbody></table></div>
   {sidebarOpen&&<aside id="plan-pendientes" className="traffic-location-sidebar" aria-label="Pedidos pendientes de asignar"><div className="traffic-location-sidebar-head"><strong>Pendientes de asignar ({pending.length})</strong><button type="button" onClick={()=>setSidebarOpen(false)} aria-label="Ocultar pendientes">×</button></div><p>Marca varios viajes y arrástralos a un vehículo, o usa «← Añadir viajes».</p>
    {canEdit&&pending.length>0&&<label className="traffic-location-select-all"><input type="checkbox" checked={selected.length===pending.length} onChange={e=>setSelected(e.target.checked?pending.map(order=>order.id):[])}/> Seleccionar todos</label>}
    <div className="traffic-location-pending-list">{pending.length?pending.map(order=><div key={order.id} className="traffic-location-pending" draggable={canEdit&&!saving} onDragStart={e=>startDrag(e,order)}>{canEdit&&<input type="checkbox" aria-label={`Seleccionar ${order.numero||'pedido'}`} checked={selected.includes(order.id)} onChange={()=>toggleSelected(order.id)}/>}<button type="button" onClick={()=>open(order)}><strong>{order.numero||'Pedido'}</strong><span>{order.origen||'Origen pendiente'} → {order.destino||'Destino pendiente'}</span><small>{String(order.fecha_carga||'').slice(0,10)} · {order.cliente_nombre||'Cliente'}</small></button></div>):<p>No hay viajes pendientes en esta semana.</p>}</div>
   </aside>}
  </div>}
 </section>;
}

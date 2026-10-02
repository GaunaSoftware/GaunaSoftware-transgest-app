import {useCallback,useEffect,useMemo,useState} from 'react';
import {editarPedido,getEmpresaConfig,getPedidosResumenLista,getPlanDiario} from '../../services/api';
import {useAuth} from '../../context/AuthContext';
import {setRuntimeFocus} from '../../services/runtimeFocus';
import {assignPendingOrders,groupPendingOrders,pendingOrdersForWeek} from './dailyPlanAssignment';
import {projectedLocation,locationAgendaRows,sortTrafficLocationRows} from './trafficLocationProjection';
import './trafficLocationAgenda.css';
import './trafficLocationAgendaV2.css';

const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const add=(date,days)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const firstDay=()=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d);};
const phases={salida:'Salida / carga',ruta:'En ruta prevista',destino:'Destino previsto',descarga:'Descarga prevista'};
const dateLabel=date=>/^\d{4}-\d{2}-\d{2}$/.test(date)
 ?new Date(`${date}T12:00:00`).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})
 :'Sin fecha de carga';
const initialSidebarOpen=()=>{try{return localStorage.getItem('tg_traffic_pending_collapsed')!=='1';}catch{return true;}};

export default function TrafficLocationAgenda({onNewOrder}){
 const {puedeEditar}=useAuth();const canEdit=puedeEditar('plan_diario');
 const [week,setWeek]=useState(firstDay),[orders,setOrders]=useState([]),[fleet,setFleet]=useState([]),[settings,setSettings]=useState({});
 const [selected,setSelected]=useState([]),[sidebarOpen,setSidebarOpen]=useState(initialSidebarOpen),[collapsedRows,setCollapsedRows]=useState(()=>new Set()),[collapsedPendingDays,setCollapsedPendingDays]=useState(()=>new Set()),[pendingSearch,setPendingSearch]=useState(''),[targetVehicleId,setTargetVehicleId]=useState(''),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false);
 const [mobileDayIndex,setMobileDayIndex]=useState(0);
 const [error,setError]=useState(''),[notice,setNotice]=useState(''),[partial,setPartial]=useState(false),[revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(x=>x+1),[]);
 useEffect(()=>{window.addEventListener('tms:pedidos-changed',reload);return()=>window.removeEventListener('tms:pedidos-changed',reload);},[reload]);
 useEffect(()=>{let active=true;setLoading(true);setError('');setPartial(false);
  (async()=>{const [cfg,plan]=await Promise.all([getEmpresaConfig(),getPlanDiario({fecha:week})]);const found=[];let page=1,more=true;
   while(more&&page<=12){const result=await getPedidosResumenLista({desde:add(week,-14),hasta:add(week,6),limit:500,page},{silentError:true});found.push(...(result.data||[]));more=result.pagination?.hasNext===true;page++;}
   if(active){setSettings(cfg?.cfg_trafico||{});setOrders(found);setFleet(plan?.rows||[]);setPartial(more);setSelected([]);}
  })().catch(e=>{if(active)setError(e.message||'No se pudo cargar la ubicación prevista.');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[week,revision]);
 const days=useMemo(()=>Array.from({length:7},(_,i)=>add(week,i)),[week]);
 const pending=useMemo(()=>pendingOrdersForWeek(orders,days),[orders,days]);
 const pendingGroups=useMemo(()=>groupPendingOrders(pending,pendingSearch),[pending,pendingSearch]);
 const visiblePending=pendingGroups.flatMap(group=>group.orders);
 const rows=useMemo(()=>{const by=new Map(locationAgendaRows(orders,days,settings).map(row=>[row.id,row]));
  for(const vehicle of fleet){const key=`propio:${vehicle.id}`;by.set(key,{...(by.get(key)||{id:key,orders:[]}),label:vehicle.matricula,vehicle,disabled:['taller','inactivo'].includes(String(vehicle.estado||'').toLowerCase())});}
  return sortTrafficLocationRows([...by.values()]);
 },[orders,days,settings,fleet]);
 const availableVehicles=rows.filter(row=>row.vehicle&&!row.disabled);
 const plannedIds=new Set(rows.flatMap(row=>row.orders.map(order=>order.id)));
 const activeOwnVehicles=rows.filter(row=>row.vehicle&&row.orders.length>0).length;
 const expectedUnloads=new Set(rows.flatMap(row=>row.orders.filter(order=>days.some(date=>projectedLocation(order,date,settings)?.phase==='descarga')).map(order=>order.id))).size;
 function toggleSidebar(){setSidebarOpen(value=>{try{localStorage.setItem('tg_traffic_pending_collapsed',value?'1':'0');}catch{}return !value;});}
 function toggleRow(id){setCollapsedRows(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
 function togglePendingDay(date){setCollapsedPendingDays(current=>{const next=new Set(current);if(next.has(date))next.delete(date);else next.add(date);return next;});}
 function open(order){setRuntimeFocus('tms_pedidos_focus',{source:'agenda_trafico',pedido_id:order.id});window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'}));}
 const toggleSelected=id=>setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
 async function assign(row,ids=selected){if(!canEdit||!row.vehicle||row.disabled||saving||!ids.length)return;
  setSaving(true);setError('');setNotice('');const result=await assignPendingOrders({ids,pending,vehicle:row.vehicle,save:editarPedido});setSaving(false);
  if(result.ok.length){setNotice(`${result.ok.length} viaje(s) asignado(s) a ${row.label}.`);reload();}
  if(result.failed.length)setError(`${result.failed.length} viaje(s) no se asignaron: ${result.failed.map(item=>`${item.numero}: ${item.error}`).join('; ')}`);
 }
 function startDrag(event,order){const ids=selected.includes(order.id)?selected:[order.id];event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/transgest-pedidos',JSON.stringify(ids));event.dataTransfer.setData('text/plain',ids.join(','));}
 function onDrop(event,row){event.preventDefault();let ids;try{ids=JSON.parse(event.dataTransfer.getData('application/transgest-pedidos'));}catch{return;}if(Array.isArray(ids))assign(row,ids);}
 return <section className="traffic-location-agenda" aria-label="Mesa de tráfico">
  <header><div><h2>Mesa de tráfico</h2><p>Cargas, descargas y llegadas orientativas según los viajes y kilómetros. La posición real puede variar.</p></div><div className="traffic-location-controls">
   <button type="button" onClick={()=>setWeek(add(week,-7))}>← Semana anterior</button><input type="date" aria-label="Semana a consultar" value={week} onChange={e=>e.target.value&&setWeek(e.target.value)}/>
   <button type="button" onClick={()=>setWeek(add(week,7))}>Semana siguiente →</button><button type="button" className="traffic-location-refresh" onClick={reload}>Actualizar</button>{onNewOrder&&<button type="button" onClick={onNewOrder}>+ Nuevo pedido</button>}
  </div></header>
  <div className="traffic-location-legend"><span className="outbound">Salida</span><span className="return">Retorno</span><span className="transit">En ruta estimada</span><span className="destination">Destino / descarga previstos</span></div>
  <div className="traffic-location-mobile-day"><button type="button" aria-label="Día anterior" disabled={mobileDayIndex===0} onClick={()=>setMobileDayIndex(day=>day-1)}>←</button><strong>{dateLabel(days[mobileDayIndex])}</strong><button type="button" aria-label="Día siguiente" disabled={mobileDayIndex===6} onClick={()=>setMobileDayIndex(day=>day+1)}>→</button></div>
  {loading&&<p role="status">Cargando planificación…</p>}{error&&<p role="alert">{error} <button type="button" onClick={reload}>Reintentar</button></p>}{notice&&<p role="status">{notice}</p>}{partial&&<p role="note">Hay más de 6.000 viajes en este intervalo; el plan podría estar incompleto.</p>}
  {!loading&&<div className={`traffic-location-layout ${sidebarOpen?'sidebar-visible':''}`}>
   <div className="traffic-location-scroll"><table><thead><tr><th scope="col">Vehículo / Conductor</th>{days.map((date,index)=><th scope="col" key={date} className={index===mobileDayIndex?'traffic-mobile-selected':''}><span>{new Date(`${date}T12:00:00`).toLocaleDateString('es-ES',{weekday:'short'})}</span><small>{new Date(`${date}T12:00:00`).toLocaleDateString('es-ES',{day:'2-digit',month:'short'})}</small></th>)}</tr></thead><tbody>
    {rows.length?rows.flatMap((row,index)=>{
     const supplier=String(row.id).startsWith('colaborador:');
     const groupStart=index===0||supplier!==String(rows[index-1].id).startsWith('colaborador:');
     const collapsed=collapsedRows.has(row.id);
     return [
      ...(groupStart?[<tr className="traffic-location-group" key={`group-${row.id}`}><th colSpan={8}>{supplier?'Colaboradores':'Flota propia'}</th></tr>]:[]),
      <tr key={row.id} className={collapsed?'traffic-location-row-collapsed':''} onDragOver={e=>{if(canEdit&&row.vehicle&&!row.disabled)e.preventDefault();}} onDrop={e=>onDrop(e,row)}>
       <th scope="row" onDoubleClick={()=>toggleRow(row.id)} title="Doble clic para plegar o desplegar esta matrícula">
        <div className="traffic-location-vehicle"><button type="button" className="traffic-location-row-toggle" aria-label={`${collapsed?'Desplegar':'Plegar'} ${row.label}`} aria-expanded={!collapsed} onClick={()=>toggleRow(row.id)} onDoubleClick={e=>e.stopPropagation()}><span aria-hidden="true">{collapsed?'›':'⌄'}</span></button><strong>{row.label}</strong>{row.vehicle?.chofer_nombre&&<small>{row.vehicle.chofer_nombre}</small>}</div>
       </th>
       {collapsed?<td colSpan={7} className="traffic-location-collapsed-summary">{row.orders.length} {row.orders.length===1?'viaje':'viajes'} en la semana visible{row.vehicle?' · arrastra aquí una carga para asignarla':''}</td>:days.map((date,dayIndex)=>{
        const trips=row.orders.map(order=>({order,projection:projectedLocation(order,date,settings)})).filter(item=>item.projection);
        return <td key={date} className={dayIndex===mobileDayIndex?'traffic-mobile-selected':''}>{trips.length?trips.map(({order,projection})=><button key={order.id} type="button" className={`traffic-location-trip ${projection.direction} ${projection.phase}`} onClick={()=>open(order)} title="Abrir pedido y ajustar su planificación"><strong>{order.numero||'Pedido'} · {phases[projection.phase]}</strong><span>{projection.origin} → {projection.destination}</span><small>{projection.estimate&&projection.arrival?`Llegada calculada: ${projection.arrival.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Hora no calculable: faltan kilómetros'}{projection.plannedDay?` · Descarga programada: ${projection.plannedDay}`:''}</small></button>):<span className="traffic-location-empty">Sin viaje planificado</span>}</td>;
       })}
      </tr>,
     ];
    }):<tr><td colSpan={8}>No hay vehículos en esta semana.</td></tr>}
   </tbody></table></div>
   <div className="traffic-location-panel-divider"><button type="button" className="traffic-location-panel-toggle" aria-label={sidebarOpen?'Plegar cargas pendientes':'Mostrar cargas pendientes'} title={sidebarOpen?'Plegar cargas pendientes':'Mostrar cargas pendientes'} aria-controls="plan-pendientes" aria-expanded={sidebarOpen} onClick={toggleSidebar}><span aria-hidden="true">{sidebarOpen?'›':'‹'}</span><span className="traffic-location-panel-toggle-label">{sidebarOpen?'Plegar pendientes':`Mostrar pendientes (${pending.length})`}</span></button></div>
   <aside id="plan-pendientes" hidden={!sidebarOpen} className="traffic-location-sidebar" aria-label="Pedidos pendientes de asignar">
    <div className="traffic-location-sidebar-head"><strong>Cargas pendientes ({pending.length})</strong><small>Semana {dateLabel(days[0])}</small></div>
    <div className="traffic-location-sidebar-tools"><label htmlFor="traffic-pending-search">Buscar carga</label><input id="traffic-pending-search" type="search" value={pendingSearch} onChange={e=>{setPendingSearch(e.target.value);setSelected([]);}} placeholder="Pedido, cliente o destino"/>
     {canEdit&&visiblePending.length>0&&<label className="traffic-location-select-all"><input type="checkbox" checked={visiblePending.every(order=>selected.includes(order.id))} onChange={e=>setSelected(e.target.checked?visiblePending.map(order=>order.id):[])}/> Seleccionar visibles ({visiblePending.length})</label>}
     {canEdit&&selected.length>0&&<div className="traffic-location-assign"><label htmlFor="traffic-vehicle-target">Asignar {selected.length} {selected.length===1?'viaje':'viajes'} a</label><select id="traffic-vehicle-target" value={targetVehicleId} onChange={e=>setTargetVehicleId(e.target.value)}><option value="">Seleccionar matrícula</option>{availableVehicles.map(row=><option key={row.id} value={row.id}>{row.label}</option>)}</select><button type="button" disabled={saving||!targetVehicleId} onClick={()=>{const row=availableVehicles.find(item=>item.id===targetVehicleId);if(row)assign(row);}}>Asignar seleccionados</button></div>}
    </div>
    <div className="traffic-location-pending-list">{pendingGroups.length?pendingGroups.map(group=>{const folded=collapsedPendingDays.has(group.date);return <section className="traffic-location-pending-day" key={group.date} aria-label={`Cargas del ${dateLabel(group.date)}`}><h3 role="button" tabIndex={0} aria-expanded={!folded} aria-label={`${folded?'Desplegar':'Plegar'} cargas del ${dateLabel(group.date)}`} title="Doble clic para plegar o desplegar este día" onDoubleClick={()=>togglePendingDay(group.date)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();togglePendingDay(group.date);}}}><span><span aria-hidden="true">{folded?'›':'⌄'}</span> {dateLabel(group.date)}</span><span>{group.orders.length}</span></h3>{!folded&&group.orders.map(order=><div key={order.id} className="traffic-location-pending" draggable={canEdit&&!saving} onDragStart={e=>startDrag(e,order)}>{canEdit&&<input type="checkbox" aria-label={`Seleccionar ${order.numero||'pedido'}`} checked={selected.includes(order.id)} onChange={()=>toggleSelected(order.id)}/>}<button type="button" onClick={()=>open(order)}><strong>{order.numero||'Pedido'} {order.hora_carga&&<time>{String(order.hora_carga).slice(0,5)}</time>}</strong><span title={`${order.origen||'Origen pendiente'} → ${order.destino||'Destino pendiente'}`}>{order.origen||'Origen pendiente'} → {order.destino||'Destino pendiente'}</span><small>{order.cliente_nombre||'Cliente'}</small></button></div>)}</section>}):<p>{pending.length?'No hay cargas con esa búsqueda.':'No hay cargas pendientes en esta semana.'}</p>}</div>
   </aside>
  </div>}
  {!loading&&<div className="traffic-location-summary" aria-label="Resumen de la semana"><div><strong>{activeOwnVehicles}</strong><span>Vehículos en uso</span></div><div><strong>{plannedIds.size}</strong><span>Viajes planificados</span></div><div><strong>{pending.length}</strong><span>Cargas pendientes</span></div><div><strong>{expectedUnloads}</strong><span>Descargas previstas</span></div></div>}
 </section>;
}

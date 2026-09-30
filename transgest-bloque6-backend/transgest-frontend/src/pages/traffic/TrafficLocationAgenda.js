import {useCallback,useEffect,useMemo,useState} from 'react';
import {getPedidosResumenLista,getEmpresaConfig} from '../../services/api';
import {setRuntimeFocus} from '../../services/runtimeFocus';
import {projectedLocation,locationAgendaRows} from './trafficLocationProjection';
import './trafficLocationAgenda.css';

const iso=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const add=(date,days)=>{const d=new Date(`${date}T12:00:00`);d.setDate(d.getDate()+days);return iso(d);};
const firstDay=()=>{const d=new Date();d.setDate(d.getDate()-((d.getDay()+6)%7));return iso(d);};
const phases={salida:'Salida / carga',ruta:'En ruta prevista',destino:'Destino previsto',descarga:'Descarga prevista'};

export default function TrafficLocationAgenda(){
 const [week,setWeek]=useState(firstDay),[orders,setOrders]=useState([]),[settings,setSettings]=useState({}),[loading,setLoading]=useState(false),[error,setError]=useState(''),[partial,setPartial]=useState(false),[revision,setRevision]=useState(0);
 const reload=useCallback(()=>setRevision(x=>x+1),[]);
 useEffect(()=>{window.addEventListener('tms:pedidos-changed',reload);return()=>window.removeEventListener('tms:pedidos-changed',reload);},[reload]);
 useEffect(()=>{let active=true;setLoading(true);setError('');setPartial(false);
  (async()=>{const cfg=await getEmpresaConfig();const rows=[];let page=1,more=true;
   while(more&&page<=12){const result=await getPedidosResumenLista({desde:add(week,-14),hasta:add(week,6),limit:500,page},{silentError:true});rows.push(...(result.data||[]));more=result.pagination?.hasNext===true;page++;}
   if(active){setSettings(cfg?.cfg_trafico||{});setOrders(rows);setPartial(more);}
  })().catch(e=>{if(active)setError(e.message||'No se pudo cargar la planificación');}).finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[week,revision]);
 const days=useMemo(()=>Array.from({length:7},(_,i)=>add(week,i)),[week]);
 const rows=useMemo(()=>locationAgendaRows(orders,days,settings),[orders,days,settings]);
 function open(order){setRuntimeFocus('tms_pedidos_focus',{source:'agenda_trafico',pedido_id:order.id});window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'}));}
 return <section className="traffic-location-agenda" aria-label="Agenda de ubicación prevista de vehículos">
  <header><div><h2>Ubicación prevista de la flota</h2><p>Proyección orientativa según cargas, descargas y kilómetros del viaje. No representa posición GPS ni garantiza la hora de entrega.</p></div><div className="traffic-location-controls"><button onClick={()=>setWeek(add(week,-7))}>← Semana anterior</button><input type="date" aria-label="Semana a consultar" value={week} onChange={e=>e.target.value&&setWeek(e.target.value)}/><button onClick={()=>setWeek(add(week,7))}>Semana siguiente →</button><button onClick={reload}>Actualizar</button></div></header>
  <div className="traffic-location-legend"><span className="outbound">Salida</span><span className="return">Retorno</span><span className="transit">En ruta estimada</span><span className="destination">Destino / descarga previstos</span></div>
  {loading&&<p role="status">Cargando planificación…</p>}{error&&<p role="alert">{error} <button onClick={reload}>Reintentar</button></p>}{partial&&<p role="note">Hay más de 6.000 viajes en este intervalo. Acota la semana para consultar toda la planificación.</p>}
  {!loading&&!error&&<div className="traffic-location-scroll"><table><thead><tr><th scope="col">Vehículo</th>{days.map(date=><th scope="col" key={date}>{new Date(`${date}T12:00:00`).toLocaleDateString('es-ES',{weekday:'short',day:'2-digit',month:'short'})}</th>)}</tr></thead><tbody>{rows.length?rows.map(vehicle=><tr key={vehicle.id}><th scope="row">{vehicle.label}</th>{days.map(date=>{const trips=vehicle.orders.map(order=>({order,projection:projectedLocation(order,date,settings)})).filter(item=>item.projection);return <td key={date}>{trips.length?trips.map(({order,projection})=><button key={order.id} className={`traffic-location-trip ${projection.direction} ${projection.phase}`} onClick={()=>open(order)} title="Abrir pedido y ajustar su planificación"><strong>{order.numero||'Pedido'} · {phases[projection.phase]}</strong><span>{projection.origin} → {projection.destination}</span><small>{projection.estimate&&projection.arrival?`Llegada calculada: ${projection.arrival.toLocaleString('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`:'Hora no calculable: faltan kilómetros'}{projection.plannedDay?` · Descarga programada: ${projection.plannedDay}`:''}</small></button>):<span className="traffic-location-empty">Sin viaje planificado</span>}</td>;})}</tr>):<tr><td colSpan={8}>No hay viajes con vehículo asignado en esta semana.</td></tr>}</tbody></table></div>}
 </section>;
}

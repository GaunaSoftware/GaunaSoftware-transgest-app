import JourneyCosts from './JourneyCosts';
import RouteConstraintsPanel from './RouteConstraintsPanel';
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import RemolqueGrupaje from '../../components/RemolqueGrupaje';
import RouteMapCanvas from '../../components/RouteMapCanvas';
import {driverStops} from '../driver/driverStops';
import {displayLocation} from '../../utils/orderTown';
import {routeGeometry} from '../../utils/routeGeometry';
import {getGroupagePlan,saveGroupagePlan,optimizarRuta} from '../../services/api';
import {notify} from '../../services/notify';

export function groupageStops(orders){return orders.flatMap(order=>driverStops(order).map(stop=>{const side=stop.tipo==='carga'?'origen':'destino';return {...stop,key:`${order.id}:${stop.id}`,pedido:order,ciudad:displayLocation(stop,order[side]),lat:stop.lat??stop.latitud??stop.latitude??(stop.index===0?order[`${side}_lat`]:null),lng:stop.lng??stop.lon??stop.longitud??stop.longitude??(stop.index===0?order[`${side}_lng`]:null)};}));}
export function validGroupageSequence(stops){const loaded=new Set();for(const stop of stops){if(stop.tipo==='carga')loaded.add(stop.pedido.id);else if(!loaded.has(stop.pedido.id))return false;}return true;}
export function nearestGroupageSequence(stops){
 if(stops.some(s=>s.lat==null||(s.lng??s.lon)==null||!Number.isFinite(Number(s.lat))||!Number.isFinite(Number(s.lng??s.lon))))return null;
 const pending=[...stops],result=[],loaded=new Set();
 while(pending.length){const eligible=pending.filter(s=>s.tipo==='carga'||loaded.has(s.pedido.id));const last=result.at(-1);
  const distance=s=>{const lat=Number(s.lat),lng=Number(s.lng??s.lon);return !last?0:(lat-Number(last.lat))**2+((lng-Number(last.lng??last.lon))*Math.cos(lat*Math.PI/180))**2;};
  eligible.sort((a,b)=>distance(a)-distance(b));const next=eligible[0];if(!next)return null;result.push(next);pending.splice(pending.indexOf(next),1);if(next.tipo==='carga')loaded.add(next.pedido.id);
 }return result.map(s=>s.key);
}
function moveBefore(items,source,target){const from=items.indexOf(source),to=items.indexOf(target);if(from<0||to<0)return items;const next=items.filter(id=>id!==source);next.splice(next.indexOf(target),0,source);return next;}

export default function GroupageRouteEditor({groupId,orders,vehicle,onReload,canEdit=true}){
 const stops=useMemo(()=>groupageStops(orders),[orders]);
 const [sequence,setSequence]=useState([]),[layout,setLayout]=useState([]),[version,setVersion]=useState(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[saving,setSaving]=useState(false),[route,setRoute]=useState(null),[routing,setRouting]=useState(false);
 const routeRequest=useRef(0);
 const [loadFailed,setLoadFailed]=useState(false),[revision,setRevision]=useState(0);
 const cancelRoute=useCallback(()=>{routeRequest.current++;},[]);
 useEffect(()=>{let alive=true;setLoading(true);setError('');setLoadFailed(false);
  getGroupagePlan(groupId).then(data=>{if(!alive)return;const trip=data.origen==='materializado'?data.viajes[0]:null;
   setVersion(trip?.version??null);setSequence(trip?trip.paradas.map(s=>s.legacy_key):[...stops.filter(s=>s.tipo==='carga'),...stops.filter(s=>s.tipo==='descarga')].map(s=>s.key));
   setLayout(trip?.disposicion_carga?.length?trip.disposicion_carga:orders.map(p=>p.id));setRoute(trip?.ruta_calculada||null);
  }).catch(e=>{if(alive){setError(e.message);setLoadFailed(true);}}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;cancelRoute();};
 },[groupId,orders,stops,cancelRoute,revision]);
 const ordered=sequence.map(key=>stops.find(s=>s.key===key)).filter(Boolean);
 const cargo=layout.map(id=>orders.find(p=>p.id===id)).filter(Boolean);
 function changeSequence(next){const list=next.map(key=>stops.find(s=>s.key===key)).filter(Boolean);if(!validGroupageSequence(list)){notify('La descarga debe ir después de su carga.','warning');return;}routeRequest.current++;setRouting(false);setSequence(next);setRoute(null);}
 function shiftStop(index,direction){const next=[...sequence],other=index+direction;if(other<0||other>=next.length)return;[next[index],next[other]]=[next[other],next[index]];changeSequence(next);}
 async function calculate(){const request=++routeRequest.current;setRouting(true);setError('');try{
  const result=await optimizarRuta({stops:ordered.map(s=>({address:[s.direccion,s.ciudad,s.cp,s.pais].filter(Boolean).join(', '),lat:s.lat,lon:s.lng??s.lon})),preference:'camion'});
  if(request===routeRequest.current)setRoute(result);
 }catch(e){if(request===routeRequest.current)setError(e.message);}finally{if(request===routeRequest.current)setRouting(false);}}
 async function save(confirm=false){setSaving(true);setError('');try{
  const result=await saveGroupagePlan(groupId,{version,paradas:sequence,disposicion:layout,ruta:route,confirmar:confirm});setVersion(result.version);notify(confirm?'Viaje operativo confirmado.':'Recorrido y disposición guardados.','success');onReload?.();
 }catch(e){setError(e.message);}finally{setSaving(false);}}
 const editable=canEdit&&!saving&&!loading&&!loadFailed;
 const points=ordered.map((s,i)=>({lat:s.lat==null?NaN:Number(s.lat),lng:(s.lng??s.lon)==null?NaN:Number(s.lng??s.lon),label:s.ciudad,stopNumber:i+1})).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng)&&Math.abs(p.lat)<=90&&Math.abs(p.lng)<=180);
 const routePoints=route?.waypoint_coordinates?.length?route.waypoint_coordinates.map((p,i)=>({lat:Number(p.lat),lng:Number(p.lon),label:p.address,stopNumber:i+1})):points;
 const geometry=routeGeometry(route?.geometry);
 if(loading)return <p role="status">Cargando plan del grupaje…</p>;
 return <section className="groupage-route-editor" aria-label="Plan del grupaje">
  {error&&<p role="alert">{error}</p>}{loadFailed&&<button onClick={()=>setRevision(v=>v+1)}>Volver a cargar el plan</button>}
  <div className="groupage-plan-columns">
   <section><h3>Pedidos del viaje ({orders.length})</h3><p>Se conservan clientes, precios y documentos de cada pedido.</p>
    {orders.map(order=><div className="groupage-order" key={order.id}><strong>{order.numero}</strong><span>{order.cliente_nombre}</span><span>{order.mercancia}</span></div>)}
   </section>
   <section><h3>Disposición de mercancía</h3><RemolqueGrupaje pedidos={cargo} vehiculo={vehicle} onReorder={editable?(source,target)=>setLayout(old=>moveBefore(old,source,target)):null}/>
    <p>La cabeza del remolque está a la izquierda. Mover mercancía aquí conserva la ruta.</p>
    <button className="tgui-button" disabled={!editable} onClick={()=>setLayout([...ordered.filter(s=>s.tipo==='descarga').map(s=>s.pedido.id)].reverse())}>Optimizar disposición según ruta</button>
    <ol>{cargo.map((order,index)=><li key={order.id}>{order.numero} <button aria-label={`Adelantar mercancía ${order.numero}`} disabled={!editable||index===0} onClick={()=>setLayout(old=>moveBefore(old,order.id,old[index-1]))}>←</button><button aria-label={`Retrasar mercancía ${order.numero}`} disabled={!editable||index===cargo.length-1} onClick={()=>setLayout(old=>moveBefore(old,old[index+1],order.id))}>→</button></li>)}</ol>
    <p>La propuesta deja la primera entrega junto al portón; revisa accesibilidad y apilado según la carga real.</p>
   </section>
   <section><h3>Ruta y paradas</h3>{routePoints.length?<RouteMapCanvas points={routePoints} geometry={geometry} compact/>:<p className="groupage-map-missing">Completa las coordenadas de las paradas para verlas en el mapa. Puedes ordenar las paradas igualmente.</p>}
    <button className="tgui-button" disabled={!editable} onClick={()=>{const next=nearestGroupageSequence(ordered);if(next)changeSequence(next);else notify('Completa las coordenadas de las paradas para proponer el orden.','warning');}}>Proponer orden por proximidad</button>
    <p>Propuesta geométrica, pendiente de revisar horarios y restricciones. Calcula después el recorrido por carretera.</p>
    <button className="tgui-button" disabled={!editable||routing} onClick={calculate}>{routing?'Calculando…':'Calcular ruta por carretera'}</button>
    <RouteConstraintsPanel disabled={!editable} vehicle={vehicle} stops={ordered.map(s=>({id:s.key,shipment_id:s.pedido.id,type:s.tipo,name:s.pedido.numero+' · '+s.ciudad,address:[s.direccion,s.ciudad,s.cp,s.pais].filter(Boolean).join(', '),lat:s.lat,lng:s.lng??s.lon,weight_kg:s.pedido.peso_kg,date:s.fecha||s.pedido[s.tipo==='carga'?'fecha_carga':'fecha_descarga'],window:s.ventana||s.pedido[s.tipo==='carga'?'ventana_carga':'ventana_descarga'],window_start:s.hora_desde||s.hora_inicio,window_end:s.hora_hasta||s.hora_fin}))} onApply={proposal=>{changeSequence(proposal.stops.map(s=>s.id));setRoute(proposal);}}/>
    {route?.distance_km>0&&<p>{Number(route.distance_km).toLocaleString('es-ES',{maximumFractionDigits:1})} km · {Number(route.duration_min).toLocaleString('es-ES',{maximumFractionDigits:0})} min · estimación</p>}
    {!route?.truck_aware&&<p>Sin validación de restricciones para camiones. Revisa altura, peso y accesos.</p>}
    {route?.warning&&<p>{route.warning}</p>}
    {route?.constraint_review&&<details><summary>Restricciones de la propuesta guardada · {route.constraint_review.estado}</summary><p>{route.constraint_review.definicion}</p><ul>{route.constraint_review.incidencias.map((x,i)=><li key={i}>{x.text}</li>)}</ul></details>}
    <ol>{ordered.map((stop,index)=><li key={stop.key} draggable={editable} onDragStart={e=>e.dataTransfer.setData('application/transgest-stop',stop.key)} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(editable)changeSequence(moveBefore(sequence,e.dataTransfer.getData('application/transgest-stop'),stop.key));}}>
     <strong>{stop.tipo==='carga'?'Carga':'Descarga'} {stop.ciudad}</strong><span>{stop.pedido.numero}</span>
     <button disabled={!editable||index===0} aria-label={`Subir parada ${index+1}`} onClick={()=>shiftStop(index,-1)}>↑</button><button disabled={!editable||index===ordered.length-1} aria-label={`Bajar parada ${index+1}`} onClick={()=>shiftStop(index,1)}>↓</button>
    </li>)}</ol>
   </section>
  </div>
  {version&&<JourneyCosts groupId={groupId} canEdit={editable}/>}
  <footer><span>{version?`Plan versión ${version}`:'Plan sin guardar'} · cada cambio conserva su historial</span><button className="tgui-button" disabled={!editable} onClick={()=>save(false)}>Guardar plan</button><button className="tgui-button" disabled={!editable} onClick={()=>save(true)}>Confirmar viaje operativo</button></footer>
 </section>;
}

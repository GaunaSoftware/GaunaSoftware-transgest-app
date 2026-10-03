// Display-only summaries. The complete locations and planning remain on the order.
import {displayOrderLocation} from '../../utils/orderTown';
const text=value=>String(value||'').trim();
const points=value=>{try{const rows=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(rows)?rows:[];}catch{return [];}};
const short=value=>{const label=text(value);return label.length>40?`${label.slice(0,37).trimEnd()}…`:label;};
const location=(order,kind)=>{
 const verified=displayOrderLocation(order,kind),first=points(kind==='carga'?order.puntos_carga:order.puntos_descarga)[0]||{};
 // Keep the saved spelling after the shared helper has validated the location.
 return text([first.poblacion,first.ciudad,first.city,first.localidad,first.municipio].find(value=>text(value).toUpperCase()===verified.toUpperCase()))||verified;
};

export function trafficRouteSummary(order){
 const origin=short(location(order,'carga'));
 const destination=short(location(order,'descarga'));
 return {origin,destination,label:`${origin} → ${destination}`,full:`${order.origen||'Origen pendiente'} → ${order.destino||'Destino pendiente'}`};
}

export function trafficTripPresentation(order,projection){
 const route=trafficRouteSummary(order);
 const load=points(order.puntos_carga)[0]||{},unload=points(order.puntos_descarga)[0]||{};
 const label=projection.phase==='salida'?(projection.direction==='retorno'?'Retorno':'Salida'):
  {ruta:'En ruta estimada',destino:'Destino previsto',descarga:'Descarga prevista'}[projection.phase];
 const clock=value=>/^\d{2}:\d{2}/.test(text(value))?text(value).slice(0,5):'';
 const time=projection.phase==='salida'?text(load.ventana)||clock(order.hora_carga||load.hora):
  projection.phase==='descarga'?text(unload.ventana)||clock(order.hora_descarga||unload.hora):'';
 const arrival=projection.estimate&&projection.arrival?projection.arrival.toLocaleString('es-ES',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}):'';
 const compactArrival=projection.estimate&&projection.arrival?`≈ ${projection.arrival.toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})} · ${projection.arrival.toLocaleDateString('es-ES',{day:'2-digit',month:'2-digit'})}`:'';
 return {...route,label,time:short(time)||compactArrival,
  detail:[order.numero,label,route.full,order.cliente_nombre,order.estado,time,arrival&&`Llegada calculada: ${arrival}`,projection.plannedDay&&`Descarga programada: ${projection.plannedDay}`].filter(Boolean).join('\n')};
}

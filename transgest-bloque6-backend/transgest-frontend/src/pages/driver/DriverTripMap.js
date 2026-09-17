import { lazy, Suspense, useMemo } from 'react';
const RutaMapa=lazy(()=>import('../../components/RutaMapa'));
const list=value=>{if(Array.isArray(value))return value;try {const parsed=JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
export function driverRoutePoints(pedido,pasos={}) {
  return [['carga',list(pedido.puntos_carga),pedido.origen],['descarga',list(pedido.puntos_descarga),pedido.destino]].flatMap(([type,items,fallback])=>{
    const stops=items.length?items:[{nombre:fallback,direccion:fallback}];
    return stops.map((p,i)=>{
      const done=['entregado','facturado'].includes(pedido.estado)||['completado','entregado','finalizado'].includes(p.estado)||(type==='carga'?pasos.carga_ok:pasos.descarga_ok);
      const active=!done&&(type==='carga'?(pasos.carga_iniciada||pasos.carga_proceso):pasos.posicionado_descarga);
      return {...p,tipo:type,label:p.nombre||p.direccion||fallback||`Parada ${i+1}`,tone:{color:done?'#059669':active?'#f59e0b':'#3b82f6',label:done?'Completada':active?'En curso':'Pendiente'},title:`${type==='carga'?'Carga':'Descarga'} ${i+1} · ${done?'Completada':active?'En curso':'Pendiente'}`};
    });
  });
}
export default function DriverTripMap({pedido,pasos,chofer}) {
  const points=useMemo(()=>driverRoutePoints(pedido,pasos),[pedido,pasos]);
  const stamp=chofer?.ubicacion_ts?Date.parse(chofer.ubicacion_ts):0;
  const valid=stamp>=Date.now()-300000&&stamp<=Date.now()+60000&&chofer?.gps_lat!=null&&chofer?.gps_lng!=null&&(!pedido.vehiculo_id||pedido.vehiculo_id===chofer.vehiculo_id);
  const external=chofer?.external_gps_at&&Date.parse(chofer.external_gps_at)>=Date.now()-300000;
  const position=valid?{lat:Number(chofer.gps_lat),lng:Number(chofer.gps_lng),label:chofer.vehiculo_matricula||'Tu posición'}:null;
  return <section className="driver-route-map"><h3>Paradas y posición</h3><p className="driver-map-legend"><span>Pendiente</span><span>En curso</span><span>Completada</span></p><Suspense fallback={<p>Cargando mapa…</p>}><RutaMapa points={points} vehiclePosition={position}/></Suspense><p className="driver-sync">{valid?`Posición ${external?'del vehículo':'de la app'} · ${new Date(stamp).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}`:'Sin posición reciente del vehículo. El mapa muestra los puntos del viaje.'}</p></section>;
}

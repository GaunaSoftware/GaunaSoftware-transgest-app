import {driverStops,stopData,stopDone} from "./driverStops";
import { lazy, Suspense, useMemo } from 'react';
const RutaMapa=lazy(()=>import('../../components/RutaMapa'));
export function driverRoutePoints(pedido,pasos={}) {
  const stops=driverStops(pedido);
  return stops.map(stop=>{
    const progress=stopData(stop,pasos,stops);
    const done=['entregado','facturado'].includes(pedido.estado)||['entregado','completado'].includes(stop.estado)||stopDone(stop,progress);
    const legacyActive=!pasos.paradas&&stop.index===0&&(stop.tipo==='carga'?pasos.carga_iniciada:pasos.posicionado_descarga);
    const active=!done&&(legacyActive||(stop.tipo==='carga'?(progress.carga_iniciada||progress.carga_proceso):progress.posicionado_descarga));
    const label=done?'Completada':active?'En curso':'Pendiente';
    return {...stop,tone:{color:done?'#059669':active?'#f59e0b':'#3b82f6',label},title:`${stop.tipo==='carga'?'Carga':'Descarga'} ${stop.index+1} · ${label}`};
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

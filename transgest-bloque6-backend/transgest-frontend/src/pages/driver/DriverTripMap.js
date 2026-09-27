import {driverStops,stopData,stopDone} from "./driverStops";
import { lazy, Suspense, useMemo, useState } from 'react';
import VehicleTrackingPanel from '../../components/VehicleTrackingPanel';
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
export default function DriverTripMap({pedido,pasos,onArrival}) {
  const points=useMemo(()=>driverRoutePoints(pedido,pasos),[pedido,pasos]);
  const [position,setPosition]=useState(null);
  const stops=driverStops(pedido),active=stops.find(s=>!stopDone(s,stopData(s,pasos,stops))),progress=active?stopData(active,pasos,stops):{};
  const confirm=onArrival&&active&&!progress[active.tipo==='carga'?'carga_iniciada':'posicionado_descarga']?stop=>onArrival(stop):null;
  return <section className="driver-route-map"><h3>Paradas y posición</h3><p className="driver-map-legend"><span>Pendiente</span><span>En curso</span><span>Completada</span></p><Suspense fallback={<p>Cargando mapa…</p>}><RutaMapa points={points} vehiclePosition={position}/></Suspense><VehicleTrackingPanel pedidoId={pedido.id} onPosition={setPosition} onArrival={confirm}/></section>;
}

import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {getPedidoTelemetry,requestPedidoTelemetry} from '../services/api';
import {Button} from '../ui';
import './TripTelemetryPanel.css';
const RouteMapCanvas=lazy(()=>import('./RouteMapCanvas'));
const format=v=>v==null?'No disponible':Number(v).toLocaleString('es-ES',{maximumFractionDigits:2});
const quality={measured:'medido',estimated:'estimado',partial:'parcial'};
export default function TripTelemetryPanel({pedidoId}) {
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const generation=useRef(0);
 useEffect(()=>{let disposed=false,timer;generation.current++;setState(null);setError('');setBusy(false);
  async function load(){try{const next=await getPedidoTelemetry(pedidoId);if(!disposed){setState(next);setError('');if(['pending','processing','retry'].includes(next.status))timer=setTimeout(load,15000);}}
   catch(e){if(!disposed)setError(e.message);}}
  if(pedidoId)load();return()=>{disposed=true;clearTimeout(timer);};
 },[pedidoId,revision]);
 if(!pedidoId)return null;
 const report=state?.data,loaded=report?.loaded,empty=report?.empty;
 return <details className="tg-trip-telemetry">
  <summary>Recorrido real y datos GPS del viaje</summary>
  {error&&<p role="alert">{error}</p>}
  {!state&&!error&&<p>Consultando el resumen…</p>}
  {state?.status==='not_requested'&&<p>El resumen se prepara automáticamente al cerrar el viaje. Necesita horas reales de carga y descarga y capturas del vehículo.</p>}
  {['pending','processing','retry'].includes(state?.status)&&<p role="status">{state.status==='retry'?'La recuperación está pendiente de reintento.':'Recuperando recorrido y sensores del GPS…'} Puedes seguir trabajando.</p>}
  {state?.status==='error'&&<p role="alert">{report?.error||'No se pudo recuperar el historial.'}</p>}
  {state?.status==='ready'&&<>
   <p>Resumen guardado: {new Date(report.generated_at).toLocaleString('es-ES')} · Fuente: {report.context?.provider||'Sin datos'}</p>
   <div className="tg-trip-telemetry-metrics">
    <p><strong>Kilómetros del servicio</strong><br/>{format(loaded?.distance?.value)}{loaded?.distance&&` km · ${quality[loaded.distance.quality]} (${loaded.distance.method==='odometer'?'odómetro':'recorrido GPS'})`}</p>
    <p><strong>Kilómetros en vacío anteriores</strong><br/>{format(empty?.distance?.value)}{empty?.distance&&` km · ${quality[empty.distance.quality]}`}{empty?.applied&&<small><br/>Añadidos al pedido.</small>}</p>
    <p><strong>Combustible del servicio</strong><br/>{format(loaded?.fuel?.value)}{loaded?.fuel&&` l · ${quality[loaded.fuel.quality]}`}</p>
    <p><strong>Consumo medio</strong><br/>{format(loaded?.consumption_l_100km)}{loaded?.consumption_l_100km!=null&&' l/100 km'}</p>
   </div>
   {(report.temperatures||[]).map(t=><p key={t.sensor}><strong>Frigo · {t.label}</strong>: {format(t.min_c)} a {format(t.max_c)} °C · {t.samples} lecturas.</p>)}
   {!report.temperatures?.length&&<p>Temperatura del frigo: no hay lecturas de una sonda identificada.</p>}
   {loaded?.route?.segments?.length>0&&<div><Suspense fallback={<p>Cargando mapa…</p>}><RouteMapCanvas segments={loaded.route.segments} compact/></Suspense><small>Capturas reales del vehículo. Los huecos se muestran separados; los kilómetros por GPS son una estimación.</small></div>}
   {(report.warnings||[]).map(w=><p key={w}>{w}</p>)}
   <p>Los kilómetros previstos se conservan. El tramo en vacío solo se añade automáticamente con mediciones suficientes y sin servicios solapados; se respetan los kilómetros introducidos manualmente.</p>
  </>}
  {state?.can_request&&<Button disabled={busy||['pending','processing','retry'].includes(state.status)} onClick={async()=>{const version=generation.current;setBusy(true);setError('');try{await requestPedidoTelemetry(pedidoId);if(version===generation.current)setRevision(v=>v+1);}catch(e){if(version===generation.current)setError(e.message);}finally{if(version===generation.current)setBusy(false);}}}>
   {busy?'Solicitando…':'Recuperar datos del viaje cerrado'}</Button>}
 </details>;
}

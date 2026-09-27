import React,{useEffect,useRef,useState} from 'react';
import {Button} from '../ui';
import {getPedidoTracking,getPortalPedidoTracking,calcularPedidoEta,guardarPedidoTrackingConfig} from '../services/api';

export default function VehicleTrackingPanel({pedidoId,onPosition,onArrival,customer=false}){
 const [state,setState]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[clock,setClock]=useState(Date.now());
 const generation=useRef(0),callbacks=useRef({onPosition});callbacks.current={onPosition};
 useEffect(()=>{const version=++generation.current;let timer,closed=false;setState(null);setError('');setBusy(false);callbacks.current.onPosition?.(null);
  async function poll(){if(closed)return;if(!document.hidden){try{const next=await (customer?getPortalPedidoTracking:getPedidoTracking)(pedidoId);if(!closed&&generation.current===version){setState(prev=>({...next,eta:prev?.last_recorded_at===next.last_recorded_at&&prev?.next_stop?.id===next.next_stop?.id?prev.eta:next.eta}));setError('');}}catch(e){if(!closed){setError(e.message);setState(null);}}}if(!closed)timer=setTimeout(poll,30000);}
  if(pedidoId)poll();const ticker=setInterval(()=>setClock(Date.now()),1000);
  return()=>{closed=true;clearTimeout(timer);clearInterval(ticker);};
 },[pedidoId,customer]);
 const age=state?.last_recorded_at?Math.max(0,(clock-Date.parse(state.last_recorded_at))/1000):null;
 const fresh=state?.status==='reciente'&&age<=state.stale_seconds;
 useEffect(()=>{callbacks.current.onPosition?.(fresh?state.position:null);},[fresh,state]);
 async function action(fn){const version=generation.current;setBusy(true);setError('');try{await fn(version);}catch(e){if(version===generation.current)setError(e.message);}finally{if(version===generation.current)setBusy(false);}}
 if(!pedidoId)return null;
 const stop=state?.next_stop,ageLabel=age===null?'Sin posición registrada':`Última posición hace ${age<60?`${Math.floor(age)} segundos`:`${Math.floor(age/60)} ${Math.floor(age/60)===1?'minuto':'minutos'}`}`;
 return <section aria-label="Seguimiento del vehículo" style={{padding:'10px 0',color:'var(--text)',fontSize:13}}>
  <p aria-live="polite">{error?'No se puede consultar el seguimiento':!state?'Consultando seguimiento…':state.status==='finalizado'?'Seguimiento finalizado':`${ageLabel}${fresh?'':' · Señal no reciente'}`}</p>
  {error&&<p role="alert">{error}</p>}
  {state&&<><p>{state.provider||'Sin proveedor'} · Umbral de señal: {state.stale_seconds} s{state.timestamp_source!=='device'?' · Hora de captura no verificada; ubicación actual oculta':''}</p>
   {fresh&&<p>Velocidad: {state.position?.speed_kmh??'No disponible'} km/h · Rumbo: {state.position?.heading??'No disponible'}° · Precisión: {state.position?.accuracy_m??'No disponible'} m</p>}
   {stop&&<p>Próximo punto: <strong>{stop.label}</strong>{state.distance_straight_m!=null&&fresh?` · ${(state.distance_straight_m/1000).toLocaleString('es-ES',{maximumFractionDigits:1})} km en línea recta`:''}</p>}
   {fresh&&state.eta?.value?<p>ETA estimada: {new Date(state.eta.value).toLocaleString('es-ES')} · {state.eta.distance_road_km?.toLocaleString('es-ES')} km por carretera{state.eta.delay_minutes==null?' · Retraso no calculable sin ventana con fecha y zona horaria':` · Retraso estimado ${Math.ceil(state.eta.delay_minutes)} min`}<br/>{state.eta.definition} {state.eta.warning}</p>:<p>ETA: no calculable. {state.eta?.reason}</p>}
   {state.can_eta!==false&&<Button disabled={busy||!fresh||!stop?.coordinates} onClick={()=>action(async version=>{const next=await calcularPedidoEta(pedidoId);if(version===generation.current)setState({...next,can_configure:state.can_configure});})}>Calcular ETA por carretera</Button>}
   {fresh&&state.arrival&&onArrival&&<div role="status"><p>Llegada detectada cerca de {stop?.label}. Confirma solo si estás en el punto.</p><Button disabled={busy} onClick={()=>action(async()=>{await onArrival(stop);setState(prev=>({...prev,arrival:null}));})}>Confirmar llegada</Button></div>}
   {state.can_configure&&<details><summary>Ajustar seguimiento y radio de esta parada</summary><form key={`${stop?.id}:${state.stale_seconds}:${stop?.radius_m}:${stop?.hysteresis_m}`} onSubmit={e=>{e.preventDefault();const values=new FormData(e.currentTarget);action(async version=>{const cfg={...state.configuration,stale_seconds:Number(values.get('stale'))};if(stop)cfg.stops={...cfg.stops,[stop.id]:{radius_m:Number(values.get('radius')),hysteresis_m:Number(values.get('hysteresis'))}};await guardarPedidoTrackingConfig(pedidoId,cfg);const next=await getPedidoTracking(pedidoId);if(version===generation.current)setState(next);});}} style={{display:'flex',gap:12,flexWrap:'wrap',alignItems:'end'}}>
    <label>Señal reciente (s)<input name="stale" type="number" min="30" max="3600" defaultValue={state.stale_seconds} required/></label>
    {stop&&<><label>Radio (m)<input name="radius" type="number" min="30" max="3000" defaultValue={stop.radius_m} required/></label><label>Histéresis de salida (m)<input name="hysteresis" type="number" min="10" max="1000" defaultValue={stop.hysteresis_m} required/></label></>}
    <Button type="submit" disabled={busy}>Guardar umbrales</Button></form></details>}
  </>}
 </section>;
}

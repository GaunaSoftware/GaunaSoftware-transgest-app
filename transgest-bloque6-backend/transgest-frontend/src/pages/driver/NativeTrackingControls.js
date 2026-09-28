import {useEffect,useState} from 'react';
import {Button} from '../../ui';
import {hasNativeDriverTracking,startNativeDriverTracking,stopNativeDriverTracking,nativeDriverTrackingStatus,nativeDriverDiagnostics} from '../../services/nativeDriverTracking';
import {shareMobileDocument} from '../../services/mobileRuntime';

export default function NativeTrackingControls({jornada,vehicleId,onStatus,visible=true}){
 const [state,setState]=useState({active:false,message:'Seguimiento detenido'}),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const eligible=jornada?.estado==='abierta'&&vehicleId&&!['pausa','descanso','fin'].includes(jornada?.actividad_actual);
 useEffect(()=>{if(!hasNativeDriverTracking())return;let disposed=false;
  const update=()=>nativeDriverTrackingStatus().then(value=>{if(!disposed){setState(value);onStatus?.({active:value.active,text:value.message});}}).catch(()=>{if(!disposed)setError('No se pudo consultar el servicio GPS.');});
  update();const timer=setInterval(update,3000);
  const stop=()=>stopNativeDriverTracking().catch(()=>{});window.addEventListener('tms:session-cleared',stop);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('tms:session-cleared',stop);stop();};
 },[onStatus]);
 useEffect(()=>{if(hasNativeDriverTracking())stopNativeDriverTracking().catch(()=>{});},[jornada?.id,vehicleId,eligible]);
 if(!hasNativeDriverTracking()||!visible)return null;
 async function toggle(){setBusy(true);setError('');try{if(state.active)await stopNativeDriverTracking();else await startNativeDriverTracking();setState(await nativeDriverTrackingStatus());}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <section aria-label="GPS de la jornada" className="driver-card" style={{padding:16,marginBottom:16}}>
  <strong>GPS de jornada</strong><p role="status">{state.message}</p>
  {state.last_sent_at&&<p>Último envío: {new Date(state.last_sent_at).toLocaleTimeString('es-ES')}</p>}
  {error&&<p role="alert">{error}</p>}
  <Button disabled={busy||(!eligible&&!state.active)} onClick={toggle}>{state.active?'Detener seguimiento':'Iniciar seguimiento'}</Button>
  <Button disabled={busy} onClick={async()=>{try{await shareMobileDocument({title:'Diagnóstico Android de TransGest',text:JSON.stringify(await nativeDriverDiagnostics(),null,2)});}catch(e){setError(e.message);}}}>Compartir diagnóstico Android</Button>
 </section>;
}

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import RouteMapCanvas from '../components/RouteMapCanvas';
import {useAuth} from '../context/AuthContext';
import {getFleetLocations,getGpsProviders,refreshFleetGps} from '../services/api';
import './Localizacion.css';
const labels={reciente:'Posición reciente',obsoleta:'Señal antigua',sin_datos:'Sin posición',sin_fecha_verificada:'Fecha no verificada',coordenadas_invalidas:'Coordenadas inválidas'};
const sourceLabels={app_chofer:'App del conductor',movildata:'Movildata',geotab:'Geotab',tacogest:'Tacogest',locatel:'Locatel',gps_generic:'Proveedor GPS'};
const date=value=>value?new Date(value).toLocaleString('es-ES'):'Sin captura';
export default function Localizacion(){
  const {puedeEditar}=useAuth();
  const canSync=puedeEditar('vehiculos');
  const inFlight=useRef(false);
  const [now,setNow]=useState(Date.now());
  const [syncSummary,setSyncSummary]=useState('');
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[q,setQ]=useState('');
  const load=useCallback(async()=>{
    if(inFlight.current)return;
    inFlight.current=true;setLoading(true);setError('');
    let warning='';
    try{
      if(canSync){
        try{
          const config=await getGpsProviders();
          const providers=(config.active_providers||[config.active_provider].filter(Boolean)).filter(p=>['geotab','movildata'].includes(p));
          const results=await Promise.allSettled(providers.map(provider=>refreshFleetGps(provider)));
          const summaries=[],warnings=[];
          results.forEach((result,i)=>{
            const label=sourceLabels[providers[i]];
            if(result.status==='rejected'){warnings.push(`${label}: ${result.reason.message}`);return;}
            const value=result.value;
            const problem=value.positions_error||value.link_error||(value.auth_error?'El proveedor ha rechazado el acceso a las posiciones.':'');
            if(problem)warnings.push(`${label}: ${problem}`);
            summaries.push(`${label}: ${value.updated||0} posiciones recibidas`);
          });
          warning=warnings.join(' · ');
          setSyncSummary(`${summaries.length?summaries.join(' · ')+'. ':''}La vista se actualiza cada minuto con las posiciones recibidas.`);
        }catch(e){warning=`No se ha podido actualizar el GPS: ${e.message}`;}
      }
      // A provider failure must not hide previously received or driver positions.
      setData(await getFleetLocations());setNow(Date.now());setError(warning);
    }catch(e){setError([warning,e.message].filter(Boolean).join(' '));}
    finally{inFlight.current=false;setLoading(false);}
  },[canSync]);
  useEffect(()=>{load();const timer=setInterval(load,60000);return()=>clearInterval(timer);},[load]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),10000);return()=>clearInterval(timer);},[]);
  const items=useMemo(()=>(data?.items||[]).map(v=>v.position&&now-Date.parse(v.last_recorded_at)>v.stale_seconds*1000?{...v,position:null,status:'obsoleta'}:v).filter(v=>`${v.matricula} ${v.chofer_nombre||''}`.toLowerCase().includes(q.toLowerCase())),[data,q,now]);
  // Recheck freshness locally as well as when positions are fetched.
  const points=useMemo(()=>items.filter(v=>v.position&&now-Date.parse(v.last_recorded_at)<=v.stale_seconds*1000).map(v=>({...v.position,stopNumber:v.matricula,label:`${v.matricula} · ${sourceLabels[v.provider]||v.provider} · ${date(v.last_recorded_at)}`})),[items,now]);
  return <section className="tg-localizacion"><header><div><h1>Localización</h1><p>Situación de la flota con fecha y fuente de la última captura.</p></div><button onClick={load} disabled={loading}>{loading?'Actualizando…':'Actualizar posiciones'}</button></header>
    <p className="tg-location-help">{data?.definition||'Cada vehículo usa su GPS asignado; si no tiene GPS, usa la app del conductor.'} Un GPS sin señal se muestra como antiguo o sin posición.</p>
    {error&&<p role="alert">{error}</p>}
    {syncSummary&&<p className="tg-location-help" role="status">{syncSummary}</p>}
    <input aria-label="Buscar vehículo o conductor" placeholder="Buscar matrícula o conductor…" value={q} onChange={e=>setQ(e.target.value)}/>
    <div className="tg-location-layout"><div className="tg-location-map"><RouteMapCanvas points={points} fleet/><p>{points.length} vehículos con posición reciente · Consulta: {date(data?.generated_at)}</p><p>Los números agrupan vehículos cercanos. Pulsa un grupo para ver sus matrículas o amplía el mapa.</p></div>
      <div className="tg-location-list">{items.map(v=><article key={v.id}><strong>{v.matricula}</strong><span>{v.chofer_nombre||'Sin conductor asignado'}</span><span className={v.position?'tg-location-ok':''}>{labels[v.status]||'Sin datos'}</span><small>{sourceLabels[v.provider]||v.provider||'Sin fuente'}{v.fallback?' · alternativa al GPS':''}</small><small>{date(v.last_recorded_at)}</small>{v.position&&<a href={`https://www.google.com/maps/search/?api=1&query=${v.position.lat},${v.position.lng}`} target="_blank" rel="noreferrer">Ver posición en Google Maps</a>}</article>)}{!loading&&!items.length&&<p>No hay vehículos que coincidan con la búsqueda.</p>}</div></div>
  </section>;
}

import {useRef,useState} from 'react';
import {optimizarRuta} from '../../services/api';
import {Button,Modal,Badge} from '../../ui';
import './JourneyReplanning.css';
const timestamp=value=>value?new Date(value).toLocaleString('es-ES',{timeZone:'Europe/Madrid'}):'No calculable';
export default function RouteConstraintsPanel({stops,vehicle={},disabled,onApply}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState(null);
 const [rules,setRules]=useState({start_day:'',start_time:'',capacity_kg:vehicle?.carga_max_kg||'',service_min:'',drive_limit_min:'',break_min:'',already_driven_min:''});
 const [truck,setTruck]=useState({height_m:'',width_m:'',length_m:'',weight_t:'',axleload_t:''});
 const request=useRef(0);
 const reset=fn=>{request.current++;setBusy(false);setResult(null);fn();};
 async function calculate(){const id=++request.current;setBusy(true);setError('');setResult(null);
  try{const data=await optimizarRuta({stops,preference:'camion',propose_sequence:true,truck:Object.fromEntries(Object.entries(truck).filter(([,v])=>Number(v)>0)),constraints:{...rules,truck_profile_confirmed:Object.values(truck).every(v=>Number(v)>0)}});if(id===request.current)setResult(data);}
  catch(e){if(id===request.current)setError(e.message);}finally{if(id===request.current)setBusy(false);}
 }
 return <><Button type="button" disabled={disabled} onClick={()=>setOpen(true)}>Proponer con restricciones</Button>
 {open&&<Modal open width={860} title="Propuesta de ruta con restricciones" onClose={()=>{request.current++;setOpen(false);setBusy(false);}}
 footer={<><Button type="button" disabled={busy||!rules.start_day||!rules.start_time} onClick={calculate}>{busy?'Calculando…':'Calcular propuesta'}</Button><Button type="button" variant="primary" disabled={!result||busy||result.constraint_review?.estado==='conflicto'} onClick={()=>{onApply(result);setOpen(false);}}>Revisar y aplicar al borrador</Button></>}>
 <div className="journey-replanning"><p>Orden propuesto por ventanas, cargas previas y capacidad. Calcula tiempos por carretera y señala conflictos; la ruta solo se guarda al confirmar el plan.</p>
  <div className="journey-replanning-fields">{[['start_day','Fecha de salida (Madrid)','date'],['start_time','Hora de salida (Madrid)','time'],['capacity_kg','Capacidad útil (kg)','number'],['service_min','Operación prevista por parada (min)','number'],['drive_limit_min','Pausa cada minutos de conducción','number'],['break_min','Duración de pausa (min)','number'],['already_driven_min','Conducción acumulada desde última pausa (min)','number']].map(([key,label,type])=><label key={key}>{label}<input type={type} min="0" value={rules[key]} onChange={e=>reset(()=>setRules({...rules,[key]:e.target.value}))}/></label>)}</div>
  <details><summary>Perfil del conjunto para el proveedor de rutas</summary><div className="journey-replanning-fields">{[['height_m','Altura (m)'],['width_m','Anchura (m)'],['length_m','Longitud (m)'],['weight_t','Peso bruto (t)'],['axleload_t','Peso por eje (t)']].map(([key,label])=><label key={key}>{label}<input type="number" min="0.1" step="0.01" value={truck[key]} onChange={e=>reset(()=>setTruck({...truck,[key]:e.target.value}))}/></label>)}</div></details>
  <p>Completa solo datos conocidos. Las pausas son una previsión; contrasta la jornada del conductor. La capacidad se comprueba en kg, sin mezclar palés ni metros.</p>
  {error&&<p role="alert">{error}</p>}
  {result&&<><Badge>{result.constraint_review?.estado==='conflicto'?'Conflictos a resolver':result.constraint_review?.estado==='parcial'?'Propuesta parcial':'Restricciones evaluadas'}</Badge>
   <p>{result.provider_label} · {result.distance_km==null?'Distancia no calculable':result.distance_km+' km'} · {result.warning}</p>
   <ul>{result.constraint_review?.incidencias.map((x,i)=><li key={i}>{x.level==='conflicto'?'Conflicto':'Pendiente'}: {x.text} {x.stop_id&&`(${stops.find(s=>s.id===x.stop_id)?.name||x.stop_id})`}</li>)}</ul>
   <div style={{overflowX:'auto'}}><table className="tgui-table"><thead><tr><th>Parada</th><th>Llegada prevista</th><th>Fin previsto</th><th>Pausas (min)</th><th>Carga (kg)</th></tr></thead><tbody>{result.constraint_review?.paradas.map((s,i)=><tr key={s.stop_id||i}><td>{result.stops[i]?.name}</td><td>{timestamp(s.arrival_at)}</td><td>{timestamp(s.end_at)}</td><td>{s.pause_min}</td><td>{s.load_kg==null?'No calculable':s.load_kg}</td></tr>)}</tbody></table></div>
  </>}
 </div></Modal>}
 </>;
}

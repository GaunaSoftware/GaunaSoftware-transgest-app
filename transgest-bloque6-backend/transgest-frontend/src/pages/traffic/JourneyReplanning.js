import {useEffect,useRef,useState} from 'react';
import {journeyOperation} from '../../services/api';
import {Button,Modal,Badge} from '../../ui';
import './JourneyReplanning.css';
const fixed=s=>s.estado!=='pendiente'||s.llegada_real_at||s.inicio_real_at||s.fin_real_at;
const label=s=>s.ubicacion.nombre||s.ubicacion.ciudad||s.ubicacion.direccion||'Ubicación pendiente';
export default function JourneyReplanning({pedido,vehiculos=[],choferes=[],canEdit,onApplied}){
 const [open,setOpen]=useState(false),[model,setModel]=useState(null),[stops,setStops]=useState([]),[assignment,setAssignment]=useState({}),[relief,setRelief]=useState(false),[reason,setReason]=useState(''),[place,setPlace]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[reload,setReload]=useState(0);
 const operation=useRef(null);
 useEffect(()=>{if(!open)return;let active=true;setBusy(true);setError('');setModel(null);
  journeyOperation(pedido.id).then(data=>{if(active){setModel(data);setStops(data.viajes[0]?.paradas||[]);setAssignment(data.viajes[0]?.asignacion_snapshot||{});}}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});return()=>{active=false;};
 },[open,reload,pedido?.id]);
 const trip=model?.viajes[0],materialized=model?.origen==='materializado';
 const change=fn=>{operation.current=null;fn();};
 function move(index,delta){const other=index+delta;if(other<0||other>=stops.length||fixed(stops[index])||fixed(stops[other]))return;change(()=>setStops(old=>{const next=[...old];[next[index],next[other]]=[next[other],next[index]];return next;}));}
 async function save(){setBusy(true);setError('');operation.current||=crypto.randomUUID();
  try{
   if(!materialized){await journeyOperation(pedido.id,'/incorporar',{method:'POST',body:{client_operation_uuid:operation.current,confirmado:true,motivo:reason}});operation.current=null;setReload(n=>n+1);}
   else {await journeyOperation(pedido.id,'/replanificar',{method:'POST',body:{client_operation_uuid:operation.current,version:trip.version,paradas:stops.map(s=>s.id),motivo:reason,...(relief?{asignacion:assignment,ubicacion_relevo:place,relevo_confirmado:true}:{})}});setOpen(false);onApplied?.();}
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 if(!pedido?.id||['entregado','facturado','cancelado'].includes(pedido.estado)||!canEdit)return null;
 return <><Button type="button" onClick={()=>{setOpen(true);setReason('');setRelief(false);operation.current=null;}}>Replanificación y relevos</Button>
  {open&&<Modal open title={'Replanificar · '+pedido.numero} width={840} onClose={()=>{if(!busy)setOpen(false);}}
   footer={<><Button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancelar</Button><Button type="button" variant="primary" disabled={busy||!model||reason.trim().length<4||(!materialized&&model.cobertura!=='compatible_simple')||(relief&&place.trim().length<3)} onClick={save}>{busy?'Guardando…':materialized?'Confirmar nueva versión':'Incorporar eventos existentes'}</Button></>}>
   <div className="journey-replanning">
    {error&&<p role="alert">{error}<Button type="button" onClick={()=>setReload(n=>n+1)}>Actualizar plan</Button></p>}
    {busy&&!model&&<p role="status">Cargando plan vigente…</p>}
    {model&&<><p>Las paradas realizadas y los documentos conservan sus datos. Guarda primero cualquier cambio pendiente en el pedido; esta operación cierra su editor y actualiza el listado.</p>
     {!materialized&&<p>{model.cobertura==='compatible_simple'?'Incorpora el viaje con los eventos ya registrados para poder replanificarlo. No se reconstruyen tiempos ni asignaciones anteriores que no estén registrados.':'Este viaje necesita identificar sus envíos antes de replanificarlo.'}</p>}
     {materialized&&<><Badge>Versión {trip.version}</Badge><h3>Secuencia pendiente</h3>
      <ol>{stops.map((s,i)=><li key={s.id}><span><strong>{s.tipo==='carga'?'Carga':'Descarga'} · {label(s)}</strong><small>{fixed(s)?'Con actividad · posición conservada':'Pendiente'}</small></span><div><Button type="button" aria-label={`Subir parada ${i+1}`} disabled={busy||fixed(s)||i===0||fixed(stops[i-1])} onClick={()=>move(i,-1)}>↑</Button><Button type="button" aria-label={`Bajar parada ${i+1}`} disabled={busy||fixed(s)||i===stops.length-1||fixed(stops[i+1])} onClick={()=>move(i,1)}>↓</Button></div></li>)}</ol>
      {!trip.asignacion_snapshot?.colaborador_id&&<label className="journey-check"><input type="checkbox" checked={relief} onChange={e=>change(()=>setRelief(e.target.checked))}/>Registrar relevo de la flota propia</label>}
      {relief&&<div className="journey-replanning-fields">{[['vehiculo_id','Tractora',vehiculos,'matricula'],['remolque_id','Remolque',vehiculos,'matricula'],['chofer_id','Conductor',choferes,'nombre'],['chofer2_id','Segundo conductor',choferes,'nombre']].map(([key,title,rows,name])=><label key={key}>{title}<select value={assignment[key]||''} onChange={e=>change(()=>setAssignment({...assignment,[key]:e.target.value}))}><option value="">Sin asignar</option>{rows.map(r=><option key={r.id} value={r.id}>{r[name]}</option>)}</select></label>)}<label className="journey-full">Lugar del relevo<input required maxLength={400} value={place} onChange={e=>change(()=>setPlace(e.target.value))}/></label><p className="journey-full">Al confirmar, el nuevo conductor podrá continuar las paradas pendientes. Se registra la asignación anterior; los kilómetros no se duplican ni se reparten por vehículo sin evidencia.</p></div>}
      {trip.relevos?.length>0&&<details><summary>Relevos registrados ({trip.relevos.length})</summary>{trip.relevos.map((r,i)=><p key={i}>{new Date(r.received_at).toLocaleString('es-ES')} · {r.ubicacion} · {r.motivo}</p>)}</details>}
     </>}
     <label>Motivo<textarea required maxLength={1000} rows={3} value={reason} onChange={e=>change(()=>setReason(e.target.value))}/></label>
    </>}
   </div>
  </Modal>}
 </>;
}

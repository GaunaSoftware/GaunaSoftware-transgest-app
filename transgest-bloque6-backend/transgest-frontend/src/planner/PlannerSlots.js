import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {plannerApi} from '../services/api';
import {Button,Modal} from '../ui';
import {confirmDialog} from '../services/notify';
import {Panel,Badge,Empty,dayKey} from './PlannerUI';
const time=d=>new Date(d).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'});
const localInput=d=>`${dayKey(d)}T${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
export default function PlannerSlots({onOrder,selectedDay,onDayChange,refreshKey=0}){
 const {puedeEditar}=useAuth(),canEdit=puedeEditar('pedidos');
 const [ownDay,setOwnDay]=useState(dayKey()),[view,setView]=useState('dia'),[warehouse,setWarehouse]=useState('');
 const [docks,setDocks]=useState([]),[bookings,setBookings]=useState([]),[requests,setRequests]=useState([]);
 const [draft,setDraft]=useState(null),[dock,setDock]=useState(null),[selected,setSelected]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[allPending,setAllPending]=useState(false);
 const day=selectedDay||ownDay;
 const setDay=value=>{setOwnDay(value);onDayChange?.(value);};
 const load=useCallback(async()=>{
  const start=new Date(`${day}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+(view==='semana'?7:1));
  const [d,b,r]=await Promise.all([plannerApi('/muelles'),plannerApi(`/reservas?${new URLSearchParams({desde:start.toISOString(),hasta:end.toISOString()})}`),plannerApi('/solicitudes-hueco')]);
  setDocks(d);setBookings(b);setRequests(r);
 },[day,view]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load,refreshKey]);
 const visible=docks.filter(d=>!warehouse||d.almacen===warehouse);
 const dates=Array.from({length:view==='dia'?1:7},(_,i)=>{const d=new Date(`${day}T12:00`);d.setDate(d.getDate()+i);return dayKey(d);});
 const pending=requests.filter(r=>allPending||dates.includes(String(r.fecha_carga||'').slice(0,10)));
 const openDock=()=>setDock({nombre:'',almacen:'Principal',activo:true,horario_inicio:'06:00',horario_fin:'18:00',dias:[1,2,3,4,5],zona_horaria:'Europe/Madrid'});
 const newReservation=(d=visible.find(x=>x.activo),hour=9,date=day,request=null)=>{
  if(!d)return;setError('');setDraft({muelle_id:d.id,pedido_id:request?.pedido_id||'',tipo:'carga',inicio:localInput(new Date(`${date}T${String(hour).padStart(2,'0')}:00`)),notas:request?.notas||''});
 };
 async function assign(body){
  try{return await plannerApi('/reservas',{method:'POST',body,silentError:true});}
  catch(e){
   if(e.data?.code!=='MUELLE_OCUPADO')throw e;
   if(!await confirmDialog({title:'Camión cargando en el muelle',message:e.message,confirmText:'Asignar igualmente',cancelText:'Volver',tone:'warning'}))return null;
   return plannerApi('/reservas',{method:'POST',body:{...body,confirmar_ocupado:true}});
  }
 }
 async function drop(e,d,date,hour){
  e.preventDefault();if(busy||!canEdit||!d.activo)return;
  const pedido_id=e.dataTransfer.getData('application/x-planner-load');
  if(!requests.some(r=>r.pedido_id===pedido_id))return;
  setBusy(true);setError('');
  try{const result=await assign({muelle_id:d.id,pedido_id,tipo:'carga',inicio:new Date(`${date}T${String(hour).padStart(2,'0')}:00`).toISOString()});if(result){await load();window.dispatchEvent(new CustomEvent('tms:planner-changed'));}}
  catch(err){setError(err.message);}finally{setBusy(false);}
 }
 async function save(e){e.preventDefault();if(busy)return;setBusy(true);setError('');try{
  if(dock)await plannerApi(dock.id?`/muelles/${dock.id}`:'/muelles',{method:dock.id?'PUT':'POST',body:dock});
  else if(!await assign({...draft,inicio:new Date(draft.inicio).toISOString()}))return;
  setDraft(null);setDock(null);await load();window.dispatchEvent(new CustomEvent('tms:planner-changed'));
 }catch(err){setError(err.message);}finally{setBusy(false);}}
 async function cancel(b){if(!await confirmDialog({title:'Liberar muelle',message:'La carga volverá a solicitudes pendientes. Se conservan la mercancía y la aceptación del proveedor.',confirmText:'Liberar muelle',tone:'warning'}))return;setBusy(true);try{await plannerApi(`/reservas/${b.id}`,{method:'DELETE'});setSelected(null);await load();}catch(e){setError(e.message);}finally{setBusy(false);}}
 const hours=Array.from({length:24},(_,i)=>i).filter(h=>h>=Math.min(6,...visible.map(d=>Number(d.horario_inicio?.slice(0,2)||6)))&&h<Math.max(19,...visible.map(d=>Number(d.horario_fin?.slice(0,2)||18))));
 return <section className="pl-slots">
  <div className="pl-filters"><Button onClick={()=>setDay(dayKey())}>Hoy</Button><input aria-label="Fecha del cuadrante" type="date" value={day} onChange={e=>e.target.value&&setDay(e.target.value)}/><select aria-label="Filtrar almacén" value={warehouse} onChange={e=>setWarehouse(e.target.value)}><option value="">Todos los almacenes</option>{[...new Set(docks.map(d=>d.almacen))].map(w=><option key={w}>{w}</option>)}</select><div className="pl-segment">{[['dia','Día'],['semana','Semana']].map(([id,l])=><button key={id} aria-pressed={view===id} onClick={()=>setView(id)}>{l}</button>)}</div>{canEdit&&<Button onClick={openDock}>Nuevo muelle</Button>}<Button onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</Button></div>
  <p className="pl-muted">Arrastra una carga pendiente al muelle y hora de llegada, o pulsa «Asignar muelle». Sin límite de palets ni duración obligatoria. Horas: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
  {error&&!draft&&!dock&&<p role="alert">{error}</p>}
  <div className="pl-workspace"><div>{dates.map(date=><Panel key={date} title={new Date(`${date}T12:00`).toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long'})} icon="clock"><div className="pl-calendar-scroll"><div className="pl-dock-board" style={{gridTemplateColumns:`64px repeat(${visible.length||1},minmax(205px,1fr))`}}>
   <div className="pl-calendar-head">Llegada</div>{visible.map(d=><div key={d.id} className="pl-calendar-head"><button disabled={!canEdit} onClick={()=>setDock(d)}>{d.nombre}</button><small>{d.almacen} · {d.activo?'Operativo':'Fuera de servicio'}</small></div>)}
   {hours.map(h=><div className="pl-dock-row" key={h}><div className="pl-hour">{String(h).padStart(2,'0')}:00</div>{visible.map(d=><div className="pl-drop-cell" key={d.id} onDragOver={e=>{if(canEdit&&d.activo)e.preventDefault();}} onDrop={e=>drop(e,d,date,h)}>
    {bookings.filter(b=>b.muelle_id===d.id&&dayKey(new Date(b.inicio))===date&&new Date(b.inicio).getHours()===h).map(b=><button className="pl-slot-card" key={b.id} onClick={()=>setSelected(b)}><strong>{b.numero||'Reserva'}</strong><span>{b.cliente||'Cliente pendiente'}</span><span>{b.destino}</span><small>{b.colaborador||'Pendiente de asignación de colaborador'}</small><small>Llegada {time(b.inicio)}</small><Badge value={b.situacion_camion||b.estado||'pendiente'}/></button>)}
    {canEdit&&d.activo&&<button className="pl-drop-add" disabled={busy} aria-label={`Asignar ${d.nombre} ${date} ${h}:00`} onClick={()=>newReservation(d,h,date)}>+ Asignar</button>}
   </div>)}</div>)}
  </div></div>{!visible.length&&<Empty>Añade un muelle para comenzar a planificar.</Empty>}</Panel>)}</div>
  <aside><Panel title={`Solicitudes pendientes (${pending.length})`} icon="file"><label className="pl-check-line"><input type="checkbox" checked={allPending} onChange={e=>setAllPending(e.target.checked)}/>Todas las fechas</label>{pending.map(r=><article className="pl-side-item pl-pending-load" key={r.pedido_id} draggable={canEdit&&!busy} onDragStart={e=>{e.dataTransfer.setData('application/x-planner-load',r.pedido_id);e.dataTransfer.effectAllowed='move';}}><strong>{r.numero}</strong><p>{r.cliente||'Cliente pendiente'} · {r.destino}</p><p>{r.colaborador||'Pendiente de asignación de colaborador'}</p><small>{String(r.fecha_carga||'Sin fecha').slice(0,10)} · {r.colaborador_precio_confirmado?'Aceptada por el proveedor':'Aceptación del proveedor pendiente'}</small>{canEdit&&<Button disabled={busy||!visible.some(d=>d.activo)} onClick={()=>newReservation(undefined,9,day,r)}>Asignar muelle</Button>}</article>)}{!pending.length&&<Empty>No hay cargas pendientes para estas fechas.</Empty>}{requests.length>=500&&<p>Se muestran las primeras 500 solicitudes pendientes.</p>}</Panel>
   <Panel title="Tiempos reales de carga" icon="clock">{visible.map(d=><article className="pl-side-item" key={d.id}><strong>{d.nombre}</strong><p>{Number(d.muestras)>0?`${d.media_min} min de media · ${d.muestras} cargas registradas`:'Aún no hay cargas terminadas con tiempos registrados.'}</p><small>Información orientativa. No limita la asignación del muelle.</small></article>)}</Panel>
  </aside></div>
  {(draft||dock)&&<Modal title={dock?'Muelle y horario de apertura':'Asignar carga al muelle'} onClose={()=>!busy&&(setDraft(null),setDock(null))}><form className="planner-form" onSubmit={save}><div className="planner-grid">{dock?<>
   {[['nombre','Nombre del muelle','text'],['almacen','Almacén','text'],['horario_inicio','Apertura','time'],['horario_fin','Cierre','time']].map(([k,l,t])=><label key={k}>{l}<input required type={t} value={dock[k]} onChange={e=>setDock({...dock,[k]:e.target.value})}/></label>)}
   <label>Zona horaria<select value={dock.zona_horaria} onChange={e=>setDock({...dock,zona_horaria:e.target.value})}>{['Europe/Madrid','Atlantic/Canary','Europe/Lisbon','Europe/Paris','UTC'].map(z=><option key={z}>{z}</option>)}</select></label><label>Estado<select value={String(dock.activo)} onChange={e=>setDock({...dock,activo:e.target.value==='true'})}><option value="true">Operativo</option><option value="false">Fuera de servicio</option></select></label>
   <fieldset><legend>Días de apertura</legend>{['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'].map((l,i)=><label className="pl-check-line" key={l}><input type="checkbox" checked={dock.dias.includes(i+1)} onChange={e=>setDock({...dock,dias:e.target.checked?[...dock.dias,i+1]:dock.dias.filter(d=>d!==i+1)})}/>{l}</label>)}</fieldset>
  </>:<><label>Muelle<select value={draft.muelle_id} onChange={e=>setDraft({...draft,muelle_id:e.target.value})}>{docks.filter(d=>d.activo).map(d=><option key={d.id} value={d.id}>{d.almacen} · {d.nombre}</option>)}</select></label><label>Carga<select required value={draft.pedido_id} onChange={e=>setDraft({...draft,pedido_id:e.target.value})}><option value="">Selecciona la carga</option>{requests.map(r=><option key={r.pedido_id} value={r.pedido_id}>{r.numero} · {r.cliente} · {r.destino}</option>)}</select></label><label>Llegada prevista<input required type="datetime-local" value={draft.inicio} onChange={e=>setDraft({...draft,inicio:e.target.value})}/></label><label>Notas<textarea maxLength={2000} value={draft.notas} onChange={e=>setDraft({...draft,notas:e.target.value})}/></label></>}</div>{error&&<p role="alert">{error}</p>}<Button type="submit" variant="primary" disabled={busy}>{busy?'Guardando…':'Guardar'}</Button></form></Modal>}
  {selected&&<Modal title={selected.numero||'Reserva de muelle'} onClose={()=>setSelected(null)}><p>{selected.almacen} · {selected.muelle}</p><p>Llegada: {new Date(selected.inicio).toLocaleString('es-ES')}</p><p>{selected.cliente} · {selected.origen} → {selected.destino}</p><p>{selected.colaborador||'Pendiente de asignación de colaborador'}</p><p>{selected.notas}</p><div className="pl-action-row">{onOrder&&selected.pedido_id&&<Button onClick={()=>{onOrder(selected.pedido_id);setSelected(null);}}>Abrir carga</Button>}{canEdit&&<Button disabled={busy} onClick={()=>cancel(selected)}>Liberar muelle</Button>}</div>{error&&<p role="alert">{error}</p>}</Modal>}
 </section>;
}

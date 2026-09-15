import {useCallback,useEffect,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {getPedidos} from '../services/api';
import {resolveApiBase} from '../utils/serverConfig';
import {Button,Modal} from '../ui';
import {confirmDialog} from '../services/notify';
async function api(path,options={}){
 const res=await fetch(`${resolveApiBase()}/api/v1/planner${path}`,{method:options.method||'GET',headers:{Authorization:`Bearer ${localStorage.getItem('tms_token')||''}`,'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});
 const data=await res.json();if(!res.ok)throw new Error(data.error||'No se pudo guardar la planificación');return data;
}
const localDate=()=>new Date().toLocaleDateString('en-CA');
export default function PlannerSlots(){
 const {puedeEditar}=useAuth(),canEdit=puedeEditar('pedidos');
 const [day,setDay]=useState(localDate),[docks,setDocks]=useState([]),[bookings,setBookings]=useState([]),[orders,setOrders]=useState([]),[draft,setDraft]=useState(null),[dock,setDock]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{
   const start=new Date(`${day}T00:00:00`),end=new Date(start);end.setDate(end.getDate()+1);
   const [d,b,o]=await Promise.all([api('/muelles'),api(`/reservas?desde=${start.toISOString()}&hasta=${end.toISOString()}`),getPedidos({desde:day,hasta:day,limit:200})]);
   setDocks(d);setBookings(b);setOrders(Array.isArray(o)?o:o.data||[]);
 },[day]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{
   if(dock)await api('/muelles',{method:'POST',body:dock});
   else await api('/reservas',{method:'POST',body:{...draft,inicio:new Date(draft.inicio).toISOString(),fin:new Date(draft.fin).toISOString()}});
   setDraft(null);setDock(null);await load();
 }catch(err){setError(err.message);}finally{setBusy(false);}}
 async function cancel(b){if(!await confirmDialog({title:'Liberar hueco',message:'Se eliminará esta reserva del muelle. El pedido se conserva.',confirmText:'Liberar hueco',tone:'warning'}))return;try{await api(`/reservas/${b.id}`,{method:'DELETE'});await load();}catch(e){setError(e.message);}}
 return <section className="planner-loads"><h1>Planificación de cargas y muelles</h1><p>Reserva huecos de carga y descarga por almacén. Vincula cada reserva con su pedido y proveedor.</p>
 <div className="planner-toolbar"><label>Día<input type="date" required value={day} onChange={e=>e.target.value&&setDay(e.target.value)}/></label><Button onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</Button>{canEdit&&<><Button onClick={()=>setDock({nombre:'',almacen:''})}>Nuevo muelle</Button><Button disabled={!docks.length} variant="primary" onClick={()=>setDraft({muelle_id:docks[0].id,pedido_id:'',tipo:'carga',inicio:`${day}T09:00`,fin:`${day}T10:00`,notas:''})}>Reservar hueco</Button></>}</div>
 {error&&!draft&&!dock&&<p role="alert">{error}</p>}
 <div className="planner-grid">{docks.map(d=><article className="planner-stop" key={d.id}><h2>{d.almacen} · {d.nombre}</h2>{bookings.filter(b=>b.muelle_id===d.id).map(b=><div key={b.id} style={{borderLeft:`4px solid ${b.tipo==='carga'?'#00a486':'#f28c18'}`,padding:12,marginBottom:10,background:b.tipo==='carga'?'#00a48612':'#f28c1812'}}><strong>{new Date(b.inicio).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}–{new Date(b.fin).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})} · {b.tipo==='carga'?'Carga':'Descarga'}</strong><p>{b.numero||'Hueco reservado'} · {b.colaborador||'Sin proveedor externo'} {b.estado?`· ${b.estado}`:''}</p><p>{b.notas}</p>{canEdit&&<Button onClick={()=>cancel(b)}>Liberar hueco</Button>}</div>)}{!bookings.some(b=>b.muelle_id===d.id)&&<p>Sin reservas para este día.</p>}</article>)}</div>
 {!docks.length&&<p>Añade los muelles de tus almacenes para comenzar.</p>}
 {(draft||dock)&&<Modal title={dock?'Nuevo muelle':'Reserva de carga / descarga'} onClose={()=>!busy&&(setDraft(null),setDock(null))}><form onSubmit={save} className="planner-grid">{dock?<>{[['almacen','Almacén'],['nombre','Muelle']].map(([k,l])=><label key={k}>{l}<input required maxLength={120} className="tgui-input" value={dock[k]} onChange={e=>setDock({...dock,[k]:e.target.value})}/></label>)}</>:<>
 <label>Muelle<select className="tgui-select" value={draft.muelle_id} onChange={e=>setDraft({...draft,muelle_id:e.target.value})}>{docks.map(d=><option key={d.id} value={d.id}>{d.almacen} · {d.nombre}</option>)}</select></label><label>Pedido del día<select className="tgui-select" value={draft.pedido_id} onChange={e=>setDraft({...draft,pedido_id:e.target.value})}><option value="">Reserva sin pedido</option>{orders.map(o=><option key={o.id} value={o.id}>{o.numero} · {o.origen} → {o.destino}</option>)}</select></label>
 <label>Operación<select className="tgui-select" value={draft.tipo} onChange={e=>setDraft({...draft,tipo:e.target.value})}><option value="carga">Carga</option><option value="descarga">Descarga</option></select></label>{[['inicio','Inicio'],['fin','Fin']].map(([k,l])=><label key={k}>{l}<input required type="datetime-local" className="tgui-input" value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}/></label>)}<label>Notas<textarea className="tgui-input" maxLength={2000} value={draft.notas} onChange={e=>setDraft({...draft,notas:e.target.value})}/></label></>}{error&&<p role="alert">{error}</p>}<Button type="submit" variant="primary" disabled={busy}>{busy?'Guardando…':'Guardar'}</Button></form></Modal>}
 </section>;
}

import {useCallback,useEffect,useState,useRef} from 'react';
import {resolveApiBase} from '../utils/serverConfig';
import {Button,Modal} from '../ui';
import './support.css';
async function userRequest(path,options={}) {
  const response = await fetch(`${resolveApiBase()}/api/v1/soporte${path}`,{method:options.method || 'GET',headers:{Authorization:`Bearer ${localStorage.getItem('tms_token') || ''}`,'Content-Type':'application/json'},...(options.body ? {body:JSON.stringify(options.body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'No se pudo contactar con soporte');
  return data;
}
const labels={abierta:'Pendiente de soporte',respondida:'Respondida',resuelta:'Resuelta'};
export default function SupportInbox({admin=false,request=userRequest,onClose}) {
  const [items,setItems]=useState([]),[selected,setSelected]=useState(''),[thread,setThread]=useState(null);
  const [subject,setSubject]=useState(''),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[resolve,setResolve]=useState(false);
  const revision=useRef(0);
  const reload=useCallback(async()=>{
    const current=++revision.current;const rows=await request('');
    if(current!==revision.current)return;setItems(rows);
    if(selected){const detail=await request(`/${selected}`);if(current===revision.current)setThread(detail);}
  },[request,selected]);
  useEffect(()=>{let alive=true;const update=()=>reload().catch(e=>alive&&setError(e.message));update();const timer=setInterval(update,15000);return()=>{alive=false;clearInterval(timer);};},[reload]);
  async function send(event){
    event.preventDefault();setBusy(true);setError('');
    try{
      if(selected) await request(`/${selected}/mensajes`,{method:'POST',body:{mensaje:message,...(resolve?{estado:'resuelta'}:{})}});
      else {const result=await request('',{method:'POST',body:{asunto:subject,mensaje:message}});setSelected(result.id);setSubject('');}
      setMessage('');setResolve(false);await reload();
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }
  function select(id){revision.current++;setSelected(id);setThread(null);setMessage('');setError('');setResolve(false);}
  const content=<div className="tg-support">
    <p>Describe tu consulta. Quedará registrada y podrás leer aquí la respuesta del equipo de soporte.</p>
    {error&&<p role="alert">{error}</p>}
    <div className="tg-support-columns"><aside aria-label="Solicitudes">
      {!admin&&<Button onClick={()=>select('')}>Nueva solicitud</Button>}
      {!items.length&&<p>No hay solicitudes.</p>}
      {items.map(item=><button type="button" key={item.id} aria-pressed={selected===item.id} onClick={()=>select(item.id)}><strong>{item.asunto}</strong><small>{admin?`${item.empresa_nombre} · ${item.usuario_nombre} · `:''}{labels[item.estado] || item.estado}</small><small>{new Date(item.updated_at).toLocaleString('es-ES')}</small></button>)}
    </aside><section aria-label="Conversación">
      {selected&&<><h3>{thread?.asunto || 'Cargando conversación…'}</h3><div className="tg-support-messages" aria-live="polite">{thread?.mensajes?.map(m=><article className={m.desde_soporte?'from-support':''} key={m.id}><strong>{m.autor_nombre}</strong><small>{new Date(m.created_at).toLocaleString('es-ES')}</small><p>{m.mensaje}</p></article>)}</div></>}
      {(!admin||selected)&&<form onSubmit={send}>
        {!selected&&<label>Asunto<input className="tgui-input" required maxLength={160} value={subject} onChange={e=>setSubject(e.target.value)}/></label>}
        <label>{selected?'Tu respuesta':'Mensaje'}<textarea className="tgui-input" required rows={4} maxLength={6000} value={message} onChange={e=>setMessage(e.target.value)}/></label>
        {selected&&<label><input type="checkbox" checked={resolve} onChange={e=>setResolve(e.target.checked)}/> Marcar como resuelta al enviar</label>}
        <Button type="submit" variant="primary" disabled={busy||(!!selected&&!thread)}>{busy?'Enviando…':'Enviar'}</Button>
      </form>}
      {admin&&!selected&&<p>Selecciona una solicitud para responder.</p>}
    </section></div>
  </div>;
  return onClose?<Modal title="Soporte" width={1000} onClose={onClose}>{content}</Modal>:content;
}

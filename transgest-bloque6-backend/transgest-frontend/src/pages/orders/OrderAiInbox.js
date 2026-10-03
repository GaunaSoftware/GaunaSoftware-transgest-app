import {useEffect,useState} from 'react';
import {Button,Select,Card} from '../../ui';
import {getOrderInbox,interpretarPedidoIA,changeOrderInboxState,descargarArchivoProtegido,getPedido} from '../../services/api';
const labels={nuevo:'Nuevo',revisar:'Revisar',listo:'Listo',creado:'Creado',descartado:'Descartado',error:'Error'};
export const notifyInboxChanged=()=>window.dispatchEvent(new Event('tms:inbox-changed'));
export default function OrderAiInbox({onPrepared,onOpenOrder,revision}){
 const [page,setPage]=useState(1),[state,setState]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null),[reload,setReload]=useState(0);
 useEffect(()=>{let active=true;setError('');setData(null);getOrderInbox({page,state}).then(value=>{if(active)setData(value);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[page,state,reload,revision]);
 const total=data?.counts?.filter(item=>!state||item.state===state).reduce((sum,item)=>sum+item.count,0)||0;
 async function act(item,action){setBusy(item.id);setError('');try{
  if(action==='open'){onOpenOrder(await getPedido(item.pedido_id));return;}
  if(action==='parse'||action==='reparse')onPrepared(await interpretarPedidoIA({inbox_id:item.id,...(action==='reparse'?{reanalyze:true}:{})}));
  else await changeOrderInboxState(item.id,{state:action,version:item.version,reviewed:action==='listo'});
  setReload(value=>value+1);notifyInboxChanged();
 }catch(e){setError(e.message);}finally{setBusy(null);}}
 return <Card className="order-inbox"><h3>Entradas pendientes y revisadas</h3>
  <p>Interpretar y marcar como listo no crea el pedido. Se crea al revisar y guardar su formulario.</p>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end'}}><label>Estado<Select value={state} onChange={e=>{setState(e.target.value);setPage(1);}}><option value="">Todos</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select></label><Button onClick={()=>setReload(v=>v+1)}>Actualizar bandeja</Button></div>
  {data?.inbound?.address&&<p>Correo de entrada: <strong>{data.inbound.address}</strong></p>}
  {data?.inbound?.guidance&&<p>{data.inbound.guidance}</p>}
  {error&&<p role="alert">{error}</p>}
  {!data&&!error&&<p role="status">Cargando entradas…</p>}
  {data?.items?.length===0&&<p>No hay entradas en este estado.</p>}
  {data?.items?.map(item=><article key={item.id} style={{padding:'12px 0',borderBottom:'1px solid var(--border2)'}}>
   <div><strong>{item.email_subject||item.filename||'Texto de pedido'}</strong> · {labels[item.state]}{item.processing_at?' · Análisis en curso':''}</div>
   <p>{new Date(item.created_at).toLocaleString('es-ES')}{item.error&&` · ${item.error}`}</p>
   <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
    {item.state==='creado'?<Button disabled={!!busy} onClick={()=>act(item,'open')}>Ver pedido creado</Button>:<>
     {item.state==='descartado'?<Button disabled={!!busy} onClick={()=>act(item,'revisar')}>Restaurar para revisar</Button>:<>
      <Button disabled={!!busy} onClick={()=>act(item,'parse')}>{item.state==='nuevo'||item.state==='error'?'Analizar entrada':'Recuperar borrador'}</Button>
      {item.state==='revisar'&&<Button disabled={!!busy} onClick={()=>act(item,'reparse')}>Volver a analizar</Button>}
      {item.state==='revisar'&&<Button disabled={!!busy} onClick={()=>act(item,'listo')}>He revisado: marcar listo</Button>}
      <Button disabled={!!busy} onClick={()=>act(item,'descartado')}>Descartar</Button>
     </>}
    </>}
    {item.attachments?.map((file,index)=><Button key={index} disabled={!!busy} onClick={()=>descargarArchivoProtegido(`/pedidos/ai-inbox/entries/${item.id}/attachments/${index}`,file.name).catch(e=>setError(e.message))}>Original: {file.name}</Button>)}
   </div>
  </article>)}
  {data&&<div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap',marginTop:12}}><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page} · {total} entradas</span><Button disabled={page*25>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div>}
 </Card>;
}

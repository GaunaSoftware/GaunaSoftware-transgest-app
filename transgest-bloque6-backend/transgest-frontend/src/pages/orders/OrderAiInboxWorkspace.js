import {useEffect,useRef,useState} from 'react';
import {Badge,Button,Card,EmptyState,Icon,SearchInput,Select,Tabs} from '../../ui';
import {getOrderInbox,getOrderInboxEntry,interpretarPedidoIA,changeOrderInboxState,descargarArchivoProtegido,readOrderInboxOriginal,getPedido} from '../../services/api';
import OrderAiReview from './OrderAiReview';
import {inboxOriginalView} from './inboxOriginalView';
import './orderAiInbox.css';
const labels={nuevo:'Nuevo',revisar:'Revisar',listo:'Listo',creado:'Creado',descartado:'Descartado',error:'Error'};
const tones={nuevo:'success',revisar:'warning',listo:'success',error:'danger'};
const date=value=>value?new Date(value).toLocaleString('es-ES',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
export const notifyInboxChanged=()=>window.dispatchEvent(new Event('tms:inbox-changed'));
export function InboxHeading({inbound}){
 return <span className="ai-inbox-heading"><span className="ai-inbox-heading-icon"><Icon name="mail" size={28}/></span><span className="ai-inbox-heading-copy"><strong>Bandeja IA de pedidos</strong><small>La IA analiza tus correos y documentos, detecta la información clave y te ayuda a crear pedidos.</small></span><span className={`ai-inbox-connection ${inbound?.configured?'connected':''}`}><span><i/>{inbound?.configured?'IMAP conectado':'IMAP sin conectar'}</span><small>{inbound?.address||'Pendiente de configurar'}</small></span></span>;
}
export default function OrderAiInbox({onPrepared,onOpenOrder,onCreate,preview,revision,activeTab='entries',onTabChange,documentAnalyzer,history,historyCount,documentCount,onInbound,onConfigure}){
 const [page,setPage]=useState(1),[state,setState]=useState(''),[data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(null),[reload,setReload]=useState(0);
 const [selectedId,setSelectedId]=useState(null),[mobileDetail,setMobileDetail]=useState(false),[detailTab,setDetailTab]=useState('summary'),[search,setSearch]=useState(''),[period,setPeriod]=useState(''),[original,setOriginal]=useState(null),[originalError,setOriginalError]=useState('');
 const preparedRef=useRef(onPrepared),inboundRef=useRef(onInbound);preparedRef.current=onPrepared;inboundRef.current=onInbound;
 useEffect(()=>{if(revision){setState('');setPage(1);setPeriod('');setSearch('');setMobileDetail(true);}},[revision]);
 useEffect(()=>{let active=true;setError('');setData(null);
  getOrderInbox({page,state}).then(async value=>{
   const items=await Promise.all((value.items||[]).map(async item=>{try{return {...item,...await getOrderInboxEntry(item.id)};}catch{return item;}}));
   if(active){setData({...value,items});inboundRef.current?.(value.inbound);setSelectedId(current=>items.some(item=>item.id===current)?current:items[0]?.id||null);}
  }).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};
 },[page,state,reload,revision]);
 const total=data?.counts?.filter(item=>!state||item.state===state).reduce((sum,item)=>sum+item.count,0)||0;
 const selected=data?.items?.find(item=>item.id===selectedId);
 const selectedPreview=preview?.inbox_id===selectedId?preview:selected?.result?{...selected.result,inbox_id:selected.id,inbox_state:selected.state,pedido_id:selected.pedido_id}:null;
 useEffect(()=>{setDetailTab('summary');},[selected?.id,selected?.version]);
 useEffect(()=>{if(preview?.inbox_id&&preview.inbox_id!==selectedId){setSelectedId(preview.inbox_id);setMobileDetail(true);}},[preview?.inbox_id]); // eslint-disable-line react-hooks/exhaustive-deps
 useEffect(()=>{let active=true;setOriginal(null);setOriginalError('');if(!selected)return()=>{active=false;};
  const index=(selected.attachments||[]).findIndex(file=>file.mediaType==='message/rfc822'||/\.(eml|txt|md|html?)$/i.test(file.name));
  if(index>=0)readOrderInboxOriginal(selected.id,index).then(raw=>{if(active)setOriginal(inboxOriginalView(raw,/\.eml$/i.test(selected.attachments[index].name)||selected.attachments[index].mediaType==='message/rfc822'));}).catch(e=>{if(active)setOriginalError(e.message);});
  return()=>{active=false;};
 },[selected?.id,selected?.version]); // eslint-disable-line react-hooks/exhaustive-deps
 const visible=(data?.items||[]).filter(item=>{
  const haystack=[item.email_from,item.email_subject,item.filename,item.result?.pedido?.cliente_nombre].join(' ').toLocaleLowerCase('es');
  return (!search||haystack.includes(search.toLocaleLowerCase('es')))&&(!period||new Date(item.created_at).getTime()>=Date.now()-Number(period)*86400000);
 });
 const visibleIds=visible.map(item=>item.id).join('|');
 useEffect(()=>{if(data&&!visible.some(item=>item.id===selectedId))setSelectedId(visible[0]?.id||null);},[visibleIds]); // eslint-disable-line react-hooks/exhaustive-deps
 async function act(item,action){setBusy(item.id);setError('');try{
  if(action==='open'){const order=await getPedido(item.pedido_id);onOpenOrder?.(order);return;}
  if(action==='parse'||action==='reparse'){const result=await interpretarPedidoIA({inbox_id:item.id,...(action==='reparse'?{reanalyze:true}:{})});preparedRef.current?.(result);}
  else await changeOrderInboxState(item.id,{state:action,version:item.version,reviewed:action==='listo'});
  setReload(value=>value+1);notifyInboxChanged();
 }catch(e){setError(e.message);}finally{setBusy(null);}}
 function actions(item){
  const disabled=!!busy||!!item.processing_at,hasDraft=!!selectedPreview,canReview=hasDraft&&selectedPreview.pedido?.cliente_id&&['origen','destino','fecha_carga'].every(key=>selectedPreview.pedido?.[key]);
  if(item.state==='creado')return <Button variant="primary" disabled={disabled} onClick={()=>act(item,'open')}>Ver pedido creado</Button>;
  if(item.state==='descartado')return <Button disabled={disabled} onClick={()=>act(item,'revisar')}>Restaurar para revisar</Button>;
  return <>{hasDraft&&onCreate&&<Button variant="primary" disabled={disabled} onClick={()=>onCreate(selectedPreview)}>Crear pedido</Button>}
   {(!hasDraft||['nuevo','error'].includes(item.state))&&<Button variant="primary" disabled={disabled} onClick={()=>act(item,'parse')}>Analizar entrada</Button>}
   {hasDraft&&['revisar','listo'].includes(item.state)&&<Button disabled={disabled} onClick={()=>act(item,'parse')}>Recuperar borrador</Button>}
   {item.state==='revisar'&&<Button disabled={disabled} onClick={()=>act(item,'reparse')}>Volver a analizar</Button>}
   {item.state==='revisar'&&hasDraft&&<Button disabled={disabled||!canReview} title={!canReview?'Completa los campos obligatorios en el formulario del pedido':undefined} onClick={()=>act(item,'listo')}>He revisado: marcar listo</Button>}
   <Button disabled={disabled} onClick={()=>act(item,'descartado')}>Descartar</Button></>;
 }
 const originalContent=<section className="ai-inbox-original">{originalError?<p role="alert">{originalError}</p>:original?<><dl>{[['De',original.from||selected?.email_from],['Para',original.to],['Asunto',original.subject||selected?.email_subject],['Fecha',original.date]].filter(([,value])=>value).map(([key,value])=><div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl><pre>{original.body||'El original no contiene cuerpo de texto legible.'}</pre></>:<EmptyState title={(selected?.attachments||[]).some(file=>/\.(eml|txt|md|html?)$/i.test(file.name))?'Cargando contenido original…':'Consulta el archivo original en Adjuntos'} text="Los originales se conservan en la entrada."/>}</section>;
 const attachments=(selected?.attachments||[]).length?<div className="ai-inbox-files">{selected.attachments.map((file,index)=><Card key={index} className="ai-inbox-file"><span className="ai-inbox-icon"><Icon name="attachment"/></span><div><strong>{file.name}</strong><small>{file.mediaType||'Documento'}{file.sizeKb!=null?` · ${file.sizeKb} KB`:''}</small>{selectedPreview&&<small>{selectedPreview.source?.attachments?.find(item=>item.name===file.name)?.serverTextDetected?'Texto detectado':'Conservado con el original'}</small>}</div><Button disabled={!!busy} onClick={()=>descargarArchivoProtegido(`/pedidos/ai-inbox/entries/${selected.id}/attachments/${index}`,file.name).catch(e=>setError(e.message))}>Descargar</Button></Card>)}</div>:<EmptyState title="Sin archivos adjuntos"/>;
 return <div className="ai-inbox-workspace" data-mobile-detail={mobileDetail}>
  <div className="ai-inbox-navigation"><Tabs idPrefix="ai-inbox-workspace" label="Secciones de Bandeja IA" value={activeTab} onChange={onTabChange||(()=>{})} items={[{value:'entries',icon:'mail',label:<>Entradas {data&&<span className="ai-inbox-counter">{data.counts?.reduce((sum,item)=>sum+item.count,0)||0}</span>}</>},{value:'documents',icon:'invoice',label:<>Documentos {documentCount>0&&<span className="ai-inbox-counter">{documentCount}</span>}</>},{value:'history',icon:'clock',label:<>Historial {historyCount>0&&<span className="ai-inbox-counter">{historyCount}</span>}</>}]}/>{onConfigure&&<Button onClick={onConfigure}><Icon name="settings" size={16}/>Configuración</Button>}</div>
  {error&&<p className="ai-inbox-error" role="alert">{error}</p>}
  <div id="ai-inbox-workspace-panel" role="tabpanel" aria-labelledby={`ai-inbox-workspace-${activeTab}`} className="ai-inbox-panel">
   {activeTab==='documents'?documentAnalyzer:activeTab==='history'?history:<>
    <div className="ai-inbox-toolbar"><Select label="Estado" value={state} onChange={e=>{setState(e.target.value);setPage(1);setMobileDetail(false);}}><option value="">Todos los estados</option>{Object.entries(labels).map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select><Select label="Periodo de las entradas cargadas" value={period} onChange={e=>setPeriod(e.target.value)}><option value="">Todos los periodos</option><option value="7">Últimos 7 días</option><option value="30">Últimos 30 días</option></Select><Button onClick={()=>setReload(v=>v+1)}><Icon name="refresh" size={16}/>Actualizar bandeja</Button><SearchInput label="Buscar por remitente, asunto o cliente" placeholder="Buscar por remitente, asunto o cliente…" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="ai-inbox-split"><aside className="ai-inbox-list" aria-label="Lista de entradas"><header><strong>Entradas pendientes y revisadas ({visible.length})</strong><p>Selecciona un correo para ver el análisis de la IA.</p></header><div className="ai-inbox-list-scroll">
     {!data&&!error&&<p role="status">Cargando entradas…</p>}{data&&visible.length===0&&<EmptyState title="No hay entradas con estos filtros"/>}
     {visible.map(item=>{const isMail=!!item.email_from||item.attachments?.some(file=>file.mediaType==='message/rfc822'),sender=item.email_from||item.result?.pedido?.cliente_nombre||'Documento',route=[item.result?.pedido?.origen,item.result?.pedido?.destino].filter(Boolean).join(' → ');return <button className={`ai-inbox-item ${selectedId===item.id?'selected':''}`} type="button" key={item.id} aria-label={`Abrir ${item.email_subject||item.filename||'Texto de pedido'}`} aria-pressed={selectedId===item.id} onClick={()=>{setSelectedId(item.id);setMobileDetail(true);}}><span className={`ai-inbox-state-dot ${item.state}`}/><span className="ai-inbox-avatar"><Icon name={isMail?'mail':'invoice'} size={19}/></span><span className="ai-inbox-item-copy"><span className="ai-inbox-item-top"><strong title={sender}>{sender}</strong><time>{date(item.created_at)}</time></span><strong className="ai-inbox-item-subject">{item.email_subject||item.filename||'Texto de pedido'}</strong><small>{route||item.result?.pedido?.mercancia||item.error||item.filename||'Pendiente de análisis'}</small><span className="ai-inbox-item-badges"><Badge>{isMail?'Correo':'Documento'}</Badge><Badge tone={tones[item.state]||'neutral'}>{labels[item.state]}</Badge>{item.attachments?.length>0&&<small><Icon name="attachment" size={12}/>{item.attachments.length}</small>}</span></span></button>;})}
    </div>{data&&<footer className="ai-inbox-pagination"><Button aria-label="Página anterior de entradas" disabled={page===1} onClick={()=>setPage(p=>p-1)}>‹</Button><span>Página {page} de {Math.max(1,Math.ceil(total/25))}</span><Button aria-label="Página siguiente de entradas" disabled={page*25>=total} onClick={()=>setPage(p=>p+1)}>›</Button></footer>}<small className="ai-inbox-page-note">Búsqueda y periodo sobre las entradas de esta página.</small></aside>
    <section className="ai-inbox-detail" aria-label="Detalle de entrada"><Button className="ai-inbox-back" onClick={()=>setMobileDetail(false)}>← Volver a entradas</Button>{selected?<>
     <header className="ai-inbox-detail-heading"><span className="ai-inbox-icon"><Icon name="invoice" size={24}/></span><div><h3>{selected.email_subject||selected.filename||'Pedido'} · {labels[selected.state]}</h3><p>{date(selected.created_at)}</p></div>{selected.attachments?.[0]&&<Badge>Original: {selected.attachments[0].name}</Badge>}</header><div className="ai-inbox-entry-actions">{actions(selected)}</div>
     {selected.error&&<p role="alert">{selected.error}</p>}{selected.processing_at&&<p role="status">Análisis en curso…</p>}
     <Tabs idPrefix="ai-inbox-detail" label="Detalle del correo" value={detailTab} onChange={setDetailTab} items={[{value:'summary',label:'Resumen IA',icon:'invoice'},{value:'original',label:'Contenido original',icon:'mail'},{value:'attachments',label:`Archivos adjuntos (${selected.attachments?.length||0})`,icon:'attachment'}]}/>
     <div id="ai-inbox-detail-panel" role="tabpanel" aria-labelledby={`ai-inbox-detail-${detailTab}`} className="ai-inbox-detail-scroll">{detailTab==='original'?originalContent:detailTab==='attachments'?attachments:selectedPreview?<><OrderAiReview preview={selectedPreview} onEdit={onCreate&&['revisar','listo'].includes(selected.state)?()=>onCreate(selectedPreview):undefined}/>{original&&<details className="ai-inbox-disclosure ai-inbox-mail-text" open><summary>Texto del correo</summary><pre>{original.body}</pre></details>}</>:<EmptyState title="Esta entrada está pendiente de análisis" text="Analiza la entrada para revisar los datos detectados y preparar el pedido."/>}</div>
    </>:<EmptyState title="Selecciona una entrada" text={data?.inbound?.guidance||'Los correos se revisan antes de crear el pedido.'}/>}</section></div>
   </>}
  </div>
 </div>;
}

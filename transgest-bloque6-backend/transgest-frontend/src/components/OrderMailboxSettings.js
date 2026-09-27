import {useEffect,useState} from 'react';
import {Card,Button} from '../ui';
import {getOrderMailbox,saveOrderMailbox,testOrderMailbox,syncOrderMailbox} from '../services/api';
import './OrderMailboxSettings.css';
const stateLabels={pendiente_configuracion:'Pendiente de configurar',pendiente_prueba:'Pendiente de probar',activo:'Recepción activada',desactivado:'Recepción desactivada',error:'Requiere revisión'};
export default function OrderMailboxSettings(){
 const [config,setConfig]=useState(null),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),[revision,setRevision]=useState(0),[dirty,setDirty]=useState(false);
 useEffect(()=>{let active=true;getOrderMailbox().then(data=>{if(active){setConfig(data);setDraft(data);setError('');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[revision]);
 const change=key=>e=>{setDraft(d=>({...d,[key]:e.target.value}));setDirty(true);setMessage('');};
 async function act(action){
  setBusy(true);setError('');setMessage('');
  try{
   let data;
   if(action==='save'){data=await saveOrderMailbox({...draft,enabled:dirty?false:config.enabled});setMessage('Datos guardados. Prueba la recepción antes de activarla.');}
   if(action==='test'){const result=await testOrderMailbox();data=result.config;setMessage(result.message);}
   if(action==='toggle'){data=await saveOrderMailbox({...config,enabled:!config.enabled});setMessage(data.enabled?'Recepción activada: comprobación cada cinco minutos.':'Recepción desactivada.');}
   if(action==='sync'){const result=await syncOrderMailbox();data=result.config;setMessage(`${result.received} entradas nuevas recogidas. Revísalas en Pedidos → Bandeja IA.`);window.dispatchEvent(new Event('tms:inbox-changed'));}
   setConfig(data);setDraft({...data,password:''});setDirty(false);
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Card className="order-mailbox-settings">
  <h3>Recepción de pedidos · Bandeja IA</h3>
  <p>SMTP sirve para enviar. Para recibir, conecta un buzón IMAP con TLS. Los mensajes se interpretan y revisan desde la bandeja; no crean viajes automáticamente.</p>
  {!draft&&!error&&<p role="status">Cargando configuración…</p>}
  {error&&<div role="alert"><p>{error}</p>{!draft&&<Button onClick={()=>setRevision(r=>r+1)}>Reintentar</Button>}</div>}
  {draft&&<>
   <p role="status"><strong>{stateLabels[config.state]||'Pendiente'}</strong>{config.missing?.length>0&&` · Faltan: ${config.missing.join(', ')}`}</p>
   {config.last_error&&<p role="alert">{config.last_error}</p>}
   <div className="order-mailbox-grid">
    <label>Correo de pedidos<input type="email" className="tgui-input" value={draft.email} onChange={change('email')} placeholder="pedidos@tuempresa.es" disabled={busy}/></label>
    <label>Proveedor<select className="tgui-select" value={draft.provider} onChange={change('provider')} disabled={busy}><option value="otro">Hosting / otro</option><option value="google">Google Workspace</option><option value="microsoft">Microsoft 365</option></select></label>
    <label>Servidor IMAP<input className="tgui-input" value={draft.host} onChange={change('host')} placeholder="imap.tuempresa.es" autoComplete="off" disabled={busy}/></label>
    <label>Puerto y seguridad<input className="tgui-input" value="993 · TLS obligatorio" readOnly/></label>
    <label>Usuario del buzón<input className="tgui-input" value={draft.username} onChange={change('username')} autoComplete="off" disabled={busy}/></label>
    <label>Contraseña de aplicación<input className="tgui-input" type="password" autoComplete="new-password" value={draft.password||''} onChange={change('password')} placeholder={config.has_password?'Guardada; deja vacío para conservar':'Pendiente de introducir'} disabled={busy}/></label>
    <label>Carpeta de recepción<input className="tgui-input" value={draft.folder} onChange={change('folder')} placeholder="INBOX" disabled={busy}/></label>
   </div>
   {['microsoft','google'].includes(draft.provider)&&<p>Esta conexión admite contraseña de aplicación solo si tu proveedor la permite. No incluye aún autorización OAuth de Microsoft o Google. Si tu administrador exige OAuth, deja la recepción desactivada y solicita la conexión del proveedor; puedes subir EML a la bandeja mientras tanto.</p>}
   <p>Utiliza una carpeta dedicada a pedidos. La primera prueba toma un punto de inicio: no importa correos anteriores. Después se leen mensajes nuevos sin borrarlos ni marcarlos como leídos. Cambiar los datos requiere volver a probar y activar.</p>
   <div className="order-mailbox-actions"><Button variant="primary" disabled={busy} onClick={()=>act('save')}>Guardar recepción</Button><Button disabled={busy||dirty||config.missing.length>0} onClick={()=>act('test')}>Probar recepción</Button><Button disabled={busy||dirty||(!config.enabled&&!config.verified_at)} onClick={()=>act('toggle')}>{config.enabled?'Desactivar recepción':'Activar recepción'}</Button><Button disabled={busy||dirty||!config.enabled} onClick={()=>act('sync')}>Recoger correos ahora</Button></div>
   {dirty&&<p>Hay cambios sin guardar. Guardarlos desactiva la recepción hasta que vuelvas a comprobarla.</p>}
   {busy&&<p role="status">Comprobando…</p>}{message&&<p role="status">{message}</p>}
   {config.last_sync_at&&<p>Última recogida: {new Date(config.last_sync_at).toLocaleString('es-ES')} · {config.last_received} entradas nuevas.</p>}
  </>}
 </Card>;
}

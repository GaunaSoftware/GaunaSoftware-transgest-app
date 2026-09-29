import React,{useEffect,useRef,useState} from 'react';
import {prepararFirmaOperacion,verArchivoProtegido} from '../../services/api';
import {getCurrentLocation} from '../../services/mobileRuntime';
import './OperationSignature.css';
const types=['daños','faltante','sobrante','embalaje','temperatura','retraso','rechazo parcial','rechazo total','documentación','otro'];
export default function OperationSignature({pedido,paradaId,correctionId,onFirma,onCancel,title='Firma de conformidad'}){
 const [summary,setSummary]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[identity,setIdentity]=useState({nombre:'',apellidos:'',empresa:''}),[reviewed,setReviewed]=useState(false),[accepted,setAccepted]=useState(false),[reservation,setReservation]=useState({tipo:'',descripcion:''});
 const canvas=useRef(null),drawing=useRef(false),last=useRef(null),ink=useRef(0),operationId=useRef(crypto.randomUUID());
 const dialogRef=useRef(null),actions=useRef({onCancel,busy});actions.current={onCancel,busy};
 useEffect(()=>{const prior=document.activeElement,dialog=dialogRef.current;dialog.querySelector('select')?.focus();
  const key=e=>{if(e.key==='Escape'&&!actions.current.busy){e.preventDefault();actions.current.onCancel();}if(e.key==='Tab'){const nodes=Array.from(dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select,textarea')).filter(n=>n.getClientRects().length);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  dialog.addEventListener('keydown',key);return()=>{dialog.removeEventListener('keydown',key);if(prior?.isConnected)prior.focus();};},[]);
 useEffect(()=>{let alive=true;setSummary(null);setReviewed(false);setAccepted(false);setError('');const timer=setTimeout(()=>prepararFirmaOperacion(pedido.id,{parada_id:paradaId,reserva:reservation,...(correctionId?{correccion_de:correctionId}:{})}).then(v=>{if(alive)setSummary(v);}).catch(e=>{if(alive)setError(e.message);}),250);return()=>{alive=false;clearTimeout(timer);};},[pedido.id,paradaId,reservation,correctionId]);
 function pos(e){const r=canvas.current.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.current.width/r.width,y:(e.clientY-r.top)*canvas.current.height/r.height};}
 function move(e){if(!drawing.current)return;e.preventDefault();const p=pos(e),ctx=canvas.current.getContext('2d');ctx.beginPath();ctx.lineWidth=2.5;ctx.lineCap='round';ctx.strokeStyle='#111';ctx.moveTo(last.current.x,last.current.y);ctx.lineTo(p.x,p.y);ctx.stroke();ink.current+=Math.hypot(p.x-last.current.x,p.y-last.current.y);last.current=p;}
 function clear(){canvas.current.getContext('2d').clearRect(0,0,600,240);ink.current=0;}
 async function confirm(){
  if(busy||!summary)return;
  if(Object.values(identity).some(v=>!v.trim())){setError('Indica nombre, apellidos y empresa del firmante.');return;}
  if(!reviewed||!accepted){setError('Revisa la información y acepta la vinculación de la firma a esta versión.');return;}
  if(ink.current<35){setError('Firma en el recuadro con un trazo legible.');return;}
  setBusy(true);setError('');
  try{let gps=null;try{gps=await getCurrentLocation({timeout:5000});}catch{}const evidence={operation_id:summary.id,document_hash:summary.pdf_hash,client_operation_uuid:operationId.current,identidad:identity,revisado:reviewed,conforme_version:accepted,gps,gps_status:gps?'available':'unavailable',timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,app_version:'tms-evidence-1'};await onFirma(canvas.current.toDataURL('image/png'),`${identity.nombre} ${identity.apellidos}`,evidence);}
  catch(e){setError(e.message||'No se pudo guardar la firma.');}finally{setBusy(false);}
 }
 const p=summary?.payload;
 return <div ref={dialogRef} className="driver-overlay operation-signature" role="dialog" aria-modal="true" aria-label={title} style={{position:'fixed',inset:0,zIndex:600,background:'rgba(0,0,0,.65)',display:'grid',placeItems:'center',padding:12}}><section style={{background:'var(--bg2)',color:'var(--text)',width:'min(560px,100%)',maxHeight:'92dvh',overflowY:'auto',borderRadius:14,padding:18,boxSizing:'border-box'}}>
  <h2>{title}</h2><p>Justificante de la operación, independiente del DeCA.</p>
  {p?.correccion_de&&<p role="note">Nueva firma sobre los datos conservados de la operación. No reabre el viaje ni modifica su mercancía o tiempos. Motivo: {p.correccion_motivo}</p>}
  <label>Reservas<select value={reservation.tipo} onChange={e=>setReservation({...reservation,tipo:e.target.value})}><option value="">Sin reservas aparentes</option>{types.map(t=><option key={t}>{t}</option>)}</select></label>
  {reservation.tipo&&<label>Descripción de la reserva<textarea maxLength={3000} value={reservation.descripcion} onChange={e=>setReservation({...reservation,descripcion:e.target.value})}/></label>}
  {!p&&!error&&<p role="status">Preparando el resumen que vas a firmar…</p>}
  {p&&<><dl><dt>Pedido / operación / lugar</dt><dd>{p.pedido_numero} · {p.operacion} · {p.lugar}</dd><dt>Viaje / envíos</dt><dd style={{overflowWrap:'anywhere'}}>{p.viaje_id?'Viaje operativo':'Servicio del pedido'} · {p.envios?.join(', ')||'Envío del pedido'}</dd><dt>Mercancía / peso / bultos</dt><dd>{p.mercancia} · {p.peso_kg} kg · {p.bultos}</dd><dt>Tractora / remolque / conductor</dt><dd>{p.vehiculo?.tractora||'No registrado'} / {p.vehiculo?.remolque||'No registrado'} · {p.conductor||'No registrado'}</dd><dt>Versión del justificante</dt><dd>{summary.version}</dd></dl><button type="button" onClick={()=>verArchivoProtegido(`/pedidos/${pedido.id}/firma/operaciones/${summary.id}/pdf`,'justificante-para-firma.pdf',{inlineNative:true}).catch(e=>setError(e.message))}>Ver documento que firmaré</button></>}
  <div style={{display:'grid',gap:10,marginTop:12}}>{[['nombre','Nombre'],['apellidos','Apellidos'],['empresa','Empresa']].map(([k,l])=><label key={k}>{l}<input required maxLength={200} autoComplete="off" value={identity[k]} onChange={e=>setIdentity({...identity,[k]:e.target.value})} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label>)}</div>
  {p&&<p>{p.declaracion}</p>}
  <label style={{display:'flex',gap:8,marginBlock:10}}><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>He revisado la información y es correcta.</label>
  <label style={{display:'flex',gap:8,marginBlock:10}}><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/>Entiendo que mi firma quedará asociada a esta operación y versión.</label>
  <canvas ref={canvas} width={600} height={240} aria-label="Recuadro de firma" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);drawing.current=true;last.current=pos(e);}} onPointerMove={move} onPointerUp={()=>{drawing.current=false;}} onPointerCancel={()=>{drawing.current=false;}} style={{width:'100%',height:130,background:'#fff',border:'2px solid var(--border)',borderRadius:8,touchAction:'none',boxSizing:'border-box'}}/>
  {error&&<p role="alert">{error}</p>}
  <div className="operation-signature-actions" style={{position:'sticky',bottom:-18,background:'var(--bg2)',display:'flex',flexWrap:'wrap',gap:8,paddingBlock:12}}><button type="button" disabled={busy} onClick={clear}>Limpiar</button><button type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="operation-signature-confirm" type="button" disabled={busy||!summary} onClick={confirm}>{busy?'Guardando…':'Confirmar firma'}</button></div>
 </section></div>;
}

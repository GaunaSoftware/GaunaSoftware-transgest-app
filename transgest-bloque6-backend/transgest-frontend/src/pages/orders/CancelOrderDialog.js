import {useState} from 'react';
import {Modal,Button} from '../../ui';
const reasons=['Solicitud del cliente','Cambio de fecha o planificación','Mercancía no disponible','Falta de vehículo o conductor','Pedido duplicado','Otro'];
export default function CancelOrderDialog({pedido,onClose,onConfirm}){
 const [reason,setReason]=useState(''),[detail,setDetail]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function submit(){
  if(!reason||(reason==='Otro'&&!detail.trim())){setError('Selecciona un motivo y describe la causa si eliges Otro.');return;}
  setBusy(true);setError('');
  try{const ok=await onConfirm(reason==='Otro'?detail.trim():`${reason}${detail.trim()?`: ${detail.trim()}`:''}`);if(ok!==false)onClose();else setError('No se ha cancelado el pedido. Revisa el aviso e inténtalo de nuevo.');}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <Modal title={`Cancelar pedido ${pedido.numero||''}`} onClose={()=>!busy&&onClose()} footer={<><Button disabled={busy} onClick={onClose}>Volver</Button><Button variant="primary" disabled={busy} onClick={submit}>{busy?'Guardando…':'Confirmar cancelación'}</Button></>}>
  <div className="order-action-form"><p>El motivo quedará registrado en el pedido.</p><label>Motivo<select autoFocus className="tgui-select" value={reason} onChange={e=>setReason(e.target.value)}><option value="">Selecciona un motivo</option>{reasons.map(r=><option key={r}>{r}</option>)}</select></label><label>{reason==='Otro'?'Describe el motivo':'Detalles (opcional)'}<textarea className="tgui-input" value={detail} onChange={e=>setDetail(e.target.value)} rows={4} maxLength={1500}/></label>{error&&<p role="alert">{error}</p>}</div>
 </Modal>;
}

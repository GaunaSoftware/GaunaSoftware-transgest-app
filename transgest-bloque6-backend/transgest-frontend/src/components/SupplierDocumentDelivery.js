import {useEffect,useState,useCallback} from 'react';
import {getSupplierDocumentDeliveries,retrySupplierDocumentDelivery} from '../services/api';
const labels={pending:'Pendiente de envío',processing:'Enviando',sent:'Correo enviado',failed:'Pendiente de reintento',obsolete:'Envío anterior descartado'};
export default function SupplierDocumentDelivery({pedidoId}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const load=useCallback(()=>getSupplierDocumentDeliveries(pedidoId).then(data=>{setRows(data);setError('');}).catch(e=>setError(e.message)),[pedidoId]);
  useEffect(()=>{load();const timer=setInterval(load,30000);return()=>clearInterval(timer);},[load]);
  return <details className="deca-versions-extra"><summary>Correos de DeCA al colaborador</summary><p>Se remiten al completar la confirmación de carga y disponer de los originales de todos los envíos. Un fallo de correo no borra el documento.</p>{error&&<p role="alert">{error}</p>}{!rows.length&&<p>Aún no hay un envío preparado para este pedido.</p>}{rows.map(row=><div key={row.id} style={{margin:'10px 0'}}><strong>{labels[row.status]}</strong> · {new Date(row.sent_at||row.created_at).toLocaleString('es-ES')}{row.last_error&&<p>{row.last_error}</p>}{row.status==='failed'&&<button type="button" disabled={!!busy} onClick={async()=>{setBusy(row.id);setError('');try{await retrySupplierDocumentDelivery(pedidoId,row.id);await load();}catch(e){setError(e.message);}finally{setBusy('');}}}>Reintentar correo</button>}</div>)}</details>;
}

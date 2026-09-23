import {useState} from 'react';
import {fiscalFlowRequest} from '../services/api';
import './fiscalFlow.css';

export default function InvoiceFiscalData({invoice,onSaved}) {
 const [value,setValue]=useState(invoice.fiscal_metadata || {});
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const set=(key,v)=>setValue(old=>({...old,[key]:v}));
 const rect=(key,v)=>setValue(old=>({...old,rectificacion:{...old.rectificacion,[key]:v}}));
 if(invoice.estado!=='borrador' || invoice.fiscal)return null;
 return <details className="fiscal-flow" data-internal-ui="true">
  <summary>Datos fiscales: exención, no sujeción o rectificación</summary>
  <p>Selecciona la causa que corresponde a la operación. Guarda estos datos antes de registrar la revisión de la factura.</p>
  <div className="fiscal-flow-grid">
   <label>Causa de exención<select value={value.operacion_exenta || ''} onChange={e=>{set('operacion_exenta',e.target.value);set('calificacion_operacion','');}}><option value="">No exenta</option>{['E1','E2','E3','E4','E5','E6'].map(c=><option key={c}>{c}</option>)}</select></label>
   <label>Calificación de la operación<select value={value.calificacion_operacion || ''} onChange={e=>{set('calificacion_operacion',e.target.value);set('operacion_exenta','');}}><option value="">Sujeta, sin inversión (S1)</option><option value="S2">Inversión del sujeto pasivo (S2)</option><option value="N1">No sujeta: artículos 7, 14 y otros (N1)</option><option value="N2">No sujeta por localización (N2)</option></select></label>
   {invoice.factura_original_id && <>
    <label>Tipo de rectificación<select value={value.rectificacion?.tipo_factura || ''} onChange={e=>rect('tipo_factura',e.target.value)}><option value="">Seleccionar causa fiscal</option>{['R1','R2','R3','R4','R5'].map(c=><option key={c}>{c}</option>)}</select></label>
    <label>Método<select value={value.rectificacion?.tipo_rectificativa || ''} onChange={e=>rect('tipo_rectificativa',e.target.value)}><option value="">Seleccionar</option><option value="I">Por diferencias</option><option value="S">Por sustitución</option></select></label>
    {value.rectificacion?.tipo_rectificativa==='S' && [['base_rectificada','Base sustituida'],['cuota_rectificada','Cuota sustituida'],['cuota_recargo_rectificada','Recargo sustituido']].map(([key,label])=><label key={key}>{label}<input type="number" step="0.01" value={value.rectificacion?.[key] ?? ''} onChange={e=>rect(key,e.target.value)}/></label>)}
   </>}
  </div>
  <button type="button" disabled={busy} onClick={async()=>{setBusy(true);setMessage('');try{await fiscalFlowRequest(`/${invoice.id}/fiscal/datos`,{method:'PUT',body:value});setMessage('Datos guardados. Registra de nuevo la revisión.');onSaved?.();}catch(e){setMessage(e.message);}finally{setBusy(false);}}}>{busy?'Guardando…':'Guardar datos fiscales'}</button>
  {message && <p role="status">{message}</p>}
 </details>;
}

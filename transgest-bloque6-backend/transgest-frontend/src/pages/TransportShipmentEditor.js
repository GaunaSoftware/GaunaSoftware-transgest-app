import {useState} from 'react';
import {declararEnviosPedido} from '../services/api';

const empty=()=>({origen_id:'',destino_id:'',referencia:'',destinatario:'',mercancia:'',peso_kg:'',bultos:'',embalaje:''});
const stops=value=>{try{const parsed=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(parsed)?parsed:[];}catch{return [];}};
const weight=value=>{if(value==null||value==='')return '';const raw=String(value).trim();const number=Number(raw.replace(',','.'));return Number.isFinite(number)&&number>0?((raw.includes(',')||raw.includes('.'))&&number<1000?number*1000:number):'';};
export function initialShipmentRows(pedido={},points=[]){
 const loads=points.filter(point=>point.tipo==='carga'),unloads=points.filter(point=>point.tipo==='descarga');
 const deliveries=stops(pedido.puntos_descarga);
 return (unloads.length?unloads:[null]).map((point,index)=>({
  ...empty(),origen_id:loads.length===1?loads[0].id:'',destino_id:point?.id||'',
  destinatario:String(deliveries[index]?.cliente_nombre||'').trim(),
  mercancia:String(deliveries[index]?.mercancia||pedido.mercancia||pedido.descripcion_carga||'').trim(),
  peso_kg:weight(deliveries[index]?.peso_kg||(unloads.length===1?pedido.peso_kg:'')),
  bultos:deliveries[index]?.bultos||(unloads.length===1?pedido.bultos:'')||'',
 }));
}
export default function TransportShipmentEditor({pedidoId,pedido,points,onChange}){
 const [rows,setRows]=useState(()=>initialShipmentRows(pedido,points)),[busy,setBusy]=useState(false),[error,setError]=useState(''),[operationId]=useState(()=>crypto.randomUUID());
 const change=(index,key,value)=>setRows(previous=>previous.map((row,i)=>i===index?{...row,[key]:value}:row));
 async function save(){setBusy(true);setError('');try{onChange(await declararEnviosPedido(pedidoId,{envios:rows,client_operation_uuid:operationId}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <details open style={{marginBlock:12}}><summary>Identificar origen, destino y mercancía de cada envío</summary>
  <p>Relaciona cada mercancía con su carga y descarga. Hemos precargado los datos generales que se pueden atribuir con seguridad; confirma el peso de cada descarga. El destinatario puede añadirse si se conoce. El orden de esta lista identifica envíos; no cambia el itinerario. Una vez emitidos los documentos se conserva esta estructura.</p>
  {rows.map((row,index)=><fieldset disabled={busy} key={index} style={{border:'1px solid var(--border)',borderRadius:8,marginBlock:10,padding:12,minWidth:0}}><legend>Envío {index+1}</legend>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}}>
    {[['origen_id','Punto de carga','carga'],['destino_id','Punto de descarga','descarga']].map(([key,label,type])=><label key={key}>{label}<select value={row[key]} onChange={e=>change(index,key,e.target.value)} style={{display:'block',width:'100%'}}><option value="">Selecciona un punto</option>{points.filter(p=>p.tipo===type).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>)}
    {[['referencia','Referencia del envío'],['destinatario','Razón social del destinatario (opcional)'],['mercancia','Naturaleza de la mercancía'],['embalaje','Embalaje'],['peso_kg','Peso (kg)'],['bultos','Bultos / unidades']].map(([key,label])=><label key={key}>{label}<input type={['peso_kg','bultos'].includes(key)?'number':'text'} min="0" step="any" maxLength={key==='mercancia'?500:200} value={row[key]} onChange={e=>change(index,key,e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label>)}
   </div><button type="button" disabled={rows.length===1} onClick={()=>setRows(previous=>previous.filter((_,i)=>i!==index))}>Quitar envío</button>
  </fieldset>)}
  {error&&<p role="alert">{error}</p>}<div style={{display:'flex',flexWrap:'wrap',gap:8}}><button disabled={busy||rows.length>=100} onClick={()=>setRows(previous=>[...previous,empty()])}>Añadir envío</button><button disabled={busy} onClick={save}>{busy?'Guardando…':'Confirmar envíos del pedido'}</button></div>
 </details>;
}

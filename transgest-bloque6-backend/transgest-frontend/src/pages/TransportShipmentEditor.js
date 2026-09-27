import {useState} from 'react';
import {declararEnviosPedido} from '../services/api';

const empty=()=>({origen_id:'',destino_id:'',referencia:'',destinatario:'',mercancia:'',peso_kg:'',bultos:'',embalaje:''});
export default function TransportShipmentEditor({pedidoId,points,onChange}){
 const [rows,setRows]=useState([empty()]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[operationId]=useState(()=>crypto.randomUUID());
 const change=(index,key,value)=>setRows(previous=>previous.map((row,i)=>i===index?{...row,[key]:value}:row));
 async function save(){setBusy(true);setError('');try{onChange(await declararEnviosPedido(pedidoId,{envios:rows,client_operation_uuid:operationId}));}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <details style={{marginBlock:12}}><summary>Identificar mercancía y destinatario de cada envío</summary>
  <p>Relaciona cada mercancía con su carga y descarga. El orden de esta lista identifica envíos; no cambia el itinerario. Una vez emitidos los documentos se conserva esta estructura.</p>
  {rows.map((row,index)=><fieldset disabled={busy} key={index} style={{border:'1px solid var(--border)',borderRadius:8,marginBlock:10,padding:12,minWidth:0}}><legend>Envío {index+1}</legend>
   <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,220px),1fr))',gap:12}}>
    {[['origen_id','Punto de carga','carga'],['destino_id','Punto de descarga','descarga']].map(([key,label,type])=><label key={key}>{label}<select value={row[key]} onChange={e=>change(index,key,e.target.value)} style={{display:'block',width:'100%'}}><option value="">Selecciona un punto</option>{points.filter(p=>p.tipo===type).map(p=><option key={p.id} value={p.id}>{p.label}</option>)}</select></label>)}
    {[['referencia','Referencia del envío'],['destinatario','Razón social del destinatario'],['mercancia','Naturaleza de la mercancía'],['embalaje','Embalaje'],['peso_kg','Peso (kg)'],['bultos','Bultos / unidades']].map(([key,label])=><label key={key}>{label}<input type={['peso_kg','bultos'].includes(key)?'number':'text'} min="0" step="any" maxLength={key==='mercancia'?500:200} value={row[key]} onChange={e=>change(index,key,e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box'}}/></label>)}
   </div><button type="button" disabled={rows.length===1} onClick={()=>setRows(previous=>previous.filter((_,i)=>i!==index))}>Quitar envío</button>
  </fieldset>)}
  {error&&<p role="alert">{error}</p>}<div style={{display:'flex',flexWrap:'wrap',gap:8}}><button disabled={busy||rows.length>=100} onClick={()=>setRows(previous=>[...previous,empty()])}>Añadir envío</button><button disabled={busy} onClick={save}>{busy?'Guardando…':'Confirmar envíos del pedido'}</button></div>
 </details>;
}

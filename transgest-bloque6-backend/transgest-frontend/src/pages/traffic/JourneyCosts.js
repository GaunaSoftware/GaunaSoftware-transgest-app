import {useEffect,useState} from 'react';
import {getGroupageCosts,recordGroupageCost} from '../../services/api';
import {madridDay} from '../../utils/trafficWeek';
export default function JourneyCosts({groupId,canEdit}){
 const [rows,setRows]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[revision,setRevision]=useState(0);
 const [form,setForm]=useState({concepto:'',referencia:'',importe_neto:'',fecha:madridDay(new Date())});
 useEffect(()=>{let alive=true;setLoading(true);getGroupageCosts(groupId).then(result=>{if(alive){setRows(result.data);setError('');}}).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});return()=>{alive=false;};},[groupId,revision]);
 async function save(event){event.preventDefault();setBusy(true);try{await recordGroupageCost(groupId,form);setForm(old=>({...old,concepto:'',referencia:'',importe_neto:''}));setRevision(v=>v+1);}catch(e){setError(e.message);}finally{setBusy(false);}}
 return <details className="journey-costs"><summary>Costes del viaje</summary>
  <p>Importes netos en euros. Registra aquí solo justificantes que no estén ya imputados en pedidos, tickets o facturas. Pendientes de conciliación con BI.</p>
  {error&&<p role="alert">{error}<button type="button" onClick={()=>setRevision(v=>v+1)}>Volver a cargar</button></p>}
  {loading?<p role="status">Cargando costes…</p>:<ul>{rows.map(row=><li key={row.id}>{row.fecha?.slice(0,10)} · {row.concepto} · {row.referencia} · {Number(row.importe_neto).toLocaleString('es-ES',{style:'currency',currency:'EUR'})}{row.anulado_at?' · Anulado':''}</li>)}</ul>}
  {canEdit&&<form onSubmit={save}><label>Concepto<input required maxLength={300} value={form.concepto} onChange={e=>setForm({...form,concepto:e.target.value})}/></label><label>Referencia del justificante<input required maxLength={160} value={form.referencia} onChange={e=>setForm({...form,referencia:e.target.value})}/></label><label>Coste sin impuestos (€)<input type="number" min="0" step="0.01" required value={form.importe_neto} onChange={e=>setForm({...form,importe_neto:e.target.value})}/></label><label>Fecha<input type="date" required value={form.fecha} onChange={e=>setForm({...form,fecha:e.target.value})}/></label><button className="tgui-button" disabled={busy||loading}>{busy?'Guardando…':'Registrar coste'}</button></form>}
 </details>;
}

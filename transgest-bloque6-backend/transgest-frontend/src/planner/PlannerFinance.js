import {useCallback,useEffect,useState} from 'react';
import {plannerApi} from '../services/api';
import {useAuth} from '../context/AuthContext';
import {Button} from '../ui';
import {confirmDialog} from '../services/notify';
import {VistaFactura,ModalRectificativa} from '../pages/Facturacion';
import {PageHead,Panel,Metrics,money,Empty} from './PlannerUI';
export default function PlannerFinance(){
 const {puedeEditar}=useAuth(),canEdit=puedeEditar('facturacion');
 const [month,setMonth]=useState(new Date().toLocaleDateString('en-CA').slice(0,7)),[page,setPage]=useState(1),[data,setData]=useState(null),[rectify,setRectify]=useState(null),[detail,setDetail]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const load=useCallback(async()=>{const [y,m]=month.split('-').map(Number);setData(await plannerApi(`/facturas?${new URLSearchParams({desde:month+'-01',hasta:month+'-'+new Date(y,m,0).getDate(),page,limit:50})}`));},[month,page]);
 useEffect(()=>{load().catch(e=>setError(e.message));},[load]);
 async function inspect(id){setError('');try{setDetail(await plannerApi(`/facturas/${id}`));}catch(e){setError(e.message);}}
 async function change(id,estado){
  if(!await confirmDialog({title:estado==='emitida'?'Emitir factura de Planner':'Actualizar factura',message:`Se cambiará el estado a ${estado}.`,confirmText:'Confirmar'}))return;
  setBusy(true);setError('');try{await plannerApi(`/facturas/${id}/estado`,{method:'PATCH',body:{estado}});setDetail(null);await load();}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 return <section><PageHead icon="file" title="Facturación de Planner" description="Ventas de mercancía expedida y sus rectificaciones. Los servicios de transporte de TransGest pertenecen a su propio espacio."><input aria-label="Mes de facturación" type="month" value={month} onChange={e=>{if(e.target.value){setMonth(e.target.value);setPage(1);}}}/><Button onClick={()=>load().catch(e=>setError(e.message))}>Actualizar</Button></PageHead>
  {error&&<p role="alert">{error}</p>}
  <Metrics items={[{label:'Facturas de Planner',value:data?.pagination?.total||0,icon:'file'},{label:'Base emitida del periodo',value:money(data?.resumen?.base_emitida||0),icon:'box'},{label:'Cobrado',value:money(data?.resumen?.total_cobrado||0),icon:'check'}]}/>
  <Panel title="Facturas de venta de mercancía" icon="file"><p>Para crear un borrador, abre una preparación expedida en «Almacén y stock» y pulsa «Crear factura de venta».</p><div className="planner-table"><table><thead><tr>{['Factura','Cliente','Fecha','Vencimiento','Base','Total','Estado','Acciones'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{(data?.data||[]).map(f=><tr key={f.id}><td>{f.numero}</td><td>{f.cliente_nombre}</td><td>{String(f.fecha||'').slice(0,10)}</td><td>{String(f.fecha_vencimiento||'').slice(0,10)}</td><td>{money(f.base_imponible)}</td><td>{money(f.total)}</td><td>{f.estado}</td><td><Button disabled={busy} onClick={()=>inspect(f.id)}>Ver / revisar</Button></td></tr>)}</tbody></table></div>{!data?.data?.length&&<Empty>No hay facturas de Planner en este periodo.</Empty>}<div className="pl-action-row"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</Button><span>Página {page}</span><Button disabled={!data?.pagination?.hasNext} onClick={()=>setPage(p=>p+1)}>Siguiente</Button></div></Panel>
  {detail&&<VistaFactura key={detail.id} factura={detail} onClose={()=>setDetail(null)} registerReview={(id,body)=>plannerApi(`/facturas/${id}/revision`,{method:'POST',body})} onCambiarEstado={canEdit&&!busy?change:null} onRectificar={canEdit?f=>{setDetail(null);setRectify(f);}:null}/>}
 {rectify&&<ModalRectificativa facturaOriginal={rectify} onClose={()=>setRectify(null)} create={body=>plannerApi('/facturas',{method:'POST',body})} onSaved={()=>{setRectify(null);load().catch(e=>setError(e.message));}}/>}
 </section>;
}

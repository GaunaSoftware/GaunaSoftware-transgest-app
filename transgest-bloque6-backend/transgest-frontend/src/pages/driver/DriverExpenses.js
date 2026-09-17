import { useEffect, useState } from 'react';
import { createDriverExpense, getDriverExpenses, getDriverLocations, verArchivoProtegido } from '../../services/api';
import DocumentScanner from './DocumentScanner';
import { prepararArchivoEscaner } from './documentScan';
import { DriverHeading } from './DriverUI';

const newForm=()=>({solicitud_id:crypto.randomUUID(),tipo:'gasoil',fecha:new Date().toLocaleDateString('en-CA'),poblacion:'',provincia:'',litros:'',importe:'',en_base:false,notas:''});
export default function DriverExpenses({jornadaInfo}) {
 const [form,setForm]=useState(newForm),[rows,setRows]=useState([]),[locations,setLocations]=useState([]),[ticket,setTicket]=useState(null),[scanner,setScanner]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState('');
 const vehicle=jornadaInfo?.chofer;
 const load=()=>getDriverExpenses().then(setRows).catch(e=>setError(e.message));
 useEffect(()=>{load();getDriverLocations().then(setLocations).catch(e=>setError(e.message));},[]);
 const set=(k,v)=>setForm(f=>({...f,[k]:v}));
 const scanned=doc=>{setTicket({...doc,nombre:'ticket.jpg'});setScanner(false);};
 async function choose(e){const file=e.target.files?.[0];if(!file)return;setBusy(true);setError('');try{setTicket({...await prepararArchivoEscaner(file),nombre:file.type.startsWith('image/')?'ticket.jpg':file.name});}catch(err){setError(err.message);}finally{setBusy(false);e.target.value='';}}
 async function save(e){e.preventDefault();setBusy(true);setError('');setSuccess('');try{await createDriverExpense({...form,vehiculo_id:vehicle?.vehiculo_id,ticket:ticket?{nombre:ticket.nombre,mime:ticket.mime,base64:ticket.base64}:null});setForm(newForm());setTicket(null);setSuccess('Gasto guardado y vinculado a la hoja de ruta del camión.');await load();}catch(err){setError(err.message);}finally{setBusy(false);}}
 return <div className="driver-section-shell"><section className="driver-card"><DriverHeading icon="repostajes" title="Repostajes y dietas">Camión: {vehicle?.vehiculo_matricula||'Selecciona tu conjunto'}</DriverHeading>
 <form className="driver-expense-form" onSubmit={save}>
 <label>Tipo<select aria-label="Tipo" value={form.tipo} onChange={e=>setForm(f=>({...f,tipo:e.target.value,en_base:false}))}><option value="gasoil">Gasoil / repostaje</option><option value="dieta">Dieta / manutención</option></select></label>
 <label>Fecha<input type="date" required value={form.fecha} onChange={e=>set('fecha',e.target.value)}/></label>
 <label>Ubicación habitual<select aria-label="Ubicación habitual" value="" onChange={e=>{const l=locations.find(x=>x.id===e.target.value);if(l)setForm(f=>({...f,poblacion:l.poblacion,provincia:l.provincia,en_base:f.tipo==='gasoil'&&l.es_base}));}}><option value="">Elegir base o ubicación</option>{locations.map(l=><option key={l.id} value={l.id}>{l.nombre} · {l.poblacion}</option>)}</select></label>
 <label>Población<input required value={form.poblacion} onChange={e=>set('poblacion',e.target.value)}/></label><label>Provincia<input required={!form.en_base} value={form.provincia} onChange={e=>set('provincia',e.target.value)}/></label>
 {form.tipo==='gasoil'&&<label>Repostaje<select aria-label="Repostaje" value={form.en_base?'base':'externo'} onChange={e=>set('en_base',e.target.value==='base')}><option value="externo">Fuera de la base</option><option value="base">En la base · completa la empresa</option></select></label>}
 {form.en_base?<p>La empresa completará los litros y el importe. Quedará pendiente de valorar.</p>:<>{form.tipo==='gasoil'&&<label>Litros<input inputMode="decimal" required value={form.litros} onChange={e=>set('litros',e.target.value)}/></label>}<label>Importe total (€)<input inputMode="decimal" required value={form.importe} onChange={e=>set('importe',e.target.value)}/></label></>}
 <label>Notas<textarea value={form.notas} onChange={e=>set('notas',e.target.value)}/></label>
 <button type="button" onClick={()=>setScanner(true)}>Escanear ticket</button><label>Adjuntar ticket<input type="file" accept="image/*,application/pdf" onChange={choose}/></label>
 {ticket&&<><p>{ticket.nombre} · {ticket.sizeKb} KB</p>{ticket.preview&&<img src={ticket.preview} alt="Ticket recortado" style={{maxWidth:'100%',maxHeight:240,objectFit:'contain'}}/>}<button type="button" onClick={()=>setTicket(null)}>Quitar ticket</button></>}
 {error&&<p role="alert">{error}</p>}{success&&<p role="status">{success}</p>}<button className="driver-save" disabled={busy||!vehicle?.vehiculo_id}>{busy?'Guardando…':'Guardar gasto'}</button></form>
 <div className="driver-expense-list"><h3>Mis registros</h3>{rows.map(r=><article key={r.id}><strong>{r.tipo==='gasoil'?'Repostaje':'Dieta'} · {String(r.fecha).slice(0,10)}</strong><p>{r.matricula} · {r.poblacion}, {r.provincia}</p><p>{r.estado==='pendiente_base'?'Base · pendiente de valorar':`${r.litros?`${r.litros} L · `:''}${Number(r.importe).toLocaleString('es-ES',{style:'currency',currency:'EUR'})}`}</p>{r.ticket_nombre&&<button onClick={()=>verArchivoProtegido(`/choferes/app/gastos/${r.id}/ticket`,r.ticket_nombre).catch(e=>setError(e.message))}>Ver ticket</button>}</article>)}</div>
 </section>{scanner&&<DocumentScanner onClose={()=>setScanner(false)} onCapture={scanned}/>}</div>;
}

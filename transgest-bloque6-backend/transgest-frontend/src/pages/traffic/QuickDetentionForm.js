import { useRef, useState } from 'react';
import { calculateDetention, prepareDetentionPrefactura } from '../../services/api';
import { Button } from '../../ui';
const eur = n => new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n);

const localTime = value => { if(!value)return ''; const date=new Date(value); return Number.isNaN(date.getTime())?'':new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16); };
export default function QuickDetentionForm({ pedidoId, initial, onCreated, onCancel }) {
  const [form,setForm]=useState({inicio:localTime(initial?.inicio),fin:localTime(initial?.fin),tipo:'carga',motivo:'',importe_pactado:'',acuerdo:'',no_imputable:false});
  const [quote,setQuote]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const operation=useRef(null);
  const update=(key,value)=>{setForm(f=>({...f,[key]:value}));setQuote(null);operation.current=null;};
  const payload=()=>({...form,inicio:new Date(form.inicio).toISOString(),fin:new Date(form.fin).toISOString()});
  async function calculate(e){e.preventDefault();setBusy(true);setError('');try{setQuote(await calculateDetention(pedidoId,payload()));}catch(e){setError(e.message);}finally{setBusy(false);}}
  async function prepare(){setBusy(true);setError('');try{operation.current||=crypto.randomUUID();const row=await prepareDetentionPrefactura(pedidoId,{...payload(),operacion:operation.current});onCreated(row);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return <form onSubmit={calculate} className="journey-replanning-fields" aria-label="Prefactura rápida de paralización">
    <p className="journey-full">Indica cuándo se puso el vehículo a disposición según lo pactado y cuándo terminó la carga o descarga. Las horas usan la zona de este dispositivo. El cálculo se conserva con la prefactura.</p>
    {initial?.parada_label&&<p className="journey-full"><strong>Punto de carga:</strong> {initial.parada_label}</p>}
    {error&&<p className="journey-full" role="alert">{error}</p>}
    <label>Operación<select disabled={busy} value={form.tipo} onChange={e=>update('tipo',e.target.value)}><option value="carga">Carga</option><option value="descarga">Descarga</option></select></label>
    <label>Motivo de la paralización<input required maxLength={1000} disabled={busy} value={form.motivo} onChange={e=>update('motivo',e.target.value)}/></label>
    <label>Puesta a disposición pactada<input required type="datetime-local" disabled={busy} value={form.inicio} onChange={e=>update('inicio',e.target.value)}/></label>
    <label>Fin real de carga o descarga<input required type="datetime-local" disabled={busy} value={form.fin} onChange={e=>update('fin',e.target.value)}/></label>
    <label>Importe superior pactado (opcional, sin IVA)<input type="number" min="0" step="0.01" disabled={busy} value={form.importe_pactado} onChange={e=>update('importe_pactado',e.target.value)}/></label>
    <label>Acuerdo con el cliente<input required={form.importe_pactado!==''} maxLength={1000} disabled={busy} value={form.acuerdo} placeholder="Referencia legal si no hay pacto superior" onChange={e=>update('acuerdo',e.target.value)}/></label>
    <label className="journey-full"><span><input required type="checkbox" disabled={busy} checked={form.no_imputable} onChange={e=>update('no_imputable',e.target.checked)}/> La causa no es imputable al porteador; se aplica la normativa de transporte nacional en España.</span></label>
    <Button type="submit" disabled={busy}>Calcular paralización</Button>
    {quote&&<section className="journey-full" aria-label="Resultado del cálculo"><h3>{eur(quote.importe)} sin IVA</h3>
      <p>{quote.criterio}</p><div className="journey-table-scroll"><table><thead><tr><th>Día</th><th>Horas facturables</th><th>Tarifa</th><th>Importe</th></tr></thead><tbody>{quote.filas.map(r=><tr key={r.dia}><td>{r.dia}</td><td>{r.horas}</td><td>{eur(r.tarifa_hora)}/h</td><td>{eur(r.importe)}</td></tr>)}</tbody></table></div>
      <p>Prefactura sin validez fiscal. Queda pendiente de documentar y aceptar; no modifica el precio del transporte, los cobros ni las facturas existentes.</p>
      <Button type="button" disabled={busy||quote.importe<=0} onClick={prepare}>Crear prefactura sin IVA</Button>
    </section>}
    <Button type="button" disabled={busy} onClick={onCancel}>Volver</Button>
  </form>;
}

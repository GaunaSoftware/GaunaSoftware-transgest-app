import React, { useEffect, useState } from 'react';
import { Button, EmptyState } from '../ui';
import { getPolizasEmpresa, guardarPolizaEmpresa } from '../services/api';
import useRuntimeFocus from '../hooks/useRuntimeFocus';

const empty = { aseguradora:'', cobertura:'', numero_poliza:'', matricula_referencia:'', fecha_vencimiento:'', periodicidad:'', importe_referencia:'', correduria:'', notas:'', activo:true };
const dateKey = value => value ? String(value).slice(0,10) : '';

export default function CompanyInsurance({ canEdit, onSaved }) {
  const focus = useRuntimeFocus('tms_seguros_focus');
  const [rows,setRows] = useState(null), [form,setForm] = useState(null), [id,setId] = useState(null);
  const [error,setError] = useState(''), [busy,setBusy] = useState(false), [message,setMessage] = useState('');
  const load = () => getPolizasEmpresa().then(setRows).catch(e=>setError(e.message || 'No se pudieron consultar las pólizas.'));
  useEffect(()=>{ load(); },[]);
  useEffect(()=>{
    if (!focus?.poliza_id || !rows) return;
    const row = rows.find(item=>item.id===focus.poliza_id);
    if (row) {
      setId(row.id);
      setForm({ ...row, fecha_vencimiento:dateKey(row.fecha_vencimiento), importe_referencia:row.importe_referencia ?? '' });
      document.getElementById('polizas-empresa-form')?.scrollIntoView({block:'nearest'});
    }
  },[focus,rows]);
  const edit = row => { setId(row.id); setForm({ ...row, fecha_vencimiento:dateKey(row.fecha_vencimiento), importe_referencia:row.importe_referencia ?? '' }); setMessage(''); };
  async function save(event) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('');
    try {
      await guardarPolizaEmpresa(form,id);
      await load(); onSaved?.(); setForm(null); setId(null); setMessage('Póliza guardada.');
    } catch(e) { setError(e.message || 'No se pudo guardar la póliza.'); }
    finally { setBusy(false); }
  }
  const field = (key,label,type='text',required=false) => <label key={key}>{label}<input type={type} required={required} min={type==='number'?'0':undefined} step={type==='number'?'0.01':undefined} value={form?.[key] ?? ''} onChange={e=>setForm(v=>({ ...v,[key]:e.target.value }))}/></label>;
  return <section className="insurance-panel" aria-label="Pólizas de empresa">
    <div className="insurance-panel-heading"><div><h2>Seguros de empresa</h2><p>Registra pólizas generales y, si una matrícula aún no consta en la flota, anótala como referencia. Evita registrar dos veces un seguro ya controlado en la ficha del vehículo.</p></div>{canEdit && <Button onClick={()=>{setId(null);setForm({...empty});setMessage('');}}>Añadir póliza</Button>}</div>
    {error && <p className="notices-error" role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {rows === null && !error && <p role="status">Consultando pólizas…</p>}
    {rows && !rows.length && <EmptyState title="Sin pólizas registradas" text="Añade los seguros generales para recibir avisos de renovación."/>}
    {!!rows?.length && <div className="insurance-list">{rows.map(row=><article key={row.id} className={`insurance-entry${focus?.poliza_id===row.id?' is-focused':''}`}>
      <div><strong>{row.cobertura}{row.matricula_referencia ? ` · ${row.matricula_referencia}` : ''}</strong><p>{row.aseguradora}{row.numero_poliza ? ` · Póliza ${row.numero_poliza}` : ''}</p>{!row.activo && <span>Inactiva</span>}</div>
      <div><span>Vencimiento</span><strong>{new Date(`${dateKey(row.fecha_vencimiento)}T12:00:00`).toLocaleDateString('es-ES')}</strong></div>
      {canEdit && <Button onClick={()=>edit(row)}>Editar</Button>}
    </article>)}</div>}
    {form && canEdit && <form id="polizas-empresa-form" className="insurance-form" onSubmit={save}>
      <h3>{id?'Editar póliza':'Nueva póliza'}</h3><div className="insurance-form-grid">
        {field('aseguradora','Aseguradora *','text',true)}{field('cobertura','Tipo de cobertura *','text',true)}
        {field('numero_poliza','Número de póliza')}{field('matricula_referencia','Matrícula de referencia, si procede')}{field('fecha_vencimiento','Vencimiento *','date',true)}
        <label>Periodicidad<select value={form.periodicidad || ''} onChange={e=>setForm(v=>({...v,periodicidad:e.target.value}))}><option value="">Sin indicar</option><option value="mensual">Mensual</option><option value="trimestral">Trimestral</option><option value="semestral">Semestral</option><option value="anual">Anual</option><option value="otra">Otra</option></select></label>
        {field('correduria','Correduría')}{field('importe_referencia','Importe indicado en la póliza (€)','number')}
        <label className="insurance-wide">Notas<textarea value={form.notas || ''} onChange={e=>setForm(v=>({...v,notas:e.target.value}))}/></label>
      </div><p>El importe es informativo. Guardar la póliza no genera un gasto ni una factura.</p>
      <label className="insurance-active"><input type="checkbox" checked={form.activo} onChange={e=>setForm(v=>({...v,activo:e.target.checked}))}/> Póliza activa</label>
      <div className="insurance-actions"><Button type="button" onClick={()=>{setForm(null);setId(null);}}>Cancelar</Button><Button type="submit" variant="primary" disabled={busy}>{busy?'Guardando…':'Guardar póliza'}</Button></div>
    </form>}
  </section>;
}

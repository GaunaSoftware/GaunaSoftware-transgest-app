import { useCallback, useEffect, useMemo, useState } from 'react';
import { getDatosMaestrosReadiness } from '../services/api';

const SECTIONS=[
  ['clientes','Clientes','clientes'],['clientes_situacion','Situación de clientes','clientes'],
  ['colaboradores','Colaboradores','colaboradores'],['choferes','Conductores','choferes'],
  ['vehiculos','Vehículos','vehiculos'],['viajes_pendientes','Viajes pendientes','pedidos'],
  ['facturas_pendientes','Facturas pendientes','facturacion'],
];
function cell(value){
  const text=String(value??'');
  const safe=/^[=+\-@\t\r]/.test(text)?`'${text}`:text;
  return `"${safe.replace(/"/g,'""')}"`;
}
function download(rows){
  const body='\uFEFF'+rows.map(row=>row.map(cell).join(';')).join('\r\n');
  const href=URL.createObjectURL(new Blob([body],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=href;link.download='pendientes_datos_maestros_transgest.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(href),1000);
}
export default function DataQuality(){
  const [data,setData]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[selected,setSelected]=useState('clientes');
  const load=useCallback(async()=>{setLoading(true);setError('');try{setData(await getDatosMaestrosReadiness());}catch(cause){setError(cause.message);}finally{setLoading(false);}},[]);
  useEffect(()=>{load();},[load]);
  const pending=useMemo(()=>SECTIONS.flatMap(([key,label])=>(data?.secciones?.[key]?.items||[])
    .filter(item=>Number(item.missing_required||0)>0||Number(item.score||0)<90).map(item=>({...item,section:label}))),[data]);
  const summary=data?.resumen||{};
  const [key,label,view]=SECTIONS.find(([section])=>section===selected)||SECTIONS[0];
  const items=(data?.secciones?.[key]?.items||[]).filter(item=>Number(item.missing_required||0)>0||Number(item.score||0)<90);
  return <section style={{background:'var(--card-bg)',border:'1px solid var(--border)',borderRadius:12,padding:20,color:'var(--text)'}}>
    <div style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}><div><h2 style={{font:"800 16px 'Syne',sans-serif",margin:'0 0 5px'}}>Calidad de datos para operar</h2>
      <p style={{color:'var(--text4)',fontSize:12,margin:0}}>Registros incompletos que pueden bloquear pedidos, documentación o facturación.</p></div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}><button onClick={load} disabled={loading}>Actualizar</button>
        <button onClick={()=>download([['Módulo','Registro','Score','Faltantes obligatorios','Campos pendientes'],...pending.map(item=>[item.section,item.nombre||'',item.score??'',item.missing_required||0,(item.missing||[]).map(m=>m.label).join(' | ')])])} disabled={!pending.length}>Descargar pendientes CSV</button></div></div>
    {error&&<p role="alert" style={{color:'var(--red)'}}>{error}</p>}
    <div style={{display:'flex',gap:10,flexWrap:'wrap',margin:'17px 0',fontSize:12}}>
      <span>Revisados: <strong>{summary.total??'—'}</strong></span><span>Completos: <strong>{summary.completos??'—'}</strong></span>
      <span>Incompletos: <strong>{summary.incompletos??'—'}</strong></span><span>Faltantes obligatorios: <strong>{summary.faltantes_obligatorios??'—'}</strong></span>
      <span>Score: <strong>{Number(summary.total||0)>0?`${summary.score_medio??0}%`:'Sin datos'}</strong></span></div>
    <div style={{display:'flex',gap:7,flexWrap:'wrap',marginBottom:15}}>{SECTIONS.map(([section,name])=><button key={section} onClick={()=>setSelected(section)} aria-pressed={selected===section} style={{background:selected===section?'var(--accent)':'var(--bg2)',color:selected===section?'#fff':'var(--text)',border:'1px solid var(--border)',borderRadius:7,padding:'7px 10px',cursor:'pointer'}}>{name}</button>)}</div>
    <div style={{display:'flex',justifyContent:'space-between',gap:10,alignItems:'center'}}><strong>{label}</strong><button onClick={()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:view}))}>Abrir módulo</button></div>
    {loading&&!data?<p>Cargando…</p>:items.length?<div style={{display:'grid',gap:7,marginTop:12}}>{items.slice(0,30).map(item=><div key={item.id} style={{display:'flex',justifyContent:'space-between',gap:12,flexWrap:'wrap',background:'var(--bg2)',border:'1px solid var(--border)',borderRadius:7,padding:10,fontSize:12}}>
      <strong>{item.nombre||'Sin nombre'}</strong><span>{(item.missing||[]).map(m=>m.label).join(' · ')}</span><span>{item.score??'—'}%</span></div>)}</div>
      :<p style={{color:'var(--text4)',fontSize:12,marginTop:12}}>{Number(data?.secciones?.[key]?.resumen?.total||0)>0?'Sin pendientes relevantes.':'Sin registros evaluables.'}</p>}
  </section>;
}

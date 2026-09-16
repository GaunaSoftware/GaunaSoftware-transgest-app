import { useEffect, useState } from 'react';

export default function CompanyProducts({empresaId, request}) {
  const [mode,setMode]=useState(''), [saved,setSaved]=useState(''), [busy,setBusy]=useState(false), [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    request(`/empresas/${empresaId}/productos`).then(data=>{if(active){setMode(data.modalidad);setSaved(data.modalidad);}})
      .catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[empresaId,request]);
  async function save() {
    setBusy(true);setError('');
    try { const data=await request(`/empresas/${empresaId}/productos`,{method:'PUT',body:{modalidad:mode}});setSaved(data.modalidad); }
    catch(e){setError(e.message);} finally {setBusy(false);}
  }
  return <section style={{padding:14,border:'1px solid #334155',borderRadius:8,marginBottom:18,color:'#e2e8f0'}} aria-label="Productos de la empresa">
    <label htmlFor="company-products" style={{display:'block',fontWeight:700,marginBottom:8}}>Productos habilitados</label>
    <select id="company-products" disabled={!mode||busy} value={mode} onChange={e=>setMode(e.target.value)} style={{width:'100%',padding:10,borderRadius:6,background:'#1a2035',color:'#e2e8f0',border:'1px solid #64748b'}}>
      {!mode&&<option value="">Cargando configuración…</option>}
      <option value="transgest">Solo TransGest</option><option value="planner">Solo Planner</option><option value="combinado">TransGest + Planner</option>
    </select>
    <p style={{fontSize:12,lineHeight:1.5}}>Planner: cargas, muelles, almacén y proveedores. La combinación añade la gestión de flota y viajes de TransGest, con los mismos datos de empresa.</p>
    <p style={{fontSize:12,lineHeight:1.5}}>Para probarlo en una empresa de TransGest, selecciona ambos. Los cambios que guardes son reales. Esta activación no modifica tarifas ni genera cobros.</p>
    {error&&<p role="alert" style={{color:'#fca5a5'}}>{error}</p>}
    <button type="button" disabled={!mode||busy||saved===mode} onClick={save} style={{padding:'9px 12px',border:0,borderRadius:6,background:'#087f75',color:'white',cursor:'pointer',opacity:(!mode||busy||saved===mode) ? 0.6 : 1}}>{busy?'Guardando…':'Guardar productos'}</button>
    {saved&&mode===saved&&<p role="status" style={{fontSize:12,marginBottom:0}}>Configuración guardada. Recarga la sesión de la empresa para aplicar el acceso.</p>}
  </section>;
}

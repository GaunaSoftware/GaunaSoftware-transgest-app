import {useState} from 'react';
export default function VehicleDocumentReview({result,onApply,onClose}){
  const [selected,setSelected]=useState([]);
  return <section style={{padding:15,border:'1px solid var(--accent)',borderRadius:10,background:'var(--bg2)'}}><h3 style={{marginTop:0}}>Revisar datos leídos del documento</h3><p>Compara cada valor con el original y selecciona los campos que quieras aplicar. Después guarda la ficha del vehículo.</p>
    {(result.warnings||[]).map((text,i)=><p key={i} role="status">{text}</p>)}
    <div style={{display:'grid',gap:10}}>{result.fields.map(field=><label key={field.key} style={{display:'flex',gap:10,padding:9,border:'1px solid var(--border)',borderRadius:6,overflowWrap:'anywhere'}}><input type="checkbox" checked={selected.includes(field.key)} onChange={e=>setSelected(values=>e.target.checked?[...values,field.key]:values.filter(key=>key!==field.key))}/><span><strong>{field.label}: {String(field.value)}</strong><small style={{display:'block',color:'var(--text4)'}}>En la ficha: {String(field.existing??'Sin dato')} · Documento: {field.evidence}</small></span></label>)}</div>
    <div style={{display:'flex',gap:9,flexWrap:'wrap',marginTop:12}}><button type="button" disabled={!selected.length} onClick={()=>onApply(Object.fromEntries(result.fields.filter(field=>selected.includes(field.key)).map(field=>[field.key,field.value])))}>Aplicar {selected.length} campos seleccionados</button><button type="button" onClick={onClose}>Cerrar sin aplicar</button></div>
  </section>;
}

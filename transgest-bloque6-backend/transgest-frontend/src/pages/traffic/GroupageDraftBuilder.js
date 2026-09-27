import {useMemo,useState} from 'react';
import RemolqueGrupaje from '../../components/RemolqueGrupaje';
import {combinarGrupaje} from '../../services/api';
import {notify} from '../../services/notify';
export default function GroupageDraftBuilder({orders,onReload,canEdit}){
 const [selected,setSelected]=useState([]),[saving,setSaving]=useState(false);
 const eligible=useMemo(()=>orders.filter(p=>!p.grupaje_id&&!p.viaje_operativo&&!p.factura_id&&['pendiente','confirmado'].includes(p.estado)),[orders]);
 const cargo=selected.map(id=>eligible.find(p=>p.id===id)).filter(Boolean);
 function add(id){if(eligible.some(p=>p.id===id))setSelected(old=>[...new Set([...old,id])]);}
 function remove(id){setSelected(old=>old.filter(x=>x!==id));}
 async function save(){setSaving(true);try{await combinarGrupaje(cargo.map(p=>p.id),true);setSelected([]);onReload?.();notify('Borrador creado. Revisa el recorrido y la asignación antes de confirmarlo.','success');}catch(e){notify(e.message,'error');}finally{setSaving(false);}}
 return <details className="groupage-draft"><summary>Preparar nuevo grupaje</summary><p>Arrastra pedidos al remolque. Para retirarlos, arrástralos a disponibles o pulsa Retirar.</p><div className="groupage-draft-columns">
  <section onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(canEdit)remove(e.dataTransfer.getData('application/transgest-cargo'));}}><h3>Pedidos disponibles</h3>
   {eligible.filter(p=>!selected.includes(p.id)).map(p=><div key={p.id} draggable={canEdit&&!saving} onDragStart={e=>e.dataTransfer.setData('application/transgest-order',p.id)}><strong>{p.numero}</strong> · {p.cliente_nombre}<button disabled={!canEdit||saving} onClick={()=>add(p.id)}>Añadir</button></div>)}
  </section>
  <section onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(canEdit&&!saving)add(e.dataTransfer.getData('application/transgest-order'));}}><h3>Remolque provisional ({cargo.length})</h3><RemolqueGrupaje pedidos={cargo} onReorder={canEdit&&!saving?(source,target)=>setSelected(old=>{const list=old.filter(id=>id!==source);list.splice(list.indexOf(target),0,source);return list;}):null}/>
   {cargo.map(p=><div key={p.id} draggable={canEdit&&!saving} onDragStart={e=>e.dataTransfer.setData('application/transgest-cargo',p.id)}>{p.numero}<button disabled={!canEdit||saving} onClick={()=>remove(p.id)}>Retirar</button></div>)}
  </section></div><button className="tgui-button" disabled={!canEdit||saving||cargo.length<2} onClick={save}>{saving?'Guardando…':'Guardar borrador y preparar ruta'}</button>
 </details>;
}

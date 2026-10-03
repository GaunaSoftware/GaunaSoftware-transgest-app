import {useEffect,useState} from 'react';
import {getPuntosInteres} from '../services/api';
import PointEditor from './PointEditor';
export default function RoutePointField({side,customer,form,setForm,inputStyle,buttonStyle}){
 const [points,setPoints]=useState([]),[editing,setEditing]=useState(false),[error,setError]=useState('');
 const key=side+'_punto_id';
 useEffect(()=>{let alive=true;getPuntosInteres({}).then(rows=>{if(alive)setPoints(Array.isArray(rows)?rows:[]);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[]);
 const choose=point=>setForm(previous=>({...previous,[key]:point?.id||null,...(point?{[side]:point.nombre||point.direccion}:{})}));
 return <><select aria-label={'Punto exacto de '+side} style={inputStyle} value={form[key]||''} onChange={e=>choose(points.find(p=>p.id===e.target.value))}>
  <option value="">Elegir punto guardado…</option>{points.map(p=><option key={p.id} value={p.id}>{p.nombre} · {p.ciudad||p.direccion}</option>)}
 </select><button type="button" style={buttonStyle} onClick={()=>setEditing(true)}>+ Guardar punto exacto</button>{error&&<small role="alert">{error}</small>}
 {editing&&<PointEditor initial={{cliente_id:customer,punto_general:!customer,tipo:side==='origen'?'carga':'descarga'}} onClose={()=>setEditing(false)} onSave={point=>{setPoints(previous=>[...previous.filter(p=>p.id!==point.id),point]);choose(point);}}/>}</>;
}

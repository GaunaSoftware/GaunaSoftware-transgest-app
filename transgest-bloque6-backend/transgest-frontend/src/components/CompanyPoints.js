import {useEffect,useMemo,useState} from 'react';
import {getPuntosInteres} from '../services/api';
import {useAuth} from '../context/AuthContext';
import {Button,Card} from '../ui';
import PointEditor from './PointEditor';
import './CompanyPoints.css';
export default function CompanyPoints(){
 const {puedeEditar}=useAuth(),canEdit=puedeEditar('pedidos')||puedeEditar('clientes');
 const [points,setPoints]=useState([]),[search,setSearch]=useState(''),[editing,setEditing]=useState(null),[revision,setRevision]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState('');
 useEffect(()=>{let active=true;setLoading(true);getPuntosInteres().then(rows=>{if(active){setPoints(Array.isArray(rows)?rows:[]);setError('');}}).catch(e=>active&&setError(e.message)).finally(()=>active&&setLoading(false));return()=>{active=false;};},[revision]);
 const rows=useMemo(()=>points.filter(p=>[p.nombre,p.direccion,p.ciudad,p.provincia,p.codigo_postal].some(v=>String(v||'').toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')))).sort((a,b)=>String(a.nombre||'').localeCompare(String(b.nombre||''),'es')),[points,search]);
 return <Card className="company-points"><header><div><h2>Puntos de carga y descarga</h2><p>Direcciones reutilizables con datos de contacto, horarios y coordenadas. Son los mismos puntos disponibles en clientes, tarifas y pedidos.</p></div>{canEdit&&<Button variant="primary" onClick={()=>setEditing({punto_general:true})}>Crear punto</Button>}</header>
 <div className="company-points-tools"><input aria-label="Buscar puntos de la empresa" placeholder="Buscar nombre, dirección o población…" value={search} onChange={e=>setSearch(e.target.value)}/><Button onClick={()=>setRevision(n=>n+1)}>Actualizar</Button><span>{rows.length} puntos</span></div>
 {error&&<p role="alert">{error}</p>}{loading?<p role="status">Cargando puntos…</p>:!rows.length?<p>No hay puntos con esta búsqueda.</p>:<div className="company-points-list">{rows.map(p=><article key={p.id}><div><strong>{p.nombre}</strong><p>{[p.direccion,p.codigo_postal,p.ciudad,p.provincia,p.pais].filter(Boolean).join(', ')}</p><small>{[p.ventana,p.contacto_nombre,p.contacto_telefono].filter(Boolean).join(' · ')}</small><small>{p.cliente_id?'Vinculado a cliente':'Punto general'}{p.lat==null||p.lng==null?' · Sin coordenadas verificadas':''}</small></div>{canEdit&&<Button onClick={()=>setEditing(p)}>Editar punto</Button>}</article>)}</div>}
 {editing&&<PointEditor initial={editing} onClose={()=>setEditing(null)} onSave={()=>setRevision(n=>n+1)}/>}</Card>;
}

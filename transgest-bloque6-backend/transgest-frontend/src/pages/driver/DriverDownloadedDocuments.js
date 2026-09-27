import {useEffect,useState} from 'react';
import {Button} from '../../ui';
import {listNativePdfs,openNativePdf,removeNativePdf} from '../../services/nativeDocuments';
export default function DriverDownloadedDocuments(){
 const [items,setItems]=useState([]),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const load=()=>listNativePdfs().then(r=>{setItems(r.items);setError('');}).catch(e=>setError(e.message)).finally(()=>setLoading(false));
 useEffect(()=>{load();},[]);
 return <section className="driver-card" style={{padding:16}}><h2>Documentos descargados</h2><p>Copias privadas de esta cuenta en este dispositivo. Sin conexión no se puede comprobar si existe una versión posterior. Retirar una copia no elimina el original de TransGest.</p>
  {loading&&<p role="status">Leyendo documentos…</p>}{error&&<p role="alert">{error}</p>}{!loading&&!items.length&&<p>No has guardado ningún PDF. Abre o descarga un original desde un viaje con conexión.</p>}
  <ul>{items.map(item=><li key={item.id} style={{overflowWrap:'anywhere',marginBlock:16}}><strong>{item.name}</strong><p>{new Date(item.saved_at).toLocaleString('es-ES')} · {(item.size/1024).toLocaleString('es-ES',{maximumFractionDigits:0})} KB</p><Button onClick={()=>openNativePdf(item.id).catch(e=>setError(e.message))}>Abrir copia</Button><Button onClick={()=>removeNativePdf(item.id).then(load).catch(e=>setError(e.message))}>Retirar copia local</Button></li>)}</ul>
 </section>;
}

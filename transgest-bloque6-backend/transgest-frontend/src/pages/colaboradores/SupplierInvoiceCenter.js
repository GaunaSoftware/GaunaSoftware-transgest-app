import {useEffect,useState} from 'react';
import {supplierInvoiceReview as api} from '../../services/api';
import {Section} from '../../ui';
import SupplierInvoiceReview from './SupplierInvoiceReview';
export default function SupplierInvoiceCenter({onRegistered}){
 const [query,setQuery]=useState(''),[providers,setProviders]=useState([]),[selected,setSelected]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let current=true;const timeout=setTimeout(()=>api('/proveedores?q='+encodeURIComponent(query)).then(data=>{if(current){setProviders(data);setError('');}}).catch(e=>current&&setError(e.message)),250);return()=>{current=false;clearTimeout(timeout);};},[query]);
 return <Section title="Facturas de proveedor"><div className="supplier-review"><label>Buscar proveedor<input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Nombre o NIF"/></label>{error&&<p role="alert">{error}</p>}<label>Proveedor (hasta 100 coincidencias)<select value={selected?.id||''} onChange={e=>setSelected(providers.find(p=>p.id===e.target.value)||null)}><option value="">Selecciona proveedor para revisar sus facturas</option>{providers.map(p=><option key={p.id} value={p.id}>{p.nombre} · {p.cif}</option>)}</select></label></div>{selected&&<SupplierInvoiceReview key={selected.id} proveedor={selected} onRegistered={onRegistered}/>}</Section>;
}

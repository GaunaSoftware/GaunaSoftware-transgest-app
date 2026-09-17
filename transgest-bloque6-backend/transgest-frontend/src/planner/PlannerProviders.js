import {lazy,Suspense,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {plannerApi} from '../services/api';
const Agencies=lazy(()=>import('../pages/Colaboradores'));
const Vehicles=lazy(()=>import('./PlannerVehicles'));
const Drivers=lazy(()=>import('./PlannerDrivers'));
const Connections=lazy(()=>import('./PlannerConnections'));
export default function PlannerProviders(){
 const {puedeEditar,puedeVer}=useAuth();
 const [tab,setTab]=useState('colaboradores'),[version,setVersion]=useState(0),[message,setMessage]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function registerOwn(){setBusy(true);setError('');try{const p=await plannerApi('/proveedores/propio',{method:'POST',body:{}});setVersion(v=>v+1);setMessage(`${p.nombre} está disponible como proveedor de transporte. Puedes vincularle sus vehículos y conductores.`);}catch(e){setError(e.message);}finally{setBusy(false);}}
 const tabs=[['colaboradores','Proveedores'],['conductores','Conductores'],...(puedeVer('pedidos')?[['vehiculos','Vehículos autorizados'],['conexiones','Conexiones con TransGest']]:[])];
 return <section><div className="pl-tabs">{tabs.map(([id,label])=><button key={id} aria-pressed={tab===id} onClick={()=>setTab(id)}>{label}</button>)}</div>
 {puedeEditar('colaboradores')&&puedeEditar('pedidos')&&<div className="pl-action-row"><button disabled={busy} onClick={registerOwn}>Registrar mi empresa como transportista</button></div>}
 {message&&<p className="pl-notice" role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
 <Suspense fallback={<p>Cargando proveedores…</p>}><div key={version}>{tab==='colaboradores'?<Agencies/>:tab==='conductores'?<Drivers/>:tab==='vehiculos'?<Vehicles/>:<Connections embedded/>}</div></Suspense></section>;
}

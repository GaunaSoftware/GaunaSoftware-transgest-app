import {useState,useEffect} from 'react';
export default function ClaveiconAdminSummary({empresaId,request}) {
 const [value,setValue]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setValue(null);setError('');request(`/integraciones/fiscal/${empresaId}/claveicon`).then(v=>{if(active)setValue(v);}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[empresaId,request]);
 if(error)return <p role="status">ClaveiCon: {error}</p>;
 if(!value)return <p>Consultando ClaveiCon…</p>;
 const cfg=value.config || {};
 return <details style={{marginTop:16,color:'#e2e8f0'}}><summary>ClaveiCon · {cfg.enabled?'Activado':'Sin activar'} · {value.pending || 0} pendientes · {value.errors || 0} errores</summary><dl style={{display:'grid',gridTemplateColumns:'minmax(130px,1fr) minmax(100px,1fr)',gap:8}}>{[['Modo',cfg.mode==='api'?'API (pendiente de contrato)':'XML manual'],['Empresa',cfg.codemp],['Cuenta de ventas',cfg.sales_account],['Cuenta de IVA',cfg.vat_account],['Cuenta de retención',cfg.withholding_account],['Tipo de previsión',cfg.codtipopre],['Última sincronización',value.last_synced_at?new Date(value.last_synced_at).toLocaleString('es-ES'):'Sin importaciones confirmadas']].map(([label,v])=><div key={label}><dt>{label}</dt><dd style={{margin:0,fontWeight:600}}>{v || 'Sin configurar'}</dd></div>)}</dl><p>La configuración y conciliación de ficheros se gestionan en Facturación → Exportación contable de la empresa.</p></details>;
}

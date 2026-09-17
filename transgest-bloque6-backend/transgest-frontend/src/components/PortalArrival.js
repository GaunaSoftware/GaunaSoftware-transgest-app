import {useEffect,useState} from 'react';
import {getPortalPedidoMuelle} from '../services/api';

export default function PortalArrival({orderId}) {
  const [rows,setRows]=useState([]),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;setRows([]);setError('');
    getPortalPedidoMuelle(orderId).then(data=>{if(active)setRows(data);}).catch(()=>{if(active)setError('No se pudo consultar la información del muelle.');});
    return ()=>{active=false;};
  },[orderId]);
  if(error)return <p role="status">{error}</p>;
  if(!rows.length)return null;
  return <div className="portal-card"><strong>Información de carga</strong>{rows.map(r=><div key={r.id}>
    <p>{r.almacen} · {r.muelle} · Llegada prevista: {new Date(r.inicio).toLocaleString('es-ES',{timeZone:r.zona_horaria})}</p>
    <p>{r.muestras>0?`Tiempo medio de carga: ${r.media_min} min, calculado con ${r.muestras} cargas terminadas. Es orientativo y no garantiza una hora de salida.`:'El tiempo medio estará disponible cuando haya cargas terminadas.'}</p>
  </div>)}</div>;
}

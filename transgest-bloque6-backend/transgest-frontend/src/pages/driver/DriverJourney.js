import { useEffect, useState } from 'react';
import { getPedidoChoferPasos } from '../../services/api';
import { TarjetaViaje } from './DriverTrip';

export default function DriverJourney({pedidos, fallback, onActualizar, jornadaInfo, onAbrirJornada, onFoto}) {
  const [context,setContext]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[reload,setReload]=useState(0),[open,setOpen]=useState(false);
  const firstId=pedidos[0]?.id;
  const revision=JSON.stringify(pedidos);
  useEffect(()=>{
    let alive=true;setLoading(true);setError('');
    getPedidoChoferPasos(firstId).then(result=>{if(alive)setContext(result.viaje_operativo?{...result.viaje_operativo,requestedOrder:firstId}:null);})
      .catch(err=>{if(alive)setError(err.message||'No se pudo cargar el plan del viaje.');}).finally(()=>{if(alive)setLoading(false);});
    return ()=>{alive=false;};
  },[firstId,reload,revision]);
  if(error)return <div role="alert" className="driver-stops-summary">{error} <button onClick={()=>setReload(value=>value+1)}>Reintentar</button></div>;
  if(loading&&context?.requestedOrder!==firstId)return <p role="status">Consultando las paradas del viaje…</p>;
  if(!context)return fallback;
  const next=context.proxima_parada,order=pedidos.find(item=>item.id===next?.pedido_id);
  const refresh=()=>{setReload(value=>value+1);onActualizar?.();};
  return <section className="driver-stops-summary" aria-label="Viaje multiparada">
    <h3>Grupaje · un solo viaje</h3>
    <p><strong>{next?`Próxima parada · ${next.orden}/${context.paradas.length}`:'Todas las paradas completadas'}</strong></p>
    {next&&<p>{next.tipo==='carga'?'Carga':'Descarga'} · {next.label}</p>}
    <details><summary>Ver secuencia de {context.paradas.length} paradas</summary><ol>{context.paradas.map(stop=><li key={stop.id} aria-current={stop.id===next?.id?'step':undefined}>
      {stop.tipo==='carga'?'Carga':'Descarga'} · {stop.label} — {stop.completa?'Completada':stop.id===next?.id?'Próxima':'Pendiente'}
      {stop.espera_min!=null&&<small> · Espera: {stop.espera_min.toLocaleString('es-ES',{maximumFractionDigits:1})} min</small>}
      {stop.duracion_min!=null&&<small> · Operación: {stop.duracion_min.toLocaleString('es-ES',{maximumFractionDigits:1})} min</small>}
    </li>)}</ol><small>{context.fuente_tiempos}</small></details>
    {order&&<button className="driver-back" onClick={()=>setOpen(value=>!value)} aria-expanded={open}>{open?'Plegar parada':'Abrir próxima parada'}</button>}
    {next&&!order&&<p role="alert">La próxima parada no está entre tus servicios disponibles. Actualiza el viaje o consulta a tráfico.</p>}
    {open&&order&&<TarjetaViaje key={`${order.id}:${next.id}`} pedido={order} journeyStopId={next.parada_legacy_id} onActualizar={refresh} jornadaInfo={jornadaInfo} onAbrirJornada={onAbrirJornada} expanded onFoto={()=>onFoto?.(order.id)} />}
  </section>;
}

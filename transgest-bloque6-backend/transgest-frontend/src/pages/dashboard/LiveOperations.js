import { useEffect, useRef, useState } from "react";
import { getPedidosTodos } from "../../services/api";
import { Button, Card, EmptyState, Select, Badge } from "../../ui";

const states=[['pendiente','Pendientes'],['confirmado','Confirmados'],['espera_carga','En espera de carga'],['cargando','Cargando'],['en_curso','En ruta'],['espera_descarga','En espera de descarga'],['descarga','Descargando'],['incidencia','Incidencias']];
export default function LiveOperations({ initialItems, onSnapshot, openOrder }) {
  const [items,setItems]=useState(initialItems),[busy,setBusy]=useState(false),[error,setError]=useState(''),[updated,setUpdated]=useState(null),[filter,setFilter]=useState('todos');
  const root=useRef(null),refreshRef=useRef(null);
  useEffect(()=>{let alive=true,running=false;
    async function refresh(force=false){
      if(running||(!force&&(document.visibilityState==='hidden'||!root.current?.getClientRects().length)))return;
      running=true;setBusy(true);
      try{const result=await getPedidosTodos({}, {timeoutMs:25000,silentError:true});const rows=Array.isArray(result)?result:result?.data||[];
        if(alive){setItems(rows);onSnapshot(rows);setUpdated(new Date());setError('');}
      }catch(e){if(alive)setError('No se pudo actualizar la operativa. Se mantiene la última lectura.');}
      finally{running=false;if(alive)setBusy(false);}
    }
    refreshRef.current=()=>refresh(true);refresh();
    const timer=setInterval(()=>refresh(),30000),trigger=()=>refresh();
    window.addEventListener('focus',trigger);window.addEventListener('tms:pedidos-changed',trigger);document.addEventListener('visibilitychange',trigger);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',trigger);window.removeEventListener('tms:pedidos-changed',trigger);document.removeEventListener('visibilitychange',trigger);};
  },[onSnapshot]);
  const active=items.filter(p=>states.some(([key])=>key===p.estado));
  const shown=active.filter(p=>filter==='todos'||p.estado===filter).sort((a,b)=>String(a.fecha_carga||'').localeCompare(String(b.fecha_carga||''))).slice(0,8);
  return <Card className="dashboard-live" ><div ref={root}><header><div><h2>Operativa en curso</h2><p>Actualización automática cada 30 s{updated?` · Última lectura: ${updated.toLocaleTimeString('es-ES')}`:''}</p></div><Button disabled={busy} onClick={()=>refreshRef.current?.()}>{busy?'Actualizando…':'Actualizar estados'}</Button></header>
    {error&&<p role="alert">{error}</p>}
    <div className="dashboard-live-states">{states.map(([key,label])=><button key={key} className={filter===key?'is-active':''} onClick={()=>setFilter(filter===key?'todos':key)} aria-pressed={filter===key}><strong>{active.filter(p=>p.estado===key).length}</strong><span>{label}</span></button>)}</div>
    <div className="dashboard-live-heading"><Select label="Filtrar operativa" value={filter} onChange={e=>setFilter(e.target.value)}><option value="todos">Todos los estados operativos</option>{states.map(([key,label])=><option key={key} value={key}>{label}</option>)}</Select><span>{shown.length} de {active.filter(p=>filter==='todos'||p.estado===filter).length} pedidos</span></div>
    {shown.length?<div className="dashboard-live-list">{shown.map(p=><button key={p.id} onClick={()=>openOrder({pedido_id:p.id,numero:p.numero})}><strong>{p.numero||'Pedido'}</strong><span>{p.cliente_nombre||'Sin cliente'}</span><span>{p.origen||'—'} → {p.destino||'—'}</span><small>{p.vehiculo_matricula||'Sin vehículo'} · {p.chofer_nombre||'Sin conductor'}</small><Badge tone={p.estado==='incidencia'?'danger':'info'}>{states.find(([key])=>key===p.estado)?.[1]}</Badge></button>)}</div>:<EmptyState title="Sin pedidos en este estado"/>}
  </div></Card>;
}

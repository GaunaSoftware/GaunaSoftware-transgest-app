import {useEffect,useState} from 'react';
import {getAgendaEventos} from '../services/api';
export default function AgendaToday(){
  const [rows,setRows]=useState(null),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;const from=new Date();from.setHours(0,0,0,0);const to=new Date(from);to.setDate(to.getDate()+1);to.setMilliseconds(-1);
    getAgendaEventos({origen:'manual',modo:'mias',desde:from.toISOString(),hasta:to.toISOString()}).then(r=>{if(active)setRows(r);}).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[]);
  const open=()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'agenda'}));
  return <section className="dashboard-card agenda-today"><div className="workspace-toolbar"><h2>Mi agenda de hoy</h2><button onClick={open}>Abrir agenda</button></div>
    {error ? <p role="alert">{error}</p> : !rows ? <p>Cargando agenda…</p> : !rows.length ? <p>No tienes citas ni tareas para hoy. Puedes crearlas en la agenda.</p> : <><div className="dashboard-scroll">{rows.slice(0,5).map(r=><button key={r.id} className="dashboard-agenda-row" onClick={open}><time>{r.todo_dia?'Todo el día':new Date(r.fecha_inicio).toLocaleTimeString('es-ES',{hour:'2-digit',minute:'2-digit'})}</time><strong>{r.titulo}</strong><span>{r.asignado_a_nombre}</span></button>)}</div>{rows.length>5&&<button onClick={open}>Ver las {rows.length} citas y tareas</button>}</>}
  </section>;
}

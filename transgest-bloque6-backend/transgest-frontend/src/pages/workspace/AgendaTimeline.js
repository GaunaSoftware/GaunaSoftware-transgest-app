const key = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
const time = d => new Date(d).toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});
export default function AgendaTimeline({day, view, events, selectDay, openEvent}) {
  const start = new Date(`${day}T12:00:00`);
  if(view === "semana") start.setDate(start.getDate()-(start.getDay()+6)%7);
  const days=Array.from({length:view === "dia" ? 1 : 7},(_,i)=>{const d=new Date(start);d.setDate(d.getDate()+i);return d;});
  const entries = days.flatMap(d=>events.get(key(d))||[]);
  const eventHours = entries.filter(e=>!e.todo_dia).map(e=>new Date(e.fecha_inicio).getHours()).filter(Number.isFinite);
  const first=Math.min(8,...eventHours),last=Math.max(18,...eventHours);
  const hours=Array.from({length:last-first+1},(_,i)=>first+i);
  const eventButton=(e,d)=><button key={e.id} className={`agenda-event event-${e.tipo}`} onClick={()=>{selectDay(key(d));openEvent(e);}}>
    <time>{e.todo_dia ? "Todo el día" : `${time(e.fecha_inicio)}${e.fecha_fin ? ` – ${time(e.fecha_fin)}` : ""}`}</time><strong>{e.titulo}</strong><span>{e.asignado_a_nombre || "Sin responsable"}</span><small>{e.prioridad || "media"} · {e.estado === "en_progreso" ? "En progreso" : e.estado}</small>
  </button>;
  const cells=hour=>days.map(d=><div key={key(d)} className={`agenda-hour-cell ${key(d)===key(new Date()) ? "is-today" : ""}`}>{(events.get(key(d))||[]).filter(e=>hour===null ? e.todo_dia : !e.todo_dia&&new Date(e.fecha_inicio).getHours()===hour).sort((a,b)=>new Date(a.fecha_inicio)-new Date(b.fecha_inicio)).map(e=>eventButton(e,d))}</div>);
  return <div className="agenda-timeline" role="region" aria-label="Calendario de eventos" tabIndex={0}>
    <div className={`agenda-time-grid ${view === "dia" ? "is-day" : ""}`} style={{gridTemplateColumns:`48px repeat(${days.length},minmax(120px,1fr))`}}>
      <div className="agenda-hour-label">Hora</div>{days.map(d=><button key={key(d)} className={`agenda-day-heading ${key(d)===key(new Date()) ? "is-today" : ""}`} onClick={()=>selectDay(key(d))}><span>{d.toLocaleDateString("es-ES",{weekday:"short"})}</span><strong>{d.toLocaleDateString("es-ES",{day:"numeric",month:"short"})}</strong><small>{(events.get(key(d))||[]).length} eventos</small></button>)}
      {entries.some(e=>e.todo_dia)&&<><div className="agenda-hour-label">Día</div>{cells(null)}</>}
      {hours.map(hour=><div key={hour} className="agenda-hour-row"><time className="agenda-hour-label">{String(hour).padStart(2,"0")}:00</time>{cells(hour)}</div>)}
    </div>
  </div>;
}

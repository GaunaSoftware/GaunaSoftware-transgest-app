const dateOf = item => { const key=String(item.pedido.fecha_carga||'').slice(0,10); return /^\d{4}-\d{2}-\d{2}$/.test(key)&&!Number.isNaN(Date.parse(key))?key:''; };
const weekOf = key => { const d=new Date(key+'T12:00:00Z'); d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7); return d.toISOString().slice(0,10); };
export function orderByDate(items) { return [...items].sort((a,b)=>(dateOf(a)||'9999').localeCompare(dateOf(b)||'9999')); }
export function groupOrderDates(page, all) {
 const dates=all.map(dateOf).filter(Boolean), months=new Set(dates.map(d=>d.slice(0,7))), weeks=new Set(dates.map(weekOf));
 const counts=new Map(); all.forEach(item=>{const key=dateOf(item);counts.set(key,(counts.get(key)||0)+1);});
 const rows=[];let previous=null;
 page.forEach(item=>{const key=dateOf(item);if(key!==previous){
  const d=key?new Date(key+'T12:00:00Z'):null;
  const month=key.slice(0,7),week=key?weekOf(key):'';
  const add=(level,id,label,count)=>rows.push({__group:true,id:`${level}-${id}`,level,label,count});
  if(key&&months.size>1&&(!previous||month!==previous.slice(0,7)))add('month',month,d.toLocaleDateString('es-ES',{month:'long',year:'numeric',timeZone:'UTC'}));
  if(key&&weeks.size>1&&(!previous||week!==weekOf(previous)||month!==previous.slice(0,7))) {const end=new Date(week+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+6);add('week',month+'-'+week,`Semana del ${week.split('-').reverse().join('/')} al ${end.toISOString().slice(0,10).split('-').reverse().join('/')}`);}
  add('day',key||'sin-fecha',d?d.toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'}):'Sin fecha de carga',counts.get(key));previous=key;
 }rows.push(item);});return rows;
}

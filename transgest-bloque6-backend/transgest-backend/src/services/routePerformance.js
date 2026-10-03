const { driverStops, stopData } = require('./driverStops');
function duration(start, end) {
  if (!start || !end) return null;
  const a = new Date(start).getTime(), b = new Date(end).getTime();
  return Number.isFinite(a) && Number.isFinite(b) && b >= a && b-a<=7*24*3600000 ? Math.round((b-a)/60000*100)/100 : null;
}
function average(values) {
  const recorded = values.filter(v => v !== null && Number.isFinite(v));
  return { minutos:recorded.length ? Math.round(recorded.reduce((a,b)=>a+b,0)/recorded.length*100)/100 : null, muestras:recorded.length };
}
function routePerformance(orders) {
  const data = orders.map(order => {
    const graph = Array.isArray(order.paradas) ? order.paradas : [];
    const legacy=driverStops(order), all=order.pasos||{};
    const stops=legacy.map(stop=>{
      const data=stopData(stop,all,legacy),load=stop.tipo==='carga';
      const materialized=graph.find(s=>s.legacy_key===stop.id||s.legacy_key===order.id+':'+stop.id);
      return {...stop,...materialized,
        llegada_real_at:materialized?.llegada_real_at||data[load?'carga_iniciada_at':'posicionado_descarga_at'],
        inicio_real_at:materialized?.inicio_real_at||data[load?'carga_proceso_at':'descarga_iniciada_at'],
        fin_real_at:materialized?.fin_real_at||data[load?'carga_ok_at':'descarga_ok_at'],
        progreso:{...data,...materialized?.progreso}};
    });
    // Legacy identifiers may be absent in an imported plan; retain real recorded stops.
    for(const stop of graph)if(!stops.some(s=>s.id===stop.id))stops.push(stop);
    const loads = stops.filter(s=>s.tipo==='carga'), deliveries=stops.filter(s=>s.tipo==='descarga');
    return {...order,paradas:stops,
      carga:average(loads.map(s=>duration(s.inicio_real_at,s.fin_real_at))),
      descarga:average(deliveries.map(s=>duration(s.inicio_real_at,s.fin_real_at))),
      espera:average(stops.map(s=>duration(s.llegada_real_at,s.inicio_real_at))),
      trayecto:average(deliveries.map(s=>duration(s.progreso?.viaje_iniciado_at,s.llegada_real_at))),
    };
  });
  return {data, indicadores:Object.fromEntries(['carga','descarga','espera','trayecto'].map(key=>{
    const samples=data.flatMap(o=>(o.paradas||[]).filter(s=>key==='carga'?s.tipo==='carga':key==='descarga'||key==='trayecto'?s.tipo==='descarga':true)
      .map(s=>key==='espera'?duration(s.llegada_real_at,s.inicio_real_at):key==='trayecto'?duration(s.progreso?.viaje_iniciado_at,s.llegada_real_at):duration(s.inicio_real_at,s.fin_real_at)));
    return [key,average(samples)];
  })), fuente:'Confirmaciones operativas registradas en el servidor. El trayecto incluye paradas y descansos; no equivale a tiempo de conducción.'};
}
module.exports={duration,average,routePerformance};

const day=value=>String(value||'').slice(0,10);
const localDay=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;

export function estimateArrival(order,settings={}){
 const startDay=day(order.fecha_carga||order.fecha_pedido),km=Number(order.km_ruta||order.km);
 if(!startDay||!Number.isFinite(km)||km<=0)return null;
 const hour=/^\d{2}:\d{2}/.test(String(order.hora_carga||''))?String(order.hora_carga).slice(0,5):'08:00';
 const start=new Date(`${startDay}T${hour}:00`);
 if(Number.isNaN(start.getTime()))return null;
 const speed=Math.max(40,Math.min(100,Number(settings.velocidad_media)||80));
 const driving=km/speed,breaks=Math.floor(Math.max(0,driving-0.01)/4.5)*45;
 const rests=Math.floor(Math.max(0,driving-0.01)/9)*11*60;
 return new Date(start.getTime()+Math.round(driving*60+breaks+rests)*60000);
}

export function projectedLocation(order,date,settings={}){
 if(!order?.vehiculo_id&&!String(order?.matricula_colaborador||'').trim())return null;
 if(['cancelado','borrador'].includes(String(order.estado||'').toLowerCase()))return null;
 const load=day(order.fecha_carga||order.fecha_pedido),planned=day(order.fecha_descarga||order.fecha_entrega);
 if(!load||date<load)return null;
 const arrival=estimateArrival(order,settings),arrivalDay=arrival?localDay(arrival):null;
 const finalDay=planned&&planned>arrivalDay?planned:(arrivalDay||planned||load);
 if(date>finalDay)return null;
 const direction=order.tipo_viaje==='retorno'?'retorno':'salida';
 const phase=date===load?'salida':date===finalDay?'descarga':arrivalDay&&date<=arrivalDay?'ruta':'destino';
 return {direction,phase,arrival,plannedDay:planned,origin:order.origen||'Origen pendiente',destination:order.destino||'Destino pendiente',estimate:!!arrival};
}

export function locationAgendaRows(orders=[],days=[],settings={}){
 const by=new Map();
 for(const order of orders){
  if(['cancelado','borrador'].includes(String(order.estado||'').toLowerCase()))continue;
  const plate=String(order.matricula_colaborador||'').trim(),own=!!order.vehiculo_id;
  // El contador de la fila y las celdas deben usar los mismos siete días visibles.
  // La consulta incluye dos semanas anteriores para proyectar viajes largos.
  if(!days.some(date=>projectedLocation(order,date,settings)))continue;
  if(!own&&(!plate||!order.colaborador_id))continue;
  const key=own?`propio:${order.vehiculo_id}`:`colaborador:${order.colaborador_id}:${plate}`;
  const label=own?(order.vehiculo_matricula||'Vehículo asignado'):`${plate} · ${order.colaborador_nombre||'Colaborador'}`;
  const item=by.get(key)||{id:key,label,orders:[]};
  item.orders.push(order);by.set(key,item);
 }
 return sortTrafficLocationRows([...by.values()]);
}

export function sortTrafficLocationRows(rows=[]){
 return [...rows].sort((a,b)=>{
  const aSupplier=String(a.id||'').startsWith('colaborador:');
  const bSupplier=String(b.id||'').startsWith('colaborador:');
  if(aSupplier!==bSupplier)return aSupplier?1:-1;
  return String(a.label||'').localeCompare(String(b.label||''),'es',{numeric:true,sensitivity:'base'});
 });
}

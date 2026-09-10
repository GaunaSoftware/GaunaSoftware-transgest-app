function stops(value) { try { const data=typeof value==='string'?JSON.parse(value):value;return Array.isArray(data)?data:[]; } catch {return [];} }
function dailyDeliveries(orders, sequence = []) {
  const all=orders.flatMap(order=>{
    const points=stops(order.puntos_descarga);
    return (points.length?points:[{ciudad:order.destino,fecha:order.fecha_descarga}]).map((point,index)=>({
      key:`${order.id}:${point.id || index}`,pedido_id:order.id,numero:order.numero,
      lugar:point.nombre || point.cliente_nombre || point.ciudad || point.direccion || order.destino || '-',
      fecha:point.fecha || order.fecha_descarga || '',hora:point.hora || point.ventana || order.hora_descarga || order.ventana_descarga || '',
    }));
  });
  const ranks=new Map(sequence.map((key,index)=>[key,index]));
  return all.sort((a,b)=>(ranks.get(a.key)??1e6)-(ranks.get(b.key)??1e6)).map((stop,index)=>({...stop,orden:index+1}));
}
function dailyPlanMessage({fecha,vehiculo,pedidos,descargas,nota}) {
  return [`Plan diario ${fecha}`,`Vehiculo: ${vehiculo}`,...pedidos.map((p,i)=>`${i+1}. ${p.numero}: ${p.origen || '-'} -> ${p.destino || '-'}`),'Orden de descargas:',...descargas.map(p=>`${p.orden}. ${p.lugar} (${p.numero}) ${String(p.fecha).slice(0,10)} ${p.hora}`),nota?`Nota: ${nota}`:''].filter(Boolean).join('\n');
}
module.exports={dailyDeliveries,dailyPlanMessage};

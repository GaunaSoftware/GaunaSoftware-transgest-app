function stops(value) { try { const data=typeof value==='string'?JSON.parse(value):value;return Array.isArray(data)?data:[]; } catch {return [];} }
export function dailyDeliveries(orders, sequence = []) {
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

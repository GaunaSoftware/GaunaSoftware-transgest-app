const list=value=>{try{const data=Array.isArray(value)?value:JSON.parse(value||'[]');return Array.isArray(data)?data.filter(item=>item&&typeof item==='object'&&!Array.isArray(item)):[];}catch{return [];}};
function driverStops(order) {
 return [['carga',list(order.puntos_carga),order.origen],['descarga',list(order.puntos_descarga),order.destino]].flatMap(([type,items,fallback])=>{
  const seen=new Map();return (items.length?items:[{direccion:fallback}]).map((point,index)=>{
   // A point id can occur twice; identify each occurrence without relying on the global row index.
   const identity=String(point.id||point.punto_id||point.punto_interes_id||[point.direccion,point.ciudad,point.nombre].filter(Boolean).join('|')||fallback||type);
   let hash=2166136261;for(const char of identity){hash^=char.charCodeAt(0);hash=Math.imul(hash,16777619);}
   const occurrence=seen.get(identity)||0;seen.set(identity,occurrence+1);
   return {...point,id:`${type}-${(hash>>>0).toString(16)}-${occurrence}`,tipo:type,index,label:point.nombre||point.direccion||point.ciudad||fallback||`${type} ${index+1}`};
  });
 });
}
const stopDone=(stop,data={})=>stop.tipo==='carga'?!!data.carga_ok:!!data.firma_entrega;
function stopData(stop,all={},stops=[]) {
 if(all.paradas?.[stop.id])return all.paradas[stop.id];
 // Preserve already completed legacy single-stop trips, without completing additional stops.
 if(stops.filter(s=>s.tipo===stop.tipo).length===1 && !Object.keys(all.paradas||{}).some(k=>k.startsWith(stop.tipo+'-'))) {
  const {paradas,...legacy}=all;
  if(stop.tipo==='descarga')for(const key of Object.keys(legacy))if(key.startsWith('mercancia_')||key.startsWith('carga_')||key==='firma_cargador'||key==='albaran_carga')delete legacy[key];
  return legacy;
 }
 return {};
}
function activeDriverStop(order,all={}) {
 if(["entregado","facturado","cancelado"].includes(order.estado))return null;
 const stops=driverStops(order);return stops.find(s=>!stopDone(s,stopData(s,all,stops)))||null;
}

export {driverStops,stopData,stopDone,activeDriverStop};

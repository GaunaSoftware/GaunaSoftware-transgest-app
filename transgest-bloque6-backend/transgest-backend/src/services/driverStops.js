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

const number=v=>Number(String(v??'').replace(',','.'));
const reject=message=>{throw Object.assign(new Error(message),{status:409,code:'DRIVER_STOP_SEQUENCE'});};
function mergeStop(order,all,patch) {
 const stops=driverStops(order),stop=stops.find(s=>s.id===patch.parada_id);
 if(!stop)reject('La parada ha cambiado. Actualiza el viaje antes de continuar.');
 const previous=stopData(stop,all,stops),next={...previous,...patch};delete next.paradas;delete next.parada_id;
 const active=activeDriverStop(order,all);
 if(stopDone(stop,previous)) {
  const changed=Object.entries(patch).some(([key,value])=>!['parada_id','updated_at'].includes(key)&&!key.endsWith('_at')&&JSON.stringify(value)!==JSON.stringify(previous[key]));
  if(changed)reject('Esta parada ya está confirmada. Solicita a tráfico la corrección.');
  return {data:all,goods:null,state:order.estado,stop,idempotent:true};
 }
 const forbidden=stop.tipo==='carga'?['viaje_iniciado','posicionado_descarga','descarga_iniciada','descarga_ok','firma_entrega','albaran_descarga']:['carga_iniciada','carga_proceso','carga_ok','firma_cargador','albaran_carga'];
 if(forbidden.some(key=>Object.hasOwn(patch,key)))reject('La acción no corresponde al tipo de parada.');
 if(Object.entries(patch).some(([key,value])=>typeof value==='boolean'&&previous[key]===true&&value===false))reject('No puedes deshacer una confirmación registrada.');
 if(active?.id!==stop.id&&!stopDone(stop,previous))reject('Completa primero la parada anterior.');
 if(stop.tipo==='carga') {
  if(patch.carga_proceso&&!previous.carga_iniciada)reject('Marca primero posicionado en carga.');
  if(patch.mercancia_confirmada){
   if(!previous.carga_proceso)reject('Inicia primero la carga.');
   if(!String(next.mercancia_cargada||'').trim()||!(number(next.mercancia_palets)>0)||!(number(next.mercancia_peso_kg)>0))reject('Indica mercancía, bultos y peso válidos para esta carga.');
  }
  if(patch.carga_ok&&!(next.carga_proceso&&next.mercancia_confirmada&&next.albaran_carga&&next.firma_cargador))reject('Confirma mercancía, albarán y firma de esta carga antes de finalizar.');
 } else {
  if(patch.mercancia_confirmada&&!previous.descarga_iniciada)reject('Inicia primero esta descarga.');
  if(patch.descarga_iniciada&&!previous.posicionado_descarga)reject('Marca primero posicionado para descarga.');
  if(patch.descarga_ok&&!(next.descarga_iniciada&&next.mercancia_confirmada))reject('Confirma la mercancía, bultos y peso descargados antes de finalizar.');
  if(patch.firma_entrega&&!(next.descarga_ok&&next.albaran_descarga))reject('Completa la descarga y adjunta el albarán antes de firmar.');
  if(patch.mercancia_confirmada&&(!String(next.mercancia_cargada||'').trim()||!(number(next.mercancia_palets)>0)||!(number(next.mercancia_peso_kg)>0)))reject('Indica mercancía, bultos y peso válidos para esta descarga.');
 }
 const paradas={...all.paradas,[stop.id]:{...next,tipo:stop.tipo,label:stop.label,index:stop.index,updated_at:new Date().toISOString()}};
 // Copy single-stop legacy progress once to avoid losing it when the first per-stop entry is written.
 for(const s of stops)if(!paradas[s.id]){const data=stopData(s,all,stops);if(Object.keys(data).length)paradas[s.id]={...data,tipo:s.tipo,label:s.label,index:s.index};}
 const loads=stops.filter(s=>s.tipo==='carga'),unloads=stops.filter(s=>s.tipo==='descarga');
 const completeLoad=loads.every(s=>paradas[s.id]?.carga_ok),completeDelivery=unloads.every(s=>paradas[s.id]?.firma_entrega);
 const result={...all,paradas,carga_ok:completeLoad,descarga_ok:completeDelivery,firma_entrega:completeDelivery,updated_at:new Date().toISOString()};
 const confirmed=loads.map(s=>paradas[s.id]).filter(d=>d?.mercancia_confirmada);
 const goods=confirmed.length?{mercancia:[...new Set(confirmed.map(d=>d.mercancia_cargada))].join(' · '),bultos:confirmed.reduce((n,d)=>n+number(d.mercancia_palets),0),peso_kg:confirmed.reduce((n,d)=>n+number(d.mercancia_peso_kg),0)}:null;
 if(stop.tipo==='descarga'&&patch.mercancia_confirmada&&goods){
  const delivered=unloads.map(s=>paradas[s.id]).filter(d=>d?.mercancia_confirmada);
  if(delivered.reduce((sum,d)=>sum+number(d.mercancia_peso_kg),0)>goods.peso_kg+0.01||delivered.reduce((sum,d)=>sum+number(d.mercancia_palets),0)>goods.bultos)reject('La suma de las descargas supera la mercancía cargada. Revisa las cantidades.');
 }
 const state=completeDelivery?'entregado':stop.tipo==='descarga'?(next.firma_entrega?'en_curso':next.descarga_iniciada?'descarga':next.posicionado_descarga?'espera_descarga':'en_curso'):next.carga_ok?'en_curso':next.carga_proceso?'cargando':'espera_carga';
 return {data:result,goods,state,stop};
}
async function saveStop(db,{pedidoId,empresaId,choferId,patch}) {
 return db.transaction(async client=>{
  const order=(await client.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[pedidoId,empresaId])).rows[0];
  if(!order)reject('Pedido no encontrado.');
  if(['cancelado','facturado'].includes(order.estado))reject('Este viaje ya no admite cambios operativos.');
  const current=(await client.query('SELECT data FROM pedido_chofer_pasos WHERE pedido_id=$1 AND empresa_id=$2',[pedidoId,empresaId])).rows[0]?.data||{};
  const merged=mergeStop(order,current,patch);
  if(merged.idempotent)return merged;
  if(patch.firma_cargador||patch.firma_entrega){
   const evidence=order.firma_evidencia?.paradas?.[patch.parada_id];
   if(!evidence?.firma?.hash)reject('Registra primero la firma de esta parada.');
  }
  // Serialize assignment checks for the same truck/driver as well as the trip.
  const resources=[order.vehiculo_id,order.chofer_id,order.chofer2_id].filter(Boolean).sort();
  for(const resource of resources)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${empresaId}:${resource}`]);
  const other=(await client.query(`SELECT id,numero FROM pedidos WHERE empresa_id=$1 AND id<>$2 AND estado::text IN ('en_curso','descarga','cargando','espera_carga','espera_descarga') AND (($3::uuid IS NOT NULL AND vehiculo_id=$3) OR chofer_id=ANY($4::uuid[]) OR chofer2_id=ANY($4::uuid[])) LIMIT 1`,[empresaId,pedidoId,order.vehiculo_id||null,[order.chofer_id,order.chofer2_id].filter(Boolean)])).rows[0];
  if(other)reject(`El vehículo o conductor tiene otro viaje activo (${other.numero||other.id}).`);
  await client.query(`INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,chofer_id,data,updated_at) VALUES($1,$2,$3,$4,NOW())
   ON CONFLICT(pedido_id) DO UPDATE SET data=EXCLUDED.data,chofer_id=COALESCE(EXCLUDED.chofer_id,pedido_chofer_pasos.chofer_id),updated_at=NOW()`,[pedidoId,empresaId,choferId,JSON.stringify(merged.data)]);
  await client.query('UPDATE pedidos SET estado=$1,updated_at=NOW() WHERE id=$2 AND empresa_id=$3',[merged.state,pedidoId,empresaId]);
  if(merged.goods)await client.query('UPDATE pedidos SET mercancia=$1,bultos=$2,peso_kg=$3,updated_at=NOW() WHERE id=$4 AND empresa_id=$5',[merged.goods.mercancia,merged.goods.bultos,merged.goods.peso_kg,pedidoId,empresaId]);
  if(choferId)await client.query("UPDATE choferes SET estado=$1 WHERE id=$2 AND empresa_id=$3 AND COALESCE(estado,'disponible') NOT IN ('baja','vacaciones','ausencia')",[merged.state==='entregado'?'disponible':merged.state==='en_curso'?'en_ruta':merged.stop.tipo==='descarga'?'descargando':'carga',choferId,empresaId]);
  return merged;
 });
}
module.exports={driverStops,stopData,stopDone,activeDriverStop,mergeStop,saveStop};

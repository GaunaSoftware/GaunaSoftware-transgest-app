const crypto=require('node:crypto');
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
async function validateRoutePoints(tx,company,body){
 const result={};
 for(const key of ['origen_punto_id','destino_punto_id']){
  if(body[key]===undefined)continue;
  const id=body[key]||null;
  if(id&&(!UUID.test(id)||!(await tx.query('SELECT id FROM puntos_interes WHERE id=$1 AND empresa_id=$2 AND activo=true',[id,company])).rows.length))throw fail('El punto seleccionado no pertenece a esta empresa o ya no está activo.',404);
  result[key]=id;
 }
 return result;
}
async function saveCustomerRouteTerms(tx,company,customer,route,body){
 const points=await validateRoutePoints(tx,company,body);
 const fields={...points};
 for(const key of ['notas','observaciones_factura'])if(body[key]!==undefined){
  const value=String(body[key]||'').trim();
  if(value.length>2000)throw fail('Las instrucciones y observaciones admiten hasta 2.000 caracteres.');
  fields[key]=value;
 }
 const keys=Object.keys(fields);
 if(keys.length)await tx.query(`UPDATE ruta_precios_cliente SET ${keys.map((k,i)=>`${k}=$${i+1}`).join(',')} WHERE ruta_id=$${keys.length+1} AND cliente_id=$${keys.length+2}`,[...Object.values(fields),route,customer]);
}
async function orderCommercialTerms(tx,company,user,body,previous,routeId){
 // An existing order keeps the agreed terms when only its operational data changes.
 if(previous&&String(previous.ruta_id||'')===String(routeId||'')&&(!body.cliente_id||String(body.cliente_id)===String(previous.cliente_id)))return {};
 if(!routeId)return {tarifa_instrucciones:null,observaciones_factura:null};
 const customer=body.cliente_id||previous?.cliente_id;
 const row=(await tx.query(`SELECT COALESCE(rc.notas,r.notas,'') AS notas,
   COALESCE(rc.observaciones_factura,r.observaciones_factura,'') AS observaciones_factura
   FROM rutas r LEFT JOIN ruta_precios_cliente rc ON rc.ruta_id=r.id AND rc.cliente_id=$3
   WHERE r.id=$1 AND (r.empresa_id=$2 OR r.empresa_id IS NULL) AND (r.cliente_id=$3 OR rc.cliente_id=$3)`,[routeId,company,customer])).rows[0];
 if(!row)throw fail('La tarifa no pertenece al cliente seleccionado.',409);
 const instructions=String(row.notas||'').trim();
 if(instructions&&body.tarifa_notas_confirmadas!==instructions)throw fail('Revisa y acepta las instrucciones de la tarifa en el pedido. Si han cambiado, vuelve a seleccionar la tarifa.',409);
 return {observaciones_factura:String(row.observaciones_factura||'').trim()||null,
  tarifa_instrucciones:instructions?JSON.stringify({ruta_id:routeId,texto:instructions,huella:crypto.createHash('sha256').update(instructions).digest('hex'),usuario_id:user,aceptadas_at:new Date().toISOString()}):null};
}
module.exports={validateRoutePoints,saveCustomerRouteTerms,orderCommercialTerms};

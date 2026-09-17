const list=value=>{if(Array.isArray(value))return value;try{return JSON.parse(value||'[]');}catch{return [];}};
async function deliveryData(db,company,id,lines){
 const row=(await db.query(`SELECT p.*,to_jsonb(c) AS delivery_client,to_jsonb(e) AS delivery_company,
 to_jsonb(co) AS delivery_carrier,to_jsonb(v) AS delivery_vehicle,to_jsonb(r) AS delivery_trailer
 FROM pedidos p LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id JOIN empresas e ON e.id=p.empresa_id
 LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id
 LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
 LEFT JOIN vehiculos r ON r.id=COALESCE(p.remolque_id,v.remolque_id) AND r.empresa_id=p.empresa_id
 WHERE p.id=$1 AND p.empresa_id=$2`,[id,company])).rows[0];
 if(!row)throw Object.assign(new Error('Pedido no encontrado.'),{status:404});
 const e=row.delivery_company||{},profile=e.cfg_precios?.empresa_perfil||e.cfg_precios||{},c=row.delivery_client||{};
 const issuer={...profile,...Object.fromEntries(Object.entries(e).filter(([,value])=>value!==null&&value!==''))};
 const identity=x=>({nombre:x.razon_social||x.nombre,cif:x.cif||x.nif,direccion:x.direccion||x.domicilio,cp:x.cp||x.codigo_postal,ciudad:x.ciudad||x.poblacion||x.municipio,provincia:x.provincia,pais:x.pais,logo_base64:x.logo_base64});
 return {empresa:identity(issuer),cliente:identity(c),cliente_nombre:c.nombre,cliente_cif:c.cif,cliente_direccion:c.direccion,
  pedido_numero:row.numero,referencia_cliente:row.referencia_cliente,origen:row.origen,destino:row.destino,
  puntos_carga:list(row.puntos_carga),puntos_descarga:list(row.puntos_descarga),fecha_carga:row.fecha_carga,fecha_descarga:row.fecha_descarga,
  transportista:identity(row.delivery_carrier||issuer),matricula:row.matricula_colaborador||row.delivery_vehicle?.matricula||row.matricula_manual,
  remolque:row.remolque_matricula_colaborador||row.delivery_trailer?.matricula||row.remolque_matricula_manual,
  peso_total:Number(row.peso_kg||0),bultos:row.bultos,palets:row.palets_cantidad,
  lineas:lines||[{referencia:row.referencia_cliente||row.numero,descripcion:row.mercancia||'Mercancía',cantidad:Number(row.bultos||1),unidad:row.bultos?'bultos':'envío',peso_kg:Number(row.peso_kg||0)/Number(row.bultos||1),parada:1}]
 };
}
module.exports={deliveryData};

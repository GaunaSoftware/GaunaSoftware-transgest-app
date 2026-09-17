const crypto=require('crypto');
const {fail}=require('./plannerInventory');
const {nextGestionPedidoNumero}=require('./pedidoNumbers');
const normalized=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
async function connect(db,company,user,input){
 const token=String(input.token||'').trim();if(!/^[a-f0-9]{64}$/i.test(token))throw fail('Introduce el código del enlace recibido por correo.');
 return db.transaction(async tx=>{
  const recipient=(await tx.query('SELECT id,cif FROM empresas WHERE id=$1',[company])).rows[0];
  const source=(await tx.query(`SELECT p.*,c.cif AS transportista_cif,e.cif AS cargador_cif,e.nombre AS cargador_nombre,e.plan AS cargador_plan,ep.modalidad AS cargador_modalidad
   FROM colaborador_pedido_tokens t JOIN pedidos p ON p.id=t.pedido_id AND p.empresa_id=t.empresa_id
   JOIN colaboradores c ON c.id=p.colaborador_id AND c.empresa_id=p.empresa_id JOIN empresas e ON e.id=p.empresa_id LEFT JOIN empresa_productos ep ON ep.empresa_id=e.id
   WHERE t.token_hash=$1 AND t.accion='confirmar' AND t.expires_at>NOW()`,[crypto.createHash('sha256').update(token).digest('hex')])).rows[0];
  if(source&&!['planner','pro_planner'].includes(source.cargador_plan)&&!['planner','combinado'].includes(source.cargador_modalidad))throw fail('El cargador no tiene Planner activo.',403);
  if(!source||source.empresa_id===company)throw fail('El encargo no está disponible para esta empresa.',404);
  if(!normalized(recipient?.cif)||normalized(recipient.cif)!==normalized(source.transportista_cif))throw fail('El NIF/CIF de tu empresa no coincide con el transportista del encargo.',403);
  if(['cancelado','entregado','facturado'].includes(source.estado))throw fail('El encargo está cerrado.',409);
  const customer=(await tx.query('SELECT id,cif FROM clientes WHERE id=$1 AND empresa_id=$2',[input.cliente_id,company])).rows[0];
  if(!customer||!normalized(source.cargador_cif)||normalized(customer.cif)!==normalized(source.cargador_cif))throw fail('Selecciona en tu cartera al cliente cuyo NIF/CIF coincide con la empresa que envía la carga.',409);
  const existing=(await tx.query('SELECT * FROM planner_conexiones_transporte WHERE empresa_id=$1 AND colaborador_id=$2 FOR UPDATE',[source.empresa_id,source.colaborador_id])).rows[0];
  if(existing&&existing.transportista_empresa_id!==company)throw fail('Este transportista ya está vinculado a otra empresa. El cargador debe revisar la conexión.',409);
  const link=(await tx.query(`INSERT INTO planner_conexiones_transporte(empresa_id,colaborador_id,transportista_empresa_id,cliente_id,created_by) VALUES($1,$2,$3,$4,$5)
   ON CONFLICT(empresa_id,colaborador_id) DO UPDATE SET cliente_id=EXCLUDED.cliente_id,activo=true RETURNING *`,[source.empresa_id,source.colaborador_id,company,customer.id,user])).rows[0];
  const current=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[source.id,source.empresa_id])).rows[0];if(!current||current.colaborador_id!==source.colaborador_id||['cancelado','entregado','facturado'].includes(current.estado))throw fail('El encargo ha cambiado. Solicita un nuevo enlace.',409);
  await tx.query("UPDATE pedidos SET colaborador_precio_confirmado=true,colaborador_precio_confirmado_at=NOW(),estado=CASE WHEN estado::text='pendiente' THEN 'confirmado'::estado_pedido ELSE estado END WHERE id=$1 AND empresa_id=$2",[source.id,source.empresa_id]);
  Object.assign(source,current);source.colaborador_precio_confirmado=true;
  return createTrip(tx,link,source);
 });
}
const copyPoints=value=>{let rows=value;if(typeof rows==='string'){try{rows=JSON.parse(rows);}catch{rows=[];}}return(Array.isArray(rows)?rows:[]).map(p=>Object.fromEntries(['nombre','direccion','ciudad','provincia','pais','codigo_postal','google_maps_url','lat','lon','lng','fecha','hora','ventana','referencia','orden'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])));};
async function createTrip(tx,link,p){
 const old=(await tx.query('SELECT viaje_id FROM planner_viajes_compartidos WHERE empresa_id=$1 AND pedido_id=$2',[p.empresa_id,p.id])).rows[0];if(old)return old;
 const number=await nextGestionPedidoNumero(tx,link.transportista_empresa_id);
 const trip=(await tx.query(`INSERT INTO pedidos(empresa_id,numero,cliente_id,origen,destino,fecha_carga,fecha_descarga,fecha_entrega,hora_carga,hora_descarga,mercancia,peso_kg,bultos,palets_cantidad,puntos_carga,puntos_descarga,importe,estado,referencia_cliente,notas)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'confirmado',$18,$19) RETURNING id,numero`,[link.transportista_empresa_id,number,link.cliente_id,p.origen,p.destino,p.fecha_carga,p.fecha_descarga,p.fecha_entrega,p.hora_carga,p.hora_descarga,p.mercancia,p.peso_kg,p.bultos,p.palets_cantidad,JSON.stringify(copyPoints(p.puntos_carga)),JSON.stringify(copyPoints(p.puntos_descarga)),Number(p.precio_colaborador||0),p.numero,`Encargo recibido de Planner: ${p.numero}`])).rows[0];
 await tx.query('INSERT INTO planner_viajes_compartidos(empresa_id,pedido_id,transportista_empresa_id,viaje_id,conexion_id) VALUES($1,$2,$3,$4,$5)',[p.empresa_id,p.id,link.transportista_empresa_id,trip.id,link.id]);return {viaje_id:trip.id,numero:trip.numero};
}
async function synchronize(db,company){
 // The caller's tenant is always part of the explicitly linked relationship.
 const links=(await db.query(`SELECT x.* FROM planner_conexiones_transporte x JOIN colaboradores c ON c.id=x.colaborador_id AND c.empresa_id=x.empresa_id JOIN empresas e ON e.id=x.transportista_empresa_id
 JOIN empresas owner ON owner.id=x.empresa_id JOIN clientes cli ON cli.id=x.cliente_id AND cli.empresa_id=e.id
 LEFT JOIN empresa_productos ep ON ep.empresa_id=owner.id LEFT JOIN empresa_productos tp ON tp.empresa_id=e.id
 WHERE x.activo AND (x.empresa_id=$1 OR x.transportista_empresa_id=$1)
 AND e.estado IN ('activo','activa') AND owner.estado IN ('activo','activa') AND e.plan IN ('profesional','enterprise','pro','pro_intelligence','pro_planner')
 AND COALESCE(tp.modalidad,'transgest')<>'planner'
 AND (owner.plan IN ('planner','pro_planner') OR (owner.plan NOT IN ('planner','pro_planner') AND ep.modalidad IN ('planner','combinado')))
 AND NULLIF(regexp_replace(upper(cli.cif),'[^A-Z0-9]','','g'),'')=regexp_replace(upper(owner.cif),'[^A-Z0-9]','','g')
 AND regexp_replace(upper(c.cif),'[^A-Z0-9]','','g')=regexp_replace(upper(e.cif),'[^A-Z0-9]','','g') ORDER BY x.id`,[company])).rows;
 let created=0;
 for(const link of links)await db.transaction(async tx=>{
  if(!(await tx.query('SELECT id FROM planner_conexiones_transporte WHERE id=$1 AND activo FOR UPDATE',[link.id])).rows.length)return;
  const pending=(await tx.query(`SELECT p.* FROM pedidos p WHERE p.empresa_id=$1 AND COALESCE(to_jsonb(p)->>'origen_producto','transgest')='planner' AND p.colaborador_id=$2 AND p.colaborador_precio_confirmado AND p.estado::text NOT IN ('cancelado','entregado','facturado') AND p.colaborador_precio_confirmado_at>=$3
   AND NOT EXISTS(SELECT 1 FROM planner_viajes_compartidos v WHERE v.empresa_id=p.empresa_id AND v.pedido_id=p.id) ORDER BY p.id LIMIT 100 FOR UPDATE`,[link.empresa_id,link.colaborador_id,link.created_at])).rows;
  for(const p of pending){await createTrip(tx,link,p);created++;}
  const pairs=(await tx.query(`SELECT v.*,p.puntos_carga AS cargas,p.puntos_descarga AS descargas FROM planner_viajes_compartidos v JOIN pedidos p ON p.id=v.pedido_id AND p.empresa_id=v.empresa_id WHERE v.conexion_id=$1 AND p.colaborador_id=$2`,[link.id,link.colaborador_id])).rows;
  for(const pair of pairs){
   await tx.query(`UPDATE pedidos t SET peso_kg=s.peso_kg,bultos=s.bultos,palets_cantidad=s.palets_cantidad,mercancia=s.mercancia,
     puntos_carga=$6::jsonb,puntos_descarga=$7::jsonb,importe=COALESCE(s.precio_colaborador,0)
     FROM pedidos s WHERE t.id=$1 AND t.empresa_id=$2 AND s.id=$3 AND s.empresa_id=$4 AND s.colaborador_id=$5
     AND t.factura_id IS NULL AND t.estado::text NOT IN ('entregado','facturado','cancelado')`,[pair.viaje_id,pair.transportista_empresa_id,pair.pedido_id,pair.empresa_id,link.colaborador_id,JSON.stringify(copyPoints(pair.cargas)),JSON.stringify(copyPoints(pair.descargas))]);
   // Local invoice and customer data stay private. Only operational state, plates and delivery evidence return to the shipper.
   await tx.query(`UPDATE pedidos s SET estado=CASE WHEN t.estado::text='facturado' THEN 'entregado'::estado_pedido ELSE t.estado END,
    matricula_colaborador=COALESCE(v.matricula,t.matricula_colaborador,s.matricula_colaborador),remolque_matricula_colaborador=COALESCE(r.matricula,t.remolque_matricula,s.remolque_matricula_colaborador),
    conductor_colaborador=COALESCE(NULLIF(TRIM(CONCAT_WS(' ',ch.nombre,ch.apellidos)),''),s.conductor_colaborador),
    incidencia_tipo=t.incidencia_tipo,incidencia_descripcion=t.incidencia_descripcion
    FROM pedidos t LEFT JOIN vehiculos v ON v.id=t.vehiculo_id AND v.empresa_id=t.empresa_id LEFT JOIN vehiculos r ON r.id=t.remolque_id AND r.empresa_id=t.empresa_id LEFT JOIN choferes ch ON ch.id=t.chofer_id AND ch.empresa_id=t.empresa_id
    WHERE s.id=$1 AND s.empresa_id=$2 AND t.id=$3 AND t.empresa_id=$4 AND s.colaborador_id=$5
    AND t.updated_at>$6 AND s.estado::text NOT IN ('cancelado','facturado','entregado') AND t.estado::text IN ('espera_carga','cargando','en_curso','espera_descarga','descarga','entregado','facturado','incidencia')`,[pair.pedido_id,pair.empresa_id,pair.viaje_id,pair.transportista_empresa_id,link.colaborador_id,pair.last_estado_ts]);
   await tx.query('UPDATE planner_viajes_compartidos v SET last_estado_ts=t.updated_at FROM pedidos t WHERE v.id=$1 AND t.id=v.viaje_id AND t.empresa_id=v.transportista_empresa_id',[pair.id]);
   const docs=(await tx.query(`SELECT d.* FROM pedido_docs d WHERE d.pedido_id=$1 AND d.empresa_id=$2 AND d.tipo IN ('pod','cmr','albaran','albaran_colaborador') AND NULLIF(d.file_base64,'') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM planner_documentos_compartidos x WHERE x.enlace_id=$3 AND x.documento_origen_id=d.id)`,[pair.viaje_id,pair.transportista_empresa_id,pair.id])).rows;
   for(const d of docs){const copied=(await tx.query('INSERT INTO pedido_docs(empresa_id,pedido_id,tipo,nombre,file_base64,file_mime,file_size_kb,notas) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[pair.empresa_id,pair.pedido_id,d.tipo,d.nombre,d.file_base64,d.file_mime,d.file_size_kb,'Entrega comunicada por el transportista conectado'])).rows[0];await tx.query('INSERT INTO planner_documentos_compartidos(empresa_id,enlace_id,documento_origen_id,documento_destino_id) VALUES($1,$2,$3,$4)',[pair.empresa_id,pair.id,d.id,copied.id]);}
  }
 });
 return {created};
}
module.exports={connect,synchronize};

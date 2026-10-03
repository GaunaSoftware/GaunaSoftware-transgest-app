const crypto=require('crypto');
const {fail}=require('./plannerInventory');
const {nextGestionPedidoNumero}=require('./pedidoNumbers');
const {canonical}=require('./transportDocumentVersions');
const consent=require('./networkConsent');
const connect=(...args)=>consent.accept(...args);
const copyPoints=value=>{let rows=value;if(typeof rows==='string'){try{rows=JSON.parse(rows);}catch{rows=[];}}return(Array.isArray(rows)?rows:[]).map(p=>Object.fromEntries(['nombre','direccion','ciudad','provincia','pais','codigo_postal','google_maps_url','lat','lon','lng','fecha','hora','ventana','referencia','orden'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])));};
async function createTrip(tx,link,p,renegotiate=false){
 if(!consent.allowed(link,'pedidos')||p.empresa_id!==link.empresa_id||p.colaborador_id!==link.colaborador_id)throw fail('Conexión no autorizada para este encargo.',403);
 const old=(await tx.query('SELECT viaje_id FROM planner_viajes_compartidos WHERE empresa_id=$1 AND pedido_id=$2',[p.empresa_id,p.id])).rows[0];if(old){if(renegotiate){const existing=(await tx.query('SELECT importe,estado,factura_id FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[old.viaje_id,link.transportista_empresa_id])).rows[0];if(Number(existing.importe)!==Number(p.precio_colaborador)){if(existing.factura_id||['entregado','facturado','cancelado'].includes(existing.estado))throw fail('El viaje receptor ya está cerrado; no se cambia su precio histórico.',409);await tx.query('UPDATE pedidos SET importe=$3 WHERE id=$1 AND empresa_id=$2',[old.viaje_id,link.transportista_empresa_id,p.precio_colaborador]);}}return old;}
 const number=await nextGestionPedidoNumero(tx,link.transportista_empresa_id);
 const trip=(await tx.query(`INSERT INTO pedidos(empresa_id,numero,cliente_id,origen,destino,fecha_carga,fecha_descarga,fecha_entrega,hora_carga,hora_descarga,mercancia,peso_kg,bultos,palets_cantidad,puntos_carga,puntos_descarga,importe,estado,referencia_cliente,notas)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'confirmado',$18,$19) RETURNING id,numero`,[link.transportista_empresa_id,number,link.cliente_id,p.origen,p.destino,p.fecha_carga,p.fecha_descarga,p.fecha_entrega,p.hora_carga,p.hora_descarga,p.mercancia,p.peso_kg,p.bultos,p.palets_cantidad,JSON.stringify(copyPoints(p.puntos_carga)),JSON.stringify(copyPoints(p.puntos_descarga)),Number(p.precio_colaborador||0),p.numero,`Encargo recibido por TransGest Network: ${p.numero}`])).rows[0];
 await tx.query('INSERT INTO planner_viajes_compartidos(empresa_id,pedido_id,transportista_empresa_id,viaje_id,conexion_id,external_reference) VALUES($1,$2,$3,$4,$5,$6)',[p.empresa_id,p.id,link.transportista_empresa_id,trip.id,link.id,p.numero]);return {viaje_id:trip.id,numero:trip.numero};
}
async function synchronize(db,company,actor=null){
 const links=(await db.query(`SELECT x.* FROM planner_conexiones_transporte x
 JOIN colaboradores c ON c.id=x.colaborador_id AND c.empresa_id=x.empresa_id
 JOIN empresas recipient ON recipient.id=x.transportista_empresa_id JOIN empresas owner ON owner.id=x.empresa_id
 JOIN clientes cli ON cli.id=x.cliente_id AND cli.empresa_id=recipient.id
 LEFT JOIN empresa_productos ep ON ep.empresa_id=recipient.id
 WHERE x.activo AND x.revocada_at IS NULL AND x.consentimiento_origen_at IS NOT NULL AND x.consentimiento_destino_at IS NOT NULL
 AND (x.empresa_id=$1 OR x.transportista_empresa_id=$1)
 AND recipient.estado IN ('activo','activa') AND owner.estado IN ('activo','activa')
 AND recipient.plan IN ('profesional','enterprise','pro','pro_intelligence','pro_planner') AND COALESCE(ep.modalidad,'transgest')<>'planner'
 AND NULLIF(regexp_replace(upper(cli.cif),'[^A-Z0-9]','','g'),'')=regexp_replace(upper(owner.cif),'[^A-Z0-9]','','g')
 AND NULLIF(regexp_replace(upper(c.cif),'[^A-Z0-9]','','g'),'')=regexp_replace(upper(recipient.cif),'[^A-Z0-9]','','g') ORDER BY x.id`,[company])).rows;
 let created=0,updated=0,documents=0;
 for(const candidate of links)await db.transaction(async tx=>{
  const link=(await tx.query('SELECT * FROM planner_conexiones_transporte WHERE id=$1 FOR UPDATE',[candidate.id])).rows[0];if(!consent.allowed(link,'pedidos'))return;
  const pending=(await tx.query(`SELECT p.* FROM pedidos p WHERE p.empresa_id=$1 AND p.colaborador_id=$2 AND p.colaborador_precio_confirmado
   AND p.estado::text NOT IN ('cancelado','entregado','facturado','borrador') AND p.colaborador_precio_confirmado_at>=$3
   AND NOT EXISTS(SELECT 1 FROM planner_viajes_compartidos v WHERE v.empresa_id=p.empresa_id AND v.pedido_id=p.id) ORDER BY p.id LIMIT 100 FOR UPDATE`,[link.empresa_id,link.colaborador_id,link.consentimiento_destino_at])).rows;
  for(const p of pending){await createTrip(tx,link,p);created++;}
  const pairs=(await tx.query('SELECT * FROM planner_viajes_compartidos WHERE conexion_id=$1 ORDER BY id',[link.id])).rows;
  for(const pair of pairs){
   const source=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 AND colaborador_id=$3 FOR UPDATE',[pair.pedido_id,pair.empresa_id,link.colaborador_id])).rows[0];
   if(!source)continue;
   const trip=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[pair.viaje_id,pair.transportista_empresa_id])).rows[0];if(!trip)continue;
   const change=async(row,values)=>{const entries=Object.entries(values).filter(([k,v])=>canonical(row[k]??null)!==canonical(v??null));if(!entries.length)return;
    // All keys originate in the fixed field whitelist below; never in request input.
    await tx.query('UPDATE pedidos SET '+entries.map(([k],i)=>k+'=$'+(i+3)).join(',')+' WHERE id=$1 AND empresa_id=$2',[row.id,row.empresa_id,...entries.map(([,v])=>Array.isArray(v)?JSON.stringify(v):v)]);updated++;
    await consent.event(tx,company,actor,'viaje.sincronizado',{link:link.id,data:{pedido_id:pair.pedido_id,viaje_id:pair.viaje_id,campos:entries.map(([k])=>k)}});
   };
   if(!trip.factura_id&&!['entregado','facturado','cancelado'].includes(trip.estado)){
    const values=Object.fromEntries(['peso_kg','bultos','palets_cantidad','mercancia'].map(k=>[k,source[k]]));
    values.puntos_carga=copyPoints(source.puntos_carga);values.puntos_descarga=copyPoints(source.puntos_descarga);
    // Price changes after acceptance require a new invitation, never silently reprice an accepted trip.
    if(consent.allowed(link,'estados')&&source.estado==='cancelado')values.estado='cancelado';
    await change(trip,values);
   }
   if(!['cancelado','facturado','entregado'].includes(source.estado)){
    const values={};
    if(consent.allowed(link,'estados')&&['espera_carga','cargando','cargado','en_curso','espera_descarga','descarga','entregado','facturado','incidencia'].includes(trip.estado)){
     values.estado=trip.estado==='facturado'?'entregado':trip.estado;values.incidencia_tipo=trip.incidencia_tipo;values.incidencia_descripcion=trip.incidencia_descripcion;
    }
    if(consent.allowed(link,'recursos')){
     const resources=(await tx.query(`SELECT v.matricula,r.matricula AS remolque,NULLIF(TRIM(CONCAT_WS(' ',ch.nombre,ch.apellidos)),'') AS conductor
       FROM pedidos p LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
       LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id LEFT JOIN choferes ch ON ch.id=p.chofer_id AND ch.empresa_id=p.empresa_id WHERE p.id=$1 AND p.empresa_id=$2`,[trip.id,trip.empresa_id])).rows[0];
     values.matricula_colaborador=resources?.matricula||trip.matricula_colaborador||null;
     values.remolque_matricula_colaborador=resources?.remolque||trip.remolque_matricula||null;
     values.conductor_colaborador=resources?.conductor||null;
    }
    await change(source,values);
   }
   const types=[...(consent.allowed(link,'pod')?['pod','albaran_colaborador']:[]),...(consent.allowed(link,'documentos')?['cmr','albaran']:[])];
   if(types.length){
    const docs=(await tx.query(`SELECT d.* FROM pedido_docs d WHERE d.pedido_id=$1 AND d.empresa_id=$2 AND d.tipo=ANY($4::text[]) AND NULLIF(d.file_base64,'') IS NOT NULL
     AND NOT EXISTS(SELECT 1 FROM planner_documentos_compartidos x WHERE x.enlace_id=$3 AND x.documento_origen_id=d.id)`,[pair.viaje_id,pair.transportista_empresa_id,pair.id,types])).rows;
    for(const d of docs){const copied=(await tx.query('INSERT INTO pedido_docs(empresa_id,pedido_id,tipo,nombre,file_base64,file_mime,file_size_kb,notas) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',[pair.empresa_id,pair.pedido_id,d.tipo,d.nombre,d.file_base64,d.file_mime,d.file_size_kb,'Entrega compartida por TransGest Network'])).rows[0];await tx.query('INSERT INTO planner_documentos_compartidos(empresa_id,enlace_id,documento_origen_id,documento_destino_id) VALUES($1,$2,$3,$4)',[pair.empresa_id,pair.id,d.id,copied.id]);documents++;await consent.event(tx,company,actor,'documento.compartido',{link:link.id,data:{origen:d.id,destino:copied.id,tipo:d.tipo}});}
   }
  }
 });
 return {created,updated,documents};
}
module.exports={connect,synchronize,createTrip,copyPoints};

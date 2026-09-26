const crypto=require('crypto'),docs=require('./transportDocumentVersions');
const {fail}=require('./plannerInventory');
async function delivery(tx,company,user,id){
 const prep=(await tx.query('SELECT * FROM planner_preparaciones WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[id,company])).rows[0];
 if(!prep||!['lista','expedida'].includes(prep.estado))throw fail('Completa la preparación antes de generar el albarán.',409);
 const lines=(await tx.query(`SELECT l.referencia,l.descripcion,l.unidad,l.cantidad,l.parada,l.peso_kg,e.lote,e.ubicacion
 FROM planner_preparacion_lineas l JOIN planner_existencias e ON e.id=l.existencia_id AND e.empresa_id=l.empresa_id
 WHERE l.preparacion_id=$1 AND l.empresa_id=$2 ORDER BY l.parada,l.referencia,l.id`,[id,company])).rows;
 const datos=await require('./deliveryData').deliveryData(tx,company,prep.pedido_id,lines);
 const fingerprint=docs.hash(docs.canonical(datos));
 const previous=(await tx.query('SELECT * FROM planner_albaran_versiones WHERE empresa_id=$1 AND preparacion_id=$2 ORDER BY version DESC LIMIT 1',[company,id])).rows[0];
 if(previous?.material_hash===fingerprint)return previous;
 const legacy=(await tx.query('SELECT * FROM planner_albaranes WHERE empresa_id=$1 AND preparacion_id=$2',[company,id])).rows[0];
 const version=previous?previous.version+1:legacy?2:1;
 const record={id:crypto.randomUUID(),empresa_id:company,preparacion_id:id,numero:`${legacy?.numero||'ALB-'+datos.pedido_numero}-${version}-${crypto.randomUUID().slice(0,6).toUpperCase()}`,version,datos};
 const pdf=await require('./plannerDeliveryPdf').deliveryPdf(record);
 if(!legacy)await tx.query('INSERT INTO planner_albaranes(id,empresa_id,preparacion_id,numero,datos,created_by) VALUES($1,$2,$3,$4,$5,$6)',[record.id,company,id,record.numero,JSON.stringify(datos),user]);
 await tx.query('INSERT INTO planner_albaran_versiones(id,empresa_id,preparacion_id,numero,version,datos,material_hash,pdf,pdf_hash,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[record.id,company,id,record.numero,version,JSON.stringify(datos),fingerprint,pdf,docs.hash(pdf),user]);
 await tx.query("INSERT INTO pedido_docs(empresa_id,pedido_id,tipo,nombre,file_mime,file_base64,file_size_kb) VALUES($1,$2,'albaran_carga',$3,'application/pdf',$4,$5)",[company,prep.pedido_id,record.numero+'.pdf',pdf.toString('base64'),Math.ceil(pdf.length/1024)]);
 return {...record,pdf,pdf_hash:docs.hash(pdf)};
}
async function prepareDeca(tx,company,user,orderId,baseUrl){
 const row=(await tx.query(`SELECT p.*,to_jsonb(e) AS issuer,to_jsonb(c) AS customer,to_jsonb(co) AS carrier,v.matricula AS veh_matricula,r.matricula AS rem_matricula
 FROM pedidos p JOIN empresas e ON e.id=p.empresa_id LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
 LEFT JOIN colaboradores co ON co.id=p.colaborador_id AND co.empresa_id=p.empresa_id LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
 LEFT JOIN vehiculos r ON r.id=p.remolque_id AND r.empresa_id=p.empresa_id WHERE p.id=$1 AND p.empresa_id=$2`,[orderId,company])).rows[0];
 if(!row)throw fail('Carga no encontrada.',404);
 const profile=row.issuer.cfg_precios?.empresa_perfil||row.issuer.cfg_precios||{};
 const issuer={...profile,...Object.fromEntries(Object.entries(row.issuer).filter(([,v])=>v!==null&&v!==''))};
 const customer={...row.customer,poblacion:row.customer?.municipio||row.customer?.ciudad};
 const carrier={...row.carrier,direccion:[row.carrier?.calle,row.carrier?.num_ext].filter(Boolean).join(' '),cp:row.carrier?.codigo_postal,poblacion:row.carrier?.ciudad};
 const payload=require('./documentoControl').buildDocumentoControlPayload({empresaId:company,pedido:row,empresa:issuer,cliente:customer,colaborador:carrier,appBaseUrl:baseUrl});
 const shipments=(await tx.query('SELECT id FROM pedidos_envios WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY id',[company,orderId])).rows;
 const versions=[];
 for(const shipment of shipments.length?shipments:[null])versions.push(await docs.issue({query:(...a)=>tx.query(...a),transaction:fn=>fn(tx)},{empresaId:company,pedidoId:orderId,payload,envioId:shipment?.id,actorId:user,reason:'Mercancía confirmada en Planner',baseUrl}));
 return versions.map(v=>v.id);
}
async function closedLoad(tx,company,user,prep,baseUrl){
 const albaran=await delivery(tx,company,user,prep.id);
 let result={albaran_id:albaran.id,deca:'pendiente',detalle:'Completa los datos y revisa el DeCA antes de salir.'};
 await tx.query('SAVEPOINT planner_deca');
 try{const ids=await prepareDeca(tx,company,user,prep.pedido_id,baseUrl);result={...result,deca:'preparado',versiones:ids,detalle:'Documentos preparados; requieren revisión antes de salir.'};await tx.query('RELEASE SAVEPOINT planner_deca');}
 catch(e){await tx.query('ROLLBACK TO SAVEPOINT planner_deca');await tx.query('RELEASE SAVEPOINT planner_deca');result.detalle=e.status&&e.status<500?e.message:'No se pudo preparar el DeCA. Reintenta su generación desde Documentos antes de salir.';}
 await tx.query('UPDATE planner_preparaciones SET documentacion_estado=$3 WHERE id=$1 AND empresa_id=$2',[prep.id,company,JSON.stringify(result)]);
 return result;
}
async function read(tx,company,id){
 const current=(await tx.query('SELECT * FROM planner_albaran_versiones WHERE id=$1 AND empresa_id=$2',[id,company])).rows[0];
 if(current){if(docs.hash(Buffer.from(current.pdf))!==current.pdf_hash)throw fail('Fallo de integridad del albarán.',500);return current;}
 return (await tx.query('SELECT * FROM planner_albaranes WHERE id=$1 AND empresa_id=$2',[id,company])).rows[0];
}
module.exports={delivery,prepareDeca,closedLoad,read};

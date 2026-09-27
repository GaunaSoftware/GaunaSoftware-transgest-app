const crypto=require('crypto');
const {canonical}=require('./transportDocumentVersions');
const defaults={hito:'delivery',exigir_pod:true,exigir_deca:false,bloquear_incidencia:true};
const fail=(s,status=400)=>Object.assign(new Error(s),{status});
function policy(raw={}) {return {hito:raw.hito==='departure'?'departure':'delivery',exigir_pod:raw.exigir_pod!==false,exigir_deca:raw.exigir_deca===true,bloquear_incidencia:raw.bloquear_incidencia!==false};}
const factSelect=`SELECT p.*,c.nombre AS cliente_nombre,
 COALESCE(cp.reglas,gp.reglas,'{}'::jsonb) AS reglas,
 COALESCE(pasos.data,'{}'::jsonb) AS progreso,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',d.id,'hash',md5(COALESCE(d.file_base64,'')||COALESCE(to_jsonb(d)->>'file_url',''))) ORDER BY d.id)
 FROM pedido_docs d WHERE d.empresa_id=p.empresa_id AND d.pedido_id=p.id AND lower(COALESCE(d.tipo,'')||' '||d.nombre) ~ '(pod|albar|cmr)' AND (NULLIF(d.file_base64,'') IS NOT NULL OR NULLIF(to_jsonb(d)->>'file_url','') IS NOT NULL)),'[]'::jsonb) AS soportes,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('id',v.id,'scope',v.scope_key,'hash',v.pdf_hash,'envio_id',v.envio_id,'envio_ids',v.payload->'envio_ids') ORDER BY v.scope_key)
 FROM transport_document_versions v WHERE v.empresa_id=p.empresa_id AND v.pedido_id=p.id AND NOT EXISTS(SELECT 1 FROM transport_document_versions newer WHERE newer.empresa_id=v.empresa_id AND newer.pedido_id=v.pedido_id AND newer.scope_key=v.scope_key AND newer.version>v.version)),'[]'::jsonb) AS decas,
 COALESCE((SELECT jsonb_agg(e.id ORDER BY e.id) FROM pedidos_envios e WHERE e.empresa_id=p.empresa_id AND e.pedido_id=p.id),'[]'::jsonb) AS envios,
 r.huella AS review_hash
 FROM pedidos p JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
 LEFT JOIN invoice_operational_policies cp ON cp.empresa_id=p.empresa_id AND cp.scope_key=p.cliente_id::text
 LEFT JOIN invoice_operational_policies gp ON gp.empresa_id=p.empresa_id AND gp.scope_key='empresa'
 LEFT JOIN pedido_chofer_pasos pasos ON pasos.empresa_id=p.empresa_id AND pasos.pedido_id=p.id
 LEFT JOIN invoice_operational_reviews r ON r.empresa_id=p.empresa_id AND r.pedido_id=p.id`;
function departure(p) {return !!p.colaborador_en_camino_confirmada_at || p.progreso?.viaje_iniciado===true || Object.values(p.progreso?.paradas||{}).some(v=>v?.viaje_iniciado===true);}
function evaluate(p) {
 const rules=policy(p.reglas),errors=[],delivered=['entregado','facturado'].includes(p.estado);
 const eligible=delivered||(rules.hito==='departure'&&p.estado==='en_curso'&&departure(p));
 if(!eligible)errors.push(rules.hito==='departure'?'Salida real pendiente de registrar':'Entrega pendiente');
 if(rules.exigir_pod&&!p.soportes?.length)errors.push('Falta POD, albarán o CMR con archivo');
 if(rules.exigir_deca&&(!p.decas?.length||(p.envios||[]).some(id=>!p.decas.some(d=>d.envio_id===id||d.envio_ids?.includes(id)))))errors.push('DeCA pendiente para uno o más envíos');
 if(rules.bloquear_incidencia&&p.estado==='incidencia')errors.push('Incidencia operativa sin resolver');
 if(p.importe===null||p.importe===''||!Number.isFinite(Number(p.importe))||Number(p.importe)<=0)errors.push('Revisar tarifa: importe ausente, cero o negativo');
 const data={estado:p.estado,importe:p.importe,combustible:p.importe_revision_combustible,cliente_id:p.cliente_id,referencia:p.referencia_cliente,origen:p.origen,destino:p.destino,fecha_carga:p.fecha_carga,fecha_descarga:p.fecha_descarga,soportes:p.soportes,decas:p.decas,envios:p.envios,salida:departure(p),reglas:rules};
 const huella=crypto.createHash('sha256').update(canonical(data)).digest('hex');
 return {id:p.id,numero:p.numero,cliente_id:p.cliente_id,cliente_nombre:p.cliente_nombre,importe:p.importe,reglas:rules,huella,eligible,errores:errors,estado:errors.length?'excepcion':p.review_hash===huella?'listo':'revisar',documentos:{pod:p.soportes?.length||0,deca:p.decas?.length||0}};
}
async function facts(tx,company,ids){if(!ids.length)return [];return (await tx.query(factSelect+' WHERE p.empresa_id=$1 AND p.id=ANY($2::uuid[]) ORDER BY p.id',[company,ids])).rows.map(evaluate);}
async function list(tx,company,{page=1,cliente_id}={}){
 const params=[company],where=["p.empresa_id=$1","p.estado::text NOT IN ('cancelado','facturado')","COALESCE(to_jsonb(p)->>'origen_producto','transgest')<>'planner'",
 "NOT EXISTS(SELECT 1 FROM facturas f WHERE f.id=p.factura_id AND f.estado<>'borrador')",
 "NOT EXISTS(SELECT 1 FROM factura_pedidos fp JOIN facturas f ON f.id=fp.factura_id WHERE fp.pedido_id=p.id AND f.estado<>'borrador')"];
 if(cliente_id){params.push(cliente_id);where.push(`p.cliente_id=$${params.length}`);}
 const condition=where.join(' AND '),total=Number((await tx.query('SELECT count(*)::int n FROM pedidos p WHERE '+condition,params)).rows[0].n);
 const rows=(await tx.query(factSelect+' WHERE '+condition+` ORDER BY p.fecha_carga,p.id LIMIT 30 OFFSET $${params.length+1}`,[...params,(page-1)*30])).rows;
 return {data:rows.map(evaluate),total,page,limit:30,alcance:'Transporte pendiente; todas las fechas; reglas vigentes; revisión caduca al cambiar sus datos'};
}
async function review(tx,company,user,id,hash){await tx.query('SELECT id FROM pedidos WHERE empresa_id=$1 AND id=$2 FOR UPDATE',[company,id]);const value=(await facts(tx,company,[id]))[0];if(!value)throw fail('Pedido no encontrado',404);if(value.huella!==hash)throw fail('Los datos han cambiado. Actualiza y revisa de nuevo.',409);if(value.errores.length)throw fail(value.errores.join('; '),409);
 await tx.query(`INSERT INTO invoice_operational_reviews(empresa_id,pedido_id,huella,usuario_id) VALUES($1,$2,$3,$4) ON CONFLICT(empresa_id,pedido_id) DO UPDATE SET huella=$3,usuario_id=$4,revisada_at=now()`,[company,id,hash,user]);
 if(value.estado!=='listo')await tx.query("INSERT INTO invoice_operational_events(empresa_id,usuario_id,pedido_id,evento,datos) VALUES($1,$2,$3,'revision',$4)",[company,user,id,JSON.stringify(value)]);
 return {...value,estado:'listo'};
}
module.exports={defaults,policy,evaluate,departure,facts,list,review,fail};

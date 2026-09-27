const JSZip=require('jszip');
const {hash}=require('./transportDocumentVersions');
async function dossier(db,empresaId,pedidoId){
 const data=await db.transaction(async tx=>{
  const order=(await tx.query('SELECT id,numero FROM pedidos WHERE empresa_id=$1 AND id=$2',[empresaId,pedidoId])).rows[0];
  if(!order)throw Object.assign(Error('Pedido no encontrado'),{status:404});
  const versions=(await tx.query('SELECT * FROM transport_document_versions WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY scope_key,version',[empresaId,pedidoId])).rows;
  const operations=(await tx.query('SELECT * FROM operacion_evidencias WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at,id',[empresaId,pedidoId])).rows;
  const signatures=(await tx.query('SELECT e.*,a.reason AS anulacion,a.created_at AS anulada_at FROM signature_evidence e JOIN operacion_evidencias o ON o.empresa_id=e.empresa_id AND o.id=e.operation_id LEFT JOIN signature_evidence_annulments a ON a.empresa_id=e.empresa_id AND a.signature_id=e.id WHERE e.empresa_id=$1 AND o.pedido_id=$2 ORDER BY e.created_at,e.id',[empresaId,pedidoId])).rows;
  const docs=(await tx.query('SELECT id,nombre,tipo,file_base64,file_mime,metadata,created_at FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at,id',[empresaId,pedidoId])).rows;
  const events=(await tx.query('SELECT * FROM pedido_eventos WHERE empresa_id=$1 AND pedido_id=$2 ORDER BY created_at,id',[empresaId,pedidoId])).rows;
  const old=(await tx.query('SELECT pdf_base64,pdf_filename,pdf_hash_sha256 FROM documento_control_repositorio WHERE empresa_id=$1 AND pedido_id=$2',[empresaId,pedidoId])).rows;
  const lifecycle=(await tx.query('SELECT e.* FROM transport_document_events e JOIN transport_document_versions d ON d.empresa_id=e.empresa_id AND d.id=e.document_id WHERE d.empresa_id=$1 AND d.pedido_id=$2 ORDER BY e.created_at,e.id',[empresaId,pedidoId])).rows;
  return {order,versions,operations,signatures,docs,events,old,lifecycle};
 },{readOnlyRepeatableRead:true});
 const zip=new JSZip(),files=[];let bytes=0;
 function add(name,content,expected){const b=Buffer.from(content);bytes+=b.length;if(bytes>100*1024*1024)throw Object.assign(Error('El expediente supera 100 MB. Descarga los originales individualmente.'),{status:413});const sha=hash(b);if(expected&&sha!==expected)throw Error('Fallo de integridad del original '+name);zip.file(name,b);files.push({name,sha256:sha,bytes:b.length});}
 for(const v of data.versions){add(`DeCA/${v.id}-v${v.version}.pdf`,v.pdf,v.pdf_hash);add(`DeCA/${v.id}-payload.json`,JSON.stringify({id:v.id,source:v.source,version:v.version,payload:v.payload,reason:v.reason,created_at:v.created_at,created_by:v.created_by,payload_hash:v.payload_hash,retention_until:v.retention_until},null,2));}
 for(const o of data.old)if(o.pdf_base64)add('DeCA/archivo-anterior-original.pdf',Buffer.from(o.pdf_base64,'base64'),o.pdf_hash_sha256);
 for(const o of data.operations)add(`Justificantes/${o.id}-revisado.pdf`,o.pdf,o.pdf_hash);
 for(const e of data.signatures){add(`Firmas/${e.id}-justificante.pdf`,e.receipt_pdf,e.receipt_hash);add(`Firmas/${e.id}.png`,e.signature,e.signature_hash);add(`Firmas/${e.id}-evidencia.json`,JSON.stringify({evidencia:e.payload,package_hash:e.package_hash,anulacion:e.anulacion,anulada_at:e.anulada_at},null,2));}
 const missing=[];
 for(const d of data.docs){if(!d.file_base64){missing.push({id:d.id,nombre:d.nombre,motivo:'Sin bytes disponibles'});continue;}const filename=String(d.nombre||'anexo').replace(/[^a-zA-Z0-9_.-]/g,'_');add(`Anexos/${d.id}-${filename}`,Buffer.from(String(d.file_base64).replace(/^data:[^,]+,/,''),'base64'));}
 add('Eventos/historico.json',JSON.stringify(data.events,null,2));
 add('Eventos/ciclo-documentos.json',JSON.stringify(data.lifecycle,null,2));
 add('Anexos/indice.json',JSON.stringify(data.docs.map(({file_base64,...metadata})=>metadata),null,2));
 add('Preparacion/eCMR-borrador.json',JSON.stringify(require('./ecmrPreparation').build(data),null,2));
 zip.file('manifest.json',JSON.stringify({version:1,empresa_id:empresaId,pedido:data.order,generado_at:new Date().toISOString(),retencion:'No se eliminan originales automáticamente. Conservar como mínimo hasta un año después de la finalización efectiva del transporte; nunca antes de retention_until.',alcance:'Todos los originales disponibles del pedido, incluidas versiones superadas y firmas anuladas. No reconstruye bytes de versiones históricas que nunca se conservaron.',files,missing},null,2));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:3}});
}
module.exports={dossier};

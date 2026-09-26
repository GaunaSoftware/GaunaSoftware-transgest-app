const {buildDocumentoControlStructuredExport}=require('./documentoControl');
const {canonical,hash}=require('./transportDocumentVersions');

// Preparation boundary for a future eCMR provider. A DeCA issuance or a driver
// event does not prove acceptance of an electronic consignment note by its parties.
const states=Object.freeze(['borrador','emitida','aceptada','recogida','en_transito','entregada','cerrada']);
function build({order,versions,operations,signatures,docs,events}){
 const snapshots=versions.map(v=>({document_id:v.id,version:v.version,payload_hash:v.payload_hash,pdf_hash:v.pdf_hash,
  created_at:v.created_at,reason:v.reason,
  preparation:buildDocumentoControlStructuredExport({documento:v.payload.documento,status:{ready:false}}).ecmr_consignment_note,
  envios:v.payload.documento.envios||[],documento:v.payload.documento}));
 const content={schema:'transgest.ecmr.preparation.v1',pedido:order,estado:'borrador',estados_admitidos:states,
  certified:false,provider_connected:false,
  limitaciones:['Preparación interna; no es una eCMR emitida, aceptada ni certificada.','Los eventos físicos del transporte no sustituyen la aceptación documental de las partes.','Requiere validar el procedimiento y el proveedor antes de activar transiciones eCMR.'],
  versions:snapshots,
  operations:operations.map(o=>({id:o.id,version:o.version,payload:o.payload,payload_hash:o.payload_hash,pdf_hash:o.pdf_hash})),
  signatures:signatures.map(s=>({id:s.id,operation_id:s.operation_id,payload:s.payload,package_hash:s.package_hash,receipt_hash:s.receipt_hash,replaces_id:s.replaces_id,anulacion:s.anulacion,anulada_at:s.anulada_at})),
  attachments:docs.map(({file_base64,...metadata})=>metadata),audit:events};
 return {...content,integrity_sha256:hash(canonical(content))};
}
module.exports={build,states};

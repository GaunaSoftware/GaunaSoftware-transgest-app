// Synthetic HTTP flow only. Uses the same review/version/consent boundary as the app.
const crypto=require('node:crypto');
module.exports=async function(call,url,stopId){
 const op=await call('POST',url+'/preparar',{parada_id:stopId});
 const body={parada_id:stopId,operation_id:op.id,document_hash:op.pdf_hash,client_operation_uuid:crypto.randomUUID(),identidad:{nombre:'Firmante',apellidos:'Sintético QA',empresa:'Empresa sintética'},revisado:true,conforme_version:true,firma_destinatario:require('./synthetic_signature_fixture.cjs')(),gps_status:'denied',timezone:'Europe/Madrid'};
 return call('POST',url,body);
};

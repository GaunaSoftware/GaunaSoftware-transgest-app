import {signaturePayload} from './signaturePayload';

test.each(['cargador','destinatario'])('firma %s preserves the prepared operation and consent',role=>{
 const evidence={operation_id:'prepared-uuid',client_operation_uuid:'submission-uuid',document_hash:'pdf-hash',identidad:{nombre:'Ana',apellidos:'Prueba',empresa:'Ejemplo'},revisado:true,conforme_version:true};
 expect(signaturePayload({stopId:'stop-uuid',role,image:'data:image/png;base64,AA',name:'Ana Prueba',evidence})).toEqual(expect.objectContaining({...evidence,parada_id:'stop-uuid',rol:role,firma_destinatario:'data:image/png;base64,AA'}));
});

const {getEmpresaFiscalConfig,saveEmpresaFiscalConfig}=require('./fiscal');
async function recordRepresentation(client,empresaId,actorId,input,adminId=null) {
 const states=['no_configurada','pendiente','valida','rechazada','caducada'];
 if(!states.includes(input.estado))throw Object.assign(new Error('Estado de representación no válido'),{status:422});
 const config=await getEmpresaFiscalConfig(empresaId,client);
 const reference=String(input.referencia || '').trim().slice(0,500);
 if(input.estado==='valida' && (!config.nif_declarante || !reference || input.confirmed!==true))throw Object.assign(new Error('Confirma la validación por Verifacti e indica su referencia.'),{status:422});
 if(input.expires_at && !Number.isFinite(Date.parse(input.expires_at)))throw Object.assign(new Error('Caducidad no válida'),{status:422});
 const representation={estado:input.estado,nif:config.nif_declarante,referencia:reference,validated_at:input.estado==='valida'?new Date().toISOString():null,expires_at:input.expires_at || null,updated_at:new Date().toISOString(),updated_by:actorId,superadmin_id:adminId,source:'manual_verified'};
 config.verifactu.representacion=representation;
 await saveEmpresaFiscalConfig(empresaId,config,client,{allowRepresentationUpdate:true});
 await client.query("INSERT INTO audit_log(tabla,registro_id,campo,valor_nuevo,usuario_id,empresa_id) VALUES('empresas',$1,'verifacti_representacion',$2,$3,$1)",[empresaId,JSON.stringify(representation),actorId]);
 return representation;
}
module.exports={recordRepresentation};

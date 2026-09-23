const db=require('./db');
const {digest}=require('./fiscalIdentity');
const {getEmpresaFiscalConfig,ensureFacturaFiscalRecord}=require('./fiscal');
const {mapInternalPayloadToVerifacti,probeVerifactiConnection}=require('./fiscalProviderVerifacti');
const fail=(message)=>{throw Object.assign(new Error(message),{status:409,code:'FISCAL_NOT_READY'});};
function assertRepresentation(config) {
 if(config.entorno!=='produccion')return;
 const r=config.verifactu.representacion || {};
 if(r.estado!=='valida' || r.nif!==config.nif_declarante || !r.validated_at || !r.referencia || (r.expires_at && new Date(r.expires_at).getTime()<=Date.now()))fail('Valida la representación de esta empresa en Verifacti antes de emitir.');
 const d=config.declaracion_responsable || {};
 if(!d.visible || !/^https:\/\//.test(d.url || '') || !d.fecha || !d.version || !d.productor)fail('Publica la declaración responsable con productor, versión y fecha antes de emitir.');
}
async function prepareFiscalEmission({facturaId,empresaId,actorUserId}) {
 const config=await getEmpresaFiscalConfig(empresaId);
 if(config.modo!=='verifactu' || config.verifactu.proveedor!=='verifacti')return {skipped:true};
 assertRepresentation(config);
 if(!config.verifactu.envio_automatico)fail('Activa el envío automático a Verifacti para emitir.');
 const health=await probeVerifactiConnection(config);
 if(!health.ok)fail(health.message);
 await db.transaction(async client=>{
  const invoice=await client.query('SELECT estado FROM facturas WHERE id=$1 AND empresa_id=$2 FOR UPDATE',[facturaId,empresaId]);
  if(invoice.rows[0]?.estado!=='borrador')fail('La factura ha cambiado. Actualiza el listado.');
  await require('./invoiceReview').assertReviewed(client,facturaId,empresaId);
  const result=await ensureFacturaFiscalRecord({facturaId,empresaId,actorUserId,allowEmissionIntent:true,client});
  const request=mapInternalPayloadToVerifacti(result.record.payload);
  await client.query(`UPDATE factura_envios_fiscales SET idempotency_key=COALESCE(idempotency_key,$1),request_payload=COALESCE(request_payload,$2::jsonb),request_hash=COALESCE(request_hash,$3),first_attempt_at=COALESCE(first_attempt_at,NOW()) WHERE registro_id=$4 AND empresa_id=$5`,[`transgest:${empresaId}:${facturaId}:${result.record.id}`,JSON.stringify(request),digest(request),result.record.id,empresaId]);
 });
 await db.transaction(client=>require('./fiscalProcessor').processPendingFiscalQueue({empresaId,facturaId,actorUserId,limit:1,client}));
 const record=await db.query('SELECT official_qr_url,official_qr_base64,ultimo_error FROM factura_registros_fiscales WHERE factura_id=$1 AND empresa_id=$2',[facturaId,empresaId]);
 if(!record.rows[0]?.official_qr_url || !record.rows[0]?.official_qr_base64)fail(record.rows[0]?.ultimo_error || 'Emisión pendiente de obtener el registro y QR oficial. La solicitud está guardada; vuelve a comprobarla sin crear otra factura.');
 return {ok:true};
}
module.exports={prepareFiscalEmission,assertRepresentation};

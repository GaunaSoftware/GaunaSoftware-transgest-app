const crypto=require('crypto');
const {extractVerifactiWebhookPayload}=require('./fiscalProviderVerifacti');
const {markQueueAccepted,markQueuePending,markQueueError,findLatestQueueItemByProviderUuid}=require('./fiscalQueueState');
function validSignature(raw,signature,secret) {
 if(!Buffer.isBuffer(raw) || !secret || !/^[a-f0-9]{64}$/i.test(String(signature||'')))return false;
 const calculated=crypto.createHmac('sha256',secret).update(raw).digest();
 return crypto.timingSafeEqual(calculated,Buffer.from(signature,'hex'));
}
async function processReceipts(client,empresaId) {
 const {rows}=await client.query(`SELECT * FROM fiscal_webhook_receipts WHERE empresa_id=$1 AND provider='verifacti' AND processed_at IS NULL AND next_retry_at<=NOW() ORDER BY received_at LIMIT 5 FOR UPDATE SKIP LOCKED`,[empresaId]);
 for(const receipt of rows){
  let missing=false;
  for(const record of receipt.payload || []){
   const result=extractVerifactiWebhookPayload(record);
   const item=await findLatestQueueItemByProviderUuid(client,empresaId,'verifactu',result.provider_uuid);
   if(!item){missing=true;continue;}
   if(result.provider_status==='accepted')await markQueueAccepted(client,item,result,null);
   else if(result.provider_status==='pending')await markQueuePending(client,item,result,null);
   else await markQueueError(client,item,record.mensaje_error || (result.provider_status==='accepted_with_errors'?'Aceptada con errores: requiere subsanación.':'Registro rechazado por AEAT.'),null,false,result);
  }
  await client.query(`UPDATE fiscal_webhook_receipts SET processed_at=CASE WHEN $1 THEN NULL ELSE NOW() END,next_retry_at=NOW()+INTERVAL '2 minutes',last_error=$2 WHERE empresa_id=$3 AND provider='verifacti' AND event_id=$4`,[missing,missing?'UUID pendiente de correlacionar; no se ha actualizado ninguna factura ajena.':null,empresaId,receipt.event_id]);
 }
}
module.exports={validSignature,processReceipts};

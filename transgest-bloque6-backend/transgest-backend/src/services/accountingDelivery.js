const db=require('./db');
const {pushFacturaToAccounting}=require('./accountingSync');
async function processInternal(empresaId) {
 const {rows}=await db.query(`UPDATE accounting_invoice_outbox SET status='processing',attempts=attempts+1,updated_at=NOW() WHERE id IN (SELECT id FROM accounting_invoice_outbox WHERE empresa_id=$1 AND provider='internal' AND status IN ('pending','failed','processing') AND attempts<8 AND (attempts=0 OR updated_at<NOW()-INTERVAL '5 minutes') ORDER BY created_at LIMIT 10 FOR UPDATE SKIP LOCKED) RETURNING *`,[empresaId]);
 for(const item of rows){
  const result=await pushFacturaToAccounting({empresaId,factura:{...item.payload.invoice,estado:'emitida'},clienteId:item.payload.source_party_id,fromOutbox:true,partySnapshot:item.payload.party});
  await db.query("UPDATE accounting_invoice_outbox SET status=$1,last_error=$2,processed_at=CASE WHEN $1='synced' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$3 AND empresa_id=$4",[result.ok?'synced':'failed',result.ok?null:String(result.error || result.reason || `HTTP ${result.status || 'no disponible'}`),item.id,empresaId]);
 }
}
module.exports={processInternal};

const fs=require('fs'),path=require('path');
const schemaSql=fs.readFileSync(path.join(__dirname,'../../scripts/migrations/20261002_supplier_document_email.sql'),'utf8');
function createSupplierDocumentNotifications({db,prepare,send,logger=console}){
  let schema,timer,processing;
  const ensure=()=>schema||(schema=db.query(schemaSql).catch(e=>{schema=null;throw e;}));
  async function enqueue({empresa_id,pedido_id,colaborador_id,version_key,base_url}){
    await ensure();
    return (await db.query(`INSERT INTO pedido_deca_email_jobs(empresa_id,pedido_id,colaborador_id,version_key,base_url)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(empresa_id,pedido_id,colaborador_id,version_key) DO UPDATE SET version_key=EXCLUDED.version_key RETURNING *`,[empresa_id,pedido_id,colaborador_id,version_key,base_url])).rows[0];
  }
  async function claim(id){return db.transaction(async tx=>{
    const row=(await tx.query(`SELECT id FROM pedido_deca_email_jobs WHERE status IN ('pending','failed','processing') AND attempts<8 AND available_at<=now()
      AND ($1::uuid IS NULL OR id=$1) ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED`,[id||null])).rows[0];
    return row?(await tx.query(`UPDATE pedido_deca_email_jobs SET status='processing',attempts=attempts+1,available_at=now()+interval '10 minutes' WHERE id=$1 RETURNING *`,[row.id])).rows[0]:null;
  });}
  async function deliver(id){
    await ensure();const job=await claim(id);if(!job)return false;
    let status='failed',error=null;
    try{
      const context=await prepare(job);
      if(!context){status='obsolete';error='El pedido, colaborador o las versiones han cambiado; este envío ya no corresponde.';}
      else{const result=await send(context,job);if(result?.simulado||result?.error)throw Error('El servidor de correo no ha confirmado el envío.');status='sent';}
    }catch(e){error=e.status?e.message:'El correo no se ha enviado. Revisa SMTP y reintenta desde el pedido.';logger.warn('DeCA pendiente de correo:',e.message);}
    await db.query(`UPDATE pedido_deca_email_jobs SET status=$3,last_error=$4,available_at=now()+interval '5 minutes',sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END WHERE id=$1 AND empresa_id=$2 AND attempts=$5`,[job.id,job.empresa_id,status,error,job.attempts]);
    return status==='sent';
  }
  async function drain(){if(processing)return processing;processing=(async()=>{await ensure();for(let i=0;i<3;i++){const row=(await db.query("SELECT id FROM pedido_deca_email_jobs WHERE status IN ('pending','failed','processing') AND attempts<8 AND available_at<=now() ORDER BY created_at LIMIT 1")).rows[0];if(!row)break;await deliver(row.id);}})().finally(()=>{processing=null;});return processing;}
  async function retry(company,order,id){await ensure();const row=(await db.query(`UPDATE pedido_deca_email_jobs SET status='pending',attempts=0,available_at=now(),last_error=NULL WHERE empresa_id=$1 AND pedido_id=$2 AND id::text=$3 AND status='failed' RETURNING id`,[company,order,id])).rows[0];if(!row)throw Object.assign(Error('Este envío no está pendiente de reintento.'),{status:409});return {ok:true};}
  function start(){if(timer)return;timer=setInterval(()=>drain().catch(e=>logger.warn('Cola de DeCA:',e.message)),15000);timer.unref();drain().catch(e=>logger.warn('Cola de DeCA:',e.message));}
  async function stop(){clearInterval(timer);timer=null;await processing;}
  return {ensure,enqueue,deliver,drain,retry,start,stop};
}
module.exports={createSupplierDocumentNotifications,schemaSql};

const assert=require('node:assert/strict'),{PGlite}=require('@electric-sql/pglite');
const {createSupplierDocumentNotifications}=require('../src/services/supplierDocumentNotifications');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
(async()=>{const pg=new PGlite();try{
  const db={query:async(sql,params)=>params?.length?pg.query(sql,params):(await pg.exec(sql)).at(-1),transaction:fn=>pg.transaction(tx=>fn(tx))};let sent=0,fail=true,ready=true;
  const notifier=createSupplierDocumentNotifications({db,logger:{warn(){}},prepare:async()=>ready?{}:null,send:async()=>{if(fail)throw Object.assign(Error('SMTP down'),{status:503});sent++;return {ok:true};}});
  const job=await notifier.enqueue({empresa_id:a,pedido_id:a,colaborador_id:a,version_key:'v1',base_url:'https://example.invalid'});
  const duplicate=await notifier.enqueue({empresa_id:a,pedido_id:a,colaborador_id:a,version_key:'v1',base_url:'https://example.invalid'});assert.equal(job.id,duplicate.id);
  assert.equal(await notifier.deliver(job.id),false);assert.equal((await pg.query('SELECT status FROM pedido_deca_email_jobs WHERE id=$1',[job.id])).rows[0].status,'failed');
  await assert.rejects(notifier.retry(b,a,job.id),{status:409});
  fail=false;await notifier.retry(a,a,job.id);assert.equal(await notifier.deliver(job.id),true);assert.equal(sent,1);
  assert.equal(await notifier.deliver(job.id),false);assert.equal(sent,1);await assert.rejects(notifier.retry(a,a,job.id),{status:409});
  const corrected=await notifier.enqueue({empresa_id:a,pedido_id:a,colaborador_id:a,version_key:'v2',base_url:'https://example.invalid'});assert.notEqual(corrected.id,job.id);
  ready=false;await notifier.deliver(corrected.id);assert.equal((await pg.query('SELECT status FROM pedido_deca_email_jobs WHERE id=$1',[corrected.id])).rows[0].status,'obsolete');assert.equal(sent,1);
  await notifier.stop();console.log('PASS DeCA email queue: duplicate reservation, SMTP failure persisted, tenant-only retry, sent job cannot repeat, corrected version creates job, changed documents suppress obsolete delivery. SMTP is synthetic.');
}finally{await pg.close();}})().catch(e=>{console.error(e);process.exitCode=1;});

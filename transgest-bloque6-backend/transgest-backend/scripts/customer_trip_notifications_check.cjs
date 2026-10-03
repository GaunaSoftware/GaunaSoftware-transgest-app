const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {createCustomerTripNotifications,recipients}=require('../src/services/customerTripNotifications');
const {customerTripEmail}=require('../src/services/customerTripEmail');
const {pedidoSelectionFilter}=require('../src/services/pedidoSelectionFilter');
async function main(){
 const pg=new PGlite();const sent=[];let fail=false;
 const db={query:(sql,args)=>args?pg.query(sql,args):pg.exec(sql).then(()=>({rows:[]})),transaction:fn=>pg.transaction(tx=>fn({query:(...args)=>tx.query(...args)}))};
 const queue=createCustomerTripNotifications({db,send:async mail=>{if(fail)return{simulado:true};sent.push(mail);return{messageId:'synthetic'};},logger:{warn(){}}});
 const company='11111111-1111-4111-8111-111111111111',customer='22222222-2222-4222-8222-222222222222',order='33333333-3333-4333-8333-333333333333';
 try{
  await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY,nombre text);CREATE TABLE clientes(id uuid,empresa_id uuid,emails_albaranes jsonb);
   CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,cliente_id uuid,numero text,estado text,origen text,destino text,mercancia text,colaborador_id uuid);CREATE TABLE usuarios(empresa_id uuid,email text,rol text,activo boolean);
   CREATE TABLE pedido_docs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,pedido_id uuid,nombre text,tipo text,file_base64 text,file_mime text);`);
  await queue.ensureSchema();
  await pg.query('INSERT INTO empresas VALUES($1,$2)',[company,'Synthetic']);
  await pg.query('INSERT INTO clientes VALUES($1,$2,$3)',[customer,company,JSON.stringify(['docs@example.invalid','status@example.invalid'])]);
  await pg.query("INSERT INTO pedidos VALUES($1,$2,$3,'QA','confirmado','A','B','Goods',NULL)",[order,company,customer]);
  await pg.query("UPDATE pedidos SET estado='cargado' WHERE id=$1",[order]);
  await pg.query("UPDATE pedidos SET estado='cargado' WHERE id=$1",[order]);
  assert.equal((await pg.query('SELECT count(*)::int n FROM pedido_cliente_email_jobs')).rows[0].n,1,'same-state retry does not queue again');
  fail=true;
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal((await pg.query('SELECT status FROM pedido_cliente_email_jobs')).rows[0].status,'failed');
  assert.equal((await pg.query('SELECT estado FROM pedidos')).rows[0].estado,'cargado','SMTP failure never rolls back operational state');
  fail=false;
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal(sent[0].datos.estado,'cargado');assert.equal(sent[0].destinatario,'docs@example.invalid,status@example.invalid');assert.equal(sent[0].require_company,true);
  await pg.transaction(async tx=>{
   await tx.query("INSERT INTO pedido_docs(empresa_id,pedido_id,nombre,tipo,file_base64) VALUES($1,$2,'one.pdf','Albaran','UERG'),($1,$2,'two.pdf','Albaran','UERG')",[company,order]);
   await tx.query("UPDATE pedidos SET estado='entregado' WHERE id=$1",[order]);
  });
  await pg.query("INSERT INTO pedido_docs(empresa_id,pedido_id,nombre,tipo,file_base64) VALUES($1,$2,'foreign.pdf','Albaran','UERG')",[customer,order]);
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal(sent.length,2);assert.equal(sent[1].attachments.length,2,'only own tenant complete batch attached');
  await pg.query("INSERT INTO pedido_docs(empresa_id,pedido_id,nombre,tipo,file_base64) VALUES($1,$2,'three.pdf','Albaran','UERG')",[company,order]);
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal(sent.length,3);assert.equal(sent[2].attachments.length,3);assert.equal(sent[2].datos.albaranes,true);
  await pg.query("UPDATE pedido_docs SET file_base64=file_base64 WHERE empresa_id=$1",[company]);
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal(sent.length,3,'unchanged uploaded document batch does not send again');
  await assert.rejects(pg.transaction(async tx=>{await tx.query("UPDATE pedidos SET estado='en_curso'");throw Error('rollback');}),/rollback/);
  assert.equal((await pg.query('SELECT count(*)::int n FROM pedido_cliente_email_jobs')).rows[0].n,3,'state and email job roll back together');
  assert.deepEqual(recipients('a@example.invalid; A@example.invalid;bad\nX@example.invalid'),['a@example.invalid','x@example.invalid']);
  const params=[company];const scope=pedidoSelectionFilter({pedido_ids:'[]'},params);
  assert.equal((await pg.query(`SELECT id FROM pedidos p WHERE p.empresa_id=$1 AND ${scope}`,params)).rows.length,0);
  assert.throws(()=>pedidoSelectionFilter({pedido_ids:'["bad"]'},[]),{status:400});
  assert.match(customerTripEmail({numero:'<script>',origen:'<img>',estado:'cargado'}).html,/&lt;script&gt;/);
  await pg.query('INSERT INTO usuarios VALUES($1,$2,$3,true),($4,$5,$3,true)',[company,'traffic@example.invalid','trafico',customer,'foreign@example.invalid']);
  await pg.query("UPDATE pedidos SET colaborador_id=$2,estado='en_curso' WHERE id=$1",[order,customer]);
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.deepEqual(sent.at(-1).bcc,['traffic@example.invalid'],'issuing company traffic receives the supplier status without exposing customer recipients');
  await pg.query("UPDATE clientes SET emails_albaranes='[]'::jsonb");
  await pg.query("UPDATE pedidos SET estado='descarga' WHERE id=$1",[order]);
  await pg.query("UPDATE pedido_cliente_email_jobs SET available_at=NOW()-INTERVAL '1 minute'");await queue.drain();
  assert.equal(sent.at(-1).destinatario,'traffic@example.invalid','issuer is notified even if customer has no status email');

  console.log('PASS transactional state/POD notification queue, SMTP retry, batch completion, dedupe, tenant isolation, rollback and exact empty dashboard scope. Synthetic recipients only.');
 }finally{await queue.stop();await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const mailbox=require('../src/services/orderMailbox'),inbox=require('../src/services/orderInbox');
const {decryptSecret}=require('../src/services/apiKeys');
(async()=>{
 const pg=new PGlite(),db={query:(...a)=>pg.query(...a),transaction:fn=>pg.transaction(tx=>fn({query:(...a)=>tx.query(...a)}))};
 const a=crypto.randomUUID(),b=crypto.randomUUID(),go=crypto.randomUUID(),actor=crypto.randomUUID();
 try{
  await pg.exec('CREATE TABLE empresas(id uuid PRIMARY KEY,plan text,estado text);');
  await pg.query("INSERT INTO empresas VALUES($1,'enterprise','activo'),($2,'enterprise','activo'),($3,'lite','activo')",[a,b,go]);
  for(const file of ['20260926_ai_inbox.sql','20260928_company_order_mailbox.sql']){const sql=fs.readFileSync(path.join(__dirname,'migrations',file),'utf8');await pg.exec(sql);await pg.exec(sql);}
  assert.equal((await mailbox.status(db,a)).state,'pendiente_configuracion');
  await mailbox.save(db,a,actor,{});assert.equal((await mailbox.status(db,a)).enabled,false);
  const draft={email:'pedidos@example.invalid',host:'imap.example.invalid',username:'pedidos@example.invalid',password:'synthetic-only-password',folder:'Pedidos',enabled:false};
  await assert.rejects(mailbox.save(db,go,actor,draft),{status:403});
  await assert.rejects(mailbox.save(db,a,actor,{...draft,enabled:true}),/prueba/);
  await assert.rejects(mailbox.save(db,a,actor,{...draft,host:'127.0.0.1'}),/público/);
  await assert.rejects(mailbox.save(db,a,actor,{...draft,port:143}),/993/);
  let cfg=await mailbox.save(db,a,actor,draft);assert.equal(cfg.password,'');assert.equal(cfg.has_password,true);
  const stored=(await db.query('SELECT * FROM empresa_order_mailbox WHERE empresa_id=$1',[a])).rows[0];
  assert.notEqual(stored.secret_encrypted,draft.password);assert.equal(decryptSecret(stored.secret_encrypted),draft.password);
  assert.equal((await mailbox.status(db,b)).email,'');
  let uidNext=11,validity=15,calls=0,closed=0,large=false;
  const connector=async()=>{calls++;return {mailbox:{uidNext,uidValidity:BigInt(validity)},close:()=>closed++,client:{
   fetchAll:async(range,query,opts)=>{assert.equal(opts.uid,true);return Array.from({length:uidNext-11},(_,i)=>({uid:11+i,size:large?mailbox.MAX_MESSAGE+1:200}));},
   fetchOne:async(uid,query,opts)=>{assert.equal(opts.uid,true);assert.equal(query.source.maxLength,mailbox.MAX_MESSAGE+1);return {source:Buffer.from(`Message-ID: <synthetic-${uid}@example.invalid>\r\nSubject: Pedido ${uid}\r\n\r\nOrigen: Madrid. Destino: Valencia. Mercancia: sacos.`)};}
  }};};
  await assert.rejects(mailbox.run(db,a,{connector}),/desactivada/);assert.equal(calls,0);
  let result=await mailbox.run(db,a,{test:true,connector});assert.equal(result.config.state,'desactivado');assert.equal((await db.query('SELECT * FROM ai_inbox_items')).rows.length,0);
  cfg=await mailbox.save(db,a,actor,{...result.config,enabled:true});assert.equal(cfg.enabled,true);
  uidNext=13;result=await mailbox.run(db,a,{connector});assert.equal(result.received,2);
  const entries=(await db.query('SELECT id,empresa_id FROM ai_inbox_items')).rows;assert.equal(entries.length,2);assert.ok(entries.every(e=>e.empresa_id===a));
  const original=await inbox.get(db,a,entries[0].id,{payload:true});assert.equal(original.payload.source,'email_imap');
  await assert.rejects(inbox.get(db,b,entries[0].id),{status:404});
  await db.query('UPDATE empresa_order_mailbox SET last_uid=10 WHERE empresa_id=$1',[a]);
  assert.equal((await mailbox.run(db,a,{connector})).received,0,'retry deduplicates after cursor write failure');
  await db.query("UPDATE empresa_order_mailbox SET lease_until=now()+interval '1 minute' WHERE empresa_id=$1",[a]);
  await assert.rejects(mailbox.run(db,a,{connector}),{status:409});
  await assert.rejects(mailbox.save(db,a,actor,cfg),{status:409});
  await db.query('UPDATE empresa_order_mailbox SET lease_until=NULL WHERE empresa_id=$1',[a]);
  uidNext=14;large=true;await assert.rejects(mailbox.run(db,a,{connector}),/supera 6 MB/);
  assert.equal(Number((await db.query('SELECT last_uid FROM empresa_order_mailbox WHERE empresa_id=$1',[a])).rows[0].last_uid),12,'failed message remains pending');
  large=false;validity=16;await assert.rejects(mailbox.run(db,a,{connector}),/identificadores/);
  await mailbox.save(db,a,actor,{...cfg,enabled:false});await mailbox.run(db,a,{test:true,connector});
  const changed=await mailbox.save(db,a,actor,{...cfg,enabled:false,host:'other.example.invalid'});assert.equal(changed.verified_at,null);
  assert.ok(closed>0);
  console.log('PASS mailbox: incomplete draft, opt-in, encrypted credentials, first-test cursor, read-only bounded fetch, deduplication, tenant isolation, plan denial, leases, oversized mail, UIDVALIDITY reset, idempotent migration. Synthetic IMAP; no external mail.');
 }finally{await pg.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const express=require('express'),{PGlite}=require('@electric-sql/pglite');
const auth=require('../src/middleware/auth'),db=require('../src/services/db');
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
const originalAuth=auth.authenticate,originalQuery=db.query,originalTransaction=db.transaction;
(async()=>{
 const pg=new PGlite();let server;
 try{
  await pg.exec('CREATE TABLE empresas(id uuid PRIMARY KEY,plan text,estado text);CREATE TABLE email_log(id uuid,empresa_id uuid,sent_at timestamptz);');
  await pg.query("INSERT INTO empresas VALUES($1,'enterprise','activo'),($2,'enterprise','activo')",[a,b]);
  await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/20260928_company_order_mailbox.sql'),'utf8'));
  await pg.query("INSERT INTO empresa_order_mailbox(empresa_id,email) VALUES($1,'b@example.invalid')",[b]);
  await pg.query('INSERT INTO email_log VALUES($1,$1,now()),($2,$2,now()),(gen_random_uuid(),NULL,now())',[a,b]);
  db.query=(...args)=>pg.query(...args);db.transaction=fn=>pg.transaction(tx=>fn({query:(...args)=>tx.query(...args)}));
  // Authentication is a fixture boundary; real role/plan/module gates are retained.
  auth.authenticate=(req,res,next)=>{const who=req.get('x-test-user');if(!who)return res.status(401).json({error:'No autenticado'});
   req.user={id:a,empresa_id:who==='b'?b:a,rol:who==='staff'?'chofer':'gerente',plan:who==='go'?'lite':'enterprise',productos:['transgest']};req.empresaId=req.user.empresa_id;next();};
  delete require.cache[require.resolve('../src/routes/email')];const router=require('../src/routes/email');auth.authenticate=originalAuth;
  const app=express();app.use(express.json());app.use('/email',router);server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
  const call=(url,who='a',body,method=body?'PUT':'GET')=>fetch(`http://127.0.0.1:${server.address().port}/email${url}`,{method,headers:{...(who?{'x-test-user':who}:{}),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal((await call('/order-mailbox',null)).status,401);
  for(const who of ['staff','go'])for(const [url,method] of [['/order-mailbox','GET'],['/order-mailbox','PUT'],['/order-mailbox/test','POST'],['/order-mailbox/sync','POST']])assert.equal((await call(url,who,method==='GET'?undefined:{},method)).status,403);
  let response=await call(`/order-mailbox?empresa_id=${b}`);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).email,'');
  response=await call('/order-mailbox','a',{empresa_id:b,email:'a@example.invalid'});assert.equal(response.status,200);assert.equal((await response.json()).email,'a@example.invalid');
  assert.equal((await (await call('/order-mailbox','b')).json()).email,'b@example.invalid');
  const logs=await (await call('/log')).json();assert.equal(logs.length,1);assert.equal(logs[0].empresa_id,a);
  assert.equal((await call('/order-mailbox/sync','a',{},'POST')).status,422,'incomplete config cannot reach network');
  response=await call('/test','a',{destinatario:'test@example.invalid'},'POST');assert.equal(response.status,422,'SMTP cannot report success without company credentials');
  console.log('PASS HTTP mail permissions: anonymous/driver/Go denied, manager allowed, query/body tenant spoofing ignored, no-store, tenant-only logs, no false SMTP success. Auth and network are synthetic.');
 }finally{auth.authenticate=originalAuth;db.query=originalQuery;db.transaction=originalTransaction;if(server)await new Promise(resolve=>server.close(resolve));await pg.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

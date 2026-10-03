const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {normalizeSenderEmails,findSenderClient}=require('../src/services/orderClientSender');
const inbox=require('../src/services/orderInbox');
(async()=>{
 const pg=new PGlite(),db={query:(...args)=>pg.query(...args)};
 try{
  await pg.exec('CREATE TABLE clientes(id UUID,empresa_id UUID,nombre TEXT,cif TEXT,email TEXT,activo BOOLEAN)');
  const migration=fs.readFileSync(path.join(__dirname,'migrations/20261003_customer_order_senders.sql'),'utf8');
  await pg.exec(migration);await pg.exec(migration);
  const a=crypto.randomUUID(),b=crypto.randomUUID(),id=crypto.randomUUID();
  assert.equal(normalizeSenderEmails(' Pedidos@TLM.es ; otro@tlm.es\npedidos@tlm.es '),'pedidos@tlm.es\notro@tlm.es');
  assert.equal(normalizeSenderEmails(undefined),undefined);assert.equal(normalizeSenderEmails(''),null);
  assert.throws(()=>normalizeSenderEmails('pedidos@tlm.es\nbad'),{status:400});
  assert.throws(()=>normalizeSenderEmails('TLM <pedidos@tlm.es>'),{status:400});
  await db.query('INSERT INTO clientes VALUES($1,$2,$3,$4,$5,true,$6)',[id,a,'TLM sintético','B00000001','contacto@tlm.es','pedidos@tlm.es\notro@tlm.es']);
  await db.query('INSERT INTO clientes VALUES($1,$2,$3,$4,$5,true,$6)',[crypto.randomUUID(),b,'Otra empresa','B00000002','foreign@example.invalid','pedidos@tlm.es']);
  assert.equal((await findSenderClient(db,a,[' PEDIDOS@TLM.ES '])).client.id,id);
  assert.equal((await findSenderClient(db,a,['contacto@tlm.es'])).client.id,id);
  assert.equal((await findSenderClient(db,a,['otro@tlm.es'])).client.id,id);
  for(const sender of ['pedidos@tlm.es.evil.invalid','not-pedidos@tlm.es','unknown@tlm.es'])assert.equal((await findSenderClient(db,a,[sender])).client,null);
  assert.equal((await findSenderClient(db,a,[])).client,null);
  assert.equal((await findSenderClient(db,a,['pedidos@tlm.es','otro@tlm.es'])).ambiguous,true);
  const duplicate=crypto.randomUUID();await db.query('INSERT INTO clientes VALUES($1,$2,$3,$4,$5,true,$6)',[duplicate,a,'Compartido','B00000003','duplicate@example.invalid','PEDIDOS@TLM.ES']);
  assert.equal((await findSenderClient(db,a,['pedidos@tlm.es'])).ambiguous,true);
  await db.query('UPDATE clientes SET activo=false WHERE id=$1',[duplicate]);assert.equal((await findSenderClient(db,a,['pedidos@tlm.es'])).client.id,id);
  const message=(from,body='Origen: Abanilla\nDestino: Illescas')=>({texto:'',attachments:[{name:'pedido.eml',mediaType:'message/rfc822',base64:Buffer.from(`From: ${from}\r\nReply-To: attacker@example.invalid\r\nSubject: Pedido\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`).toString('base64')}]});
  const decoded=await inbox.expandEmails(message('TLM <PEDIDOS@TLM.ES>'));
  assert.deepEqual(decoded.email_senders,['PEDIDOS@TLM.ES']);assert.equal((await findSenderClient(db,a,decoded.email_senders)).client.id,id);
  const forwarded=await inbox.expandEmails(message('unknown@example.invalid','From: pedidos@tlm.es\nOrigen: Abanilla\nDestino: Illescas'));
  assert.equal((await findSenderClient(db,a,forwarded.email_senders)).client,null);
  const plain=await inbox.expandEmails({texto:'Origen: Abanilla\nDestino: Illescas',attachments:[],email_senders:['pedidos@tlm.es']});assert.deepEqual(plain.email_senders,[]);
  console.log('PASS sender matching: persisted config, exact case-insensitive addresses, tenant isolation, duplicate/inactive clients, original MIME From and no quoted/body/metadata identity. No messages sent.');
 }finally{await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

const crypto=require('node:crypto');
const {encryptSecret,decryptSecret}=require('./apiKeys');
const {resolveDestination}=require('./webhookTransport');
const inbox=require('./orderInbox');
const MAX_MESSAGE=6*1024*1024;
const schemas=new WeakMap();
function ensureSchema(db){if(!schemas.has(db))schemas.set(db,db.query(require('node:fs').readFileSync(require('node:path').join(__dirname,'../../scripts/migrations/20260928_company_order_mailbox.sql'),'utf8')).catch(error=>{schemas.delete(db);throw error;}));return schemas.get(db);}
const fail=(message,status=422)=>{throw Object.assign(new Error(message),{status});};
const text=(v,max=255)=>String(v||'').trim().slice(0,max);
function publicConfig(row={}) {
 const missing=[!row.email&&'Dirección del buzón',!row.host&&'Servidor IMAP',!row.username&&'Usuario',!row.secret_encrypted&&'Contraseña de aplicación'].filter(Boolean);
 return {email:row.email||'',provider:row.provider||'otro',host:row.host||'',port:993,username:row.username||'',password:'',has_password:!!row.secret_encrypted,folder:row.folder||'INBOX',enabled:!!row.enabled,verified_at:row.verified_at||null,last_sync_at:row.last_sync_at||null,last_received:row.last_received||0,last_error:row.last_error||'',missing,
  state:missing.length?'pendiente_configuracion':row.last_error?'error':!row.verified_at?'pendiente_prueba':row.enabled?'activo':'desactivado'};
}
async function read(db,company,lock=false) {if(!lock)await ensureSchema(db);return (await db.query(`SELECT * FROM empresa_order_mailbox WHERE empresa_id=$1${lock?' FOR UPDATE':''}`,[company])).rows[0]||{};}
async function status(db,company){return publicConfig(await read(db,company));}
async function allowed(db,company) {
 const row=(await db.query('SELECT * FROM empresas WHERE id=$1',[company])).rows[0];
 const {planHasFeature,getSubscriptionState}=require('../middleware/auth');
 if(!row||!planHasFeature(row.plan,'ai')||getSubscriptionState(row).blocked||['inactiva','inactivo','cancelada','suspendida'].includes(row.estado))fail('Empresa no habilitada para la bandeja IA.',403);
}
async function save(db,company,actor,input={}) {
 await allowed(db,company);
 await ensureSchema(db);
 const email=text(input.email).toLowerCase(),host=text(input.host,200).toLowerCase(),username=text(input.username),folder=text(input.folder,200)||'INBOX',provider=text(input.provider,50)||'otro';
 if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail('Dirección del buzón no válida.');
 if(host&&!/^(?=.{1,200}$)[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(host))fail('Indica el nombre público del servidor IMAP, sin URL ni puerto.');
 if(/[\x00-\x1f]/.test(folder+username))fail('Carpeta o usuario no válidos.');
 if(input.port!=null&&Number(input.port)!==993)fail('La recepción requiere IMAP cifrado en el puerto 993.');
 const password=String(input.password||'');if(password.length>2048)fail('Contraseña demasiado larga.');
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',[`${company}:order-mailbox-config`]);
  const previous=await read(tx,company,true);
  if(previous.lease_until&&new Date(previous.lease_until)>new Date())fail('Hay una conexión en curso. Espera antes de cambiar la configuración.',409);
  const changed=!!password||[email,host,username,folder].join('|')!==[previous.email,previous.host,previous.username,previous.folder].join('|');
  const secret=password?encryptSecret(password):previous.secret_encrypted||null;
  const verified=!changed&&previous.verified_at;
  if(input.enabled===true&&(!verified||!email||!host||!username||!secret))fail('Guarda y prueba la recepción antes de activarla.');
  await tx.query(`INSERT INTO empresa_order_mailbox(empresa_id,email,provider,host,username,secret_encrypted,folder,enabled,updated_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(empresa_id) DO UPDATE SET email=$2,provider=$3,host=$4,username=$5,secret_encrypted=$6,folder=$7,enabled=$8,updated_by=$9,updated_at=now(),version=empresa_order_mailbox.version+1,
   verified_at=CASE WHEN $10 THEN NULL ELSE empresa_order_mailbox.verified_at END,
   uid_validity=CASE WHEN $10 THEN NULL ELSE empresa_order_mailbox.uid_validity END,
   last_uid=CASE WHEN $10 THEN NULL ELSE empresa_order_mailbox.last_uid END,last_error=NULL`,
   [company,email,provider,host,username,secret,folder,input.enabled===true,actor||null,changed]);
  return status(tx,company);
 });
}
async function connect(row) {
 const destination=await resolveDestination(`https://${row.host}`,undefined,AbortSignal.timeout(10000));
 const {ImapFlow}=require('imapflow');
 const client=new ImapFlow({host:destination.address,port:993,secure:true,servername:row.host,
  tls:{servername:row.host,rejectUnauthorized:true,minVersion:'TLSv1.2'},auth:{user:row.username,pass:decryptSecret(row.secret_encrypted)},
  logger:false,disableAutoIdle:true,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,maxIdleTime:15000});
 client.on('error',()=>{}); // Errors are surfaced by awaited operations, never log credentials/raw mail.
 const timeout=setTimeout(()=>client.close(),45000);timeout.unref();
 try {await client.connect();const mailbox=await client.mailboxOpen(row.folder,{readOnly:true});return {client,mailbox,close:()=>{clearTimeout(timeout);client.close();}};}
 catch(error){clearTimeout(timeout);client.close();throw error;}
}
function connectionError(error) {
 if(error.status)return error.message;
 if(/descifrar/i.test(error.message||''))return 'La contraseña guardada no se puede descifrar con la configuración actual del servidor. Soporte debe revisar la clave de custodia; después puedes volver a guardar la contraseña del buzón.';
 if(['ENOTFOUND','EAI_AGAIN'].includes(error.code))return 'No se pudo resolver el servidor IMAP. Comprueba su nombre con el proveedor del correo.';
 if(['ETIMEDOUT','ECONNREFUSED','ETIMEOUT'].includes(error.code))return 'El servidor IMAP no respondió en el puerto 993. Comprueba que permite conexiones externas con TLS.';
 if(/CERT|TLS|SSL/.test(error.code||''))return 'El certificado TLS del servidor IMAP no es válido o no coincide con su nombre. Solicita al proveedor su servidor IMAP correcto; no se ha desactivado la verificación del certificado.';
 if(error.authenticationFailed||['AUTHENTICATIONFAILED','AUTHORIZATIONFAILED'].includes(error.serverResponseCode))return 'El proveedor ha rechazado el acceso. Revisa usuario y contraseña de aplicación; si exige OAuth, usa la conexión del proveedor cuando esté habilitada.';
 return 'No se pudo completar la conexión IMAP cifrada. Revisa servidor, credenciales, carpeta y permisos del proveedor.';
}
// Test and collection share a DB lease: multiple API processes cannot read the
// same cursor concurrently. Configuration changes are blocked while it is held.
async function run(db,company,{test=false,actor=null,connector=connect}={}) {
 await allowed(db,company);
 await ensureSchema(db);
 const token=crypto.randomUUID();
 const row=(await db.query(`UPDATE empresa_order_mailbox SET lease_token=$2,lease_until=now()+interval '90 seconds'
  WHERE empresa_id=$1 AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,[company,token])).rows[0];
 if(!row)fail('Guarda la configuración o espera a que termine la conexión en curso.',409);
 let connection;
 try {
  if(publicConfig(row).missing.length)fail('Completa los datos del buzón antes de probar la recepción.');
  if(!test&&(!row.enabled||!row.verified_at))fail('La recepción está desactivada o pendiente de prueba.',409);
  connection=await connector(row);
  const {client,mailbox}=connection,validity=String(mailbox.uidValidity),last=Math.max(0,Number(mailbox.uidNext)-1);
  if(!Number.isSafeInteger(last))fail('El servidor no ha devuelto un cursor de correo válido.',502);
  if(test) {
   if(row.uid_validity&&row.uid_validity!==validity&&row.enabled)fail('Desactiva la recepción antes de establecer un nuevo punto de inicio para este buzón.',409);
   // First successful test establishes the starting point, without importing the mailbox history.
   await db.query(`UPDATE empresa_order_mailbox SET verified_at=now(),last_error=NULL,uid_validity=$3,
    last_uid=CASE WHEN uid_validity=$3 AND last_uid IS NOT NULL THEN last_uid ELSE $4 END WHERE empresa_id=$1 AND lease_token=$2`,[company,token,validity,last]);
   return {ok:true,config:await status(db,company),message:'Conexión de recepción verificada. Al activarla se recogerán los nuevos mensajes de esta carpeta; no se ha importado su histórico.'};
  }
  if(validity!==row.uid_validity)fail('El buzón ha cambiado sus identificadores. Desactiva y vuelve a probar la conexión para establecer un nuevo punto de inicio.',409);
  let cursor=Number(row.last_uid),received=0;
  const end=Math.min(last,cursor+40);
  const messages=end>cursor?await client.fetchAll(`${cursor+1}:${end}`,{uid:true,size:true},{uid:true}):[];
  for(const message of messages.sort((a,b)=>a.uid-b.uid)) {
   if(message.uid<=cursor||message.uid>end)continue;
   if(message.size>MAX_MESSAGE)fail(`El mensaje UID ${message.uid} supera 6 MB. Divide sus adjuntos y súbelos manualmente; mueve después ese correo fuera de la carpeta de entrada para continuar.`,422);
   const fetched=await client.fetchOne(message.uid,{source:{start:0,maxLength:MAX_MESSAGE+1}},{uid:true});
   if(!fetched?.source)fail(`No se pudo recuperar el mensaje UID ${message.uid}. Vuelve a sincronizar.`,502);
   const item=await inbox.receive(db,company,actor,{source:'email_imap',
    attachments:[{name:`correo-${message.uid}.eml`,mediaType:'message/rfc822',base64:fetched.source.toString('base64')}]});
   if(!item.duplicate)received++;
   cursor=message.uid;
   await db.query('UPDATE empresa_order_mailbox SET last_uid=$3 WHERE empresa_id=$1 AND lease_token=$2',[company,token,cursor]);
  }
  await db.query('UPDATE empresa_order_mailbox SET last_uid=$3,last_sync_at=now(),last_received=$4,last_error=NULL WHERE empresa_id=$1 AND lease_token=$2',[company,token,Math.max(cursor,end),received]);
  return {ok:true,received,config:await status(db,company)};
 } catch(error) {
  const message=connectionError(error);
  await db.query('UPDATE empresa_order_mailbox SET last_error=$3 WHERE empresa_id=$1 AND lease_token=$2',[company,token,message]);
  const configurationError=['ENOTFOUND','EAI_AGAIN'].includes(error.code)||/CERT|TLS|SSL/.test(error.code||'')||error.authenticationFailed||['AUTHENTICATIONFAILED','AUTHORIZATIONFAILED'].includes(error.serverResponseCode);
  throw Object.assign(new Error(message),{status:error.status||(configurationError?422:502),code:'IMAP_CONNECTION_FAILED'});
 } finally {connection?.close();await db.query('UPDATE empresa_order_mailbox SET lease_token=NULL,lease_until=NULL WHERE empresa_id=$1 AND lease_token=$2',[company,token]);}
}
async function inboxStatus(db,company) {
 const cfg=await status(db,company);
 const guidance=cfg.enabled&&cfg.verified_at?`Recepción IMAP ${cfg.last_error?'con error':'activada'} para ${cfg.email}. ${cfg.last_error||'Los mensajes quedan pendientes de revisión; no se crean pedidos automáticamente.'}`:
  'Recepción pendiente de configurar o desactivada. Gerencia puede prepararla en Mi empresa → Email. Puedes seguir pegando texto o subiendo EML y adjuntos.';
 return {configured:cfg.enabled&&!!cfg.verified_at&&!cfg.last_error,address:cfg.email||null,guidance,state:cfg.state,last_sync_at:cfg.last_sync_at};
}
let timer,busy=false;
function startScheduler() {
 if(timer)return;
 timer=setInterval(async()=>{
  if(busy)return;busy=true;
  try {
   const db=require('./db');
   await ensureSchema(db);
   const rows=(await db.query('SELECT empresa_id FROM empresa_order_mailbox WHERE enabled=true AND verified_at IS NOT NULL ORDER BY last_sync_at NULLS FIRST LIMIT 50')).rows;
   for(const row of rows){try{await run(db,row.empresa_id);}catch{/* The tenant status stores a sanitized, actionable error. */}}
  }catch{require('./logger').warn('No se pudo ejecutar la recepción de pedidos por correo.');}finally{busy=false;}
 },5*60*1000);timer.unref();
}
module.exports={ensureSchema,publicConfig,status,save,run,inboxStatus,startScheduler,connect,connectionError,MAX_MESSAGE};

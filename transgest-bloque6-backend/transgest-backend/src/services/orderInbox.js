const crypto = require('crypto');
const {encryptSecret, decryptSecret} = require('./apiKeys');
const {contentMatchesMime} = require('./uploadValidation');
const UUID = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const MAX_FILE = 6 * 1024 * 1024, MAX_TOTAL = 7 * 1024 * 1024;
const TYPES = {
 pdf:'application/pdf', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp',
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 txt:'text/plain', eml:'message/rfc822', csv:'text/csv', tsv:'text/tab-separated-values',
 json:'application/json', xml:'application/xml', html:'text/html', htm:'text/html', md:'text/markdown',
};
const fail = (message,status=422) => {throw Object.assign(Error(message),{status});};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function publicItem(row){
 const {encrypted_payload,...safe}=row;
 if(!encrypted_payload)return safe;
 const payload=JSON.parse(decryptSecret(encrypted_payload));
 const email=payload.attachments?.find(file=>file.mediaType==='message/rfc822');
 if(email){const mail=await require('mailparser').simpleParser(Buffer.from(email.base64,'base64'),{skipImageLinks:true,skipHtmlToText:true,skipTextToHtml:true});safe.email_subject=String(mail.subject||'').slice(0,300);}
 return safe;
}
function validatePayload(body={}) {
 const texto=String(body.texto??body.text??'').trim();
 if(texto.length>20000)fail('El texto supera 20.000 caracteres. Divide la entrada.');
 if(body.attachments!=null&&!Array.isArray(body.attachments))fail('Adjuntos no válidos');
 if((body.attachments||[]).length>8)fail('Máximo 8 adjuntos por entrada.');
 let total=Buffer.byteLength(texto);const attachments=(body.attachments||[]).map(a=>{
  const name=String(a.name||a.filename||'').trim();
  if(!name||name.length>180||/[\x00-\x1f/\\]/.test(name))fail('Nombre de adjunto no válido.');
  const ext=name.split('.').pop().toLowerCase(),mime=TYPES[ext];
  if(!mime)fail(`Formato no admitido: ${name}. Usa PDF, imagen, DOCX, XLSX, EML o texto.`);
  const declared=String(a.mediaType||a.type||mime).split(';')[0].toLowerCase();
  if(declared!==mime&&declared!=='application/octet-stream'&&!(ext==='xml'&&declared==='text/xml'))fail('El tipo y la extensión del adjunto no coinciden.');
  const data=String(a.base64||'').replace(/^data:[^;]+;base64,/i,'').replace(/\s/g,'');
  if(data.length>Math.ceil(MAX_FILE/3)*4||!/^[a-z0-9+/]+={0,2}$/i.test(data))fail('Adjunto vacío, demasiado grande o base64 no válido.');
  const bytes=Buffer.from(data,'base64');
  if(!bytes.length||bytes.length>MAX_FILE||bytes.toString('base64').replace(/=+$/,'')!==data.replace(/=+$/,''))fail('Adjunto no válido: máximo 6 MB.');
  const textual=mime.startsWith('text/')||['message/rfc822','application/json','application/xml'].includes(mime);
  if(textual ? bytes.includes(0) : !contentMatchesMime(bytes,mime))fail('El contenido no coincide con el tipo de archivo.');
  total+=bytes.length;return {name,mediaType:mime,base64:bytes.toString('base64'),sizeKb:Math.ceil(bytes.length/1024),sha256:hash(bytes)};
 });
 if(total>MAX_TOTAL)fail('El conjunto de adjuntos supera 7 MB.');
 if(texto.length<12&&!attachments.length)fail('Introduce una orden de al menos 12 caracteres o adjunta un documento.');
 const messageId=String(body.message_id||'').trim();if(messageId.length>998||/[\r\n\x00]/.test(messageId))fail('Message-ID no válido.');
 return {texto,attachments,source:String(body.source||'texto').slice(0,80),filename:attachments.map(a=>a.name).join(', ').slice(0,500)||null,message_id:messageId||null};
}
function fingerprint(payload){return hash(JSON.stringify({texto:payload.texto,attachments:payload.attachments.map(a=>a.sha256).sort()}));}
async function event(tx,company,id,actor,action,detail={}){await tx.query('INSERT INTO ai_inbox_events(empresa_id,item_id,actor_id,action,detail) VALUES($1,$2,$3,$4,$5)',[company,id,actor||null,action,JSON.stringify(detail)]);}
async function get(db,company,id,{payload=false,lock=false}={}) {
 if(!UUID.test(id||''))fail('Entrada no válida',400);
 const row=(await db.query(`SELECT * FROM ai_inbox_items WHERE id=$1 AND empresa_id=$2${lock?' FOR UPDATE':''}`,[id,company])).rows[0];
 if(!row)fail('Entrada no encontrada',404);
 const {encrypted_payload,...safe}=row;
 return {...safe,...(payload?{payload:JSON.parse(decryptSecret(encrypted_payload))}:{})};
}
async function receive(db,company,actor,body){
 const payload=validatePayload(body);
 const emails=payload.attachments.filter(a=>a.mediaType==='message/rfc822');
 if(!payload.message_id&&emails.length===1){
  const message=await require('mailparser').simpleParser(Buffer.from(emails[0].base64,'base64'),{skipImageLinks:true,skipHtmlToText:true,skipTextToHtml:true});
  if(message.messageId)payload.message_id=String(message.messageId).trim().slice(0,998);
 }
 const content=fingerprint(payload),message=payload.message_id?hash(payload.message_id):null;
 return db.transaction(async tx=>{
  const inserted=(await tx.query(`INSERT INTO ai_inbox_items(empresa_id,content_hash,message_hash,source_type,filename,attachments,encrypted_payload,created_by)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,[company,content,message,payload.source,payload.filename,JSON.stringify(payload.attachments.map(({base64,...a})=>a)),encryptSecret(JSON.stringify(payload)),actor||null])).rows[0];
  const matches=inserted?[]:(await tx.query('SELECT id,content_hash FROM ai_inbox_items WHERE empresa_id=$1 AND (content_hash=$2 OR message_hash=$3)',[company,content,message])).rows;
  if(matches.some(row=>row.content_hash!==content))fail('Este Message-ID ya existe con otro contenido. Revisa el origen antes de repetirlo.',409);
  const row=inserted||matches[0];
  if(!row||(row.content_hash&&row.content_hash!==content))fail('Este Message-ID ya existe con otro contenido. Revisa el origen antes de repetirlo.',409);
  if(inserted)await event(tx,company,row.id,actor,'recibido',{source:payload.source,attachments:payload.attachments.length});
  return {...await get(tx,company,row.id),duplicate:!inserted};
 });
}
// Decode MIME only. All order interpretation continues through the existing parser.
async function expandEmails(payload){
 const texts=[payload.texto],attachments=[];let decodedBytes=0;
 for(const file of payload.attachments){
  if(file.mediaType!=='message/rfc822'){attachments.push(file);continue;}
  const mail=await require('mailparser').simpleParser(Buffer.from(file.base64,'base64'),{skipImageLinks:true,skipTextToHtml:true});
  texts.push([mail.subject?`Asunto: ${mail.subject}`:'',mail.text||''].filter(Boolean).join('\n'));
  for(const part of mail.attachments||[]){
   decodedBytes+=part.content.length;if(decodedBytes>MAX_TOTAL)fail('Los adjuntos del email superan 7 MB.');
   if(part.contentType==='message/rfc822')fail('Se recibió un email anidado. Guarda sus adjuntos y súbelos directamente.');
   attachments.push({name:part.filename||`adjunto-${attachments.length+1}`,mediaType:part.contentType,base64:part.content.toString('base64')});
  }
 }
 return validatePayload({...payload,texto:texts.filter(Boolean).join('\n\n'),attachments});
}
async function claim(db,company,id,actor,{reanalyze=false}={}){
 return db.transaction(async tx=>{
  const item=await get(tx,company,id,{payload:true,lock:true});
  if(item.state==='descartado')fail('La entrada está descartada. Restáurala para revisarla.',409);
  if(reanalyze&&!['nuevo','revisar','error'].includes(item.state))fail('Solo se pueden volver a analizar entradas pendientes de revisión.',409);
  if(item.result&&!reanalyze)return {item,replay:true};
  if(item.processing_at&&Date.now()-new Date(item.processing_at).getTime()<300000)fail('La entrada se está analizando. Actualiza en unos instantes.',409);
  const token=crypto.randomUUID();
  await tx.query("UPDATE ai_inbox_items SET processing_token=$3,processing_at=NOW(),error=NULL,state='nuevo',updated_at=NOW() WHERE id=$1 AND empresa_id=$2",[id,company,token]);
  await event(tx,company,id,actor,'analisis_iniciado');return {item,token};
 });
}
async function finish(db,company,id,token,actor,result,error){
 return db.transaction(async tx=>{
  const changed=(await tx.query(`UPDATE ai_inbox_items SET result=$4,error=$5,state=$6,processing_at=NULL,processing_token=NULL,updated_at=NOW(),version=version+1
   WHERE id=$1 AND empresa_id=$2 AND processing_token=$3 RETURNING id`,[id,company,token,result?JSON.stringify(result):null,error?String(error).slice(0,500):null,error?'error':'revisar'])).rows[0];
  if(!changed)fail('El análisis ya no corresponde a la revisión actual.',409);
  await event(tx,company,id,actor,error?'analisis_error':'analizado');return get(tx,company,id);
 });
}
async function changeState(db,company,id,actor,{state,version,reviewed}){
 if(!['revisar','listo','descartado'].includes(state))fail('Estado no permitido');
 return db.transaction(async tx=>{
  const item=await get(tx,company,id,{lock:true});
  if(item.state==='creado'||item.processing_at)fail('La entrada ya está creada o se está analizando.',409);
  if(item.version!==Number(version))fail('La entrada ha cambiado. Actualiza antes de continuar.',409);
  if(state==='listo'&&(!item.result||reviewed!==true))fail('Revisa expresamente el borrador antes de marcarlo listo.');
  if(state==='listo'&&(!UUID.test(item.result.pedido?.cliente_id||'')||['origen','destino','fecha_carga'].some(k=>!item.result.pedido?.[k])))fail('Completa primero los campos obligatorios en el formulario del pedido.');
  await tx.query('UPDATE ai_inbox_items SET state=$3,version=version+1,reviewed_by=$4,reviewed_at=CASE WHEN $3=\'listo\' THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1 AND empresa_id=$2',[id,company,state,state==='listo'?actor:null]);
  await event(tx,company,id,actor,state);return get(tx,company,id);
 });
}
function creationFingerprint(body){const {ai_metadata,festivo_confirmado,...fields}=body;return hash(JSON.stringify(Object.fromEntries(Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)))));}
async function lockForCreation(tx,company,actor,meta,body){
 if(!meta?.inbox_id)return null;
 const item=await get(tx,company,meta.inbox_id,{lock:true}),creationHash=creationFingerprint(body);
 if(item.state==='creado'){
  if(item.creation_hash!==creationHash)fail('Esta entrada ya creó un pedido con otros datos. Abre el pedido existente.',409);
  const pedido=(await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2',[item.pedido_id,company])).rows[0];
  if(!pedido)fail('El pedido vinculado ya no está disponible. Revisa el historial.',409);
  return {replay:pedido};
 }
 if(!['revisar','listo'].includes(item.state)||!item.result||meta.human_reviewed!==true)fail('Debes revisar la entrada antes de crear el pedido.',409);
 return {id:item.id,creationHash};
}
async function created(tx,company,id,actor,pedidoId,creationHash){
 await tx.query("UPDATE ai_inbox_items SET state='creado',pedido_id=$3,creation_hash=$4,reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1 AND empresa_id=$2",[id,company,pedidoId,creationHash,actor]);
 await event(tx,company,id,actor,'pedido_creado',{pedido_id:pedidoId});
}
function inboundConfiguration(company,env=process.env){
 const domain=String(env.ORDERS_INBOUND_DOMAIN||'').toLowerCase();
 const configured=env.ORDERS_INBOUND_ENABLED==='true'&&/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)&&String(env.ORDERS_INBOUND_WEBHOOK_SECRET||'').length>=32;
 return {configured,address:configured?`pedidos+${String(company).replace(/-/g,'')}@${domain}`:null,guidance:configured?'Conector configurado; la entrega depende del DNS y proveedor de correo.':'Entrada por correo pendiente de configurar; puedes pegar texto o subir EML y adjuntos.'};
}
module.exports={validatePayload,fingerprint,receive,get,claim,finish,changeState,lockForCreation,created,event,inboundConfiguration,expandEmails,publicItem,UUID,MAX_TOTAL,TYPES};

const assert=require('node:assert/strict'),crypto=require('crypto');
module.exports=async function({base,fetch,db,managerToken,driverToken,company,client}){
 let checks=0;
 async function request(method,path,body,status=200,token=managerToken){
  const res=await fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await res.json();assert.equal(res.status,status,`${path}: ${JSON.stringify(data)}`);checks++;return data;
 }
 const text=`Cliente: ${client.nombre||'Alfa Auditoría'}\nOrigen: Madrid\nDestino: Valencia\nFecha carga: 25/09/2026\nPrecio: 300 EUR\nMercancía: cemento`;
 const item=await request('POST','/pedidos/ai-inbox/entries',{texto:text},201);assert.equal(item.state,'nuevo');assert.equal(item.encrypted_payload,undefined);
 const parsed=await request('POST','/pedidos/ai-inbox/parse',{inbox_id:item.id});assert.equal(parsed.inbox_id,item.id);assert.equal(parsed.inbox_state,'revisar');
 const customer=await request('POST','/clientes',{nombre:'CAR VOLUM TEST, S.L.',cif:'B98328891',direccion:'Calle de Prueba 2',cp:'46002',ciudad:'Valencia',email:'car-volum@example.invalid'},201);
 await request('POST','/clientes',{nombre:'TRANSPORTES ASENSI TEST, S.L.',cif:'B03168853',direccion:'Base de prueba',cp:'46002',ciudad:'Valencia',email:'asensi@example.invalid'},201);
 const samplePdf=await require('./order_pdf_roles_check.cjs').syntheticOrder();
 const fromPdf=await request('POST','/pedidos/ai-inbox/parse',{attachments:[{name:'orden-sintetica.pdf',mediaType:'application/pdf',base64:samplePdf.toString('base64')} ]});
 assert.equal(fromPdf.pedido.cliente_id,customer.id,'the contractual shipper, not the effective carrier, is the customer');
 assert.equal(fromPdf.pedido.origen,'ALMENDRALEJO');assert.equal(fromPdf.pedido.destino,'FORTUNA');
 assert.equal(fromPdf.pedido.puntos_carga[0].cliente_nombre,'NATUYSER TEST');
 assert.equal(fromPdf.pedido.puntos_descarga[0].cliente_nombre,'PALECO TEST');
 assert.equal(fromPdf.pedido.puntos_carga[0].ventana,'08:00-17:00');
 assert.equal(fromPdf.pedido.puntos_descarga[0].fecha,'2026-09-29');
 assert.equal(fromPdf.pedido.importe,600);
 const unknownCustomer=await request('POST','/pedidos/ai-inbox/parse',{
  texto:'Cliente: CLIENTE CONTRACTUAL NO REGISTRADO\nTransportista: TRANSPORTES ASENSI TEST, S.L.\nOrigen: Madrid\nDestino: Valencia\nFecha carga: 30/09/2026'
 });
 assert.equal(unknownCustomer.pedido.cliente_id,null,'a carrier mentioned in the document cannot become the customer');
 assert.ok(unknownCustomer.issues.some(issue=>issue.key==='cliente_id'));
 const replay=await request('POST','/pedidos/ai-inbox/parse',{texto:text});assert.equal(replay.inbox_id,item.id);assert.equal(replay.duplicate,true);
 const payload={cliente_id:client.id,origen:'Madrid',destino:'Valencia',fecha_carga:'2026-09-25',importe:300,ai_metadata:{inbox_id:item.id}};
 await request('POST','/pedidos',payload,409);
 payload.ai_metadata.human_reviewed=true;
 const created=await request('POST','/pedidos',payload,201);const repeated=await request('POST','/pedidos',payload);assert.equal(created.id,repeated.id);assert.equal(repeated.inbox_duplicate,true);
 await request('POST','/pedidos',{...payload,importe:301},409);
 const final=await request('GET',`/pedidos/ai-inbox/entries/${item.id}`);assert.equal(final.state,'creado');assert.equal(final.pedido_id,created.id);
 await request('GET','/pedidos/ai-inbox/entries',null,403,driverToken);
 const foreign=crypto.randomUUID(),foreignUser=crypto.randomUUID();
 await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'INBOX EMPRESA B','B00000029','inbox-owner@example.invalid','enterprise','activa')",[foreign]);
 await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo) VALUES($1,$2,'Otro gerente','inbox-other@example.invalid','unused','gerente',true)",[foreignUser,foreign]);
 const token=require('jsonwebtoken').sign({sub:foreignUser,empresa_id:foreign,rol:'gerente'},require('../src/services/jwtSecrets').userJwtSecret(),{expiresIn:'10m'});
 await request('GET',`/pedidos/ai-inbox/entries/${item.id}`,null,404,token);
 await request('POST','/pedidos/ai-inbox/parse',{inbox_id:item.id},404,token);
 await db.query("UPDATE empresas SET plan='profesional' WHERE id=$1",[foreign]);
 await request('GET','/pedidos/ai-inbox/status',null,403,token);
 await db.query("UPDATE empresas SET plan='lite' WHERE id=$1",[foreign]);
 await request('POST','/pedidos/ai-inbox/parse',{texto:text},403,token);
 const entries=await request('GET','/pedidos/ai-inbox/entries?summary=true');assert.deepEqual(entries.items,[]);assert.ok(entries.counts.some(row=>row.state==='creado'));
 const JSZip=require('jszip');
 for(const kind of ['docx','xlsx']){
  let buffer;
  if(kind==='xlsx'){
   const wb=new (require('exceljs').Workbook)(),sheet=wb.addWorksheet('Orden');
   sheet.addRows([['Cliente',client.nombre||'Alfa Auditoría'],['Origen','Madrid'],['Destino','Valencia'],['Mercancia','material xlsx']]);
   buffer=Buffer.from(await wb.xlsx.writeBuffer());
  }else{
   const zip=new JSZip();zip.file('word/document.xml',`<w:document><w:p>Cliente: ${client.nombre||'Alfa Auditoría'}</w:p><w:p>Origen: Madrid</w:p><w:p>Destino: Valencia</w:p><w:p>Mercancia: material docx</w:p></w:document>`);
   buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
  }
  const parsedOffice=await request('POST','/pedidos/ai-inbox/parse',{attachments:[{name:`orden.${kind}`,base64:buffer.toString('base64')}]});
  assert.ok(parsedOffice.inbox_id);assert.ok(parsedOffice.source.attachments[0].serverTextDetected);assert.match(parsedOffice.pedido.origen,/Madrid/i);assert.match(parsedOffice.pedido.destino,/Valencia/i);
  const downloadPath=base+`/pedidos/ai-inbox/entries/${parsedOffice.inbox_id}/attachments/0`;
  const original=await fetch(downloadPath,{headers:{Authorization:`Bearer ${managerToken}`}});
  assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),buffer);checks++;
  for(const [deniedToken,expected] of [[driverToken,403],[token,404]]){
   if(deniedToken===token)await db.query("UPDATE empresas SET plan='enterprise' WHERE id=$1",[foreign]);
   const denied=await fetch(downloadPath,{headers:{Authorization:`Bearer ${deniedToken}`}});assert.equal(denied.status,expected);checks++;
  }

 }
 await request('POST','/pedidos/ai-inbox/parse',{attachments:[{name:'falso.pdf',mediaType:'application/pdf',base64:Buffer.from('un ejecutable falso').toString('base64')}]},422);
 const envKeys=['ORDERS_INBOUND_ENABLED','ORDERS_INBOUND_DOMAIN','ORDERS_INBOUND_WEBHOOK_SECRET'];const oldEnv=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]));
 try{
  process.env.ORDERS_INBOUND_ENABLED='true';process.env.ORDERS_INBOUND_DOMAIN='inbound.example.invalid';process.env.ORDERS_INBOUND_WEBHOOK_SECRET=crypto.randomBytes(32).toString('hex');
  const to=require('../src/services/orderInbox').inboundConfiguration(company).address;
  const raw=JSON.stringify({to,message_id:'<http-synthetic@example.invalid>',texto:text+'\nReferencia: inbound-test'}),time=String(Math.floor(Date.now()/1000));
  const signature='sha256='+crypto.createHmac('sha256',process.env.ORDERS_INBOUND_WEBHOOK_SECRET).update(time+'.').update(raw).digest('hex');
  async function deliver(sig,status){const res=await fetch(base+'/inbound/orders',{method:'POST',headers:{'Content-Type':'application/json','x-transgest-timestamp':time,'x-transgest-signature':sig},body:raw});const json=await res.json();assert.equal(res.status,status,JSON.stringify(json));checks++;return json;}
  await deliver('invalid',401);const first=await deliver(signature,202),duplicate=await deliver(signature,200);assert.equal(first.state,'nuevo');assert.equal(first.id,duplicate.id);
  assert.equal((await db.query('SELECT pedido_id FROM ai_inbox_items WHERE id=$1',[first.id])).rows[0].pedido_id,null);
 }finally{for(const key of envKeys){if(oldEnv[key]===undefined)delete process.env[key];else process.env[key]=oldEnv[key];}}
 return {checks,originals_private:true,human_creation:true,no_duplicate_order:true,tenant_role_plan:true};
};

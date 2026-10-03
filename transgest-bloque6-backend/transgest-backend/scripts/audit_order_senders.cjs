const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async function({db,call,company,client}){
 const sender='orders-alfa@example.invalid';
 const created=await call('Crear cliente con remitentes de pedidos','POST','/clientes',{nombre:'Cliente de correo nuevo',cif:'B33333331',email:'created@example.invalid',emails_remitentes_pedidos:'NEW-ORDERS@example.invalid'});
 assert.equal(created.emails_remitentes_pedidos,'new-orders@example.invalid');
 await db.query('DELETE FROM clientes WHERE id=$1 AND empresa_id=$2',[created.id,company]);
 const updated=await call('Guardar remitentes del cliente','PUT','/clientes/'+client.id,{...client,emails_remitentes_pedidos:` ${sender.toUpperCase()} ; other-alfa@example.invalid\n${sender}`});
 assert.equal(updated.emails_remitentes_pedidos,`${sender}\nother-alfa@example.invalid`);
 const fetched=await call('Recuperar remitentes guardados','GET','/clientes/'+client.id);assert.equal(fetched.emails_remitentes_pedidos,updated.emails_remitentes_pedidos);
 const rejected=await call('Rechazar remitentes inválidos','PUT','/clientes/'+client.id,{...client,emails_remitentes_pedidos:'not-an-email'});assert.match(rejected.error,/remitentes/);
 const {emails_remitentes_pedidos:initialSenders,...partial}=client;
 const unchanged=await call('Conservar remitentes en edición parcial','PUT','/clientes/'+client.id,partial);assert.equal(unchanged.emails_remitentes_pedidos,updated.emails_remitentes_pedidos);
 const foreignCompany=crypto.randomUUID(),foreignClient=crypto.randomUUID(),duplicateClient=crypto.randomUUID();
 await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'Otro tenant de correo','B11111117','foreign-admin@example.invalid','enterprise','activa')",[foreignCompany]);
 await db.query("INSERT INTO clientes(id,empresa_id,nombre,cif,email,emails_remitentes_pedidos) VALUES($1,$2,'Cliente de otro tenant','B11111118','foreign@example.invalid',$3)",[foreignClient,foreignCompany,sender]);
 const body='Necesitamos cargar un camión en abanilla, murcia, para entregar en illescas toledo.\nCargar 03/10/2026\n24.000kg hora de entrega 12:00 04/10/2026';
 async function parse(label,from,content=body,extra={}){
  const eml=Buffer.from(`From: ${from}\r\nReply-To: ${sender}\r\nSubject: Pedido de prueba\r\nMessage-ID: <${crypto.randomUUID()}@example.invalid>\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${content}`);
  return call(label,'POST','/pedidos/ai-inbox/parse',{source:'email_imap',attachments:[{name:'pedido.eml',mediaType:'message/rfc822',base64:eml.toString('base64')}],...extra});
 }
 const result=await parse('Asignar cliente por remitente MIME y aislar tenant',`Pedidos <${sender.toUpperCase()}>`);
 assert.equal(result.pedido.cliente_id,client.id);assert.equal(result.pedido.cliente_nombre,client.nombre);assert.equal(result.pedido.peso_kg,24000);
 assert.ok(result.suggestions.some(s=>s.type==='cliente_remitente'));
 assert.equal((await db.query('SELECT state,pedido_id FROM ai_inbox_items WHERE id=$1 AND empresa_id=$2',[result.inbox_id,company])).rows[0].state,'revisar');
 assert.equal((await db.query('SELECT pedido_id FROM ai_inbox_items WHERE id=$1',[result.inbox_id])).rows[0].pedido_id,null);
 assert.equal((await parse('Reconocer email principal',client.email)).pedido.cliente_id,client.id);
 assert.equal((await parse('No asociar por Reply-To ni texto reenviado','unknown@example.invalid',`From: ${sender}\n${body}`,{email_senders:[sender]})).pedido.cliente_id,null);
 const conflict=await parse('Revisar contradicción entre remitente y cliente del documento',sender,`Cliente: Cliente diferente\n${body}`);assert.equal(conflict.pedido.cliente_id,null);assert.match(conflict.issues.find(i=>i.key==='cliente_id').message,/remitente/);
 await db.query("INSERT INTO clientes(id,empresa_id,nombre,cif,email,emails_remitentes_pedidos) VALUES($1,$2,'Cliente que comparte remitente','B11111119','duplicate@example.invalid',$3)",[duplicateClient,company,sender]);
 const ambiguous=await parse('Revisar remitente compartido por dos clientes',sender);assert.equal(ambiguous.pedido.cliente_id,null);assert.match(ambiguous.issues.find(i=>i.key==='cliente_id').message,/varios clientes/);
 await db.query('UPDATE clientes SET activo=false WHERE id=$1',[duplicateClient]);assert.equal((await parse('Ignorar cliente inactivo al reconocer correo',sender)).pedido.cliente_id,client.id);
 await db.query('DELETE FROM clientes WHERE id=$1',[duplicateClient]);await db.query('DELETE FROM empresas WHERE id=$1',[foreignCompany]);
 return {matching:'exact From address',draftClient:result.pedido.cliente_nombre,humanReviewPreserved:true};
};

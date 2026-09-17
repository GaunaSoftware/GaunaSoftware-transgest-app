// Audit harness only. No application files or production services are modified.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const req=require('node:module').createRequire(path.join(root,'src/server.js'));
process.env.NODE_ENV='test';process.env.DB_HOST='127.0.0.1';process.env.DB_PORT='1';
process.env.JWT_SECRET=crypto.randomBytes(40).toString('hex');process.env.SUPERADMIN_JWT_SECRET=crypto.randomBytes(40).toString('hex');
process.env.API_KEYS_ENCRYPTION_SECRET=crypto.randomBytes(40).toString('hex');
delete process.env.SUPERADMIN_BOOTSTRAP_EMAIL;delete process.env.SUPERADMIN_BOOTSTRAP_PASSWORD;
const {PGlite}=req('@electric-sql/pglite');const {uuid_ossp}=req('@electric-sql/pglite/contrib/uuid_ossp');const {pg_trgm}=req('@electric-sql/pglite/contrib/pg_trgm');
let pg;const db=req('./services/db');
const evidence={target:'audit remediation working tree',mode:'isolated PostgreSQL-compatible PGlite; no external delivery',schemaErrors:[],checks:[],outbound:[]};
const adapt=x=>({query:async(sql,params)=>{try{let r;if(params?.length)r=await x.query(sql,params);else {const all=await x.exec(sql);r=all.at(-1)||{rows:[]};}return {...r,rowCount:r.rowCount??r.affectedRows??r.rows.length};}catch(e){e.auditSql=sql;throw e;}}});
let failEmail=false;
const email=req('./services/email');for(const name of ['enviarEmail','sendPlatformEmail'])email[name]=async()=>{evidence.outbound.push({name,simulatedFailure:failEmail});if(failEmail)throw Object.assign(Error('AUDIT_SMTP_FAILURE'),{code:'EAUTH'});return {ok:true,messageId:'isolated-sink'};};
req('./services/accountingSync').pushFacturaToAccounting=async()=>({skipped:true});req('./services/webhooks').dispatch=async()=>{};
const actualFetch=global.fetch;global.fetch=async(url,options)=>{if(!String(url).startsWith('http://127.0.0.1:'))throw Error('AUDIT_EXTERNAL_DISABLED');return actualFetch(url,options);};
const logger={info(){},warn(){},error(message){evidence.schemaErrors.push(String(message));},debug(){}};
async function main(){
 pg=process.env.AUDIT_PG_PORT ? await require('./audit_postgres.cjs').createIsolatedPostgres() : new PGlite({extensions:{uuid_ossp,pg_trgm}});
 if(process.env.AUDIT_PG_PORT)evidence.mode='native PostgreSQL on loopback, dedicated new database; no external delivery';
 db.query=adapt(pg).query;db.transaction=fn=>pg.transaction(tx=>fn(adapt(tx)));
 await pg.exec(fs.readFileSync(path.join(root,'scripts/install_completo.sql'),'utf8'));
 for(const file of fs.readdirSync(path.join(root,'scripts/migrations')).filter(n=>n.endsWith('.sql')).sort()){
  try{await pg.exec(fs.readFileSync(path.join(root,'scripts/migrations',file),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;','-- PGlite provides gen_random_uuid; pgcrypto extension unavailable.'));}catch(e){evidence.schemaErrors.push(file+': '+e.message);}
 }
 const code=fs.readFileSync(path.join(root,'src/server.js'),'utf8');
 const migration=code.slice(code.indexOf('async function applyMigrations()'),code.indexOf('// ── Auto-seed:'));
 const context={db,logger,require:req,process,console,ensureApiKeyTables:req('./services/apiKeys').ensureTables,captureStartupMigrationError:e=>evidence.schemaErrors.push(e.message),startupMigrationFailures:0};
 try{await vm.runInNewContext(migration+'\napplyMigrations()',context);}catch(e){evidence.schemaErrors.push(e.message);}
 await req('./services/apiKeys').ensureTables();await req('./services/notificaciones').ensureNotificacionesSchema();
 const auth=req('./routes/auth');await auth.initializeSchema?.();await req('./routes/choferes').initializeSchema?.();
 const company=crypto.randomUUID(),user=crypto.randomUUID();const password='Audit-Isolated-'+crypto.randomBytes(10).toString('hex');
 await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'AUDITORÍA LOCAL','B00000000','audit@example.invalid','enterprise','activa')",[company]);
 await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo) VALUES($1,$2,'Gerente de pruebas','audit@example.invalid',$3,'gerente',true)",[user,company,await req('bcryptjs').hash(password,10)]);
 const express=req('express'),app=express();app.use(express.json({limit:'12mb'}));req('./middleware/asyncErrors')(logger);
 app.use('/api/v1/auth',auth);
 for(const name of ['clientes','choferes','vehiculos','pedidos','facturas','rutas','palets','taller','agenda','intelligence'])app.use('/api/v1/'+name,req('./middleware/auth').authenticate,req('./routes/'+name));
 app.use('/api/v1/planner',req('./middleware/auth').authenticate,req('./routes/planner'));
 app.use('/api/v1/transport-exchange',req('./middleware/auth').authenticate,req('./routes/planner_exchange'));
 app.use('/api/v1/soporte',req('./middleware/auth').authenticate,req('./routes/soporte').createSupportRouter());
 app.use('/api/v1/mi-cuenta',req('./middleware/auth').authenticate,req('./routes/mi_cuenta'));
 app.use((err,request,res,next)=>res.status(err.status||500).json({error:err.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';let token;
 async function call(label,method,url,body){const response=await actualFetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});let data=await response.json();evidence.checks.push({label,method,url,status:response.status,...(data.error?{error:data.error}:{}),...(data.errors?{validation:data.errors}:{} )});return data;}
 try{
 const login=await call('Login gerente demo','POST','/auth/login',{email:'audit@example.invalid',password});token=login.token;
 if(!token)throw Error('No token on demo login');
 const client=await call('Crear cliente con datos fiscales','POST','/clientes',{nombre:'Alfa Auditoría',cif:'B12345678',direccion:'Calle de Prueba 1',cp:'46001',ciudad:'Valencia',codigo_postal:'46001',municipio:'Valencia',provincia:'Valencia',pais:'España',email:'client@example.invalid',telefono:'960000000',tipo_iva:21,forma_pago:'transferencia',vencimiento:'30 dias',pendiente_revision:true});
 const driver=await call('Crear conductor','POST','/choferes',{nombre:'Conductor',apellidos:'de Pruebas',dni:'00000000T',telefono:'960000001',email:'driver@example.invalid',activo:true});
 const vehicle=await call('Crear tractora','POST','/vehiculos',{matricula:'1234AUD',tipo:'tractora',marca:'Prueba',modelo:'Auditoría',fecha_itv:'2027-09-16',km_actuales:10000,activo:true});
 for(const url of ['/clientes','/choferes','/vehiculos','/pedidos','/facturas','/rutas','/palets','/taller/estado','/agenda','/intelligence/estado','/soporte'])await call('Listado '+url,'GET',url);
 const ticket=await call('Crear solicitud soporte','POST','/soporte',{asunto:'Auditoría local',mensaje:'Mensaje sin salida al exterior.'});
 if(ticket.id){await call('Recargar conversación','GET','/soporte/'+ticket.id);await call('Responder conversación','POST','/soporte/'+ticket.id+'/mensajes',{mensaje:'Segunda intervención de prueba'});}
 if(client.id)await call('Marcar cliente revisado','PATCH','/clientes/'+client.id+'/revision',{});
 if(client.id){
  const importSource=fs.readFileSync(path.resolve(root,'../transgest-frontend/src/pages/Importacion.js'),'utf8');
  const imports={console,crearCliente:data=>call('Importar cliente CSV','POST','/clientes',data),crearVehiculo:data=>call('Importar vehículo CSV','POST','/vehiculos',data),crearChofer:data=>call('Importar chófer CSV','POST','/choferes',data),crearPedido:data=>call('Importar pedido pendiente con nombre cliente','POST','/pedidos',data),crearColaborador:()=>{},crearFactura:()=>{},getClientes:async()=>[client],editarCliente:()=>{},crearRutaCliente:()=>{}};
  vm.runInNewContext(importSource.slice(importSource.indexOf('let clientesImportCachePromise'),importSource.indexOf('export default'))+'\nthis.templates=TEMPLATES;this.parse=parseCSV;',imports);
  evidence.csvSemicolon=imports.parse('nombre;cif\nAlfa;B12345678');
  await imports.templates.clientes.apiFn({nombre:'Cliente importado',cif:'B87654321',email:'import@example.invalid'});
  await imports.templates.choferes.apiFn({nombre:'Chofer importado',apellidos:'Audit',dni:'00000001R',email:'import-driver@example.invalid'});
  await imports.templates.viajes_pendientes.apiFn({origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-20',cliente_nombre:client.nombre,cliente_cif:client.cif,importe:'500,00',peso_kg:'24.200',bultos:'20'});
  await call('Importar tarifa CSV','POST','/rutas/importar',{cliente_id:client.id,texto:'Origen;Destino;Precio;Km\nValencia;Madrid;500;350'});
  evidence.routesAfterFailedImport=(await db.query('SELECT COUNT(*)::int AS n FROM rutas WHERE empresa_id=$1',[company])).rows[0];
  // Fuel is already part of the order total: persist separate lines in both invoice paths.
  const fuelOrders=[];
  for(const [i,amount,fuel] of [[1,528,48],[2,220,20]]){
    const trip=await call('Crear viaje con recargo '+i,'POST','/pedidos',{cliente_id:client.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',importe:amount,importe_revision_combustible:fuel,recargo_combustible_pct:10,precio_base_sin_combustible:amount-fuel});
    await call('Completar viaje con recargo '+i,'PATCH','/pedidos/'+trip.id+'/estado',{estado:'entregado'});
    await req('./routes/pedidos')._test.crearFacturaBorradorPedido(trip.id,company,user);
    const saved=(await db.query('SELECT importe,importe_revision_combustible,factura_id FROM pedidos WHERE id=$1',[trip.id])).rows[0];
    require('node:assert/strict').equal(Number(saved.importe_revision_combustible),fuel);
    const lines=(await db.query('SELECT concepto,precio_unit,importe FROM factura_lineas WHERE factura_id=$1 ORDER BY orden',[saved.factura_id])).rows;
    require('node:assert/strict').equal(lines.length,2,'automatic draft must split fuel');
    require('node:assert/strict').equal(Number(lines[0].importe)+Number(lines[1].importe),amount);
    fuelOrders.push(trip.id);
  }
  const beforeFuel=(await db.query('SELECT factura_id FROM pedidos WHERE id=ANY($1::uuid[]) ORDER BY id',[fuelOrders])).rows;
  await call('Rechazar recargo incluido en porte','POST','/facturas',{cliente_id:client.id,serie:'A',estado:'borrador',pedidos_ids:fuelOrders,lineas:[{concepto:'Porte con recargo incluido',cantidad:1,precio_unit:748}]});
  require('node:assert/strict').deepEqual((await db.query('SELECT factura_id FROM pedidos WHERE id=ANY($1::uuid[]) ORDER BY id',[fuelOrders])).rows,beforeFuel,'failed validation must preserve drafts');
  const fuelInvoice=await call('Agrupar viajes con recargo separado','POST','/facturas',{cliente_id:client.id,serie:'A',estado:'borrador',pedidos_ids:fuelOrders,lineas:[{concepto:'Portes',cantidad:1,precio_unit:680},{concepto:'Recargo de combustible',cantidad:1,precio_unit:68}]});
  require('node:assert/strict').equal(Number(fuelInvoice.base_imponible),748);
  require('node:assert/strict').equal(Number(fuelInvoice.total),905.08);
  const fuelLines=(await db.query('SELECT concepto,importe FROM factura_lineas WHERE factura_id=$1 ORDER BY orden',[fuelInvoice.id])).rows;
  require('node:assert/strict').equal(fuelLines.length,2);require('node:assert/strict').equal(Number(fuelLines[1].importe),68);
  const order=await call('Crear viaje asignado','POST','/pedidos',{cliente_id:client.id,vehiculo_id:vehicle.id,chofer_id:driver.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',fecha_entrega:'2026-09-17',fecha_descarga:'2026-09-17',hora_carga:'09:00',importe:500,mercancia:'Palets auditoría',peso_kg:24200,bultos:20});
  if(order.id){
   await call('Confirmar viaje','PATCH','/pedidos/'+order.id+'/estado',{estado:'confirmado'});
   await call('Completar viaje','PATCH','/pedidos/'+order.id+'/estado',{estado:'entregado'});
   const invoice=await call('Crear borrador sin documentos ni referencia','POST','/facturas',{cliente_id:client.id,serie:'A',fecha:'2026-09-16',estado:'borrador',pedidos_ids:[order.id],lineas:[{concepto:'Transporte auditoría',cantidad:1,precio_unit:500}]});
   if(invoice.id){await call('Emitir SIN revisar documentación','PATCH','/facturas/'+invoice.id+'/estado',{estado:'emitida'});await call('Enviar SIN documentación','PATCH','/facturas/'+invoice.id+'/estado',{estado:'enviada'});await call('Volver emitida a borrador','PATCH','/facturas/'+invoice.id+'/estado',{estado:'borrador'});
    await db.query("UPDATE facturas SET revision_cobro_at=CURRENT_DATE-2,fecha_vencimiento=CURRENT_DATE-3 WHERE id=$1",[invoice.id]);
    failEmail=true;evidence.reminderResponse=await call('Reclamar borrador con fallo SMTP simulado','POST','/facturas/reclamaciones/procesar',{});failEmail=false;
    evidence.invoiceAfterReminder=(await db.query('SELECT estado,reclamacion_envios,reclamacion_ultimo_envio_at FROM facturas WHERE id=$1',[invoice.id])).rows[0];
    await call('Revision sin documentos bloqueada','POST','/facturas/'+invoice.id+'/revision',{confirmado:true,motivo_sin_referencia:'Sin referencia contractual'});
    await db.query(`INSERT INTO pedido_docs(id,pedido_id,empresa_id,tipo,nombre,file_base64) VALUES($1,$2,$3,'albaran','Albaran.pdf',$4)`,[crypto.randomUUID(),order.id,company,Buffer.from('%PDF-1.4 test').toString('base64')]);
    await call('Registrar revision valida','POST','/facturas/'+invoice.id+'/revision',{confirmado:true,motivo_sin_referencia:'Sin referencia contractual'});
    await db.query('UPDATE pedidos SET importe=501 WHERE id=$1',[order.id]);
    await call('Revision caducada por cambio de pedido','PATCH','/facturas/'+invoice.id+'/estado',{estado:'emitida'});
    await call('Revisar datos actualizados','POST','/facturas/'+invoice.id+'/revision',{confirmado:true,motivo_sin_referencia:'Sin referencia contractual'});
    await call('Emitir con revision y documentos','PATCH','/facturas/'+invoice.id+'/estado',{estado:'emitida'});
    await call('Impedir emitida a borrador','PATCH','/facturas/'+invoice.id+'/estado',{estado:'borrador'});
    failEmail=true;
    evidence.failedDelivery=await call('Reclamacion emitida con fallo real controlado','POST','/facturas/reclamaciones/procesar',{});
    failEmail=false;
    evidence.retryDelivery=await call('Reintentar reclamacion tras rechazo SMTP','POST','/facturas/reclamaciones/procesar',{});
    evidence.duplicateDelivery=await call('Evitar duplicacion de reclamacion','POST','/facturas/reclamaciones/procesar',{});
    const correction=await call('Crear rectificativa como borrador','POST','/facturas',{cliente_id:client.id,serie:'R',estado:'borrador',fecha:'2026-09-16',factura_original_id:invoice.id,motivo_rectificacion:'Descuento posterior de prueba',tipo_rectificacion:'diferencia',lineas:[{concepto:'Rectificación de prueba',cantidad:1,precio_unit:-50}]});
    if(correction.id){
      if(correction.factura_original_id!==invoice.id)throw new Error('La rectificativa perdió la referencia original');
      await call('Bloquear rectificativa sin revision','PATCH','/facturas/'+correction.id+'/estado',{estado:'emitida'});
      if((await db.query('SELECT estado FROM facturas WHERE id=$1',[invoice.id])).rows[0].estado==='rectificada')throw new Error('Se modificó la factura original antes de emitir');
      await call('Revisar rectificativa con soporte original','POST','/facturas/'+correction.id+'/revision',{confirmado:true,motivo_sin_referencia:'Sin referencia contractual'});
      await call('Emitir rectificativa revisada','PATCH','/facturas/'+correction.id+'/estado',{estado:'emitida'});
      if((await db.query('SELECT estado FROM facturas WHERE id=$1',[invoice.id])).rows[0].estado!=='rectificada')throw new Error('No se actualizó el estado de la factura rectificada');
      if((await db.query('SELECT factura_id FROM pedidos WHERE id=$1',[order.id])).rows[0].factura_id!==invoice.id)throw new Error('La rectificativa reasignó el pedido');
    }


   }
  }
  await req('./services/companyProducts').set(company,'combinado');
  const plannerOrder=await call('Planner: crear carga','POST','/pedidos',{workspace:'planner',cliente_id:client.id,origen:'Fábrica Valencia',destino:'Madrid',fecha_carga:'2026-09-18',fecha_descarga:'2026-09-19',importe:0,referencia_cliente:'VENTA-QA',peso_kg:0,bultos:0});
  const scopedLoads=await call('Planner: cargas separadas','GET','/pedidos?workspace=planner&todos=true');if(!scopedLoads.data.some(p=>p.id===plannerOrder.id)||scopedLoads.data.some(p=>p.id!==plannerOrder.id))throw Error('Planner mezcló pedidos de TransGest');
  const article=await call('Planner: crear referencia','POST','/planner/inventario/articulos',{referencia:'REF-QA',descripcion:'Mercancía de pruebas',coste:2.1,precio_venta:3.5,peso_kg:1.25,unidades_palet:20});
  if(!plannerOrder.id||!article.id)throw Error('Planner: no se pudo iniciar la preparación');
  const stock=await call('Planner: fabricación','POST','/planner/inventario/movimientos',{articulo_id:article.id,tipo:'fabricacion',almacen:'Principal',ubicacion:'A1',lote:'QA-2026',cantidad:100,motivo:'Fin de producción',operacion:crypto.randomUUID()});
  const prep=await call('Planner: reserva mercancía','POST','/planner/inventario/preparaciones',{pedido_id:plannerOrder.id,lineas:[{existencia_id:stock.id,cantidad:25,precio_venta:3.5}]});
  if(!prep.id)throw Error('Planner: no se pudo reservar mercancía');
  let prepared=await call('Planner: consultar preparación','GET','/planner/inventario/preparaciones/'+prep.id);
  for(const l of prepared.lineas)prepared=await call('Planner: verificar picking','POST','/planner/inventario/preparaciones/'+prep.id+'/accion',{version:prepared.version,accion:'preparar_linea',linea_id:l.id,preparada:true});
  prepared=await call('Planner: mercancía lista','POST','/planner/inventario/preparaciones/'+prep.id+'/accion',{version:prepared.version,accion:'lista'});
  const note=await call('Planner: generar albarán','POST','/planner/inventario/preparaciones/'+prep.id+'/albaran',{});
  const pdf=await call('Planner: descargar albarán PDF','GET','/planner/inventario/albaranes/'+note.id+'/pdf');if(!Buffer.from(pdf.file_base64||'','base64').subarray(0,4).equals(Buffer.from('%PDF')))throw Error('Albarán PDF inválido');
  for(const situacion of ['espera_carga','cargando','cargado'])prepared=await call('Planner: estado '+situacion,'POST','/planner/inventario/preparaciones/'+prep.id+'/accion',{version:prepared.version,accion:'camion',situacion});
  await call('Planner: expedir','POST','/planner/inventario/preparaciones/'+prep.id+'/accion',{version:prepared.version,accion:'expedir'});
  const sale=await call('Planner: factura de mercancía','POST','/facturas',{cliente_id:client.id,serie:'A',estado:'borrador',planner_preparacion_id:prep.id,referencia_cliente:'VENTA-QA',lineas:[{concepto:'No confiar en cliente',cantidad:1,precio_unit:0.01}]});
  if(!sale.id||Number(sale.base_imponible)!==87.5)throw Error('Factura Planner no respeta el precio de mercancía');
  await call('Planner: revisar factura de venta','POST','/facturas/'+sale.id+'/revision',{confirmado:true});
  await call('Planner: emitir factura de venta','PATCH','/facturas/'+sale.id+'/estado',{estado:'emitida'});
  const rest=(await db.query('SELECT cantidad,reservado FROM planner_existencias WHERE id=$1',[stock.id])).rows[0];if(Number(rest.cantidad)!==75||Number(rest.reservado)!==0)throw Error('Saldo tras expedición incorrecto');
  const authorisedVehicle=await call('Planner: alta vehículo autorizado','POST','/planner/vehiculos-autorizados',{matricula:'5678QA',tipo:'tractora'});
  if(!authorisedVehicle.id)throw Error('No se creó el vehículo autorizado');
  const missingDocuments=await call('Planner: rechazar autorización sin documentos','PATCH','/planner/vehiculos-autorizados/'+authorisedVehicle.id,{estado:'autorizado',version:1});if(!missingDocuments.error)throw Error('Autorizó vehículo sin documentación');
  const vehicleDocument=await call('Planner: documentación vehículo','POST','/planner/vehiculos-autorizados/'+authorisedVehicle.id+'/documentos',{tipo:'seguro',nombre:'Seguro.pdf',file_mime:'application/pdf',file_base64:pdf.file_base64,vencimiento:'2030-12-31'});
  if(!vehicleDocument.id)throw Error('No se guardó documento del vehículo');
  const authorised=await call('Planner: autorizar vehículo revisado','PATCH','/planner/vehiculos-autorizados/'+authorisedVehicle.id,{estado:'autorizado',version:2});if(authorised.estado!=='autorizado')throw Error('No se autorizó vehículo revisado');
  const downloaded=await call('Planner: descargar documento vehículo','GET','/planner/vehiculos-autorizados/'+authorisedVehicle.id+'/documentos/'+vehicleDocument.id);if(downloaded.file_base64!==pdf.file_base64)throw Error('Documento alterado');
  const transportCompany=crypto.randomUUID(),transportClient=crypto.randomUUID(),supplier=crypto.randomUUID();
  await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'Transportista conectado','B55555555','connected@example.invalid','profesional','activa')",[transportCompany]);
  await db.query("INSERT INTO clientes(id,empresa_id,nombre,cif) VALUES($1,$2,'Almacén auditoría','B00000000')",[transportClient,transportCompany]);
  await db.query("INSERT INTO colaboradores(id,empresa_id,nombre,cif,email) VALUES($1,$2,'Transportista conectado','B55555555','supplier@example.invalid')",[supplier,company]);
  const sharedOrder=await call('Planner: encargo a empresa externa','POST','/pedidos',{cliente_id:client.id,colaborador_id:supplier,precio_colaborador:350,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-18',importe:500});
  if(!sharedOrder.id)throw Error('No se pudo crear el encargo compartido');
  const invitation=crypto.randomBytes(32).toString('hex');await db.query("INSERT INTO colaborador_pedido_tokens(pedido_id,empresa_id,accion,token_hash,expires_at) VALUES($1,$2,'confirmar',$3,NOW()+INTERVAL '1 hour')",[sharedOrder.id,company,crypto.createHash('sha256').update(invitation).digest('hex')]);
  const exchange=req('./services/plannerExchange'),assertPlanner=require('assert/strict');
  await assertPlanner.rejects(exchange.connect(db,company,user,{token:invitation,cliente_id:client.id}),/no está disponible/);
  const connected=await exchange.connect(db,transportCompany,user,{token:invitation,cliente_id:transportClient});
  const repeated=await exchange.connect(db,transportCompany,user,{token:invitation,cliente_id:transportClient});assertPlanner.equal(repeated.viaje_id,connected.viaje_id);
  const transported=(await db.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2',[connected.viaje_id,transportCompany])).rows[0];assertPlanner.equal(Number(transported.importe),350,'carrier sees its agreed sale price, not shipper sale price');assertPlanner.equal(transported.cliente_id,transportClient);
  await db.query("UPDATE pedidos SET estado='en_curso',updated_at=NOW()+INTERVAL '1 second' WHERE id=$1",[transported.id]);
  await db.query("INSERT INTO pedido_docs(empresa_id,pedido_id,tipo,nombre,file_base64,file_mime) VALUES($1,$2,'pod','Entrega.pdf',$3,'application/pdf')",[transportCompany,transported.id,pdf.file_base64]);
  await exchange.synchronize(db,company);await exchange.synchronize(db,transportCompany);
  assertPlanner.equal((await db.query('SELECT estado FROM pedidos WHERE id=$1',[sharedOrder.id])).rows[0].estado,'en_curso');
  assertPlanner.equal((await db.query("SELECT COUNT(*)::int AS n FROM pedido_docs WHERE empresa_id=$1 AND pedido_id=$2 AND tipo='pod'",[company,sharedOrder.id])).rows[0].n,1,'shared POD is idempotent');
  await db.query('UPDATE planner_conexiones_transporte SET activo=false WHERE transportista_empresa_id=$1',[transportCompany]);
  await db.query("UPDATE pedidos SET estado='entregado',updated_at=NOW()+INTERVAL '2 seconds' WHERE id=$1",[transported.id]);await exchange.synchronize(db,company);
  assertPlanner.equal((await db.query('SELECT estado FROM pedidos WHERE id=$1',[sharedOrder.id])).rows[0].estado,'en_curso','disconnected supplier cannot update shipper');
  await call('Planner: albaran de otro transportista bloqueado','GET','/transport-exchange/viajes/'+transported.id+'/albaran');
  evidence.plannerExchange={singleTrip:true,ownTenant:true,agreedPrice:true,stateSync:true,podSync:true,revoke:true};
  const warehouse=await call('Crear almacén','POST','/palets/almacenes',{nombre:'Almacén auditoría'});
  await call('Crear producto stock','POST','/palets/mercancias',{nombre:'Producto auditoría',cliente_id:client.id,almacen_id:warehouse.id,stock_actual:20,stock_minimo:5,precio_compra:10,precio_venta:15});
  await call('Entrada palets cliente','POST','/palets/movimientos',{tipo:'entrada',propietario_cliente_id:client.id,cliente_movimiento_id:client.id,almacen_id:warehouse.id,cantidad:30,num_albaran:'AUD-001',fecha:'2026-09-16'});
 }
 const workshop=await call('Leer configuración taller','GET','/taller/estado');
 await call('Guardar recambio de taller','PUT','/taller/estado',{...workshop,stock:[...(workshop.stock||[]),{id:'audit-part',nombre:'Filtro de prueba',stock:3,precio:25}]});
 const savedWorkshop=await call('Recargar recambio','GET','/taller/estado');evidence.sparePersisted=savedWorkshop.stock?.some(p=>p.id==='audit-part');
 // Two editors save from the same snapshot: check whether the first edit survives.
 await call('Guardar taller usuario A','PUT','/taller/estado',{...savedWorkshop,stock:[...(savedWorkshop.stock||[]),{id:'part-A',nombre:'Recambio A'}]});
 await call('Guardar taller usuario B con lectura anterior','PUT','/taller/estado',{...savedWorkshop,stock:[...(savedWorkshop.stock||[]),{id:'part-B',nombre:'Recambio B'}]});
 const concurrent=await call('Leer taller después de dos ediciones','GET','/taller/estado');evidence.workshopFirstEditLost=!concurrent.stock?.some(p=>p.id==='part-A');
 const piece=await call('Crear recambio con inventario SQL','POST','/taller/piezas',{nombre:'Filtro audit SQL',codigo_barras:'AUD-FILTER',stock_actual:4,precio_compra:25});
 const repair=await call('Crear reparación en taller propio','POST','/taller/intervenciones',{vehiculo_id:vehicle.id,tipo:'preventivo',descripcion:'Cambio filtro auditoría',coste_mano_obra:60,origen_taller:'propio'});
 if(repair.id&&piece.id){await call('Consumir recambio en reparación','POST','/taller/intervenciones/'+repair.id+'/piezas',{pieza_id:piece.id,codigo_barras:'AUD-FILTER',cantidad:1,precio_unitario:25});await call('Cerrar reparación propia','POST','/taller/intervenciones/'+repair.id+'/cerrar',{});}
 const externalRepair=await call('Crear reparación de proveedor externo','POST','/taller/intervenciones',{vehiculo_id:vehicle.id,tipo:'correctivo',descripcion:'Revisión externa auditoría',origen_taller:'externo',taller_externo:'Taller demo audit',factura_proveedor_num:'AUD-001',factura_proveedor_importe:150});
 if(externalRepair.id)await call('Cerrar reparación externa','POST','/taller/intervenciones/'+externalRepair.id+'/cerrar',{});
 evidence.repairs=(await db.query('SELECT origen_taller,coste_total,estado FROM taller_intervenciones WHERE empresa_id=$1',[company])).rows;
 evidence.pieceStock=(await db.query('SELECT stock_actual FROM taller_piezas WHERE id=$1',[piece.id])).rows[0];
 const tire1=await call('Alta neumático','POST','/taller/neumaticos',{medida:'315/70 R22.5',codigo_barras:'AUD-TIRE-1',profundidad_mm:12,precio_compra:280});
 const tire2=await call('Alta segundo neumático','POST','/taller/neumaticos',{medida:'315/70 R22.5',codigo_barras:'AUD-TIRE-2',profundidad_mm:12,precio_compra:280});
 if(tire1.id)await call('Montar neumático en tractora','PATCH','/taller/neumaticos/'+tire1.id+'/montar',{vehiculo_id:vehicle.id,posicion:'delantero_izquierdo',km_montaje:10000});
 if(tire2.id)await call('Montar segundo neumático en posición ocupada','PATCH','/taller/neumaticos/'+tire2.id+'/montar',{vehiculo_id:vehicle.id,posicion:'delantero_izquierdo',km_montaje:10000});
 evidence.tiresInSamePosition=(await db.query("SELECT COUNT(*)::int AS n FROM taller_neumaticos WHERE empresa_id=$1 AND vehiculo_id=$2 AND posicion='delantero_izquierdo' AND estado='montado'",[company,vehicle.id])).rows[0];
 if(tire1.id)await call('Baja neumático sustituido','PATCH','/taller/neumaticos/'+tire1.id+'/baja',{motivo:'Prueba de sustitución'});
 await db.query('UPDATE empresas SET ia_limite_mensual=0 WHERE id=$1',[company]);
 const intelRoute=fs.readFileSync(path.join(root,'src/routes/intelligence.js'),'utf8');
 try{await vm.runInNewContext(intelRoute.slice(intelRoute.indexOf('async function reserveTurn'),intelRoute.indexOf("router.post('/chat'"))+'\nreserveTurn(company)',{db,company,ensureTables:req('./services/apiKeys').ensureTables});evidence.intelligenceZeroQuota={reserved:true,company:(await db.query('SELECT ia_limite_mensual,ia_usos_mes FROM empresas WHERE id=$1',[company])).rows[0]};}catch(e){evidence.intelligenceZeroQuota={error:e.message,sql:e.auditSql};}
 await db.query('UPDATE empresas SET ia_limite_mensual=2 WHERE id=$1',[company]);
 const intelContext={db,company,ensureTables:req('./services/apiKeys').ensureTables};
 vm.runInNewContext(intelRoute.slice(intelRoute.indexOf('async function reserveTurn'),intelRoute.indexOf("router.post('/chat'")),intelContext);
 const period=await vm.runInNewContext('reserveTurn(company)',intelContext);
 evidence.intelligenceReserved=(await db.query('SELECT ia_usos_mes FROM empresas WHERE id=$1',[company])).rows[0].ia_usos_mes;
 intelContext.period=period;await vm.runInNewContext('releaseTurn(company,period)',intelContext);
 evidence.intelligenceRefunded=(await db.query('SELECT ia_usos_mes FROM empresas WHERE id=$1',[company])).rows[0].ia_usos_mes;
 const intelligence=req('./services/intelligence');evidence.intelligenceTools=[];
 for(const [name,args] of [['buscar_pedidos',{texto:'',desde:'2026-09-01',hasta:'2026-09-30'}],['resumen_mes',{mes:'2026-09'}],['disponibilidad_flota',{fecha:'2026-09-16',texto:''}],['stock_almacen',{texto:''}],['reservas_muelles',{fecha:'2026-09-16'}]]){
  try{const value=await intelligence.executeTool(db,{id:user,empresa_id:company,rol:'gerente'},name,args);evidence.intelligenceTools.push({name,ok:true,source:value.fuente});}catch(e){evidence.intelligenceTools.push({name,ok:false,error:e.message});}
 }
 if(driver.id){
  const driverUser=crypto.randomUUID();await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo,chofer_id) VALUES($1,$2,'Conductor auditoría','driver-login@example.invalid',$3,'chofer',true,$4)",[driverUser,company,await req('bcryptjs').hash(password,10),driver.id]);
  const managerToken=token;token=null;const driverLogin=await call('Login app chófer','POST','/auth/login',{email:'driver-login@example.invalid',password});token=driverLogin.token;
  if(token){
   const day=await call('Leer jornada chófer','GET','/choferes/app/jornada');
   const rig={conjunto_confirmado:true,vehiculo_id:day.chofer.vehiculo_id,remolque_id:day.chofer.vehiculo_remolque_id||null};
   await call('Catálogo de clientes del chófer','GET','/pedidos/chofer/clientes');
   await call('Rechazar jornada sin confirmar conjunto','POST','/choferes/app/jornada/iniciar',{km_inicio:10000});
   await call('Iniciar jornada','POST','/choferes/app/jornada/iniciar',{...rig,km_inicio:10000});
   await call('Registrar conducción','POST','/choferes/app/jornada/actividad',{actividad:'conduccion'});
   await call('Rechazar km de cierre inferiores','POST','/choferes/app/jornada/cerrar',{...rig,km_fin:9000});
   await call('Rechazar km de cierre iguales','POST','/choferes/app/jornada/cerrar',{...rig,km_fin:10000});
   await call('Cerrar jornada','POST','/choferes/app/jornada/cerrar',{...rig,km_fin:10350});
   await call('Chófer sin permiso de facturación','GET','/facturas');
  }
  token=managerToken;
 }
 await call('Soporte antiguo tras abrir chat nuevo','POST','/mi-cuenta/soporte',{mensaje:'Prueba compatibilidad sin envío'});
 // Reproduce upgrading an existing installation with the legacy support table.
 await pg.exec('DROP TABLE soporte_mensajes;');
  await pg.exec(`CREATE TABLE soporte_mensajes(id UUID PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id UUID,usuario_id UUID,nombre TEXT,email TEXT,mensaje TEXT NOT NULL,estado TEXT DEFAULT 'pendiente',created_at TIMESTAMPTZ DEFAULT now(),resuelto_at TIMESTAMPTZ)`);
 const historicId=crypto.randomUUID();
 await db.query("INSERT INTO soporte_mensajes(id,empresa_id,usuario_id,nombre,mensaje) VALUES($1,$2,$3,'Usuario antiguo','Consulta original')",[historicId,company,user]);
 delete require.cache[req.resolve('./services/supportSchema')];
 await req('./services/supportSchema').ensureSupportSchema();
 const restored=await db.query('SELECT m.mensaje,s.usuario_id FROM soporte_mensajes m JOIN soporte_solicitudes s ON s.id=m.solicitud_id WHERE m.id=$1',[historicId]);
 evidence.supportUpgrade=restored.rows[0]?.mensaje==='Consulta original' && restored.rows[0]?.usuario_id===user?'success':'failed';
 const assert=require('node:assert/strict');
 assert.equal(evidence.schemaErrors.length,0,JSON.stringify(evidence.schemaErrors));
 assert.equal(evidence.intelligenceReserved,1);assert.equal(evidence.intelligenceRefunded,0);
 assert.equal(evidence.workshopFirstEditLost,false);
 assert.equal(evidence.tiresInSamePosition.n,1);
 assert.equal(evidence.supportUpgrade,'success');
 assert.equal(evidence.invoiceAfterReminder.estado,'borrador');
 assert.equal(evidence.invoiceAfterReminder.reclamacion_envios,0);
 assert.equal(evidence.failedDelivery.emails,0);
 assert.ok(evidence.failedDelivery.emails_fallidos>0);
 assert.ok(evidence.retryDelivery.emails>0);
 assert.equal(evidence.duplicateDelivery.emails,0);
 const expectedErrors=new Map([
  ['Rechazar recargo incluido en porte',409],
  ['Planner: albaran de otro transportista bloqueado',404],
  ['Planner: rechazar autorización sin documentos',409],
  ['Bloquear rectificativa sin revision',409],['Emitir SIN revisar documentación',409],['Enviar SIN documentación',409],['Revision sin documentos bloqueada',409],
  ['Revision caducada por cambio de pedido',409],['Impedir emitida a borrador',409],
  ['Guardar taller usuario B con lectura anterior',409],['Montar segundo neumático en posición ocupada',409],
  ['Rechazar jornada sin confirmar conjunto',400],['Rechazar km de cierre iguales',400],
  ['Rechazar km de cierre inferiores',400],['Chófer sin permiso de facturación',403]
 ]);
 for(const c of evidence.checks) {if(expectedErrors.has(c.label))assert.equal(c.status,expectedErrors.get(c.label),JSON.stringify(c));else assert.ok(c.status>=200 && c.status<300,JSON.stringify(c));}
 evidence.technicalHealth=await req('./services/technicalHealth').readTechnicalHealth();
 assert.equal(evidence.technicalHealth.checks.find(c=>c.key==='database').state,'ok');
 assert.equal(evidence.technicalHealth.checks.find(c=>c.key==='schema').state,'ok');
 assert.equal(evidence.technicalHealth.checks.find(c=>c.key==='smtp').state,'pending');
 assert.equal(evidence.technicalHealth.checks.find(c=>c.key==='ai').state,'pending');
 if(pg.verifyBackup)evidence.backupRestore=await pg.verifyBackup();
 evidence.passed=true;
 evidence.created={company:!!company,user:!!user,client:!!client.id,driver:!!driver.id,vehicle:!!vehicle.id};
 }finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{evidence.fatal=e.stack;process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(__dirname,process.env.AUDIT_PG_PORT?'audit-workflows-native-results.json':'audit-workflows-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await pg?.close();await db.pool.end();});

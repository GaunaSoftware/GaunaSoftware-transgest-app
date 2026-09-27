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
 if(pg.applyMigrations)evidence.migrationRunner=await pg.applyMigrations();
 else for(const file of fs.readdirSync(path.join(root,'scripts/migrations')).filter(n=>n.endsWith('.sql')).sort()){
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
 const express=req('express'),app=express();app.use('/api/v1/inbound/orders',req('./routes/orderInboxInbound'));app.use(express.json({limit:'12mb'}));app.use(express.urlencoded({extended:true,limit:'12mb'}));req('./middleware/asyncErrors')(logger);
 // Exercise the actual production module boundaries, not authentication alone.
 const authMiddleware=req('./middleware/auth');
 const boundarySource=code.slice(code.indexOf('function pedidosAuthUnlessPublic'),code.indexOf('safeUse(`${api}/auth`'));
 const boundaries=vm.runInNewContext(boundarySource+'\n({pedidosAuthUnlessPublic,choferesPermissionUnlessApp,portalClientePermission,colaboradoresAuthUnlessPublic,routeOptimizerAuthUnlessPublic,routeOptimizerPlanUnlessPublic})',authMiddleware);
 if(process.env.AUDIT_BROWSER==='1')app.get('/health',(request,res)=>res.json({status:'ok',mode:'synthetic-browser-qa'}));
 app.get('/api/v1/producto',(request,res)=>res.json({producto:'tms'}));
 app.use('/api/v1/auth',auth);
 app.use('/api/v1/empresa',authMiddleware.authenticate,authMiddleware.requireModulePermission('empresa'),req('./routes/datos_empresa'));
 app.use('/api/v1/superadmin',req('./routes/superadminCore'));
 app.use('/api/v1/usuarios',authMiddleware.authenticate,req('./routes/usuarios'));
 app.use('/api/v1/route-optimizer',boundaries.routeOptimizerAuthUnlessPublic,boundaries.routeOptimizerPlanUnlessPublic,req('./routes/route_optimizer'));
 for(const name of ['clientes','choferes','vehiculos','pedidos','facturas','rutas','palets','taller','agenda','intelligence','puntos_interes'])app.use('/api/v1/'+(name==='puntos_interes'?'puntos-interes':name),name==='pedidos'?boundaries.pedidosAuthUnlessPublic:authMiddleware.authenticate,...(name==='choferes'?[boundaries.choferesPermissionUnlessApp]:[]),req('./routes/'+name));
 app.use('/api/v1/planner-loading',authMiddleware.authenticate,req('./routes/planner_loading'));
 app.use('/api/v1/planner',req('./middleware/auth').authenticate,req('./routes/planner'));
 app.use('/api/v1/portal-cliente',authMiddleware.authenticate,boundaries.portalClientePermission,req('./routes/cliente_portal'));
 app.use('/api/v1/informes',authMiddleware.authenticate,authMiddleware.requireModulePermission('informes'),authMiddleware.requirePlanFeature('kpis_avanzados'),req('./routes/informes'));
 // Exercise the compatibility router separately; production registers it after pedidos.
 app.use('/api/v1/legacy-pedidos',boundaries.pedidosAuthUnlessPublic,req('./routes/carta_porte'));
 app.use('/api/v1/colaboradores',boundaries.colaboradoresAuthUnlessPublic,req('./routes/colaboradores'));
 app.use('/api/v1/supplier-app',req('./middleware/auth').authenticate,req('./routes/supplier_app'));
 app.use('/api/v1/supplier-invoice-review',authMiddleware.authenticate,req('./routes/supplier_invoice_review'));
 app.use('/api/v1/transport-exchange',req('./middleware/auth').authenticate,req('./routes/planner_exchange'));
 app.use('/api/v1/soporte',req('./middleware/auth').authenticate,req('./routes/soporte').createSupportRouter());
 app.use('/api/v1/mi-cuenta',req('./middleware/auth').authenticate,req('./routes/mi_cuenta'));
 app.use('/api/v1/control-horario',authMiddleware.authenticate,authMiddleware.requireModulePermission('control_horario'),req('./routes/control_horario'));
 app.use('/api/v1/importacion',req('./middleware/auth').authenticate,req('./middleware/auth').requireModulePermission('importacion'),req('./routes/importacion'));
 if(process.env.AUDIT_BROWSER==='1'){
  const browserBuild=path.resolve(root,'../transgest-frontend/build');
  if(!fs.existsSync(path.join(browserBuild,'index.html')))throw Error('Build local ausente para AUDIT_BROWSER');
  app.use(req('express').static(browserBuild,{index:false}));
  app.get('*',(request,res)=>res.type('html').send(fs.readFileSync(path.join(browserBuild,'index.html'),'utf8').replace('<head>','<head><script>localStorage.setItem("transgest_api_url",location.origin)</script>')));
 }
 app.use((err,request,res,next)=>res.status(err.status||500).json({error:err.message}));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port+'/api/v1';let token;
 async function call(label,method,url,body){const response=await actualFetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});let data=await response.json();evidence.checks.push({label,method,url,status:response.status,...(data.error?{error:data.error}:{}),...(data.errors?{validation:data.errors}:{} )});return data;}
 try{
 const login=await call('Login gerente demo','POST','/auth/login',{email:'audit@example.invalid',password});token=login.token;
 if(!token)throw Error('No token on demo login');
 evidence.officeAttendance=await require('./audit_office_attendance.cjs')({db,base,company,token,password});
 const client=await call('Crear cliente con datos fiscales','POST','/clientes',{nombre:'Alfa Auditoría',cif:'B12345678',direccion:'Calle de Prueba 1',cp:'46001',ciudad:'Valencia',codigo_postal:'46001',municipio:'Valencia',provincia:'Valencia',pais:'España',email:'client@example.invalid',telefono:'960000000',tipo_iva:21,forma_pago:'transferencia',vencimiento:'30 dias',pendiente_revision:true});
 const driver=await call('Crear conductor','POST','/choferes',{nombre:'Conductor',apellidos:'de Pruebas',dni:'00000000T',telefono:'960000001',email:'driver@example.invalid',activo:true});
 const vehicle=await call('Crear tractora','POST','/vehiculos',{matricula:'1234AUD',tipo:'tractora',marca:'Prueba',modelo:'Auditoría',fecha_itv:'2027-09-16',km_actuales:10000,activo:true});
 const trailer=await call('Crear remolque con longitud útil','POST','/vehiculos',{matricula:'5678AUD',tipo:'remolque',metros_carga:12.4,activo:true});
 require('node:assert/strict').ok(trailer.id,'Debe existir el remolque de prueba');
 const defaultLengthOrder=await call('Carga completa sin longitud explícita','POST','/pedidos',{cliente_id:client.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',tipo_carga:'completa',importe:400});
 require('node:assert/strict').equal(defaultLengthOrder.longitud_ocupada_mode,'auto');
 require('node:assert/strict').equal(Number(defaultLengthOrder.metros_lineales),13.65);
 require('node:assert/strict').equal(Number(defaultLengthOrder.carga_largo_m),13.65);
 const defaultLengthReload=await call('Reabrir carga completa automática','GET','/pedidos/'+defaultLengthOrder.id);
 require('node:assert/strict').equal(defaultLengthReload.longitud_ocupada_mode,'auto');
 require('node:assert/strict').equal(Number(defaultLengthReload.carga_largo_m),13.65);
 const trailerLengthOrder=await call('Carga completa con remolque corto','POST','/pedidos',{cliente_id:client.id,remolque_id_manual:trailer.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',tipo_carga:'completa',importe:400});
 require('node:assert/strict').equal(trailerLengthOrder.longitud_ocupada_mode,'auto');
 require('node:assert/strict').equal(Number(trailerLengthOrder.metros_lineales),12.4);
 const withoutCosts=await call('Rentabilidad sin costes registrados','GET','/pedidos/'+trailerLengthOrder.id+'/rentabilidad-predictiva');
 require('node:assert/strict').equal(withoutCosts.costes.total,null,'La ausencia de costes no equivale a cero');
 require('node:assert/strict').equal(withoutCosts.margen.importe,null);
 require('node:assert/strict').equal(withoutCosts.margen.pct,null);
 require('node:assert/strict').equal(withoutCosts.decision,'completar_datos');
 await db.query('UPDATE pedidos SET coste_gasoil=50 WHERE id=$1 AND empresa_id=$2',[trailerLengthOrder.id,company]);
 await db.query('INSERT INTO pedido_extracostes(pedido_id,tipo,concepto,importe) VALUES($1,$2,$3,$4)',[trailerLengthOrder.id,'otro','Auditoría de coste',25]);
 const withCosts=await call('Rentabilidad con coste y extra registrados','GET','/pedidos/'+trailerLengthOrder.id+'/rentabilidad-predictiva');
 require('node:assert/strict').equal(Number(withCosts.costes.total),75);
 require('node:assert/strict').equal(Number(withCosts.margen.importe),325);
 require('node:assert/strict').equal(Number(withCosts.margen.pct),81.25);
 require('node:assert/strict').equal(withCosts.costes.cobertura,'parcial');
 const manualLengthOrder=await call('Carga completa con longitud manual','POST','/pedidos',{cliente_id:client.id,remolque_id_manual:trailer.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',tipo_carga:'completa',metros_lineales:7.2,importe:400});
 require('node:assert/strict').equal(manualLengthOrder.longitud_ocupada_mode,'manual');
 require('node:assert/strict').equal(Number(manualLengthOrder.carga_largo_m),7.2);
 const manualLengthReload=await call('Reabrir carga completa manual','GET','/pedidos/'+manualLengthOrder.id);
 require('node:assert/strict').equal(manualLengthReload.longitud_ocupada_mode,'manual');
 require('node:assert/strict').equal(Number(manualLengthReload.metros_lineales),7.2);
 for(const url of ['/clientes','/choferes','/vehiculos','/pedidos','/facturas','/rutas','/palets','/taller/estado','/agenda','/intelligence/estado','/soporte'])await call('Listado '+url,'GET',url);
 const ticket=await call('Crear solicitud soporte','POST','/soporte',{asunto:'Auditoría local',mensaje:'Mensaje sin salida al exterior.'});
 if(ticket.id){await call('Recargar conversación','GET','/soporte/'+ticket.id);await call('Responder conversación','POST','/soporte/'+ticket.id+'/mensajes',{mensaje:'Segunda intervención de prueba'});}
 if(client.id)await call('Marcar cliente revisado','PATCH','/clientes/'+client.id+'/revision',{});
 if(client.id){
  const catalog=await call('Catálogo de importación','GET','/importacion/catalog');
  require('node:assert/strict').ok(catalog.templates.some(template=>template.type==='Clientes'));
  const staged=await actualFetch(base+'/importacion/upload',{
   method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'text/csv','x-import-filename':'clientes-auditoria.csv','x-import-type':'Clientes','x-import-source-system':'audit-isolated'},
   body:Buffer.from('source_id,nombre,cif\naudit-client-1,Cliente importado,B87654321\n'),signal:AbortSignal.timeout(15000),
  });
  const stagedBody=await staged.json();
  evidence.checks.push({label:'Preparar lote CSV aislado',method:'POST',url:'/importacion/upload',status:staged.status});
  require('node:assert/strict').equal(staged.status,201,JSON.stringify(stagedBody));
  require('node:assert/strict').ok(stagedBody.batch.id);
  const batch=await call('Revisar lote CSV','GET','/importacion/batches/'+stagedBody.batch.id);
  require('node:assert/strict').equal(batch.id,stagedBody.batch.id);
  await call('Importar tarifa CSV','POST','/rutas/importar',{cliente_id:client.id,texto:'Origen;Destino;Precio;Km\nValencia;Madrid;500;350'});
  evidence.routesAfterFailedImport=(await db.query('SELECT COUNT(*)::int AS n FROM rutas WHERE empresa_id=$1',[company])).rows[0];
  const foreignRoute=(await db.query('SELECT id FROM rutas WHERE empresa_id=$1 AND cliente_id=$2 LIMIT 1',[company,client.id])).rows[0];
  require('node:assert/strict').ok(foreignRoute?.id,'La tarifa de prueba debe quedar vinculada al cliente');
  const otherClient=await call('Crear segundo cliente sin tarifa','POST','/clientes',{nombre:'Beta Auditoría',cif:'B87654322',email:'beta@example.invalid'});
  const otherRoutes=await call('Segundo cliente sin tarifas ajenas','GET','/clientes/'+otherClient.id+'/rutas');
  require('node:assert/strict').equal(otherRoutes.length,0);
  const otherOrder=await call('Crear pedido con ruta ajena indicada','POST','/pedidos',{cliente_id:otherClient.id,ruta_id:foreignRoute.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-16',importe:400});
  require('node:assert/strict').equal(otherOrder.ruta_id,null,'No se debe vincular una tarifa de otro cliente al pedido');
  const forbiddenRoute=await call('Rechazar ruta de otro cliente al editar','PUT','/pedidos/'+otherOrder.id,{ruta_id:foreignRoute.id});
  require('node:assert/strict').equal(forbiddenRoute.error,'La ruta no pertenece al cliente de este pedido.');
  const otherOrderAfter=(await db.query('SELECT ruta_id,importe FROM pedidos WHERE id=$1 AND empresa_id=$2',[otherOrder.id,company])).rows[0];
  require('node:assert/strict').equal(otherOrderAfter.ruta_id,null);
  require('node:assert/strict').equal(Number(otherOrderAfter.importe),400);
  const datedOrder=await call('Pedido con carga pactada anterior','POST','/pedidos',{cliente_id:client.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2020-01-15',fecha_descarga:'2020-01-16',importe:400});
  await call('Confirmar carga pactada','PATCH','/pedidos/'+datedOrder.id+'/estado',{estado:'confirmado'});
  const missingRealDateConfirmation=await call('Exigir confirmación de carga real en otro día','PATCH','/pedidos/'+datedOrder.id+'/estado',{estado:'en_curso'});
  require('node:assert/strict').equal(missingRealDateConfirmation.code,'FECHA_REAL_CARGA_CONFIRMAR');
  const confirmedRealLoad=await call('Registrar carga real confirmada','PATCH','/pedidos/'+datedOrder.id+'/estado',{estado:'en_curso',confirmar_carga_real:true});
  require('node:assert/strict').equal(confirmedRealLoad.estado,'en_curso');
  const datedAfter=(await db.query('SELECT fecha_carga,fecha_carga_planificada,fecha_descarga_planificada,carga_real_at FROM pedidos WHERE id=$1 AND empresa_id=$2',[datedOrder.id,company])).rows[0];
  require('node:assert/strict').equal(new Date(datedAfter.fecha_carga).toISOString().slice(0,10),'2020-01-15');
  require('node:assert/strict').equal(new Date(datedAfter.fecha_carga_planificada).toISOString().slice(0,10),'2020-01-15');
  require('node:assert/strict').equal(new Date(datedAfter.fecha_descarga_planificada).toISOString().slice(0,10),'2020-01-16');
  require('node:assert/strict').ok(datedAfter.carga_real_at,'La ejecución real debe tener marca temporal del servidor');
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
   const confirmedEvents=(await db.query("SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2 AND tipo='estado.actualizado'",[order.id,company])).rows[0].n;
   const repeatedConfirmation=await call('Reintentar confirmación sin efectos duplicados','PATCH','/pedidos/'+order.id+'/estado',{estado:'confirmado'});
   require('node:assert/strict').equal(repeatedConfirmation.sin_cambios,true);
   require('node:assert/strict').equal((await db.query("SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2 AND tipo='estado.actualizado'",[order.id,company])).rows[0].n,confirmedEvents);
   const concurrentDeliveries=await Promise.all([
    call('Completar viaje (petición 1)','PATCH','/pedidos/'+order.id+'/estado',{estado:'entregado'}),
    call('Completar viaje (petición 2 simultánea)','PATCH','/pedidos/'+order.id+'/estado',{estado:'entregado'}),
   ]);
   require('node:assert/strict').equal(concurrentDeliveries.filter(result=>result.sin_cambios===true).length,1,'Solo una petición simultánea debe aplicar la transición');
   const deliveredEvents=(await db.query("SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2 AND tipo='estado.actualizado'",[order.id,company])).rows[0].n;
   require('node:assert/strict').equal(deliveredEvents,confirmedEvents+1,'La entrega simultánea debe producir un solo evento de estado');
   const repeatedDelivery=await call('Reintentar entrega sin efectos duplicados','PATCH','/pedidos/'+order.id+'/estado',{estado:'entregado'});
   require('node:assert/strict').equal(repeatedDelivery.sin_cambios,true);
   require('node:assert/strict').equal((await db.query("SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2 AND tipo='estado.actualizado'",[order.id,company])).rows[0].n,deliveredEvents);
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
  evidence.plannerLoading=await require('./audit_planner_loading.cjs')({db,company,user,base,token,password,prep,order:plannerOrder,stock});
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
  evidence.plannerExchange=await require('./audit_network.cjs')({db,company,user,base,token,password,transportCompany,transportClient,sharedOrder,legacyToken:invitation,pdf,stock});
  evidence.supplierInvoice=await require('./audit_supplier_invoice.cjs')({db,base,company,user,token,password,order:sharedOrder});
  evidence.invoiceWorkflow=await require('./audit_invoice_workflow.cjs')({db,base,company,user,token,password});
  evidence.operationalCompletion=await require('./audit_operational_completion.cjs')({db,base,company,user,token,password,pdf});
  evidence.fiscalDelivery=await require('./audit_fiscal_delivery.cjs')({db,company,user});
  evidence.physicalBi=await require('./audit_physical_bi.cjs')({db,base,company,token});
  evidence.integrationRegistry=await require('./audit_integration_registry.cjs')({db,base,company,token});
  evidence.multiempresa=await require('./audit_multiempresa.cjs')({db,base,company,token,password});
  evidence.supplierDeparture=await require('./audit_supplier_departure.cjs')({db,base,company,token});
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
  require('node:assert/strict').equal(evidence.intelligenceTools.at(-1).ok,true,`Intelligence ${name}: ${evidence.intelligenceTools.at(-1).error||''}`);
 }
 if(driver.id){
  const driverUser=crypto.randomUUID();await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo,chofer_id) VALUES($1,$2,'Conductor auditoría','driver-login@example.invalid',$3,'chofer',true,$4)",[driverUser,company,await req('bcryptjs').hash(password,10),driver.id]);
  const managerToken=token;token=null;const driverLogin=await call('Login app chófer','POST','/auth/login',{email:'driver-login@example.invalid',password});token=driverLogin.token;
  if(token){
   const driverOrders=await call('App chófer: cargar viajes propios','GET','/pedidos?chofer_id='+driver.id);
   require('node:assert/strict').ok(Array.isArray(driverOrders.data),'La app debe cargar los viajes asignados al chófer');
   const assignedOrder=driverOrders.data.find(item=>item.chofer_id===driver.id);
   if(assignedOrder){
    const driverOrder=await call('App chófer: abrir viaje propio','GET','/pedidos/'+assignedOrder.id);
    require('node:assert/strict').equal(driverOrder.id,assignedOrder.id);
    const ownCarta=await call('App chófer: carta de porte propia','GET','/pedidos/'+assignedOrder.id+'/carta-porte');
    require('node:assert/strict').equal(ownCarta.id,assignedOrder.id);
    const managementSummary=await call('Bloquear resumen económico ida-retorno al chófer','GET','/pedidos/'+assignedOrder.id+'/ida-retorno');
    require('node:assert/strict').ok(managementSummary.error,'Debe rechazarse el resumen económico al chófer');
    const steps=await call('App chófer: leer pasos propios','GET','/pedidos/'+assignedOrder.id+'/chofer-pasos');
    require('node:assert/strict').ok(steps.data,'El chófer debe poder leer el progreso de su viaje');
   }
   const unassignedCartaBefore=(await db.query('SELECT carta_porte_numero FROM pedidos WHERE id=$1 AND empresa_id=$2',[defaultLengthOrder.id,company])).rows[0].carta_porte_numero;
   const unassignedCarta=await call('Bloquear carta de porte de otro viaje','GET','/pedidos/'+defaultLengthOrder.id+'/carta-porte');
   require('node:assert/strict').equal(unassignedCarta.error,'No puedes acceder a este pedido');
   require('node:assert/strict').equal((await db.query('SELECT carta_porte_numero FROM pedidos WHERE id=$1 AND empresa_id=$2',[defaultLengthOrder.id,company])).rows[0].carta_porte_numero,unassignedCartaBefore,'El acceso denegado no debe generar número de carta de porte');
   const day=await call('Leer jornada chófer','GET','/choferes/app/jornada');
   const rig={conjunto_confirmado:true,vehiculo_id:day.chofer.vehiculo_id,remolque_id:day.chofer.vehiculo_remolque_id||null};
   await call('Catálogo de clientes del chófer','GET','/pedidos/chofer/clientes');
   await call('Rechazar jornada sin confirmar conjunto','POST','/choferes/app/jornada/iniciar',{km_inicio:10000});
   await call('Iniciar jornada','POST','/choferes/app/jornada/iniciar',{...rig,km_inicio:10000});
   evidence.driverFlow=await require('./audit_driver_flow.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company,client,driver,vehicle,password});
   evidence.controlTowerFlow=await require('./audit_control_tower_flow.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company,password});
   evidence.operationalModel=await require('./audit_operational_model.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company});
   evidence.groupagePlan=await require('./audit_groupage_plan.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company});
   evidence.journeyReplanning=await require('./audit_journey_replanning.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company});
   evidence.orderInbox=await require('./audit_inbox_flow.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company,client});
   evidence.driverJourney=await require('./audit_driver_journey.cjs')({base,fetch:actualFetch,db,managerToken,driverToken:token,company,driver,vehicle});
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
  token=login.token;
  const monthlyExpense=await call('Estructura: crear mensual','POST','/empresa/gastos-estructura',{nombre:'Alquiler sintético',importe:100,periodo:'mensual',fecha:'2026-09'});
  const oneOffExpense=await call('Estructura: crear puntual','POST','/empresa/gastos-estructura',{nombre:'Puntual sintético',importe:200,periodo:'unico',fecha:'2026-09'});
  const expenseCompany=crypto.randomUUID();
  await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'GASTOS B SINTÉTICOS','B00000999','expense-b@example.invalid','enterprise','activa')",[expenseCompany]);
  const foreignExpense=(await db.query("INSERT INTO gastos_estructura(empresa_id,nombre,tipo,importe,periodo,fecha) VALUES($1,'Gasto de otra empresa','Otros',9000,'mensual','2025-01') RETURNING id",[expenseCompany])).rows[0];
  const expenseSummary=await call('Estructura: resumen mensual','GET','/empresa/gastos-estructura/resumen?periodo=2026-09&empresa_id=ajena');
  assert.equal(expenseSummary.total,300);assert.ok(expenseSummary.gastos.every(g=>g.empresa_id===company));
  assert.equal(Math.round(expenseSummary.reparto.reduce((s,r)=>s+r.coste_igual,0)*100),30000);
  const nextExpenseSummary=await call('Estructura: recurrencia siguiente mes','GET','/empresa/gastos-estructura/resumen?periodo=2026-10');
  assert.equal(nextExpenseSummary.total,100);
  assert.deepEqual(nextExpenseSummary.comparativa.periodos.map(p=>p.total),[100,300,null]);
  assert.equal(nextExpenseSummary.comparativa.variacion_anterior.diferencia,-200);
  assert.equal(expenseSummary.comparativa.periodos[0].total,expenseSummary.total);
  token=(await call('Estructura: login conductor restringido','POST','/auth/login',{email:'driver-login@example.invalid',password})).token;
  await call('Estructura: chófer sin acceso a comparativa','GET','/empresa/gastos-estructura/resumen?periodo=2026-09');
  token=login.token;
  await call('Estructura: no editar gasto de otra empresa','PUT','/empresa/gastos-estructura/'+foreignExpense.id,{importe:10});
  const foreignUser=crypto.randomUUID();
  await db.query("INSERT INTO usuarios(id,empresa_id,nombre,email,password_hash,rol,activo) VALUES($1,$2,'Contable B sintético','expense-b@example.invalid',$3,'contable',true)",[foreignUser,expenseCompany,await req('bcryptjs').hash(password,10)]);
  const foreignLogin=await call('Estructura: login contable B','POST','/auth/login',{email:'expense-b@example.invalid',password});
  token=foreignLogin.token;
  const foreignSummary=await call('Estructura: comparación B no filtra A','GET','/empresa/gastos-estructura/resumen?periodo=2026-09&empresa_id='+company);
  assert.equal(foreignSummary.total,9000);assert.deepEqual(foreignSummary.comparativa.periodos.map(p=>p.total),[9000,9000,9000]);
  token=login.token;
  await call('Estructura: cerrar mes compatible','POST','/empresa/meses-cerrados/2026-09-01',{});
  assert.ok((await call('Estructura: mes cerrado','GET','/empresa/meses-cerrados')).includes('2026-09'));
  await call('Estructura: bloqueo servidor de mes cerrado','PUT','/empresa/gastos-estructura/'+monthlyExpense.id,{importe:101});
  await call('Estructura: reabrir mes','DELETE','/empresa/meses-cerrados/2026-09');
  const attachedExpense=await call('Estructura: conservar justificante','PUT','/empresa/gastos-estructura/'+oneOffExpense.id,{factura_nombre:'Justificante.pdf',factura_data:'data:application/pdf;base64,'+Buffer.from('%PDF-1.4 synthetic').toString('base64')});
  assert.ok(attachedExpense.factura_data);
  await call('Estructura: quitar puntual de ensayo','DELETE','/empresa/gastos-estructura/'+oneOffExpense.id);
  await call('Estructura: quitar mensual de ensayo','DELETE','/empresa/gastos-estructura/'+monthlyExpense.id);
  const expectedErrors=new Map([
  ['Estructura: chófer sin acceso a comparativa',403],
  ['Estructura: no editar gasto de otra empresa',404],
  ['Estructura: bloqueo servidor de mes cerrado',409],
  ['Rechazar ruta de otro cliente al editar',400],
  ['Exigir confirmación de carga real en otro día',409],
  ['Rechazar recargo incluido en porte',409],
  ['Planner: albaran de otro transportista bloqueado',404],
  ['Planner: rechazar autorización sin documentos',409],
  ['Bloquear rectificativa sin revision',409],['Emitir SIN revisar documentación',409],['Enviar SIN documentación',409],['Revision sin documentos bloqueada',409],
  ['Revision caducada por cambio de pedido',409],['Impedir emitida a borrador',409],
  ['Guardar taller usuario B con lectura anterior',409],['Montar segundo neumático en posición ocupada',409],
  ['Bloquear carta de porte de otro viaje',403],['Bloquear resumen económico ida-retorno al chófer',403],
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
 if(process.env.AUDIT_BROWSER==='1'){
  await db.query("INSERT INTO gastos_estructura(empresa_id,nombre,tipo,importe,periodo,fecha) VALUES ($1,'Alquiler oficina · SINTÉTICO','Alquiler/Arrendamiento',950,'mensual','2025-01'),($1,'Licencia anual · SINTÉTICO','Software/Licencias',1200,'anual','2026-01'),($1,'Formación septiembre · SINTÉTICO','Formación',450,'unico','2026-09'),($1,'Formación agosto · SINTÉTICO','Formación',250,'unico','2026-08')",[company]);
  // Keep this order free of Planner reservations and customer debt so the
  // browser can exercise an ordinary save/reopen cycle without bypassing guards.
  const qaClient=await call('Cliente limpio para QA visual','POST','/clientes',{nombre:'Cliente QA visual',cif:'B87654321',direccion:'Calle de Ensayo 2',cp:'46002',ciudad:'Valencia',codigo_postal:'46002',municipio:'Valencia',provincia:'Valencia',pais:'España',email:'visual@example.invalid',telefono:'960000002',tipo_iva:21,forma_pago:'transferencia',vencimiento:'30 dias'});
  const qaOrder=await call('Pedido libre para QA visual','POST','/pedidos',{cliente_id:qaClient.id,origen:'Valencia',destino:'Madrid',fecha_carga:'2026-09-26',fecha_descarga:'2026-09-27',tipo_carga:'completa',importe:400,mercancia:'Mercancía sintética'});
  require('node:assert/strict').ok(qaClient.id && qaOrder.id,'Browser QA fixture must be complete');
  await db.query("UPDATE pedidos SET estado='en_curso',origen='Población pendiente',destino='Población desconocida',puntos_carga=$1::jsonb,puntos_descarga=$2::jsonb WHERE id=$3 AND empresa_id=$4",[
    JSON.stringify([{nombre:'Almacén de prueba',ciudad:'Castellón',direccion:'Polígono Norte 4',codigo_postal:'12006',pais:'España'}]),
    JSON.stringify([{nombre:'Destino de prueba',ciudad:'Alboraya',direccion:'Calle Puerto 2',codigo_postal:'46120',pais:'España'}]),qaOrder.id,company]);
  // Explicit synthetic loaded fixture for visual QA; never applied to real orders.
  await db.query('INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,data) VALUES($1,$2,$3)',[qaOrder.id,company,JSON.stringify({carga_ok:true})]);
  await db.query("INSERT INTO usuarios(id,empresa_id,cliente_id,nombre,email,password_hash,rol,activo) VALUES($1,$2,$3,'Cliente de pruebas','portal@example.invalid',$4,'cliente',true)",[crypto.randomUUID(),company,qaClient.id,await req('bcryptjs').hash(password,10)]);
  await db.query("INSERT INTO superadmins(email,password_hash,nombre,activo) VALUES('superadmin-audit@example.invalid',$1,'SuperAdmin sintético',true) ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash",[await req('bcryptjs').hash(password,10)]);
  console.log(JSON.stringify({browserQa:'ready',url:'http://127.0.0.1:'+server.address().port,email:'audit@example.invalid',portalEmail:'portal@example.invalid',password,company,qaOrder:qaOrder.numero,mode:'PGlite sintético; correo y conexiones externas desactivados'}));
  await new Promise(resolve=>process.once('SIGINT',resolve));
 }
 }finally{await new Promise(r=>server.close(r));}
}
main().catch(e=>{evidence.fatal=e.stack;process.exitCode=1;}).finally(async()=>{fs.writeFileSync(path.join(__dirname,process.env.AUDIT_PG_PORT?'audit-workflows-native-results.json':'audit-workflows-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));await pg?.close();await db.pool.end();});

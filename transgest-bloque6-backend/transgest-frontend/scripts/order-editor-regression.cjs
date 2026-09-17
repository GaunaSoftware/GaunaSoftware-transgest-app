// End-to-end regression against the production build and an isolated, synthetic API.
// Never uses credentials, sends real email or writes to a remote backend.
// Build first; provide Playwright and a browser (see docs/EDITOR_PEDIDOS_2026-09-17.md).
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.resolve(process.env.ORDER_EDITOR_QA_OUTPUT || path.join(__dirname,'../../../tmp/order-editor-qa'));fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(root,'index.html');res.setHeader('Content-Type',p.endsWith('.js')||p.endsWith('.mjs')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html');fs.createReadStream(p).pipe(res);});
const user={id:'qa',empresa_id:'qa-company',nombre:'QA',rol:'gerente',plan:'pro_intelligence',productos:['transgest'],permisos:{}};
const day=new Date().toLocaleDateString('en-CA');
const base={id:'order-1',numero:'PED-QA-0419',cliente_id:'client-1',cliente_nombre:'Cementos de prueba',estado:'confirmado',origen:'Madrid',destino:'Abanilla',fecha_pedido:day,fecha_carga:day,fecha_descarga:day,mercancia:'Cemento paletizado',peso_kg:4000,precio_unitario:480,tipo_precio:'viaje',tipo_iva:21,km_ruta:387.5,puntos_carga:[{direccion:'Madrid',ciudad:'Madrid',cliente_nombre:'Almacén de prueba',pais:'España',provincia:'Madrid',cp:'28001',lat:40.4,lng:-3.7,fecha:day,ventana:'16:00-21:00',es_principal:true}],puntos_descarga:[{direccion:'Abanilla',ciudad:'Abanilla',pais:'España',provincia:'Murcia',cp:'30640',lat:38.2,lng:-1.04,fecha:day,ventana:'06:30-14:00',es_principal:true}]};
const clients=[{id:'client-1',nombre:'Cementos de prueba',cif:'B12345678',activo:true,tipo_iva:21}];
const trucks=[{id:'truck-1',matricula:'1234-ABC',clase:'tractora',chofer_id:'driver-1',remolque_id:'trailer-1'},{id:'trailer-1',matricula:'R-1234-BCD',clase:'remolque'}];
const drivers=[{id:'driver-1',nombre:'Juan',apellidos:'García López',vehiculo_id:'truck-1'}];
let current={...base},writes=[],requests=[],documents=[],profit={},savedRoutes=[];
(async()=>{await new Promise(r=>server.listen(4395,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}),headless:true});let page;try{
 page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(u=>{localStorage.setItem('tms_token','isolated-order-editor-qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem('tms_onboarding_done:qa-company:gerente:qa','1');localStorage.setItem('tms_theme','light');},user);
 await page.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1','');requests.push(p);let data=[];
 if(req.method()!=='GET')writes.push({path:p,method:req.method(),body:req.postData()?req.postDataJSON():null});
 if(p.endsWith('/liquidacion-token'))data={id:'token-qa',colaborador_id:'supplier-1',operativa_url:'https://example.invalid/qa-token'};
 else if(p==='/auth/me')data=user;
 else if(p==='/pedidos' || p==='/pedidos/resumen-lista')data=req.method()==='GET'?{data:[current],pagination:{total:1,hasNext:false,totalPages:1}}:{...current,...req.postDataJSON()};
 else if(p==='/pedidos/order-1'){if(req.method()!=='GET')current={...current,...req.postDataJSON()};data=current;}
 else if(p==='/clientes')data=clients;
 else if(p==='/vehiculos')data=trucks;
 else if(p==='/choferes')data=drivers;
 else if(p==='/colaboradores')data=[{id:'supplier-1',nombre:'Transportista de prueba',cif:'B87654321',email:'test@example.invalid',activo:true}];
 else if(p==='/clientes/client-1/rutas'||p==='/rutas')data=savedRoutes;
 else if(p==='/empresa/pedido-docs/order-1')data=documents;
 else if(p==='/notificaciones/operativas/colaboradores')data={items:[{key:'qa-alert',title:'Aviso de prueba',titulo:'Aviso de prueba',severity:'alta',pedido_id:'order-1',pedido_numero:'PED-QA-0419'}],resumen:{total:1}};
 else if(p==='/puntos-interes' && req.method()==='POST')data={...req.postDataJSON(),id:'new-point-qa'};
 else if(p==='/puntos-interes')data=[{id:'point-1',nombre:'Almacén guardado',direccion:'Calle de prueba 1',ciudad:'Madrid',provincia:'Madrid',cp:'28001',pais:'España',lat:40.4,lng:-3.7,cliente_id:'client-1',tipo:'carga'}];
 else if(p.endsWith('/eventos'))data=[{id:'e1',tipo:'pedido.editado',actor_nombre:'QA',created_at:new Date().toISOString()},{id:'e2',tipo:'pedido.creado',created_at:new Date().toISOString()}];
 else if(p.endsWith('/chofer-pasos'))data={};
 else if(p.endsWith('/rentabilidad-predictiva'))data=profit;
 else if(p.endsWith('/riesgo'))data={total_pendiente:0,limite_riesgo:0,avisos:[]};
 else if(p.includes('geocoding/route'))data={ok:true,km:387.5,duration_min:264,provider:'here',points:current.puntos_carga.concat(current.puntos_descarga),geometry:[[-3.7,40.4],[-1.04,38.2]]};
 else if(p.includes('geo'))data={ok:true,lat:40.4,lng:-3.7,ciudad:'Madrid',provincia:'Madrid',pais:'España'};
 else if(p.includes('config')||p.includes('resumen')||p.includes('status')||p.includes('perfil')||p.includes('logo')||p.includes('suscripcion')||p.includes('puesta-marcha'))data={};
 await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.route('https://tiles.openfreemap.org/**',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({version:8,sources:{},layers:[{id:'base',type:'background',paint:{'background-color':'#e5eef0'}}]})}));
 await page.goto('http://127.0.0.1:4395');await page.waitForTimeout(1800);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
 await page.getByText('PED-QA-0419',{exact:true}).first().waitFor();
 await page.getByRole('button',{name:'Ver pedido PED-QA-0419',exact:true}).first().click();
 const modal=page.locator('.tg-order-editor-dialog');await modal.waitFor();
 await page.waitForTimeout(1800);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(out,'step1-desktop.png')});
 assert.ok(await modal.getByRole('heading',{name:'Mercancía',exact:true}).isVisible());
 assert.equal(await modal.getByRole('heading',{name:'Precio y condiciones'}).isVisible(),false);
 const before=writes.length;
 await modal.getByPlaceholder('Ref. pedido del cliente').fill('Referencia conservada');
 await modal.getByRole('button',{name:'Continuar →'}).click();
 assert.equal(writes.length,before);assert.ok(await modal.getByRole('heading',{name:'Precio y condiciones'}).isVisible());
 await page.screenshot({path:path.join(out,'step2-desktop.png')});
 await modal.getByRole('button',{name:'← Volver'}).click();assert.equal(await modal.getByPlaceholder('Ref. pedido del cliente').inputValue(),'REFERENCIA CONSERVADA');
 for(const [w,h]of [[375,812],[390,844],[393,852],[430,932],[768,1024],[1920,1080]]){
  await page.setViewportSize({width:w,height:h});
  for(const step of [1,2]){
   await modal.getByRole('tab',{name:step===1?/Transporte y mercancía/:/Ejecución y costes/}).click();
   const dims=await modal.evaluate(el=>({scroll:el.scrollWidth,width:el.clientWidth,body:el.querySelector('.tgui-dialog-body').scrollWidth,bw:el.querySelector('.tgui-dialog-body').clientWidth}));
   assert.ok(dims.scroll<=dims.width+1&&dims.body<=dims.bw+1,`overflow ${w} step ${step}: ${JSON.stringify(dims)}`);
   assert.ok(await modal.getByRole('button',{name:step===1?'Continuar →':'Guardar cambios',exact:true}).isVisible());
   await page.screenshot({path:path.join(out,`step${step}-${w}.png`)});
   if(w===1920)console.log('HEIGHT',step,await modal.locator('.tgui-dialog-body').evaluate(el=>({content:el.scrollHeight,viewport:el.clientHeight})));
  }
 }
 assert.deepEqual(errors,[]);console.log('PASS initial steps, retained draft, no navigation write, six viewport widths, no overflow/errors');
 async function reopen(order,theme='light'){
  current=structuredClone(order);await page.addInitScript(t=>localStorage.setItem('tms_theme',t),theme);
  await page.reload();await page.waitForTimeout(500);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
  await page.getByRole('button',{name:'Ver pedido PED-QA-0419',exact:true}).first().click();await modal.waitFor();await page.waitForTimeout(3200);
 }
 const field=label=>modal.locator('label').filter({hasText:label}).first().locator('..').locator('input:not([type=checkbox]),select,textarea').first();
 await page.setViewportSize({width:1440,height:1080});
 for(const supplier of [false,true])for(const adr of [false,true]){
  await reopen({...base,...(supplier?{colaborador_id:'supplier-1',colaborador_nombre:'Transportista de prueba',precio_colaborador:350}:{vehiculo_id:'truck-1',chofer_id:'driver-1',remolque_id:'trailer-1'}),adr,adr_items:adr?[{un:'1202',nombre:'GASÓLEO',clase:'3',grupo_embalaje:'III',categoria_transporte:'3',cantidad:100}]:[]});
  assert.equal(await modal.getByPlaceholder('Nº ONU o nombre (ej: 1202 o gasoleo)').isVisible(),adr);
  await modal.getByRole('button',{name:'Continuar →'}).click();
  assert.equal(await field(/^Vehiculo$/).isVisible(),!supplier);
  assert.equal(await field(/^Colaborador \/ proveedor$/).isVisible(),supplier);
  assert.equal(await modal.getByRole('button',{name:'Enviar enlace',exact:true}).isVisible(),supplier);
  assert.equal(await modal.locator('.order-editor-supplier-progress').count(),0);
  if(supplier && !adr){await modal.getByRole('button',{name:'Enviar enlace',exact:true}).click();await modal.getByRole('button',{name:'Reenviar enlace',exact:true}).waitFor();}
  console.log(`PASS ${supplier?'supplier':'own fleet'} + ${adr?'ADR':'no ADR'}`);
 }
 await reopen({...base,colaborador_id:'supplier-1',colaborador_nombre:'Transportista de prueba',precio_colaborador:350,workflow_colaborador_enviado_at:new Date().toISOString()});
 await modal.getByRole('button',{name:'Continuar →'}).click();
 assert.ok(await modal.getByRole('button',{name:'Reenviar enlace',exact:true}).isVisible());assert.ok(await modal.locator('.order-editor-supplier-progress').isVisible());
 assert.ok(await modal.getByRole('button',{name:'Generar acceso temporal',exact:true}).isVisible());
 await modal.getByRole('button',{name:'Generar acceso temporal',exact:true}).click();
 await modal.getByRole('button',{name:'Copiar enlace',exact:true}).waitFor();
 assert.equal(await modal.getByRole('button',{name:'Generar acceso temporal',exact:true}).count(),0);
 await modal.getByRole('button',{name:'Revocar',exact:true}).click();await page.getByRole('dialog').filter({has:page.getByText('Revocar acceso temporal',{exact:true})}).getByRole('button',{name:'Revocar',exact:true}).click();
 await modal.getByRole('button',{name:'Generar acceso temporal',exact:true}).waitFor();
 assert.ok(writes.some(r=>r.method==='DELETE' && r.path.endsWith('/liquidacion-tokens/token-qa')));
 // Tokens and writes use the isolated mock API only.
 await reopen({...base,puntos_carga:[...base.puntos_carga,{...base.puntos_carga[0],direccion:'Segunda carga',es_principal:false,es_adicional:true}],puntos_descarga:[...base.puntos_descarga,{...base.puntos_descarga[0],direccion:'Segunda descarga',es_principal:false,es_adicional:true}]});
 assert.equal(await modal.locator('.tg-stop-card').count(),4);
 await modal.getByRole('button',{name:'Acciones de descarga 2',exact:true}).click();await page.getByRole('menuitem',{name:'Subir',exact:true}).click();
 assert.ok((await modal.locator('.tg-stop-editor').nth(1).locator('.tg-stop-card').first().innerText()).includes('Segunda descarga'));
 await modal.getByRole('button',{name:'Salir',exact:true}).click();await page.getByText('Cambios sin guardar',{exact:true}).waitFor();await page.getByRole('button',{name:'No guardar',exact:true}).click();await page.getByRole('button',{name:'Volver',exact:true}).click();
 await modal.getByRole('button',{name:'Acciones de descarga 1',exact:true}).click();await page.getByRole('menuitem',{name:'Editar punto'}).click();
 assert.ok(await modal.getByPlaceholder('Poblacion o direccion').isVisible());
 await modal.getByRole('button',{name:'Cambiar origen / destino y gestionar puntos',exact:true}).click();
 await modal.getByRole('button',{name:'Guardar punto',exact:true}).first().click();
 assert.ok(await page.getByText('Nuevo punto de interés',{exact:false}).count() || await page.getByText('Punto de interes',{exact:false}).count());
 const pointEditor=page.getByText('Guardar punto de interes',{exact:true}).locator('../../..');
 for(const name of ['CIF / NIF','Latitud','Longitud','Email','Contacto','Notas'])assert.ok((await pointEditor.innerText()).toLowerCase().includes(name.toLowerCase()));
 const pointWrites=writes.length;await pointEditor.getByRole('button',{name:'Guardar punto',exact:true}).click();await pointEditor.waitFor({state:'hidden'});
 assert.ok(writes.slice(pointWrites).some(r=>r.path==='/puntos-interes'&&r.body.cliente_id==='client-1'&&r.body.direccion==='Madrid'));

 await reopen({...base,coste_peajes:30,coste_dietas:20});await modal.getByRole('button',{name:'Continuar →'}).click();
 assert.ok((await modal.getByRole('button',{name:/Costes del viaje/}).innerText()).includes('50,00'));
 assert.equal(await field(/^Peajes/).isVisible(),false);await modal.getByRole('button',{name:/Costes del viaje/}).click();assert.ok(await field(/^Peajes/).isVisible());
 await field(/^Peajes/).fill('45');await modal.getByRole('button',{name:'← Volver'}).click();await modal.getByRole('button',{name:'Continuar →'}).click();assert.equal(await field(/^Peajes/).inputValue(),'45');
 documents=[{id:'doc-1',nombre:'Albaran-QA.pdf',tipo:'Albaran',file_size_kb:10,visible_chofer:true}];profit={ingreso:{total:480,eur_km:1.24},costes:{total:200},margen:{color:'verde'},recomendacion:'Costes cubiertos',riesgos:[],acciones:[]};
 await reopen(base);await modal.getByRole('button',{name:'Continuar →'}).click();await modal.getByRole('button',{name:/Ver \/ adjuntar documentos/}).click();assert.ok(await modal.getByText('Albaran-QA.pdf',{exact:true}).isVisible());
 assert.ok(await modal.getByText('Costes cubiertos',{exact:false}).isVisible());await modal.getByRole('button',{name:'Ver historial (2)',exact:true}).click();assert.ok(await modal.getByText('Pedido creado',{exact:true}).isVisible());
 savedRoutes=[{id:'route-1',origen:'Madrid',destino:'Abanilla',cliente_id:'client-1',km:387.5,tarifa_tipo:'viaje',precio_base:480}];
 await reopen({...base,ruta_id:'route-1'});assert.equal(await field(/^Cargar tarifa/).inputValue(),'route-1');
 await modal.getByPlaceholder('Ref. pedido del cliente').fill('QA-GUARDADO');await modal.getByRole('button',{name:'Continuar →'}).click();const w=writes.length;
 await modal.getByRole('button',{name:'Guardar cambios',exact:true}).click();await modal.waitFor({state:'hidden'});
 assert.ok(writes.slice(w).some(r=>r.path==='/pedidos/order-1' && r.body.referencia_cliente==='QA-GUARDADO'));assert.equal(current.peso_kg,4000);assert.equal(current.destino,'Abanilla');
 await reopen(base,'dark');await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'step1-dark-mobile.png')});await modal.getByRole('button',{name:'Continuar →'}).click();await page.screenshot({path:path.join(out,'step2-dark-mobile.png')});
 assert.deepEqual(errors,[]);console.log('PASS assignment modes, ADR, send/resend visibility, temporary access, multi-stops/reorder/edit, full point editor, costs, documents, history, profitability, saved route, save payload, dark mobile');

 await page.setViewportSize({width:1440,height:1080});await reopen(base);
 await modal.getByRole('button',{name:'Cambiar origen / destino y gestionar puntos',exact:true}).click();
 await modal.locator('select').filter({has:page.locator('option',{hasText:'Usar punto como origen'})}).selectOption('point-1');
 assert.ok((await modal.getByPlaceholder('Escribe o elige un punto de carga').inputValue()).toLowerCase().includes('almacén guardado'));
 await reopen(base);await modal.getByRole('button',{name:'Continuar →'}).click();
 await field(/^Vehiculo$/).selectOption('truck-1');assert.equal(await field(/^Chofer principal/).inputValue(),'driver-1');assert.equal(await field(/^Remolque/).inputValue(),'trailer-1');
 await reopen(base);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:agenda-refresh')));
 await modal.locator('.order-editor-alert-button').waitFor({timeout:15000});
 assert.equal(await modal.locator('.order-editor-alert-popover').getAttribute('open'),null);
 assert.equal(await page.locator('.avimp-panel:visible').count(),0);
 await modal.locator('.order-editor-alert-button').click();assert.ok(await modal.locator('.avimp-panel').isVisible());await modal.locator('.order-editor-alert-button').click();
 console.log('PASS saved point, automatic vehicle combination, AvIm safely minimized, reorder dirty warning, temporary access generation/revocation');
 await modal.getByRole('button',{name:'Salir',exact:true}).click();
 if(await page.getByTitle('Minimizar avisos importantes').isVisible())await page.getByTitle('Minimizar avisos importantes').click();
 await page.getByRole('button',{name:/Nuevo pedido/}).first().click();await modal.waitFor();
 const newWrites=writes.length;
 await modal.getByPlaceholder('Escribe el nombre del cliente...').fill('Cementos');await modal.getByText('Cementos de prueba',{exact:true}).first().click();
 await field(/^Cargar tarifa/).selectOption('route-1');
 await field(/^Fecha carga$/).fill(day);await field(/^Fecha descarga$/).fill(day);
 await field(/^Descripcion mercancia$/).fill('Cemento de prueba');
 await field(/^Peso/).fill('4,2');await field(/^Peso/).blur();
 await modal.getByPlaceholder('Ref. pedido del cliente').fill('QA-NUEVO');
 await modal.getByRole('button',{name:'Continuar →'}).click();
 assert.equal(writes.length,newWrites);
 await modal.locator('.tg-attachment-trigger input').setInputFiles({name:'Prueba-QA.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.4\nTest fixture only')});
 await modal.getByText('1 documentos preparados',{exact:true}).waitFor();
 await modal.getByRole('button',{name:'← Volver'}).click();assert.equal(await modal.getByPlaceholder('Ref. pedido del cliente').inputValue(),'QA-NUEVO');
 await modal.getByRole('button',{name:'Continuar →'}).click();assert.ok(await modal.getByText('1 documentos preparados',{exact:true}).isVisible());
 assert.equal(writes.length,newWrites);
 await modal.getByRole('button',{name:'Crear pedido',exact:true}).click();await modal.waitFor({state:'hidden',timeout:15000});await page.waitForTimeout(600);
 const created=writes.slice(newWrites).find(r=>r.method==='POST' && r.path==='/pedidos');assert.ok(created);assert.equal(created.body.peso_kg,4200);assert.equal(created.body.referencia_cliente,'QA-NUEVO');
 assert.ok(writes.slice(newWrites).some(r=>r.path.includes('pedido-docs') && r.body.nombre==='Prueba-QA.pdf'));
 assert.deepEqual(errors,[]);console.log('PASS create from zero, pending attachment and draft preserved without writes on switching, create/upload payloads');
 fs.writeFileSync(path.join(out,'requests.json'),JSON.stringify(requests,null,2));
 }catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText());}throw e;}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

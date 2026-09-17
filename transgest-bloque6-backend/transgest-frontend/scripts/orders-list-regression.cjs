// End-to-end regression against the production build and an isolated, synthetic API.
// Never uses credentials, sends real email or writes to a remote backend.
// Build first; provide Playwright and a browser (see docs/EDITOR_PEDIDOS_2026-09-17.md).
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.resolve(process.env.ORDERS_LIST_QA_OUTPUT || path.join(__dirname,'../../../tmp/orders-list-qa'));fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{let p=path.join(root,new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(p)||fs.statSync(p).isDirectory())p=path.join(root,'index.html');res.setHeader('Content-Type',p.endsWith('.js')||p.endsWith('.mjs')?'application/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html');fs.createReadStream(p).pipe(res);});
const user={id:'qa',empresa_id:'qa-company',nombre:'QA',rol:'gerente',plan:'pro_intelligence',productos:['transgest'],permisos:{}};
const day=new Date().toLocaleDateString('en-CA');
const base={id:'order-1',numero:'PED-QA-0419',cliente_id:'client-1',cliente_nombre:'Cementos de prueba y materiales de construcción, S.L.',estado:'confirmado',origen:'Madrid',destino:'Abanilla',fecha_pedido:day,fecha_carga:day,fecha_descarga:day,mercancia:'Cemento paletizado',peso_kg:4000,precio_unitario:480,tipo_precio:'viaje',tipo_iva:21,km_ruta:387.5,puntos_carga:[{direccion:'Madrid',ciudad:'Madrid',cliente_nombre:'Almacén de prueba',pais:'España',provincia:'Madrid',cp:'28001',lat:40.4,lng:-3.7,fecha:day,ventana:'16:00-21:00',es_principal:true}],puntos_descarga:[{direccion:'Abanilla',ciudad:'Abanilla',pais:'España',provincia:'Murcia',cp:'30640',lat:38.2,lng:-1.04,fecha:day,ventana:'06:30-14:00',es_principal:true}]};
const clients=[{id:'client-1',nombre:'Cementos de prueba y materiales de construcción, S.L.',cif:'B12345678',activo:true,tipo_iva:21}];
const trucks=[{id:'truck-1',matricula:'1234-ABC',clase:'tractora',chofer_id:'driver-1',remolque_id:'trailer-1'},{id:'trailer-1',matricula:'R-1234-BCD',clase:'remolque'}];
const drivers=[{id:'driver-1',nombre:'Juan',apellidos:'García López',vehiculo_id:'truck-1'}];
let failDetails=false;
let current={...base,notas:'Nota completa de la prueba',condiciones_adicionales:'Entrega con cita previa',incidencia_tipo:'operativa',incidencia_descripcion:'Esperando confirmación del destinatario'},writes=[],requests=[],documents=[],profit={},savedRoutes=[];
(async()=>{await new Promise(r=>server.listen(4395,'127.0.0.1',r));const browser=await chromium.launch({...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}),headless:true});let page;try{
 page=await browser.newPage({viewport:{width:1440,height:1080},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(u=>{localStorage.setItem('tms_token','isolated-orders-list-qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem('tms_onboarding_done:qa-company:gerente:qa','1');localStorage.setItem('tms_theme','light');},user);
 await page.route('**/api/v1/**',async route=>{const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1','');requests.push(p);let data=[];
 if(failDetails && p==='/pedidos/order-1' && req.method()==='GET'){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fallo simulado'})});return;}
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
 else if(p==='/notificaciones/operativas/colaboradores')data={items:[],resumen:{total:0}};
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
 await page.waitForTimeout(3200);
 if(await page.getByTitle('Minimizar avisos importantes').isVisible())await page.getByTitle('Minimizar avisos importantes').click();
 const list=page.locator('.orders-workspace');
 const summary=()=>page.getByRole('button',{name:'Resumen de PED-QA-0419',exact:true});
 const initialReads=requests.filter(p=>p==='/pedidos/order-1').length;
 await summary().click();await list.getByText('Nota completa de la prueba',{exact:true}).locator(':scope:visible').waitFor();
 assert.equal(requests.filter(p=>p==='/pedidos/order-1').length,initialReads+1);
 assert.equal(await page.locator('.tg-order-editor-dialog').count(),0);
 const detail=list.locator('.orders-inline-details:visible');
 for(const text of ['Cemento paletizado','06:30-14:00','16:00-21:00','Entrega con cita previa','Esperando confirmación del destinatario'])assert.ok((await detail.innerText()).includes(text),text);
 assert.equal(writes.filter(w=>w.path.startsWith('/pedidos')).length,0);
 await summary().click();
 failDetails=true;await summary().click();await detail.getByRole('alert').waitFor();failDetails=false;await detail.getByRole('button',{name:'Reintentar'}).click();await detail.getByText('Nota completa de la prueba',{exact:true}).waitFor();
 await summary().click();
 for(const width of [1920,1662,1440,1280,768,390]){
  await page.setViewportSize({width,height:1000});
  for(const folded of [false,true]){
   const toggle=page.getByRole('button',{name:folded?'Plegar panel de seguimiento':'Mostrar panel de seguimiento',exact:true});
   if(await toggle.isVisible())await toggle.click();
   assert.equal(await page.locator('#orders-follow-up').isVisible(),!folded);
   const geometry=await list.evaluate(el=>{
    const main=el.querySelector('.orders-main'),aside=el.querySelector('.orders-aside'),divider=el.querySelector('.orders-panel-divider');
    const table=el.querySelector('.tgui-desktop-data');
    return {overflow:document.documentElement.scrollWidth>innerWidth+1,tableVisible:!!table.getClientRects().length,tableOverflow:table.scrollWidth>table.clientWidth+1,main:main.getBoundingClientRect().right,aside:aside.getBoundingClientRect().left,divider:divider.getBoundingClientRect().left};
   });
   assert.equal(geometry.overflow,false,`${width} viewport overflow`);
   assert.equal(geometry.tableVisible,width>=768,`${width}: folding must preserve table representation`);
   if(width>=1280&&!folded)assert.equal(geometry.tableOverflow,true,`${width}: expanded panel preserves horizontal table scrolling`);
   if(width>=1662&&folded)assert.equal(geometry.tableOverflow,false,`${width}: collapsed panel fits columns`);
   if(width>1199&&!folded)assert.ok(geometry.main<=geometry.divider && geometry.divider<geometry.aside);
   await summary().click();await detail.waitFor();assert.ok((await detail.innerText()).includes('Entrega con cita previa'));await summary().click();
   await list.getByRole('heading',{name:'Pedidos / Tráfico',exact:true}).scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(out,`list-${width}-${folded?'folded':'open'}.png`)});
   console.log(`PASS layout ${width}, panel ${folded?'folded':'open'}`);
  }
 }
 await page.setViewportSize({width:1662,height:1080});
 await page.reload();await page.waitForTimeout(3200);await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));await summary().waitFor();
 assert.equal(await page.locator('#orders-follow-up').isVisible(),false);
 await page.getByTitle('Plegar menu',{exact:true}).click();
 await page.screenshot({path:path.join(out,'both-panels-folded.png')});
 await page.getByRole('button',{name:'Mostrar panel de seguimiento',exact:true}).click();
 await page.getByRole('button',{name:'Acciones de PED-QA-0419',exact:true}).click();await page.getByRole('menuitem',{name:'Asignación',exact:true}).click();
 await page.getByRole('button',{name:'Asignar camión, conductor o colaborador',exact:true}).click();
 const assign=page.getByRole('dialog',{name:'Asignar recursos',exact:true});await assign.waitFor();
 assert.equal(await assign.getByText('Importes del viaje',{exact:true}).count(),0);
 await assign.getByRole('button',{name:'Proveedor externo',exact:true}).click();await assign.getByLabel('Proveedor',{exact:true}).selectOption('supplier-1');
 await assign.getByLabel('Precio de venta total (€)',{exact:true}).fill('600');await assign.getByLabel('Coste total del proveedor (€)',{exact:true}).fill('400');
 assert.ok((await assign.innerText()).includes('200,00'));await page.screenshot({path:path.join(out,'supplier.png')});
 await assign.getByRole('button',{name:'Flota propia',exact:true}).click();assert.equal(await assign.getByText('Importes del viaje',{exact:true}).count(),0);
 await page.screenshot({path:path.join(out,'own-fleet.png')});
 await assign.getByRole('button',{name:'Cancelar',exact:true}).click();
 await page.getByTitle('Cambiar a modo oscuro',{exact:true}).click();
 await summary().click();await detail.waitFor();await page.screenshot({path:path.join(out,'summary-dark.png')});
 assert.equal(writes.filter(w=>w.path.startsWith('/pedidos')).length,0);assert.deepEqual(errors,[]);
 console.log('PASS full summary, retry, no writes, persisted panel, own/supplier form, responsive and dark layout');
 }catch(e){if(page){await page.screenshot({path:path.join(out,'failure.png')});fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText());}throw e;}finally{await browser.close();server.close();}})().catch(e=>{console.error(e);server.close();process.exitCode=1;});

const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const {mergeStop}=require('../../transgest-backend/src/services/driverStops');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','stops');
const day=new Date().toLocaleDateString('en-CA'),user={id:'qa',empresa_id:'company',chofer_id:'driver',rol:'chofer',nombre:'Chofer QA',plan:'enterprise',permisos:{}};
let order={id:'order',numero:'PED-QA-1',chofer_id:'driver',vehiculo_id:'truck',cliente_nombre:'Cliente QA',origen:'Almacén A',destino:'Entrega C',referencia_cliente:'REF-EMPRESA-123',estado:'confirmado',fecha_carga:day,fecha_descarga:day,mercancia:'Sacos',bultos:4,peso_kg:200,puntos_carga:[{id:'a',direccion:'Almacén A'},{id:'b',direccion:'Almacén B'}],puntos_descarga:[{id:'c',direccion:'Entrega C'},{id:'d',direccion:'Entrega D'}]},steps={},signatures=[],uploads=[],errors=[],apiErrors=[],dcdCalls=0;
(async()=>{
 fs.mkdirSync(out,{recursive:true});const server=http.createServer((req,res)=>{let f=path.join(root,new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');fs.createReadStream(f).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;
 try{
 browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(u=>{localStorage.setItem('tms_token','local-qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem('tms_onboarding_done:company:chofer:qa','1');navigator.geolocation.getCurrentPosition=success=>success({coords:{latitude:40,longitude:-3,accuracy:8},timestamp:Date.now()});},user);
 await page.route('**/api/v1/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname.replace('/api/v1','');let data=[];
 try{
 if(p==='/auth/me')data=user;
 else if(p==='/pedidos')data=[order];
 else if(p==='/choferes/app/jornada')data={chofer:{id:'driver',vehiculo_id:'truck',firma_base:'present',vehiculo_matricula:'1234-QA'},jornada:{id:'day',estado:'abierta',inicio_at:new Date().toISOString(),km_inicio:100},resumen:{}};
 else if(p==='/pedidos/order/chofer-pasos'){if(r.method()==='PATCH'){const patch=r.postDataJSON();if(patch.parada_id){const result=mergeStop(order,steps,patch);steps=result.data;order={...order,estado:result.state,...result.goods};}else steps={...steps,...patch};data={ok:true,data:steps};}else data={data:steps};}
 else if(p==='/pedidos/order/firma'){signatures.push(r.postDataJSON());data={ok:true};}
 else if(p==='/pedidos/order/chofer-docs'&&r.method()==='POST'){uploads.push(r.postDataJSON());data={id:'doc',ok:true};}
 else if(p==='/pedidos/order/documento-control-digital'){dcdCalls++;data={documento:{codigo_control:'QA',soporte_url:'https://example.invalid/qa'},status:{ready:true}};}
 else if(/config|perfil|logo|suscripcion|resumen|puesta-marcha|gps/.test(p))data={};
 await route.fulfill({json:data});
 }catch(e){apiErrors.push(e.message);await route.fulfill({status:409,json:{error:e.message}});}
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 const click=async name=>{await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(200);};
 await click('Ver detalles del viaje PED-QA-1');await page.getByText('REF-EMPRESA-123',{exact:true}).waitFor();assert.equal(dcdCalls,0);
 const image=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=800;c.height=1600;const x=c.getContext('2d');x.fillStyle='#333';x.fillRect(0,0,800,1600);x.fillStyle='white';x.fillRect(80,120,640,1360);x.fillStyle='black';x.font='35px Arial';x.fillText('ALBARAN QA',150,200);return c.toDataURL('image/png').split(',')[1];});
 const goods=async type=>{await page.getByLabel(type==='carga'?'Mercancía cargada':'Mercancía descargada',{exact:true}).fill('Sacos QA');await page.getByLabel('Palets / bultos',{exact:true}).fill('2');await page.getByLabel('Peso kg',{exact:true}).fill('100');await click('Guardar mercancía de esta parada');};
 const upload=async(i)=>{await click('Abrir cámara');const dialog=page.getByRole('dialog',{name:'Escanear documento'});await dialog.locator('input[type=file]').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});await dialog.getByRole('button',{name:'Usar documento recortado'}).waitFor();
 for(const size of [{width:390,height:844},{width:360,height:640},{width:844,height:390}]){await page.setViewportSize(size);await page.waitForTimeout(150);const boxes=await dialog.locator('footer button').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {bottom:r.bottom,top:r.top,right:r.right,left:r.left};}));assert(boxes.every(b=>b.top>=0&&b.bottom<=size.height&&b.left>=0&&b.right<=size.width),'Scanner controls stay in viewport '+JSON.stringify(size));}
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,`scanner-${i}.png`)});await click('Usar documento recortado');await page.getByRole('button',{name:'Adjuntar',exact:true}).click();await page.waitForTimeout(250);};
 const sign=async name=>{await click(name);const dialog=page.locator('.driver-overlay').filter({has:page.locator('canvas')});await dialog.locator('input').fill('Firma QA');const b=await dialog.locator('canvas').boundingBox();await page.mouse.move(b.x+30,b.y+40);await page.mouse.down();await page.mouse.move(b.x+130,b.y+80,{steps:8});await page.mouse.up();await dialog.getByRole('button',{name:'Confirmar',exact:true}).click();await dialog.waitFor({state:'hidden',timeout:4000});await page.waitForTimeout(350);};
 for(let i=0;i<2;i++){await click('Posicionado en carga');if(i===0)assert.equal(dcdCalls,0,'position does not query DCD');await click('Iniciar carga');await goods('carga');await upload(i);await sign('Firma del remitente');await click('Carga finalizada');}
 assert.equal(signatures.length,2);assert.equal(order.estado,'en_curso');assert(dcdCalls>0);
 for(let i=2;i<4;i++){await click('Iniciar viaje');const confirm=page.getByRole('button',{name:'Lo llevo revisado',exact:true});if(await confirm.isVisible())await confirm.click();await page.waitForTimeout(250);await click('Posicionado para descarga');await click('Descarga iniciada');await goods('descarga');await click('Descarga finalizada');await upload(i);await sign('Firmar entrega cliente');assert.equal(order.estado,i===3?'entregado':'en_curso');}
 assert.equal(signatures.length,4);assert.equal(new Set(signatures.map(s=>s.parada_id)).size,4);assert.equal(new Set(uploads.map(d=>d.metadata.parada_id)).size,4);assert.deepEqual(errors,[]);assert.deepEqual(apiErrors,[]);await page.screenshot({path:path.join(out,'completed.png'),fullPage:true});console.log('PASS mobile two loads/two deliveries: independent goods, scanned documents, four signatures, final-only delivery, reference and responsive scanner controls.');
 }catch(e){if(page){fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText());fs.writeFileSync(path.join(out,'errors.json'),JSON.stringify({errors,apiErrors,steps},null,2));await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});}throw e;}finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','warehouse');
const user={id:'qa-user',empresa_id:'qa-company',rol:'gerente',nombre:'QA Trafico',activo:true};
const clients=[{id:'client-1',nombre:'Cliente QA',activo:true},{id:'client-2',nombre:'Otro cliente QA',activo:true}];
const states=['pendiente','en_curso','confirmado','entregado','incidencia'];
const orders=Array.from({length:14},(_,i)=>({id:'order-'+i,numero:'P-QA-'+String(i+1).padStart(3,'0'),cliente_id:clients[i%2].id,cliente_nombre:clients[i%2].nombre,estado:states[i%5],origen:'VALENCIA',destino:'MADRID',origen_pais:'España',destino_pais:'España',origen_provincia:'Valencia',destino_provincia:'Madrid',fecha_carga:'2026-09-12',fecha_descarga:'2026-09-13',hora_carga:'12:00',importe:320,tipo_precio:'viaje',vehiculo_id:i?'truck-1':null,vehiculo_matricula:i?'1234-BCD':'',chofer_id:i?'driver-1':null,chofer_nombre:i?'Conductor QA':'',incidencia_tipo:i%5===4?'retraso_carga':null}));
const moves=[{id:'33333333-3333-4333-8333-333333333333',propietario_cliente_id:'client-1',propietario_nombre:'Cliente QA',tipo:'entrega',cantidad:100,fecha:'2026-09-12',num_albaran:'ENT-1',obra_referencia:'Obra QA'}, {id:'66666666-6666-4666-8666-666666666666',propietario_cliente_id:'client-1',propietario_nombre:'Cliente QA',tipo:'devolucion',cantidad:20,fecha:'2026-09-12',num_albaran:'DEV-1',estado_salida:'pendiente',obra_referencia:'Obra QA'}, {id:'77777777-7777-4777-8777-777777777777',propietario_cliente_id:'client-1',propietario_nombre:'Cliente QA',tipo:'devolucion',cantidad:30,fecha:'2026-09-11',num_albaran:'DEV-2',estado_salida:'confirmada',obra_referencia:'Obra QA'}];
orders[0].id='44444444-4444-4444-8444-444444444444';orders[0].vehiculo_matricula='1234-BCD';
async function main(){fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'text/html'));
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 const errors=[],writes=[],checks=[],requests=[];
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1672,height:1040}});
  await page.clock.setFixedTime(new Date('2026-09-12T08:00:00Z'));
  page.on('pageerror',e=>errors.push(e.message));
  let failList=false;

 await page.route('**/api/v1/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');let data=[];
  if(req.method()!=='GET')writes.push({path:p,method:req.method(),body:req.postDataJSON()});
  if(p==='/auth/me')data=user;
  else if(p==='/palets/movimientos'){
    if(failList){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA unavailable'})});return;}
    data=moves;
  }
  else if(p.endsWith('/transporte')){moves[1].pedido_transporte_id=req.postDataJSON().pedido_id;data=moves[1];}
  else if(p.includes('documento-control-digital'))data={documento:{soporte_url:'https://documents.example.test/dcd/QA',codigo_control:'QA-1'},status:{faltantes:[]}};
  else if(p==='/pedidos'||p==='/pedidos/resumen-lista')data={data:orders,pagination:{total:orders.length,totalPages:1}};
  else if(p==='/clientes')data=clients;
  else if(p==='/vehiculos')data=[{id:'truck-1',matricula:'1234-BCD',clase:'tractora',activo:true}];
  else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
  else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa',cfg_precios:{palets:{precio_devolucion:5,precio_alquiler:0}}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
 });
 await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
 const home=async()=>{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'palets'})));await page.locator('.warehouse-main tbody tr').first().waitFor();};
 await home();await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
 assert.match(await page.locator('.warehouse-kpis .tgui-kpi').nth(0).innerText(),/70/);
 assert.match(await page.locator('.warehouse-kpis .tgui-kpi').nth(2).innerText(),/20/);
 checks.push('Prepared return reserves 20, confirmed return subtracts 30, stock 70');
 const reportPopup=page.waitForEvent('popup');await page.getByRole('button',{name:'Informe de stock',exact:true}).click();const report=await reportPopup;
 await report.getByRole('heading',{name:'Informe de stock de palets'}).waitFor();assert.match(await report.locator('body').innerText(),/Cliente QA/);
 await report.evaluate(()=>{window.print=()=>{window.printed=true}});await report.getByRole('button',{name:'Imprimir / Guardar PDF'}).click();assert.equal(await report.evaluate(()=>window.printed),true);
 await report.screenshot({path:path.join(out,'informe-stock.png'),fullPage:true});await report.close();
 await page.getByRole('tab',{name:'Entradas / Salidas',exact:true}).click();
 const row=page.locator('.warehouse-main tbody tr').filter({hasText:'DEV-1'});
 const popup=page.waitForEvent('popup');await row.getByRole('button',{name:'Albarán',exact:true}).click();const doc=await popup;
 await doc.getByRole('heading',{name:/Albarán de devolución/}).waitFor();assert.match(await doc.locator('body').innerText(),/SALIDA NO CONFIRMADA/);assert.match(await doc.locator('body').innerText(),/20/);
 await doc.screenshot({path:path.join(out,'albaran-devolucion.png'),fullPage:true});await doc.close();
 await row.getByRole('button',{name:'Transporte / DCD',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Documentos de devolución'});
 await dialog.getByLabel('Pedido de transporte',{exact:true}).selectOption(orders[0].id);
 await dialog.getByRole('button',{name:'Vincular transporte',exact:true}).click();await dialog.getByRole('button',{name:'Generar / actualizar DCD',exact:true}).click();
 await dialog.getByRole('link',{name:'Abrir documento del transporte'}).waitFor();await page.screenshot({path:path.join(out,'documentos-transporte.png')});await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
 assert.equal(writes.filter(w=>w.path.endsWith('/transporte')).length,1);assert.equal(writes.filter(w=>w.path.endsWith('/generar')).length,1);assert.equal(writes.filter(w=>w.path.includes('confirmar-salida')||w.path.includes('facturas')).length,0);
 checks.push('Stock report and return delivery template execute; existing own-fleet order linked and DCD generated without confirming stock or invoicing');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar CSV'}).click();assert.equal((await download).suggestedFilename(),'almacen-movimientos.csv');
 await page.getByLabel('Buscar en almacén').fill('NO EXISTE');await page.getByText('No hay registros con estos filtros').waitFor();await page.getByLabel('Buscar en almacén').fill('');
 for(const theme of ['light','dark']){
  if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
  for(const width of [390,768,1440,1672]){
   await page.setViewportSize({width,height:1000});await page.getByRole('tab',{name:'Stock',exact:true}).click();
   if(width===390)await page.waitForFunction(()=>{const el=document.querySelector('.tg-sidebar');return !el||el.getBoundingClientRect().right<=1;});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(out,`warehouse-${theme}-${width}.png`)});
   await page.getByRole('button',{name:'+ Nuevo movimiento',exact:true}).click();const form=page.locator('.tg-palets-modal');await form.waitFor();assert.ok(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
   if(width===390||width===1440)await page.screenshot({path:path.join(out,`movimiento-${theme}-${width}.png`)});
   await form.getByRole('button',{name:'Cerrar',exact:true}).click();
   checks.push(`${theme} ${width} responsive stock and form`);
  }
 }
 await page.getByRole('button',{name:'Historial detallado y facturación'}).click();await page.getByRole('heading',{name:'Historial y facturación',exact:true}).waitFor();await page.getByRole('button',{name:'Stock y movimientos',exact:true}).click();
 failList=true;await page.reload({waitUntil:'networkidle'});await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'palets'})));
 await page.getByRole('button',{name:'Reintentar',exact:true}).waitFor();
 const retried=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/palets/movimientos')&&r.status()===503);
 await page.getByRole('button',{name:'Reintentar',exact:true}).click();await retried;
 await page.getByRole('alert').filter({hasText:'No se pudieron cargar los movimientos'}).waitFor();
 failList=false;await page.reload({waitUntil:'networkidle'});await home();
 checks.push('Failed list displays actionable error, retry calls API again, restored connection recovers data');
 user.rol='visualizador';user.permisos={modulos:{palets:{ver:true,editar:false}}};await page.reload({waitUntil:'networkidle'});await home();assert.equal(await page.getByRole('button',{name:'+ Nuevo movimiento',exact:true}).count(),0);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,writes},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

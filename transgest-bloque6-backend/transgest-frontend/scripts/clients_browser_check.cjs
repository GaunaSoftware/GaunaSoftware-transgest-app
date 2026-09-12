/* Production UI checks. Every API response and write is mocked locally. */
const assert=require('node:assert/strict'), fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','clients');
const user={id:'qa-user',empresa_id:'qa-company',rol:'gerente',nombre:'QA Clientes',activo:true};
const initial=Array.from({length:14},(_,i)=>({id:'client-'+i,nombre:'Cliente de prueba '+String(i+1).padStart(2,'0'),cif:'B123456'+String(i).padStart(2,'0'),activo:true,municipio:i%2?'Madrid':'Valencia',telefono:'961234567',email:'qa@example.test',contacto:'Contacto de prueba',tipo_iva:21,forma_pago:'transferencia',pendiente_revision:i===1,bloqueado:i===2}));
const routes=[{id:'route-1',cliente_id:'client-0',cliente_nombre:initial[0].nombre,origen:'VALENCIA',destino:'MADRID',precio_base:320,tarifa_tipo:'viaje',tipo_vehiculo:'cualquiera',km:350}];
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5xkAAAAASUVORK5CYII=';
async function main(){
 fs.mkdirSync(out,{recursive:true});
 const server=http.createServer((req,res)=>{
  let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'text/html'));
  fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 const errors=[],writes=[],checks=[];
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1672,height:1040}});
  let clients=structuredClone(initial),legacyApi=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');let data=[];
    if(req.method()!=='GET')writes.push({p,method:req.method(),body:req.postDataJSON()});
    if(p==='/auth/me')data=user;
    else if(p==='/clientes') {
      if(req.method()==='POST'){data={...req.postDataJSON(),id:'new-client',activo:true};clients.push(data);}
      else data={data:clients.filter(c=>(u.searchParams.get('activo')!=='false'?c.activo!==false:c.activo===false)&&(!u.searchParams.get('q')||c.nombre.toLowerCase().includes(u.searchParams.get('q').toLowerCase())))};
    }
    else if(/^\/clientes\/[^/]+$/.test(p)&&req.method()==='PUT'){const c=clients.find(c=>p.endsWith('/'+c.id));const body=req.postDataJSON();if(legacyApi)delete body.imagen_data;Object.assign(c,body);data=c;}
    else if(p.endsWith('/rutas'))data=routes;
    else if(p==='/rutas')data=routes;
    else if(p.endsWith('/rutas/salud'))data={};
    else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
    else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  const navigate=async id=>{await page.evaluate(id=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:id})),id);};
  await navigate('clientes');
  await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();
  await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  await page.locator('.clients-table tbody tr').first().waitFor();
  assert.equal(await page.locator('.clients-page img').count(),0);
  assert.equal(await page.locator('.clients-table tbody tr').count(),10);
  await page.getByLabel('Página siguiente de clientes').click();assert.equal(await page.locator('.clients-table tbody tr').count(),4);
  await page.getByLabel('Página anterior de clientes').click();
  await page.locator('.clients-name').filter({hasText:initial[0].nombre}).first().click();
  await page.getByRole('heading',{name:'Información general'}).waitFor();
  await page.locator('.clients-detail .tgui-table tbody tr').waitFor();
  assert.equal(await page.locator('.clients-detail img').count(),0);
  for(const label of ['Contactos','Direcciones','Condiciones','Rutas y tarifas','Resumen'])await page.getByRole('tab',{name:label,exact:true}).click();
  await page.screenshot({path:path.join(out,'clientes-desktop.png'),fullPage:true});
  await page.getByRole('button',{name:'Abrir ficha completa / subir imagen'}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByLabel('Foto o logo del cliente').setInputFiles({name:'wrong.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg/>')});
  await dialog.getByRole('alert').filter({hasText:'Selecciona un PNG'}).waitFor();
  await dialog.getByLabel('Foto o logo del cliente').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await dialog.getByRole('img',{name:'Foto de este cliente'}).waitFor();
  await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.equal(clients[0].imagen_data,'data:image/png;base64,'+image);
  assert.equal(clients[0].nombre,initial[0].nombre);
  assert.equal(await page.locator('.clients-detail img').count(),1);
  await page.reload({waitUntil:'networkidle'});await navigate('clientes');
  await page.locator('.clients-table tbody tr').first().waitFor();
  await page.locator('.clients-name').filter({hasText:initial[0].nombre}).first().click();
  await page.getByRole('button',{name:'Abrir ficha completa / subir imagen'}).click();
  await dialog.getByRole('button',{name:'Quitar imagen'}).click();
  await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).click();await dialog.waitFor({state:'hidden'});
  assert.equal(clients[0].imagen_data,null);assert.equal(await page.locator('.clients-page img').count(),0);
  legacyApi=true;
  await page.getByRole('button',{name:'Abrir ficha completa / subir imagen'}).click();
  await dialog.getByLabel('Foto o logo del cliente').setInputFiles({name:'qa.png',mimeType:'image/png',buffer:Buffer.from(image,'base64')});
  await dialog.getByRole('img',{name:'Foto de este cliente'}).waitFor();
  await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByText('Cliente guardado, pero la imagen no se ha guardado. Es necesario actualizar el servidor para usar fotos de clientes.',{exact:true}).waitFor();
  legacyApi=false;
  await page.getByRole('button',{name:'Gestionar / añadir ruta o tarifa'}).click();
  await dialog.getByRole('button',{name:'+ Nueva ruta',exact:true}).click();
  const routeDialog=page.getByRole('dialog',{name:'Nueva ruta',exact:true});await routeDialog.waitFor();
  await routeDialog.press('Escape');await routeDialog.waitFor({state:'hidden'});
  assert.equal(await page.getByRole('dialog').count(),1,'Escape closes only nested route dialog');
  await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
  checks.push('No default images; invalid upload rejected; upload persists across reload; remove persists; ordinary fields retained');
  await page.getByLabel('Estado de clientes').first().selectOption('blocked');assert.equal(await page.locator('.clients-table tbody tr').count(),1);
  await page.getByLabel('Estado de clientes').first().selectOption('');
  await page.getByLabel('Buscar clientes').fill('no existe');await page.getByText('No hay clientes con estos filtros').waitFor();
  await page.getByLabel('Buscar clientes').fill('');await page.locator('.clients-table tbody tr').first().waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar',exact:true}).click();assert.equal((await download).suggestedFilename(),'clientes-listado.csv');
  checks.push('Pagination, status, search, empty state, CSV export');
  await page.getByLabel('Cerrar resumen de cliente').click();
  for(const width of [390,768,1024,1440,1672]){
    await page.setViewportSize({width,height:1000});
    await page.locator('.clients-name:visible').filter({hasText:initial[0].nombre}).first().click();
    const overlay=page.getByRole('dialog',{name:'Resumen del cliente',exact:true});
    if(width<1100) await overlay.waitFor();
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false,`Clientes overflow ${width}`);
    if(width===390)await page.screenshot({path:path.join(out,'clientes-mobile-detail.png'),fullPage:true});
    if(width<1100)await overlay.getByRole('button',{name:'Cerrar',exact:true}).click();else await page.getByLabel('Cerrar resumen de cliente').click();
    if(width===390)await page.screenshot({path:path.join(out,'clientes-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'+ Nuevo cliente',exact:true}).click();
    assert.equal(await dialog.locator('img').count(),0);
    await page.screenshot({path:path.join(out,`cliente-form-${width}.png`)});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`Editor overflow ${width}`);
    await dialog.getByRole('button',{name:'Cerrar',exact:true}).click();
    checks.push(`Responsive list, summary and editor ${width}`);
  }
  await page.getByRole('navigation',{name:'Clientes y tarifas'}).getByRole('button',{name:'Rutas y tarifas'}).click();
  await page.getByRole('heading',{name:'Rutas y tarifas'}).waitFor();
  await page.getByText('VALENCIA -> MADRID',{exact:false}).first().waitFor();
  for(const width of [390,768,1440]) {await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1),false,`Rutas overflow ${width}`);await page.screenshot({path:path.join(out,`rutas-${width}.png`),fullPage:true});}
  for(const width of [390,768,1440]){
    await page.setViewportSize({width,height:1000});
    await page.getByRole('button',{name:'+ Nueva ruta',exact:true}).click();
    const newRoute=page.getByRole('dialog',{name:'Nueva ruta',exact:true});await newRoute.waitFor();
    assert.ok(await newRoute.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`Route form overflow ${width}`);
    await page.screenshot({path:path.join(out,`ruta-form-${width}.png`)});
    await newRoute.getByRole('button',{name:'Cerrar',exact:true}).click();
  }

  await page.getByRole('navigation',{name:'Clientes y tarifas'}).getByRole('button',{name:'Clientes',exact:true}).click();
  await page.getByRole('heading',{name:'Clientes',exact:true}).waitFor();
  for(const theme of ['dark','light']) {
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
    await page.setViewportSize({width:1440,height:1000});
    await page.locator('.clients-name:visible').filter({hasText:initial[0].nombre}).first().click();
    await page.screenshot({path:path.join(out,`clientes-${theme}.png`),fullPage:true});
    await page.getByLabel('Cerrar resumen de cliente').click();
  }
  user.rol='visualizador'; await page.reload({waitUntil:'networkidle'}); await navigate('clientes');
  await page.locator('.clients-name:visible').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'+ Nuevo cliente',exact:true}).count(),0);
  await page.locator('.clients-name:visible').first().click();
  assert.equal(await page.locator('.clients-detail').getByRole('button',{name:'Editar',exact:true}).count(),0);
  await page.getByRole('button',{name:'Abrir ficha completa',exact:true}).click();
  assert.equal(await dialog.getByLabel('Foto o logo del cliente').count(),0);
  assert.equal(await dialog.getByRole('button',{name:'Guardar cambios',exact:true}).count(),0);
  checks.push('Light/dark views; read-only role cannot upload, create or save clients');
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,writes},null,2));
  console.log(JSON.stringify({checks,errors,writes:writes.length},null,2));
 } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

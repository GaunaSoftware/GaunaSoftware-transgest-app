const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','fleet');
const user={id:'qa-user',empresa_id:'qa-company',rol:'gerente',nombre:'QA Trafico',activo:true};
const clients=[{id:'client-1',nombre:'Cliente QA',activo:true},{id:'client-2',nombre:'Otro cliente QA',activo:true}];
const states=['pendiente','en_curso','confirmado','entregado','incidencia'];
const orders=Array.from({length:14},(_,i)=>({id:'order-'+i,numero:'P-QA-'+String(i+1).padStart(3,'0'),cliente_id:clients[i%2].id,cliente_nombre:clients[i%2].nombre,estado:states[i%5],origen:'VALENCIA',destino:'MADRID',origen_pais:'España',destino_pais:'España',origen_provincia:'Valencia',destino_provincia:'Madrid',fecha_carga:'2026-09-12',fecha_descarga:'2026-09-13',hora_carga:'12:00',importe:320,tipo_precio:'viaje',vehiculo_id:i?'truck-1':null,vehiculo_matricula:i?'1234-BCD':'',chofer_id:i?'driver-1':null,chofer_nombre:i?'Conductor QA':'',incidencia_tipo:i%5===4?'retraso_carga':null}));
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
  page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});
  let failList=false;
  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');let data=[];
    requests.push({path:p,query:u.search});
    if(req.method()!=='GET')writes.push({path:p,method:req.method(),body:req.postDataJSON()});
    if(p==='/auth/me')data=user;
    else if(p==='/pedidos/resumen-lista'){
      if(failList){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA unavailable'})});return;}
      const filtered=orders.filter(o=>(!u.searchParams.has('q')||o.numero.includes(u.searchParams.get('q')))&&(!u.searchParams.has('estado')||u.searchParams.get('estado').split(',').includes(o.estado))&&(!u.searchParams.has('cliente_id')||o.cliente_id===u.searchParams.get('cliente_id')));
      data={data:filtered,pagination:{total:filtered.length,totalPages:1}};
    }
    else if(/^\/pedidos\/order-\d+$/.test(p))data=orders.find(o=>p.endsWith('/'+o.id));
    else if(p==='/clientes')data=clients;
    else if(p==='/vehiculos')data=[{id:'truck-1',matricula:'1234-BCD',clase:'Tractora',marca:'Marca QA',modelo:'Modelo QA',estado:'disponible',activo:true,fecha_itv:'2026-09-20',ubicacion_actual:'Valencia'},{id:'trailer-1',matricula:'R-1234',clase:'Remolque - Bañera',estado:'taller',activo:true}];
    else if(p==='/choferes')data=[{id:'driver-1',nombre:'Conductor QA',activo:true}];
    else if(p.includes('disponibilidad'))data={vehiculos:[],choferes:[],colaboradores:[]};
    else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
    else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});


  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'vehiculos'})));
  await page.getByRole('heading',{name:'Gestión de vehículos',exact:true}).waitFor().catch(async e=>{console.error(await page.locator('body').innerText());throw e;});await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});await page.locator('.fleet-list tbody tr').first().waitFor();
  assert.equal(await page.locator('.fleet-list tbody tr').count(),2);
  await page.getByLabel('Buscar vehículos').fill('1234-BCD');assert.equal(await page.locator('.fleet-list tbody tr').count(),1);await page.getByLabel('Buscar vehículos').fill('');
  await page.getByLabel('Tipo de vehículo').selectOption('remolques');assert.equal(await page.locator('.fleet-list tbody tr').count(),1);await page.getByLabel('Tipo de vehículo').selectOption('todos');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar',exact:true}).click();assert.equal((await download).suggestedFilename(),'vehiculos.csv');
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
    for(const width of [390,768,1672]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`fleet overflow ${width}`);
      await page.screenshot({path:path.join(out,`fleet-${theme}-${width}.png`),fullPage:true});
    }
  }
  await page.getByRole('button',{name:'Ver tarjetas',exact:true}).click();await page.getByRole('img',{name:'Icono de bañera'}).waitFor();
  await page.getByRole('button',{name:'Ver 1234-BCD',exact:true}).click();const form=page.locator('.fleet-form');await form.waitFor();
  await form.getByLabel('Foto del vehículo').setInputFiles({name:'vehicle.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNlsAAAAASUVORK5CYII=','base64')});await form.locator('.workshop-portrait img').waitFor();
  assert(writes.some(w=>w.path==='/vehiculos/truck-1/imagen'&&w.body.imagen_data));await form.getByRole('button',{name:'Quitar foto',exact:true}).click();await form.getByRole('img',{name:'Icono de tractora'}).waitFor();

  for(const tab of ['Identificación','Ficha técnica','Compra / Venta','Documentación','Plataformas','Conjunto / conductor','Historial']){
    await form.getByRole('button',{name:tab,exact:true}).click();
    for(const width of [390,1440]){await page.setViewportSize({width,height:1000});assert(await form.evaluate(el=>el.scrollWidth<=el.clientWidth+1),`form overflow ${tab}`);await page.screenshot({path:path.join(out,`form-${tab.replaceAll('/','-')}-${width}.png`)});}
  }
  await form.getByRole('button',{name:'Cerrar',exact:true}).first().click();
  await page.getByRole('button',{name:'+ Nuevo vehículo',exact:true}).click();await form.getByText('Nueva tractora',{exact:true}).waitFor();await form.getByRole('button',{name:'Cerrar',exact:true}).first().click();
  await page.getByRole('button',{name:'Gestión de flota y GPS',exact:true}).click();await page.getByRole('button',{name:'Volver al resumen de vehículos',exact:true}).click();await page.getByRole('heading',{name:'Gestión de vehículos',exact:true}).waitFor().catch(async e=>{console.error(await page.locator('body').innerText());throw e;});
  checks.push('Search/type filters, export, table/cards, type-specific icons, existing create/edit and all internal tabs, mobile and desktop');
  user.rol='visualizador';await page.evaluate(u=>localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1'),user);await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'vehiculos'})));await page.getByRole('heading',{name:'Gestión de vehículos',exact:true}).waitFor().catch(async e=>{console.error(await page.locator('body').innerText());throw e;});await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  assert.equal(await page.getByRole('button',{name:'+ Nuevo vehículo',exact:true}).count(),0);checks.push('Read-only cannot create; photo save/remove uses existing API');

  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

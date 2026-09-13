const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','workshop');
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
  page.on('pageerror',e=>errors.push(e.message));
  let failList=false,vehicleImage=null;
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
    else if(p==='/taller/intervenciones')data=[{id:'repair-1',vehiculo_id:'truck-1',vehiculo_matricula:'1234-BCD',tipo:'Mantenimiento preventivo',descripcion:'Revisión de frenos',fecha:'2026-09-12',estado:'abierta',coste_total:120,piezas:[]}];
    else if(p==='/taller/estado')data={proveedores:[],avisos_mant:[],tareas_mecanicos:[],neumaticos_stock:[],neumaticos_vehiculos:{}};
    else if(p==='/clientes')data=clients;
    else if(p==='/vehiculos/truck-1/imagen'&&req.method()==='PUT'){vehicleImage=req.postDataJSON().imagen_data;data={id:'truck-1',imagen_data:vehicleImage};}
    else if(p==='/vehiculos')data=[{imagen_data:vehicleImage,id:'truck-1',matricula:'1234-BCD',clase:'tractora',activo:true}];
    else if(p==='/choferes')data=[{id:'driver-1',nombre:'Conductor QA',activo:true}];
    else if(p.includes('disponibilidad'))data={vehiculos:[],choferes:[],colaboradores:[]};
    else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
    else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});


  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'taller'})));
  await page.getByRole('heading',{name:'Taller',exact:true}).waitFor();await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  await page.getByRole('heading',{name:'Orden repair-1'}).waitFor();
  assert.equal(await page.locator('.workshop-portrait img').count(),0);await page.getByRole('img',{name:'Icono de tractora'}).waitFor();
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
    for(const width of [390,768,1672]){
      await page.setViewportSize({width,height:1000});await page.waitForTimeout(200);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`workshop overflow ${width}`);
      await page.screenshot({path:path.join(out,`workshop-${theme}-${width}.png`),fullPage:true});
    }
  }
  await page.getByLabel('Foto del vehículo').setInputFiles({name:'truck.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNlsAAAAASUVORK5CYII=','base64')});
  await page.locator('.workshop-portrait img').waitFor();assert.ok(vehicleImage?.startsWith('data:image/png'));
  await page.getByRole('button',{name:'Quitar foto',exact:true}).click();await page.getByRole('img',{name:'Icono de tractora'}).waitFor();assert.equal(vehicleImage,null);
  await page.getByRole('button',{name:'+ Nueva orden de taller',exact:true}).click();await page.locator('.workshop-form').waitFor();
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.locator('.workshop-form').evaluate(el=>el.scrollWidth<=el.clientWidth+1));await page.screenshot({path:path.join(out,`order-form-${width}.png`)});}
  await page.locator('.workshop-form').getByRole('button',{name:'Cancelar',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar',exact:true}).click();assert.equal((await download).suggestedFilename(),'ordenes-taller.csv');
  for(const name of ['Mantenimiento preventivo','Neumáticos','Talleres y proveedores','Trazabilidad de piezas','Tareas de mecánicos']){
    await page.getByRole('button',{name,exact:true}).first().click();await page.waitForTimeout(200);
    await page.screenshot({path:path.join(out,`tab-${name.replaceAll(' ','-')}.png`),fullPage:true});
    await page.setViewportSize({width:390,height:1000});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`submenu overflow ${name}`);await page.setViewportSize({width:1440,height:1000});
  }
  checks.push('Orders, vehicle icon fallback, internal forms, submenus, desktop/mobile and both themes');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

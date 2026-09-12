const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','orders');
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
    else if(p==='/vehiculos')data=[{id:'truck-1',matricula:'1234-BCD',clase:'tractora',activo:true}];
    else if(p==='/choferes')data=[{id:'driver-1',nombre:'Conductor QA',activo:true}];
    else if(p.includes('disponibilidad'))data={vehiculos:[],choferes:[],colaboradores:[]};
    else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
    else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
  await page.getByRole('heading',{name:'Pedidos / Tráfico',exact:true}).waitFor();
  await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  await page.locator('.orders-list-card tbody tr').first().waitFor();
  assert.equal(await page.locator('.orders-kpis .tgui-kpi').count(),5);
  assert.equal(await page.locator('.orders-list-card tbody tr').count(),10);
  await page.getByLabel('Página siguiente de pedidos').click();assert.equal(await page.locator('.orders-list-card tbody tr').count(),4);
  await page.getByLabel('Página anterior de pedidos').click();
  await page.screenshot({path:path.join(out,'pedidos-desktop.png'),fullPage:true});
  const quick=page.locator('.orders-quick-actions');assert.equal(await quick.getByRole('button',{name:'Asignar camión',exact:true}).isEnabled(),false);
  await page.getByLabel('Seleccionar P-QA-001',{exact:true}).first().check();
  await quick.getByRole('button',{name:'Asignar camión',exact:true}).click();
  const assign=page.getByRole('dialog',{name:'Asignar recursos'});await assign.waitFor();await assign.getByRole('button',{name:'Cancelar',exact:true}).click();
  await quick.getByRole('button',{name:'Copiar pedido',exact:true}).click();
  const copy=page.getByRole('dialog',{name:'Copiar viaje'});await copy.waitFor();await copy.getByRole('button',{name:'Cancelar',exact:true}).click();
  await page.getByRole('button',{name:'Quitar selección',exact:true}).click();
  checks.push('Default compact view, real KPIs, pagination, selection, existing assignment and copy dialogs');
  await page.getByLabel('Estado del pedido').first().selectOption('incidencia');await page.waitForFunction(()=>document.querySelectorAll('.orders-list-card tbody tr').length===2);
  await page.getByRole('button',{name:'Restablecer filtros'}).click();await page.waitForFunction(()=>document.querySelectorAll('.orders-list-card tbody tr').length===10);
  await page.getByLabel('Buscar pedidos').fill('NO-EXISTE');await page.getByText('No hay pedidos con estos filtros').waitFor();
  await page.getByLabel('Buscar pedidos').fill('');await page.locator('.orders-list-card tbody tr').first().waitFor();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar',exact:true}).click();assert.equal((await download).suggestedFilename(),'pedidos-listado.csv');
  await page.getByRole('button',{name:'Planificación y bandeja IA',exact:true}).click();
  await page.locator('.tg-pedidos-table').waitFor();
  await page.getByRole('button',{name:'Volver al resumen de tráfico'}).click();
  checks.push('State/search/empty filters, CSV export and advanced view retains operational table');
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
    for(const width of [390,768,1024,1440,1672]){
      await page.setViewportSize({width,height:1000});
      if(width===390)await page.waitForFunction(()=>{const el=document.querySelector('.tg-sidebar');return !el || el.getBoundingClientRect().right <= 1;});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`overflow ${theme} ${width}`);
      if(width===390||width===1672)await page.screenshot({path:path.join(out,`pedidos-${theme}-${width}.png`),fullPage:true});
      checks.push(`${theme} ${width} responsive`);
    }
  }
  await page.setViewportSize({width:390,height:900});
  await page.locator('.orders-list-card').getByRole('button',{name:'Filtros',exact:true}).click();
  const filters=page.getByRole('dialog',{name:'Filtros'});await filters.getByLabel('Sin asignación completa').check();await filters.getByRole('button',{name:'Ver resultados'}).click();
  assert.ok(await page.locator('.orders-scope').innerText().then(t=>t.includes('Sin asignación')));
  await page.getByRole('button',{name:'Restablecer filtros'}).click();
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Ver pedido P-QA-001',exact:true}).first().click();
  const editor=page.locator('.tg-pedido-modal');await editor.waitFor();
  await editor.locator('.tg-pedido-modal-header button').click();await editor.waitFor({state:'hidden'});
  checks.push('Mobile filters and existing full order editor');
  user.rol='visualizador';await page.reload({waitUntil:'networkidle'});await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
  await page.locator('.orders-list-card tbody tr').first().waitFor();
  assert.equal(await page.getByRole('button',{name:'+ Nuevo pedido',exact:true}).count(),0);
  await page.getByLabel('Seleccionar P-QA-001',{exact:true}).first().check();
  assert.equal(await quick.getByRole('button',{name:'Asignar camión',exact:true}).isEnabled(),false);
  assert.equal(await quick.getByRole('button',{name:'Copiar pedido',exact:true}).isEnabled(),false);
  assert.equal(await quick.getByRole('button',{name:'Avisar al cliente',exact:true}).isEnabled(),false);
  checks.push('Read-only role cannot assign/copy/send/create');
  assert.deepEqual(errors,[]);
  assert.equal(writes.filter(w=>!w.path.includes('tutorial')).length,0,'No operational data mutated by these checks');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,writes,requests},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

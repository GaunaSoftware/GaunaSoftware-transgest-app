const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','dashboard');
const user={id:'qa-user',empresa_id:'qa-company',rol:'gerente',nombre:'QA Trafico',activo:true};
const clients=[{id:'client-1',nombre:'Cliente QA',activo:true},{id:'client-2',nombre:'Otro cliente QA',activo:true}];
const states=['pendiente','en_curso','confirmado','entregado','incidencia'];
const orders=Array.from({length:14},(_,i)=>({id:'order-'+i,numero:'P-QA-'+String(i+1).padStart(3,'0'),cliente_id:clients[i%2].id,cliente_nombre:clients[i%2].nombre,estado:states[i%5],origen:'VALENCIA',destino:'MADRID',origen_pais:'España',destino_pais:'España',origen_provincia:'Valencia',destino_provincia:'Madrid',fecha_carga:'2026-09-12',fecha_descarga:'2026-09-13',hora_carga:'12:00',importe:320,tipo_precio:'viaje',vehiculo_id:i?'truck-1':null,vehiculo_matricula:i?'1234-BCD':'',chofer_id:i?'driver-1':null,chofer_nombre:i?'Conductor QA':'',incidencia_tipo:i%5===4?'retraso_carga':null}));
const invoices=[{id:'f1',numero:'F-001',cliente_id:'client-1',cliente_nombre:'Cliente QA',fecha:'2026-09-01',fecha_vencimiento:'2026-09-18',estado:'emitida',base_imponible:100,total:121},{id:'f2',cliente_nombre:'Otro cliente QA',fecha:'2026-09-01',estado:'borrador',base_imponible:900,total:1089}];
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
  let failList=false,empty=false;

  await page.route('**/api/v1/**',async route=>{
    const req=route.request(),u=new URL(req.url()),p=u.pathname.replace('/api/v1','');let data=[];
    if(req.method()!=='GET')writes.push({path:p,method:req.method()});
    if(p==='/auth/me')data=user;
    else if(p==='/pedidos' || p==='/pedidos/resumen-lista'){
      if(failList){await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA unavailable'})});return;}
      data={data:empty?[]:orders,pagination:{total:empty?0:orders.length,totalPages:1}};
    }
    else if(/^\/pedidos\/order-\d+$/.test(p))data=orders.find(o=>p.endsWith('/'+o.id));
    else if(p==='/facturas')data=empty?[]:invoices;
    else if(p==='/clientes')data=clients;
    else if(p==='/vehiculos')data=empty?[]:[{id:'truck-1',matricula:'1234-BCD',clase:'tractora',estado:'taller',fecha_itv:'2026-09-20'}];
    else if(p==='/choferes')data=[];
    else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
    else if(p.includes('empresa')||p.includes('config')||p==='/mi-cuenta/')data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},{user});
  const home=async()=>{await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'dashboard'})));await page.locator('.dashboard-kpis').waitFor();};
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});await home();
  await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  assert.equal(await page.locator('.dashboard-kpi-button').count(),4);
  assert.match(await page.locator('.dashboard-kpi-button').nth(0).innerText(),/6/);
  assert.match(await page.locator('.dashboard-kpi-button').nth(1).innerText(),/14/);
  assert.match(await page.locator('.dashboard-kpi-button').nth(2).innerText(),/100,00/);
  assert.equal(await page.locator('.dashboard-agenda-row').count(),14);
  assert.equal(await page.locator('.dashboard-ranking-row').count(),1);
  assert.equal(await page.locator('.dashboard-due-row').count(),2);
  assert.equal(await page.locator('.dashboard-recent tbody tr').count(),5);
  checks.push('Real daily counts, emitted base only, cargo agenda, ranking, invoices and fleet deadlines');
  await page.getByRole('button',{name:'Análisis detallado',exact:true}).click();await page.getByRole('button',{name:'Volver al Dashboard',exact:true}).click();
  await page.locator('.dashboard-quick').getByRole('button',{name:'Nuevo pedido',exact:true}).click();await page.locator('.tg-pedido-modal').waitFor();await page.locator('.tg-pedido-modal-header button').click();await home();
  await page.locator('.dashboard-recent').getByRole('button',{name:'P-QA-001',exact:true}).first().click();await page.locator('.tg-pedido-modal').waitFor();await page.locator('.tg-pedido-modal-header button').click();await home();
  checks.push('Detailed analysis, new order and recent order open existing views');
  for(const theme of ['light','dark']){
    if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
    assert.equal(await page.locator('html').getAttribute('data-theme'),theme);
    for(const width of [390,768,1024,1440,1672]){
      await page.setViewportSize({width,height:1000});
      if(width===390)await page.waitForFunction(()=>{const el=document.querySelector('.tg-sidebar');return !el||el.getBoundingClientRect().right<=1;});
      await page.screenshot({path:path.join(out,`dashboard-${theme}-${width}.png`),fullPage:width>600});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),`${theme} ${width} horizontal overflow`);
      if(width===1672){
        await page.locator('.tg-content').evaluate(el=>{el.scrollTop=el.scrollHeight;});
        await page.screenshot({path:path.join(out,`dashboard-${theme}-bottom.png`)});
        await page.locator('.tg-content').evaluate(el=>{el.scrollTop=0;});
      }
      checks.push(`${theme} ${width} responsive`);
    }
  }
  empty=true;await page.reload({waitUntil:'networkidle'});await home();await page.getByText('Todavía no hay pedidos',{exact:true}).waitFor();
  failList=true;await page.reload({waitUntil:'networkidle'});await page.locator('.dashboard-error').waitFor();assert.match(await page.locator('.dashboard-error').innerText(),/Pedidos/);
  failList=false;empty=false;await page.getByRole('button',{name:'Reintentar',exact:true}).click();await page.locator('.dashboard-error').waitFor({state:'hidden'});await page.locator('.dashboard-agenda-row').first().waitFor();
  checks.push('Empty state, partial failure warning and retry');
  user.rol='visualizador';await page.reload({waitUntil:'networkidle'});await home();
  assert.equal(await page.locator('.dashboard-quick').getByRole('button',{name:'Nuevo pedido',exact:true}).count(),0);
  assert.equal(await page.locator('.dashboard-quick').getByRole('button',{name:'Asignar vehículo',exact:true}).count(),0);
  assert.equal(await page.locator('.dashboard-ranking').count(),0);
  checks.push('Read-only and financial module permissions');
  assert.deepEqual(errors,[]);assert.equal(writes.filter(w=>!w.path.includes('tutorial')).length,0);
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,writes},null,2));console.log(JSON.stringify({checks,errors},null,2));
 }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

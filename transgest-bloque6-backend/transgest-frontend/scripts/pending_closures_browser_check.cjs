const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../build');
const orders=Array.from({length:30},(_,i)=>({id:`pending-${i+1}`,numero:`PED-QA-${String(i+1).padStart(3,'0')}`,cliente_nombre:i===29?'Cerámica del Mediterráneo':'Transportes de prueba, S.L.',estado:i%3===0?'incidencia':'confirmado',fecha_carga:'2026-08-01',fecha_descarga:new Date(Date.UTC(2026,8,14-i)).toISOString().slice(0,10),origen:'ALICANTE · Planta de carga y almacenamiento',destino:'VALENCIA · Plataforma logística',incidencia_descripcion:i%3===0?'El destinatario solicita cambiar la fecha de entrega.':''}));
orders.push({id:'active',numero:'PED-QA-ACTIVO',estado:'en_curso',fecha_carga:'2026-09-15',fecha_descarga:'2026-09-16',origen:'Madrid',destino:'Barcelona'});
async function main(){
  const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'text/html'));fs.createReadStream(f).pipe(res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  const errors=[],writes=[];
  try{
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage({viewport:{width:1500,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    const user={id:'qa',empresa_id:'qa-company',rol:'gerente',nombre:'QA',plan:'enterprise'};
    await page.clock.setFixedTime(new Date('2026-09-15T10:00:00Z'));
    await page.addInitScript(u=>{localStorage.setItem('tms_token','qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem('tms_theme','light');localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1');},user);
    await page.route('**/api/v1/**',async route=>{
      const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');let data=[];
      if(req.method()!=='GET')writes.push({p,method:req.method()});
      if(p==='/auth/me')data=user;
      else if(p.includes('notificaciones'))data={data:[],no_leidas:0};
      else if(p==='/pedidos'||p==='/pedidos/resumen-lista')data=orders;
      else if(/^\/pedidos\/pending-\d+$/.test(p))data=orders.find(o=>p.endsWith('/'+o.id));
      else if(p.includes('resumen'))data={};
      else if(p.includes('empresa'))data={plan:'enterprise'};
      await route.fulfill({status:200,json:data});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.locator('div[style*="z-index: 9999"]').waitFor({state:'hidden'});
    const summary=page.getByRole('region',{name:'Pedidos pendientes de revisar'});
    await summary.waitFor();
    assert.match(await summary.innerText(),/30/);
    assert.ok((await summary.boundingBox()).height<180,'Dashboard must use a compact summary');
    assert.equal(await page.locator('.closure-review-list').count(),0,'Queue is only shown on demand');
    assert.equal(await page.locator('.dashboard-live-list button').count(),1,'Old orders must stay outside active operations');
    await summary.screenshot({path:path.join(process.env.TEMP||'.','transgest-closures-summary.png')});
    await summary.getByRole('button',{name:'Revisar pedidos',exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Revisar pedidos pendientes',exact:true});
    await dialog.waitFor();
    assert.equal(await dialog.locator('.closure-review-list>li').count(),8);
    await dialog.getByRole('button',{name:'Página siguiente'}).click();
    assert.match(await dialog.locator('.closure-review-footer').innerText(),/9–16 de 30/);
    await dialog.getByRole('searchbox',{name:'Buscar pedidos pendientes'}).fill('ceramica');
    assert.equal(await dialog.locator('.closure-review-list>li').count(),1);
    assert.match(await dialog.locator('.closure-review-list').innerText(),/PED-QA-030/);
    await dialog.getByRole('searchbox',{name:'Buscar pedidos pendientes'}).fill('');
    await dialog.getByRole('button',{name:/Últimos 7 días/}).click();
    assert.equal(await dialog.locator('.closure-review-list>li').count(),7);
    await dialog.getByRole('button',{name:/Con incidencia/}).click();
    assert.match(await dialog.locator('.closure-review-footer').innerText(),/de 10/);
    await dialog.getByRole('button',{name:/Todos/}).click();
    await dialog.getByRole('combobox',{name:'Orden de revisión'}).selectOption('oldest');
    assert.match(await dialog.locator('.closure-review-list>li').first().innerText(),/PED-QA-030/);
    await dialog.getByRole('combobox',{name:'Orden de revisión'}).selectOption('recent');
    for(const theme of ['light','dark'])for(const width of [1500,768,390]){
      await page.evaluate(t=>{document.documentElement.setAttribute('data-theme',t);window.dispatchEvent(new CustomEvent('tms:company-palette-changed'));},theme);
      await page.setViewportSize({width,height:1000});
      assert.ok(await dialog.evaluate(n=>n.scrollWidth<=n.clientWidth+1),`Dialog overflow at ${width}/${theme}`);
      assert.ok(await dialog.locator('.closure-review-list>li').evaluateAll(nodes=>nodes.every(n=>n.scrollWidth<=n.clientWidth+1)),`Row overflow at ${width}/${theme}`);
      if(width!==768)await dialog.screenshot({path:path.join(process.env.TEMP||'.',`transgest-closures-${theme}-${width}.png`)});
    }
    await dialog.getByRole('button',{name:'Revisar PED-QA-001',exact:true}).click();
    await page.locator('.tg-pedido-modal-title').filter({hasText:'PED-QA-001'}).waitFor();
    assert.deepEqual(writes,[],'Review must not alter orders automatically');
    assert.deepEqual(errors,[]);
    console.log('PASS: compact dashboard; all 30 orders accessible; search, age/incidence filters, pagination, sorting and opening the correct order; desktop/mobile, light/dark');
  }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

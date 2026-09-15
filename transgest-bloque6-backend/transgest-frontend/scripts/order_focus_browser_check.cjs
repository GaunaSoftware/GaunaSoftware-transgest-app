const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.env.TEST_BUILD_ROOT || path.join(__dirname, '../build'));
const today = '2026-09-15';
const orders = [
  { id:'focus', numero:'PED-2026-0393', estado:'confirmado' },
  { id:'other', numero:'PED-2026-0400', estado:'pendiente' },
  { id:'incident', numero:'PED-2026-0401', estado:'incidencia', incidencia_descripcion:'Retraso por avería en carretera' },
].map(p => ({ cliente_id:'11111111-1111-4111-8111-111111111111', cliente_nombre:'Cliente QA de transporte', fecha_pedido:today, fecha_carga:today, fecha_descarga:today, origen:'Madrid', destino:'Valencia', ...p }));
async function main() {
  const server = http.createServer((req,res) => {
    let f=path.resolve(root, '.'+new URL(req.url,'http://localhost').pathname);
    if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()) f=path.join(root,'index.html');
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'text/html'));
    fs.createReadStream(f).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  const errors=[], writes=[];
  let lists=0;
  try {
    browser=await chromium.launch({headless:true,channel:'msedge'});
    const page=await browser.newPage({viewport:{width:1500,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.clock.setFixedTime(new Date(today+'T10:00:00Z'));
    const user={id:'qa',empresa_id:'qa-company',rol:'gerente',nombre:'QA',plan:'enterprise'};
    await page.addInitScript(u=>{
      localStorage.setItem('tms_token','qa'); localStorage.setItem('tms_user',JSON.stringify(u));
      localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1');
    },user);
    await page.route('**/api/v1/**', async route=>{
      const req=route.request(), p=new URL(req.url()).pathname.replace('/api/v1','');
      const body=req.method()==='GET'?null:req.postDataJSON();
      if(body) writes.push({p,body,method:req.method()});
      let data=[];
      if(p==='/auth/me')data=user;
      else if(p.includes('notificaciones'))data={data:[],no_leidas:0};
      else if(p==='/pedidos'||p==='/pedidos/resumen-lista'){lists++;data=orders;}
      else if(/^\/pedidos\/(focus|other|incident)$/.test(p)){
        const order=orders.find(o=>p.endsWith('/'+o.id));
        if(body) Object.assign(order,body);
        data=order;
      }
      else if(p==='/clientes')data=[{id:'11111111-1111-4111-8111-111111111111',nombre:'Cliente QA de transporte',activo:true}];
      else if(p.includes('riesgo')||p.includes('resumen'))data={};
      else if(p.includes('empresa'))data={plan:'enterprise'};
      await route.fulfill({status:200,json:data});
    });
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    async function saveOrder() {
      await page.getByRole('button',{name:'Guardar cambios',exact:true}).click();
      const routePrompt=page.getByRole('button',{name:'No guardar',exact:true});
      const needsRouteAnswer=await Promise.race([
        routePrompt.waitFor({timeout:7000}).then(()=>true),
        page.locator('.tg-pedido-modal').waitFor({state:'hidden',timeout:7000}).then(()=>false),
      ]).catch(async e=>{console.error('Save flow',writes.map(w=>({p:w.p,method:w.method})),(await page.locator('.tg-pedido-modal').innerText()).slice(-5000),await page.locator('[role="alert"]').allTextContents());throw e;});
      if(needsRouteAnswer)await routePrompt.click();
    }
    await page.locator('.dashboard-live-list button').filter({hasText:'PED-2026-0393'}).waitFor();
    // Real initial navigation from the dashboard must still open the requested order.
    await page.locator('.dashboard-live-list button').filter({hasText:'PED-2026-0393'}).click();
    await page.locator('.tg-pedido-modal-title').filter({hasText:'PED-2026-0393'}).waitFor();
    await saveOrder();
    await page.locator('.tg-pedido-modal').waitFor({state:'hidden',timeout:7000}).catch(async e=>{console.error('Save diagnostics',writes.map(w=>({p:w.p,method:w.method})),await page.locator('.tg-pedido-modal-title').allTextContents(),await page.locator('[role="alert"]').allTextContents());throw e;});
    assert.ok(writes.some(w=>w.p==='/pedidos/focus'&&w.method==='PUT'),'Save must reach the correct order');
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.tg-pedido-modal').count(),0,'Saving must not reopen the initial order');
    // Repeated background refreshes must not replay a consumed destination either.
    const before=lists;
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:pedidos-changed')));
    await page.waitForTimeout(1200);
    assert.ok(lists>before,'Test must exercise list reload');
    assert.equal(await page.locator('.tg-pedido-modal').count(),0);
    // A fresh explicit navigation remains supported; save twice in the same session.
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:pedidos-focus',{detail:{pedido_id:'other',numero:'PED-2026-0400'}})));
    await page.locator('.tg-pedido-modal-title').filter({hasText:'PED-2026-0400'}).waitFor();
    for(let n=0;n<2;n++){
      if(n)await page.getByRole('button',{name:'Ver pedido PED-2026-0400',exact:true}).click();
      await saveOrder();
      await page.locator('.tg-pedido-modal').waitFor({state:'hidden'});
      await page.waitForTimeout(1200);
      assert.equal(await page.locator('.tg-pedido-modal').count(),0,'Saving another order must not open 0393');
    }
    assert.equal(writes.filter(w=>w.p==='/pedidos/other'&&w.method==='PUT').length,2);
    await page.getByRole('searchbox',{name:'Buscar pedidos',exact:true}).fill('');
    await page.getByRole('row').filter({hasText:'PED-2026-0401'}).waitFor();
    for(const width of [1500,1100,768]){
      await page.setViewportSize({width,height:1000});
      const metrics=await page.locator('.orders-state-cell,.orders-incident-cell').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>({w:n.clientWidth,scroll:n.scrollWidth,text:n.innerText})));
      assert.ok(metrics.every(m=>m.scroll<=m.w+1),JSON.stringify({width,metrics}));
    }
    await page.setViewportSize({width:390,height:844});
    await page.locator('.tgui-mobile-data').getByText('Confirmado',{exact:true}).waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Mobile page must not overflow');
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'dashboard'})));
    await page.locator('.dashboard-live-list').first().waitFor();
    for(const width of [1500,1100,768,390,320]){
      await page.setViewportSize({width,height:1000});
      const metrics=await page.locator('.dashboard-live-list>button').evaluateAll(nodes=>nodes.map(n=>{
        const badge=n.querySelector('.tgui-badge'), b=badge.getBoundingClientRect(), r=n.getBoundingClientRect();
        return {width:n.clientWidth,scroll:n.scrollWidth,inside:b.left>=r.left&&b.right<=r.right&&b.bottom<=r.bottom};
      }));
      assert.ok(metrics.every(m=>m.inside&&m.scroll<=m.width+1),JSON.stringify({width,metrics}));
    }
    assert.deepEqual(errors,[]);
    console.log('PASS: save initial order, reload, navigate to another order and save twice without reopening 0393; readable states on desktop/tablet/mobile');
  } finally { if(browser)await browser.close(); await new Promise(r=>server.close(r)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

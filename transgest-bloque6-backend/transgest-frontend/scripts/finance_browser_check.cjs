/* Local production-build regression. All API responses and mutations are simulated. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');
const out = path.join(root, 'qa', 'finance');
const user = { id:'11111111-1111-4111-8111-111111111111', empresa_id:'22222222-2222-4222-8222-222222222222', rol:'gerente', nombre:'QA Finanzas', email:'qa@example.test', activo:true };
const client = { id:'33333333-3333-4333-8333-333333333333', nombre:'Cerámica Espíritu Santo', activo:true, cif:'B12345678', email:'cliente@example.test' };
const states=['borrador','emitida','enviada','cobrada','vencida','reclamada','sin_cobrar','rectificada'];
const invoices=states.map((estado,index)=>({id:`factura-${index}`,numero:`A-2026-00${59+index}`,serie:'A',cliente_id:client.id,cliente_nombre:client.nombre,fecha:'2026-09-01',fecha_vencimiento:'2026-10-01',estado,num_pedidos:1,total:464.64,base_imponible:384,tipo_iva:21,fiscal_modo:index ? 'verifactu' : null,fiscal_estado_envio:index===4?'error':'aceptado',lineas:[{concepto:'Transporte de mercancía con entrega y recogida de documentación',cantidad:1,precio_unit:384}],pedidos:[]}));
const orders=Array.from({length:6},(_,i)=>({id:`pedido-${i}`,numero:`PED-00${i}`,cliente_id:client.id,cliente_nombre:client.nombre,estado:'entregado',origen:'San Vicente del Raspeig',destino:'Benissa',fecha_carga:'2026-09-05',fecha_descarga:'2026-09-06',importe:384,precio:384}));
const payments=orders.slice(0,3).map((p,i)=>({...p,pedido_id:p.id,colaborador_id:'proveedor-1',colaborador_nombre:'Transportes Mediterráneo',importe:850,precio_colaborador:850,fecha_pago_calculada:'2026-09-15',pendiente_factura:true,documentacion_recibida:false,forma_pago:'Transferencia 30 días'}));
invoices.forEach(invoice => { invoice.cuota_iva=80.64; });
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
 const errors=[], mutations=[], requests=[], checks=[];
 try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.clock.setFixedTime(new Date('2026-09-10T10:00:00Z'));
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  let empty=false, fiscalUnavailable=false;
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(), url=new URL(req.url()), pathname=url.pathname.replace('/api/v1','');
   requests.push({pathname,search:url.search});
   let data=[];
   if(req.method()!=='GET')mutations.push({pathname,method:req.method(),body:req.postData()});
   if(pathname==='/auth/me')data=user;
   else if(pathname==='/facturas/control-cobros')data={resumen:{revisar_hoy:13,importe_pendiente:929.28,vencidas:2,reclamadas:1,sin_cobrar:1},proximas:[invoices[1]],riesgo:[invoices[4],invoices[5]],config:{}};
   else if(pathname==='/facturas/bloqueos-documentales')data={resumen:{total_bloqueos:12,pedidos_sin_soporte:6,importe_bloqueado_facturacion:2304},pedidos:orders.map(p=>({...p,bloqueos:['Falta POD'],accion:'Revisar documentación'})),facturas:[],cobros:[]};
   else if(pathname==='/facturas/fiscal/resumen')data=fiscalUnavailable?null:{resumen:{total_registros:7,aceptados:6,con_error:1,pendientes:0},status:{level:'ok',summary:'Configuración completa'},config:{modo:'verifactu'},recientes:[{id:'fiscal-4',factura_id:'factura-4',numero:invoices[4].numero,estado_envio:'error',modo:'verifactu',cliente_nombre:client.nombre}],cola:[]};
   else if(pathname==='/facturas')data={data:empty?[]:invoices.filter(f=>!url.searchParams.has('estado')||f.estado===url.searchParams.get('estado')),pagination:{total:80,totalPages:2}};
   else if(/^\/facturas\/factura-\d+\/estado$/.test(pathname)) { const f=invoices.find(f=>pathname.includes('/'+f.id+'/'));Object.assign(f,JSON.parse(req.postData()||'{}'));data={ok:true,factura:f}; }
   else if(/^\/facturas\/factura-\d+$/.test(pathname)) data=invoices.find(f=>pathname.endsWith('/'+f.id));
   else if(pathname==='/pedidos/colaborador-pagos/pendientes')data=empty?[]:payments;
   else if(pathname==='/pedidos'||pathname==='/pedidos/resumen-lista')data=empty?[]:orders;
   else if(pathname==='/clientes')data=[client];
   else if(pathname.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
   else if(pathname.includes('empresa')||pathname.includes('config'))data={id:user.empresa_id,nombre:'TransGest QA',cfg_alertas:[],plan:'enterprise',estado:'activa',cfg_precios:{tesoreria:{capital_actual:1000}}};
   await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.addInitScript(({user})=>{
   localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));
   localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');
  },{user});
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'facturacion'})));
  await page.getByRole('heading',{name:'Gestión financiera',exact:true}).waitFor();
  await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  await page.locator('.finance-client-group:visible').first().waitFor();
  await page.locator('.finance-client-group:visible').first().click();
  assert.ok(await page.getByRole('button',{name:'Ver factura A-2026-0059',exact:true}).filter({visible:true}).isVisible());
  await page.locator('.finance-client-group:visible').first().click();
  checks.push('client-group-expand-collapse');
  await page.getByRole('button',{name:'Vista por cliente',exact:true}).click();
  await page.getByRole('tab',{name:'Facturas',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.getByRole('tab',{name:'Cobros',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('ArrowLeft');
  checks.push('keyboard-tabs');
  const noOverflow=async label=>{
   const issues=await page.evaluate(()=>[...document.querySelectorAll('.finance-page, .tgui-dialog-body')].filter(el=>el.getClientRects().length).filter(el=>el.scrollWidth>el.clientWidth+2).map(el=>({className:el.className,width:el.clientWidth,scroll:el.scrollWidth})));
   assert.deepEqual(issues,[],`Horizontal overflow: ${label}`); checks.push(label);
  };
  for(const theme of ['light','dark']){
   if(await page.locator('html').getAttribute('data-theme')!==theme)await page.locator('.tg-topbar').getByRole('button',{name:/tema|claro|oscuro/i}).click();
   for(const width of [390,430,768,1024,1366,1440,1920]){
    await page.setViewportSize({width,height:1000});
    for(const tab of ['Facturas','Cobros','Pagos','Tesorería','Fiscal']){
     await page.getByRole('tab',{name:tab,exact:true}).click();
     await page.locator('.tg-content').evaluate(el=>{el.scrollTop=0;});
     assert.equal(await page.getByRole('tab',{name:tab,exact:true}).getAttribute('aria-selected'),'true');
     if(tab==='Facturas') {
      assert.equal(await page.locator('.tgui-mobile-data:visible').count(),width<640?1:0);
      if(width>=1366)assert.ok((await page.locator('.tgui-table tbody tr').first().boundingBox()).height<=72);
     }
     await noOverflow(`${theme}-${width}-${tab}`);
     if(width===390||width===1440)await page.screenshot({path:path.join(out,`${theme}-${width}-${tab}.png`)});
    }
   }
  }
  await page.getByRole('tab',{name:'Facturas',exact:true}).click();
  for(const width of [390,768,1440]){
   await page.setViewportSize({width,height:1000});
   await page.getByRole('button',{name:'Revisar viajes',exact:true}).click();
   await page.getByRole('dialog').waitFor(); await noOverflow(`backlog-${width}`);
   await page.keyboard.press('Shift+Tab');
   assert.ok(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));
   if(width===390)assert.equal(await page.locator('.tgui-drawer').evaluate(el=>Math.round(el.getBoundingClientRect().width)),390);
   await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);
   await page.getByRole('button',{name:'Ver factura A-2026-0059',exact:true}).filter({visible:true}).click();
   await page.getByRole('dialog').waitFor(); await noOverflow(`invoice-detail-${width}`);
   if(width===390)await page.getByRole('dialog').screenshot({path:path.join(out,'mobile-invoice-detail.png')});
   await page.keyboard.press('Escape');
   await page.getByRole('button',{name:'+ Nueva factura',exact:true}).click();
   await page.getByRole('dialog').waitFor();await noOverflow(`new-invoice-${width}`);
   if(width===390) {
    await page.getByRole('dialog').locator('select').first().selectOption(client.id);
    await page.getByRole('dialog').getByRole('button',{name:'Siguiente',exact:true}).click();
    await page.getByLabel('Seleccionar pedido PED-000').waitFor();
    await noOverflow('new-invoice-order-selection-mobile');
    await page.getByLabel('Seleccionar pedido PED-000').check();
    await page.getByRole('dialog').getByRole('button',{name:'Siguiente',exact:true}).click();
    await noOverflow('new-invoice-lines-mobile');
    await page.getByRole('dialog').screenshot({path:path.join(out,'mobile-invoice-lines.png')});
    await page.getByRole('dialog').getByRole('button',{name:'Siguiente',exact:true}).click();
    await noOverflow('new-invoice-confirmation-mobile');
   }
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:390,height:1000});
  await page.locator('.finance-accounting > summary').filter({hasText:'Exportación contable'}).click();
  await noOverflow('accounting-export-mobile');
  await page.locator('.finance-accounting > summary').filter({hasText:'Exportación contable'}).click();
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Estado de factura').selectOption('vencida');
  await page.getByRole('button',{name:'Ver resultados',exact:true}).click();
  await page.waitForTimeout(200);
  assert.ok(requests.some(r=>r.pathname==='/facturas'&&r.search.includes('estado=vencida')));
  await page.getByRole('button',{name:'Filtros',exact:true}).click();
  await page.getByRole('dialog').getByLabel('Estado de factura').selectOption('todos');
  await page.getByRole('button',{name:'Ver resultados',exact:true}).click();
  await page.getByRole('button',{name:'Acciones de A-2026-0059',exact:true}).filter({visible:true}).click();
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(),['Emitir','Cambiar estado…','Rectificar','Eliminar borrador']);
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('menu').count(),0);
  for(const [numero,required,forbidden] of [
   ['A-2026-0061','Reenviar','Emitir'],['A-2026-0062','Rectificar','Marcar cobrada'],
   ['A-2026-0063','Reclamar','Enviar'],['A-2026-0064','Sin cobrar','Reclamar'],
   ['A-2026-0065','Marcar cobrada','Reclamar'],
  ]) {
   await page.getByRole('button',{name:`Acciones de ${numero}`,exact:true}).filter({visible:true}).click();
   const labels=await page.getByRole('menuitem').allTextContents();assert.ok(labels.includes(required));assert.ok(!labels.includes(forbidden));
   await page.keyboard.press('Escape');checks.push(`actions-${numero}`);
  }
  assert.equal(await page.getByRole('button',{name:'Acciones de A-2026-0066',exact:true}).count(),0);
  await page.getByRole('button',{name:'Acciones de A-2026-0060',exact:true}).filter({visible:true}).click();
  assert.ok((await page.getByRole('menuitem').allTextContents()).includes('Marcar cobrada'));
  await page.getByRole('menuitem',{name:'Marcar cobrada',exact:true}).click();
  await page.waitForTimeout(250);
  assert.ok(mutations.some(m=>m.pathname==='/facturas/factura-1/estado'&&JSON.parse(m.body).estado==='cobrada'));
  await page.getByRole('tab',{name:'Pagos',exact:true}).click();
  await page.getByRole('button',{name:'Ver proveedor',exact:true}).click();await noOverflow('supplier-drawer-mobile');
  await page.getByRole('button',{name:'Gestionar',exact:true}).first().click();await noOverflow('supplier-edit-mobile');
  assert.equal(await page.getByRole('dialog').count(),2);
  await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),1);
  await page.keyboard.press('Escape');
  await page.getByRole('tab',{name:'Cobros',exact:true}).click();
  await page.getByRole('button',{name:'Revisar documentación',exact:true}).click();await noOverflow('document-drawer-mobile');await page.keyboard.press('Escape');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.tg-sidebar-toggle').click();assert.ok((await page.locator('.tg-sidebar').getAttribute('class')).includes('collapsed'));await noOverflow('collapsed-sidebar');
  await page.setViewportSize({width:390,height:1000});await page.locator('.tg-mobile-menu-btn').click();assert.ok((await page.locator('.tg-sidebar').getAttribute('class')).includes('mobile-open'));await page.locator('.tg-sidebar-backdrop').click({position:{x:380,y:500}});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:company-palette-changed',{detail:{id:'custom',accent:'#7c3aed',accentLight:'#a78bfa',sidebar:'#23103b'}})));
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()),'#7c3aed');
  await page.getByRole('tab',{name:'Facturas',exact:true}).click(); await page.screenshot({path:path.join(out,'custom-palette-mobile.png')});
  empty=true;await page.getByRole('button',{name:'Siguiente >',exact:true}).click();
  await page.getByText('Sin facturas',{exact:true}).waitFor();checks.push('empty-invoices');
  empty=false;fiscalUnavailable=true;
  user.permisos={modulos:{facturacion:{ver:true,editar:false},facturas:{ver:true,editar:false}}};
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'facturacion'})));
  await page.getByRole('heading',{name:'Gestión financiera',exact:true}).waitFor();
  await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'Vista por cliente',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'+ Nueva factura',exact:true}).count(),0);
  assert.equal(await page.getByRole('button',{name:/Acciones de A-2026/}).count(),0);
  assert.ok(await page.getByRole('button',{name:'Ver factura A-2026-0059',exact:true}).filter({visible:true}).isVisible());
  await page.getByText('Fiscal: resumen no disponible',{exact:true}).waitFor();checks.push('read-only-permissions','fiscal-unavailable');
  assert.deepEqual(errors,[],'Browser console errors');
  fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors,mutations,screenshots:out},null,2));
  console.log(`PASS: ${checks.length} finance checks; ${mutations.length} simulated mutations; no console errors. Screenshots: ${out}`);
 } finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(e=>{console.error(e);process.exitCode=1;});

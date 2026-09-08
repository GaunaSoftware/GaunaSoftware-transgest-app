const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');
const out = path.join(root, 'qa');
const user = { id:'11111111-1111-4111-8111-111111111111', empresa_id:'22222222-2222-4222-8222-222222222222', rol:'gerente', nombre:'QA', email:'qa@example.test', activo:true };
const client = { id:'33333333-3333-4333-8333-333333333333', nombre:'Cliente QA', activo:true };
const pedido = { id:'44444444-4444-4444-8444-444444444444', empresa_id:user.empresa_id, cliente_id:client.id, cliente_nombre:client.nombre, numero:'PED-QA-0001', estado:'confirmado', origen:'San Vicente del Raspeig', destino:'Benissa', fecha_pedido:'2026-09-01', fecha_carga:'2026-09-06', fecha_descarga:'2026-09-07', hora_carga:'08:00', hora_descarga:'14:00', importe:300, tipo_precio:'viaje', origen_pais:'España', origen_provincia:'Alicante', destino_pais:'España', destino_provincia:'Alicante', puntos_carga:[{direccion:'San Vicente del Raspeig', es_principal:true, lat:38.3964,lng:-0.5255, pais:'España',provincia:'Alicante'}], puntos_descarga:[{direccion:'Benissa',es_principal:true,lat:38.7149,lng:0.0521,pais:'España',provincia:'Alicante'}] };

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req,res) => {
    const relative = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = path.resolve(root, '.'+relative);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(root,'index.html');
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)] || 'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser, page;
  try {
    browser = await chromium.launch({ headless:true, channel:'msedge', args:['--enable-unsafe-swiftshader'] });
    page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    const stateRequests=[];
    const listRequests=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/v1/**', async route=> {
      const url=new URL(route.request().url());
      const pathname=url.pathname.replace('/api/v1','');
      let data=[];
      if (pathname==='/auth/me') data=user;
      else if (pathname==='/pedidos' || pathname==='/pedidos/resumen-lista') { data=[pedido]; listRequests.push(url); }
      else if (pathname===`/pedidos/${pedido.id}/estado`) { stateRequests.push(route.request().postDataJSON()); data={ok:true}; }
      else if (pathname===`/pedidos/${pedido.id}`) data=pedido;
      else if (pathname==='/clientes') data=[client];
      else if (pathname==='/palets/movimientos') data=Array.from({length:30},(_,index)=>({id:`lote-${index}`,empresa_id:user.empresa_id,cliente_id:client.id,propietario_cliente_id:client.id,cliente_nombre:client.nombre,tipo:'entrega',cantidad:50,fecha:'2026-09-01',obra_referencia:`Obra QA ${index}`,pedido_ref:`Obra QA ${index}`,estado_salida:'confirmada'}));
      else if (pathname==='/puntos-interes') data=[{id:'55555555-5555-4555-8555-555555555555',empresa_id:user.empresa_id,cliente_id:client.id,nombre:'Punto QA',direccion:'Calle Malaga 1',ciudad:'San Vicente del Raspeig',provincia:'Alicante',pais:'España',tipo:'carga',lat:38.3964,lng:-0.5255}];
      else if (pathname==='/geocoding/resolve') data={ok:true,provider:'local',municipio:'Aspe',provincia:'Alicante',pais:'Espana',lat:38.3486,lng:-0.7694};
      else if (pathname.includes('/geocoding/')) data={ok:true,provider:'osrm',km:71,duration_min:65,points:pedido.puntos_carga.concat(pedido.puntos_descarga),geometry:[[38.3964,-0.5255],[38.5,-0.2],[38.7149,0.0521]]};
      else if (pathname.includes('notificaciones')) data={data:[],no_leidas:0,items:[],resumen:{}};
      else if (pathname.includes('empresa') || pathname.includes('config')) data={id:user.empresa_id,nombre:'QA',cfg_alertas:[],plan:'enterprise',estado:'activa'};
      else if (pathname.includes('riesgo')) data={bloqueado:false,pendiente:0};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.addInitScript(({user})=>{
      localStorage.setItem('tms_token','qa-local-only');
      localStorage.setItem('tms_user',JSON.stringify(user));
      localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');
    },{user});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
    await page.getByText('PED-QA-0001',{exact:true}).click({timeout:30000});
    const modal=page.locator('.tg-pedido-modal');
    await modal.waitFor();
    await page.locator('[data-map-engine="maplibre"] canvas').waitFor({timeout:30000});
    await page.locator('div[style*="z-index: 9999"]').waitFor({state:'hidden'});
    await page.getByText('71 km',{exact:true}).waitFor();
    await page.locator('.maplibregl-ctrl-attrib a').first().waitFor({timeout:30000});
    await page.locator('[data-map-idle="true"]').waitFor({timeout:60000});
    assert.equal(await page.locator('.tg-route-stop-marker').count(),2);
    await page.getByRole('button',{name:'2: Benissa',exact:true}).click();
    await page.locator('.maplibregl-popup-content').waitFor();
    assert.match(await page.locator('.maplibregl-popup-content').innerText(),/Benissa/);
    await page.locator('.maplibregl-popup-close-button').click();
    await modal.evaluate(el=>{el.scrollTop=0;});
    await page.screenshot({path:path.join(out,'pedido-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.locator('[data-map-idle="true"]').waitFor();
    await page.screenshot({path:path.join(out,'mapa-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await modal.locator('.tg-pedido-modal-header button').click();
    await modal.waitFor({state:'hidden'});
    assert.equal(await page.getByText('Cambios sin guardar',{exact:true}).count(),0);
    await page.getByText('PED-QA-0001',{exact:true}).click();
    await modal.waitFor();
    await modal.getByRole('button',{name:'Puntos',exact:true}).first().click();
    await page.getByRole('button',{name:'Seleccionar',exact:true}).first().click();
    await page.getByText('Puntos guardados',{exact:true}).waitFor({state:'hidden'});
    const selectedValues=await modal.locator('input').evaluateAll(items=>items.map(el=>el.value));
    assert.ok(selectedValues.some(value=>/Punto QA|Calle Malaga 1/i.test(value)),JSON.stringify(selectedValues));
    await modal.locator('.tg-pedido-modal-header button').click();
    await page.getByText('Cambios sin guardar',{exact:true}).waitFor();
    await page.getByRole('button',{name:'No guardar',exact:true}).click();
    await page.getByRole('button',{name:'Salir sin guardar',exact:true}).click();
    await modal.waitFor({state:'hidden'});
    await page.getByText('PED-QA-0001',{exact:true}).click();
    await modal.waitFor();
    const edit=modal.getByRole('button',{name:'Editar',exact:true});
    await edit.last().click();
    const address=modal.getByPlaceholder('Poblacion o direccion',{exact:true});
    await address.fill('Benissa');
    await address.press('End');
    await address.press('Backspace');
    await address.press('Backspace');
    assert.equal(await address.inputValue(),'Benis');
    assert.equal(await address.evaluate(el=>el===document.activeElement),true);
    await address.fill('');
    assert.equal(await address.inputValue(),'');
    await address.fill('Calpe');
    const minimum=modal.locator('label').filter({hasText:/^Minimo facturable/}).locator('..').locator('input').first();
    await minimum.fill('');
    await minimum.pressSequentially('12,5');
    assert.equal(await minimum.inputValue(),'12,5');
    assert.equal(await modal.getByText('Tipo de palet',{exact:true}).count(),0);
    await modal.getByText('Temperatura (C)',{exact:true}).scrollIntoViewIfNeeded();
    assert.equal(await modal.getByText('Temperatura (C)',{exact:true}).isVisible(),true);
    await modal.locator('input[name="tipo_carga"][value="grupaje"]').check();
    assert.equal(await modal.getByText('Tipo de palet',{exact:true}).isVisible(),true);
    assert.equal(await modal.getByText('Largo carga (m)',{exact:true}).isVisible(),true);
    await modal.locator('input[name="tipo_carga"][value="completa"]').check();
    assert.equal(await modal.getByText('Largo carga (m)',{exact:true}).count(),0);
    const origin=modal.locator('label').filter({hasText:/^Origen \(carga\)/i}).locator('..').locator('input').first();
    await origin.fill('Aspe');
    const resolvedAspe=page.waitForResponse(response=>response.url().includes('/geocoding/resolve'));
    await origin.press('Tab');
    await resolvedAspe;
    assert.equal(await origin.inputValue(),'ASPE');
    await modal.getByRole('button',{name:'Guardar punto',exact:true}).first().click();
    const country=page.locator('input[list^="poi-countries-"]');
    await country.fill('Espana');
    await country.press('End');
    await country.press('Backspace');
    assert.equal(await country.inputValue(),'Espan');
    await country.fill('');
    assert.equal(await country.inputValue(),'');
    await country.pressSequentially('Portugal');
    assert.equal(await country.inputValue(),'Portugal');
    await page.getByText('Guardar punto de interes',{exact:true}).locator('..').locator('..').getByRole('button',{name:'X',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await address.scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'pedido-mobile.png')});
    await modal.evaluate(el=>{el.scrollTop=0;});
    const size=await modal.evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,rect:el.getBoundingClientRect().toJSON()}));
    assert.ok(size.scroll<=size.width+1,JSON.stringify(size));
    assert.ok(size.rect.width<=390,JSON.stringify(size));
    await modal.locator('.tg-pedido-modal-header button').click();
    await page.getByText('Cambios sin guardar',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);
    await page.getByRole('button',{name:'No guardar',exact:true}).click();
    await page.getByRole('button',{name:'Salir sin guardar',exact:true}).click();
    await modal.waitFor({state:'hidden'});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'palets'})));
    await page.getByRole('button',{name:/Registrar movimiento/}).click();
    const palets=page.locator('.tg-palets-modal');
    await palets.locator('select').nth(0).selectOption('devolucion');
    await palets.locator('select').nth(1).selectOption(client.id);
    await page.locator('.tg-palets-lotes-scroll').waitFor();
    assert.equal(await page.locator('.tg-palets-lote-button').count(),30);
    const lotSize=await page.locator('.tg-palets-lotes-scroll').evaluate(el=>({height:el.clientHeight,scroll:el.scrollHeight}));
    assert.ok(lotSize.height<300 && lotSize.scroll>lotSize.height,JSON.stringify(lotSize));
    await page.screenshot({path:path.join(out,'palets-mobile.png')});
    assert.ok(await palets.evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    const now=new Date();
    const month=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
    const originalMonth=month(new Date(now.getFullYear(),now.getMonth()-1,1));
    Object.assign(pedido,{estado:'incidencia',fecha_pedido:'2020-01-01',fecha_carga:`${originalMonth}-14`,fecha_descarga:`${originalMonth}-15`,vehiculo_id:'55555555-5555-4555-8555-555555555555',chofer_id:'66666666-6666-4666-8666-666666666666'});
    for (const [option,expected] of [
      [/mes original del viaje/,originalMonth],
      [/mes actual/,month(now)],
      [/mes siguiente/,month(new Date(now.getFullYear(),now.getMonth()+1,1))],
    ]) {
      await page.reload({waitUntil:'networkidle'});
      await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
      const row=page.locator('tr').filter({hasText:'PED-QA-0001'});
      await row.locator('select').selectOption('entregado');
      const originalOption=page.getByRole('button',{name:/mes original del viaje/});
      await originalOption.waitFor();
      assert.ok((await originalOption.innerText()).includes(new Date(`${originalMonth}-01T12:00:00`).toLocaleDateString('es-ES',{month:'long',year:'numeric'})));
      assert.equal(listRequests.at(-1).searchParams.get('incluir_incidencias'),'true');
      assert.ok(await originalOption.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth));
      await page.screenshot({path:path.join(out,'mes-facturacion-mobile.png')});
      const saved=page.waitForRequest(req=>req.url().includes(`/pedidos/${pedido.id}/estado`) && req.method()==='PATCH');
      await page.getByRole('button',{name:option}).click();
      await saved;
      assert.equal(stateRequests.at(-1).facturacion_mes,`${expected}-01`);
      assert.equal(stateRequests.at(-1).estado,'entregado');
    }
    console.log('OK: modal desktop/mobile, cierre sin cambios, edicion continua, pais, decimales con coma, grupaje, mapa MapLibre y facturacion en mes original/actual/siguiente. Capturas: '+out);
  } catch(error) {
    if(page) { await page.screenshot({path:path.join(out,'failure.png')}); console.error((await page.locator('body').innerText()).slice(-5000)); }
    throw error;
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

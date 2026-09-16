const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');
const out = path.join(root, 'qa');
const user = { id:'11111111-1111-4111-8111-111111111111', empresa_id:'22222222-2222-4222-8222-222222222222', rol:'gerente', nombre:'QA', email:'qa@example.test', activo:true };
const client = { id:'33333333-3333-4333-8333-333333333333', nombre:'Cliente QA', activo:true };
const supplier={id:'77777777-7777-4777-8777-777777777777',nombre:'Transportista QA'};
const pedido = { id:'44444444-4444-4444-8444-444444444444', empresa_id:user.empresa_id, cliente_id:client.id, cliente_nombre:client.nombre, numero:'PED-QA-0001', estado:'confirmado', origen:'San Vicente del Raspeig', destino:'Benissa', fecha_pedido:'2026-09-01', fecha_carga:new Date().toISOString().slice(0,10), fecha_descarga:'2026-09-07', hora_carga:'08:00', hora_descarga:'14:00', importe:900,precio_unitario:900,precio_colaborador:600,colaborador_id:supplier.id,matricula_colaborador:'1234-ABC',remolque_matricula_colaborador:'R-1234-ABC',tipo_precio:'viaje', origen_pais:'España', origen_provincia:'Alicante', destino_pais:'España', destino_provincia:'Alicante', puntos_carga:[{direccion:'San Vicente del Raspeig', es_principal:true, lat:38.3964,lng:-0.5255, pais:'España',provincia:'Alicante'}], puntos_descarga:[{direccion:'Benissa',es_principal:true,lat:38.7149,lng:0.0521,pais:'España',provincia:'Alicante'}] };

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
    const updateRequests=[];
    const fleet=Array.from({length:100},(_,i)=>({id:`55555555-5555-4555-8555-${String(i).padStart(12,'0')}`,matricula:`${1000+i}-BCD`,activo:true,clase:'tractora'}));
    const drivers=Array.from({length:100},(_,i)=>({id:`66666666-6666-4666-8666-${String(i).padStart(12,'0')}`,nombre:`Conductor ${String(i).padStart(3,'0')}`,activo:true}));
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/v1/**', async route=> {
      const url=new URL(route.request().url());
      const pathname=url.pathname.replace('/api/v1','');
      let data=[];
      if (pathname==='/auth/me') data=user;
      else if (pathname==='/pedidos' || pathname==='/pedidos/resumen-lista') { data=[pedido]; listRequests.push(url); }
      else if (pathname===`/pedidos/${pedido.id}/estado`) { stateRequests.push(route.request().postDataJSON()); data={ok:true}; }
      else if (pathname===`/pedidos/${pedido.id}`) {
        if(route.request().method()==='PUT' && route.request().postDataJSON()?.vehiculo_id===fleet[99].id && !route.request().postDataJSON()?.salida_taller_confirmada) {
          await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({code:'VEHICULO_EN_TALLER',requiere_confirmacion:true,vehiculos:[{id:fleet[99].id,matricula:fleet[99].matricula}],error:'Vehiculo en taller'})}); return;
        }
        if(route.request().method()==='PUT') {const body=route.request().postDataJSON();updateRequests.push(body);Object.assign(pedido,body);}
        data=pedido;
      }
      else if (pathname==='/vehiculos') data=fleet;
      else if (pathname==='/choferes') data=drivers;
      else if (pathname==='/pedidos/disponibilidad') data={vehiculos:fleet.map((v,i)=>({...v,disponible:i%2===0,motivo:i%2?'Viaje QA ocupado':''})),choferes:drivers.map((c,i)=>({...c,disponible:i%2===0,motivo:i%2?'Servicio QA':''}))};
      else if (pathname==='/colaboradores') data=[supplier];
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

    await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
    await page.getByRole('heading',{name:'Pedidos / Tráfico',exact:true}).waitFor();
    await page.getByText('PED-QA-0001',{exact:true}).first().waitFor({timeout:30000});
    const row=page.locator('tr').filter({hasText:'PED-QA-0001'});
    await row.locator('button').last().click();
    await page.getByText('Asignación',{exact:true}).click();
    await page.getByText('Limpiar asignación',{exact:true}).click();
    await page.getByRole('button',{name:'Limpiar asignacion',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'));
    assert.equal(pedido.colaborador_id,null);
    assert.equal(pedido.matricula_colaborador,null);
    assert.equal(pedido.remolque_matricula_colaborador,null);
    assert.equal(pedido.importe,900);
    await row.locator('button').last().click();
    await page.getByText('Asignación',{exact:true}).click();
    await page.getByText('Asignar camión, conductor o colaborador',{exact:true}).click();
    const dialog=page.getByRole('dialog',{name:'Asignar recursos'});
    await dialog.getByRole('button',{name:'Proveedor externo',exact:true}).click();
    await dialog.getByLabel('Colaborador',{exact:true}).selectOption(supplier.id);
    await dialog.getByLabel('Matrícula de la tractora').fill('5678-DEF');
    await dialog.getByLabel('Matrícula del remolque').fill('R-5678-DEF');
    await dialog.getByLabel('Precio de venta',{exact:false}).fill('1000,50');
    await dialog.getByLabel('Coste acordado',{exact:false}).fill('650,50');
    await page.locator('div[style*="z-index: 9999"]').waitFor({state:'hidden'});
    await page.screenshot({path:path.join(out,'quick-assignment-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await dialog.getByRole('button',{name:'Asignar',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'quick-assignment-mobile.png')});
    assert.ok(await dialog.evaluate(el=>el.getBoundingClientRect().right<=window.innerWidth));
    await dialog.getByRole('button',{name:'Asignar',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(pedido.colaborador_id,supplier.id);
    assert.equal(pedido.matricula_colaborador,'5678-DEF');
    assert.equal(pedido.remolque_matricula_colaborador,'R-5678-DEF');
    assert.equal(pedido.precio_unitario,1000.5);
    assert.equal(pedido.precio_colaborador,650.5);
    assert.equal(await page.locator('.tg-pedido-modal').count(),0);
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS: list clear, supplier assignment, prices and responsive modal with mocked API.');
  } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

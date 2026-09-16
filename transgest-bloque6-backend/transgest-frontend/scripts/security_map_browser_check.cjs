const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');
const out = path.join(root, 'qa');
const user = { id:'11111111-1111-4111-8111-111111111111', empresa_id:'22222222-2222-4222-8222-222222222222', rol:'gerente', nombre:'QA', email:'qa@example.test', activo:true };
const client = { id:'33333333-3333-4333-8333-333333333333', nombre:'Cliente QA', activo:true };
const pedido = { id:'44444444-4444-4444-8444-444444444444', empresa_id:user.empresa_id, cliente_id:client.id, cliente_nombre:client.nombre, numero:'PED-QA-0001', estado:'confirmado', origen:'San Vicente del Raspeig', destino:'Benissa', fecha_pedido:'2026-09-01', fecha_carga:new Date().toISOString().slice(0,10), fecha_descarga:'2026-09-07', hora_carga:'08:00', hora_descarga:'14:00', importe:300, tipo_precio:'viaje', origen_pais:'España', origen_provincia:'Alicante', destino_pais:'España', destino_provincia:'Alicante', puntos_carga:[{direccion:'San Vicente del Raspeig', es_principal:true, lat:38.3964,lng:-0.5255, pais:'España',provincia:'Alicante'}], puntos_descarga:[{direccion:'Benissa',es_principal:true,lat:38.7149,lng:0.0521,pais:'España',provincia:'Alicante'}] };

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req,res) => {
    const relative = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    let file = path.resolve(root, '.'+relative);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(root,'index.html');
    res.setHeader('Content-Type', ({'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)] || 'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser, page;
  try {
    browser = await chromium.launch({ headless:true, channel:'msedge', args:['--enable-unsafe-swiftshader'] });
    page = await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];
    const pending=new Set();
    page.on('request',req=>pending.add(req));
    page.on('requestfinished',req=>pending.delete(req));
    page.on('requestfailed',req=>pending.delete(req));
    const stateRequests=[];
    const listRequests=[];
    const updateRequests=[];
    const fleet=Array.from({length:100},(_,i)=>({id:`55555555-5555-4555-8555-${String(i).padStart(12,'0')}`,matricula:`${1000+i}-BCD`,activo:true,clase:'tractora'}));
    const drivers=Array.from({length:100},(_,i)=>({id:`66666666-6666-4666-8666-${String(i).padStart(12,'0')}`,nombre:`Conductor ${String(i).padStart(3,'0')}`,activo:true}));
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',msg=>{if(msg.type()==='error') console.error('Browser:',msg.text());});
    page.on('requestfailed',req=>{if(req.failure()?.errorText!=='net::ERR_ABORTED') console.error('Request failed:',new URL(req.url()).pathname,req.failure()?.errorText);});
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
      const NativeWorker=window.Worker;
      window.Worker=new Proxy(NativeWorker,{construct(Target,args){
        const worker=new Target(...args);
        worker.addEventListener('error',event=>console.error('Worker error',event.message,event.filename));
        return worker;
      }});
      localStorage.setItem('tms_token','qa-local-only');
      localStorage.setItem('tms_user',JSON.stringify(user));
      localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');
    },{user});
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});

    await page.getByRole('heading',{name:'Dashboard',exact:true}).waitFor();
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
    await page.getByRole('heading',{name:'Pedidos / Tráfico',exact:true}).waitFor();
    await page.getByText('PED-QA-0001',{exact:true}).first().click({timeout:30000});
    const modal=page.locator('.tg-pedido-modal');
    await modal.waitFor();
    await page.locator('[data-map-engine="maplibre"] canvas').waitFor({timeout:30000});
    await page.locator('div[style*="z-index: 9999"]').waitFor({state:'hidden'});
    await page.getByText('71 km',{exact:true}).waitFor();
    await page.locator('.maplibregl-ctrl-attrib a').first().waitFor({timeout:30000});
    try {await page.locator('[data-map-idle="true"]').waitFor({timeout:30000});}
    catch(error) {console.error('Pending requests',Array.from(pending,req=>new URL(req.url()).pathname));throw error;}
    assert.equal(await page.locator('.tg-route-stop-marker').count(),2);
    const markerPosition=()=>page.locator('.tg-route-stop-marker').first().evaluate(el=>el.style.transform);
    const beforeZoom=await markerPosition();
    await page.locator('.maplibregl-ctrl-zoom-in').click();
    await page.waitForFunction(before=>document.querySelector('.tg-route-stop-marker')?.style.transform!==before,beforeZoom);
    await page.getByRole('button',{name:'Centrar ruta',exact:true}).click();
    await page.getByRole('button',{name:/^2: Benissa/}).click();
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
    Object.assign(pedido,{gps_lat:38.55,gps_lng:-0.15});
    await page.getByText('PED-QA-0001',{exact:true}).first().click();
    await page.getByRole('button',{name:'V: Vehiculo',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelectorAll('.tg-route-stop-marker').length===3);
    assert.equal(await page.locator('.tg-route-stop-marker').count(),3);
    await modal.locator('.tg-pedido-modal-header button').click();
    await modal.waitFor({state:'hidden'});
    assert.equal(errors.length,0,errors.join('\n'));
    console.log('PASS MapLibre v6: rendered route, markers, popup, attribution, stable frame, mobile resize and navigation.');
  } catch(error) {
    if(page) {
      console.error(await page.locator('[data-map-engine]').evaluateAll(nodes=>nodes.map(n=>({text:n.innerText,html:n.innerHTML.slice(0,1200)}))));
      await page.screenshot({path:path.join(out,'map-failure.png'),fullPage:true});
    }
    throw error;
  } finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

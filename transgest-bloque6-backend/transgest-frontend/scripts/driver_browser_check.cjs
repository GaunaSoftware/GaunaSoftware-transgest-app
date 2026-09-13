// Isolated browser checks: every API response and write is local test data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','driver');
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNlsAAAAASUVORK5CYII=';
const user={id:'driver-user',chofer_id:'driver-1',empresa_id:'qa-company',rol:'chofer',nombre:'Conductor de prueba',plan:'enterprise',activo:true,permisos:{modulos:{avisos:{ver:true}}}};
const driver={id:'driver-1',nombre:'Conductor',apellidos:'de prueba',firma_base:image,vehiculo_id:'truck-1',vehiculo_matricula:'1234-BCD',remolque_matricula:'R-1234',gps_provider:'external',gps_external_id:'qa',km_actuales:123000};
let jornada={id:'day-1',estado:'abierta',inicio_at:'2026-09-12T05:00:00Z',actividad_actual:'otros_trabajos',resumen:{calculado_at:'2026-09-12T08:00:00Z',conduccion_min:90,conduccion_desde_pausa_min:90,avisos:[]},eventos:[{tipo:'otros_trabajos',at:'2026-09-12T05:00:00Z'}]};
const orders=[{id:'order-1',numero:'P-QA-001',cliente_nombre:'Cliente de prueba',estado:'confirmado',origen:'Valencia',destino:'Madrid',mercancia:'Palets',fecha_carga:'2026-09-12',hora_carga:'10:30',vehiculo_id:'truck-1',vehiculo_matricula:'1234-BCD',chofer_id:'driver-1'},{id:'order-2',numero:'P-QA-002',cliente_nombre:'Cliente de prueba',estado:'entregado',origen:'Madrid',destino:'Valencia',mercancia:'Palets',fecha_carga:'2026-09-10'}];
async function main(){
 fs.mkdirSync(out,{recursive:true});const errors=[],writes=[],checks=[];let failList=false;
 const server=http.createServer((req,res)=>{let file=path.resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'}[path.extname(file)]||'text/html'));fs.createReadStream(file).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',e=>{errors.push(e.message);console.error(e.message);});await page.clock.setFixedTime(new Date('2026-09-12T08:00:00Z'));
  await page.route('**/health',r=>r.fulfill({json:{status:'ok'}}));
  await page.route('**/api/v1/**',async route=>{
   const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');let data=[];const body=req.method()==='GET'?null:req.postDataJSON();if(body)writes.push({p,body});
   if(p==='/auth/login')data={token:'qa-token',user};
   else if(p==='/auth/me')data=user;
   else if(p==='/auth/login-brand')data={found:false};
   else if(p==='/auth/forgot-password')data={message:'Solicitud recibida'};
   else if(p==='/pedidos'){if(failList)return route.fulfill({status:503,json:{error:'No se pudo cargar la información'}});data=orders;}
   else if(p==='/pedidos/chofer/clientes')data=[];
   else if(p==='/pedidos/chofer')data={id:'created',documento_control:{qr:{data_url:image}}};
   else if(p.includes('chofer-pasos'))data={pasos:{}};
   else if(p.includes('documento-control'))data={status:{ready:false,faltantes:['Destino']},documento:{},qr:{data_url:image},support_url:'https://example.com/qa-dcd'};
   else if(p==='/choferes/app/jornada')data={chofer:driver,jornada};
   else if(p==='/choferes/app/jornada/cerrar'){jornada=null;data={ok:true};}
   else if(p==='/choferes/app/jornada/iniciar'){jornada={id:'day-2',inicio_at:'2026-09-12T08:00:00Z',actividad_actual:'otros_trabajos',resumen:{},eventos:[]};data={ok:true};}
   else if(p==='/choferes/app/jornada/actividad'){jornada.actividad_actual=body.actividad;data={ok:true};}
   else if(p==='/choferes/app/conjunto')data={conjunto:{vehiculo_id:'truck-1',remolque_id:'trailer-1'},tractoras:[{id:'truck-1',matricula:'1234-BCD',estado:'disponible'},{id:'truck-2',matricula:'5678-DEF',estado:'disponible'}],remolques:[{id:'trailer-1',matricula:'R-1234'}]};
   else if(p==='/choferes/app/vacaciones')data=[];
   else if(p==='/taller/solicitudes/capacidades')data={puede_mecanico:true,puede_taller_externo:true};
   else if(p==='/taller/solicitudes')data=[];
   else if(p.includes('notificaciones'))data={data:[{id:'notice-1',tipo:'ruta_chofer_app',titulo:'Ruta de prueba',mensaje:'Revisa la ruta indicada por tráfico',data:{route_url:'https://example.com/qa-route'}}],no_leidas:1};
   else if(p.includes('empresa')||p.includes('config'))data={nombre:'Empresa QA',plan:'enterprise',cfg_alertas:[]};
   return route.fulfill({status:200,json:data});
  });
  await page.addInitScript(u=>localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1'),user);
  await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Iniciar sesión'}).waitFor();
  for(const width of [360,390,768]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:path.join(out,`login-${width}.png`),fullPage:true});}
  await page.getByLabel('Usuario o correo electrónico',{exact:true}).fill('driver.qa');await page.getByLabel('Contraseña',{exact:true}).fill('test-only-password');await page.getByRole('button',{name:'Mostrar contraseña',exact:true}).click();assert.equal(await page.locator('#login-password').getAttribute('type'),'text');await page.getByRole('button',{name:'Ocultar contraseña',exact:true}).click();
  await page.getByRole('button',{name:'He olvidado la contraseña'}).click();const reset=page.getByRole('dialog',{name:'Recuperar contraseña'});await reset.getByRole('button',{name:'Enviar aviso'}).click();await reset.getByText('Solicitud recibida').waitFor();await reset.getByRole('button',{name:'Cerrar',exact:true}).click();
  await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.locator('.driver-page-heading h1').waitFor();await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});checks.push('Login, password visibility, password recovery and driver authentication');
  const tabs=page.getByRole('navigation',{name:'Apartados del chófer'}),bottom=page.getByRole('navigation',{name:'Navegación principal del chófer'});
  for(const theme of ['light','dark']){
   if(theme==='dark'){await bottom.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Usar tema oscuro',exact:true}).click();}
   for(const tab of ['Activos','Nuevo','Jornada','Datos','Vacaciones','Historial','Taller']){
    await tabs.getByRole('button',{name:tab,exact:true}).click();
    for(const width of [360,390,768]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${tab} overflow ${width}`);await page.screenshot({path:path.join(out,`${tab}-${theme}-${width}.png`),fullPage:true});}
   }
  }
  checks.push('All seven sections, light/dark themes and mobile/tablet layouts');
  await tabs.getByRole('button',{name:'Nuevo',exact:true}).click();await page.getByRole('button',{name:'Crear viaje y DCD',exact:true}).scrollIntoViewIfNeeded();await bottom.getByRole('button',{name:'Jornada',exact:true}).click();await page.waitForTimeout(100);const headingBox=await page.locator('.driver-page-heading').boundingBox();assert(headingBox.y>=0&&headingBox.y<300,'bottom navigation must return to the section header');
  await bottom.getByRole('button',{name:'Inicio',exact:true}).click();await page.getByRole('heading',{name:'Tu día, en un vistazo'}).waitFor();await bottom.getByRole('button',{name:'Avisos',exact:true}).click();await page.getByText('Ruta de prueba',{exact:true}).waitFor();await page.getByRole('button',{name:'Leída',exact:true}).click();await page.getByText('No hay avisos disponibles.').waitFor();
  await tabs.getByRole('button',{name:'Jornada',exact:true}).click();await page.getByLabel('Tractora',{exact:true}).selectOption('truck-2');await page.getByRole('button',{name:'Actualizar conjunto',exact:true}).click();assert(writes.some(w=>w.p==='/choferes/app/conjunto'&&w.body.vehiculo_id==='truck-2'));
  await page.getByRole('button',{name:'Disponibilidad',exact:true}).click();assert(writes.some(w=>w.p.endsWith('/jornada/actividad')&&w.body.actividad==='disponibilidad'));
  await page.getByLabel('Kilómetros al terminar').fill('123050');await page.getByRole('button',{name:'Cerrar jornada',exact:true}).click();await page.getByRole('button',{name:'Iniciar jornada',exact:true}).waitFor();await page.getByLabel('Kilómetros al iniciar').fill('123050');await page.getByRole('button',{name:'Iniciar jornada',exact:true}).click();await page.getByText('Jornada en curso',{exact:true}).waitFor();checks.push('Live day summary, vehicle assignment and day activity/start/end API calls');
  async function drawSignature(){const canvas=page.locator('canvas'),box=await canvas.boundingBox();await page.mouse.move(box.x+35,box.y+50);await page.mouse.down();await page.mouse.move(box.x+140,box.y+90,{steps:8});await page.mouse.move(box.x+220,box.y+35,{steps:8});await page.mouse.up();}
  await tabs.getByRole('button',{name:'Datos',exact:true}).click();await page.getByRole('button',{name:'Cambiar firma',exact:true}).click();await page.locator('canvas').waitFor();await page.screenshot({path:path.join(out,'signature.png')});await page.getByRole('button',{name:'Firmar',exact:true}).click();assert.equal(writes.filter(w=>w.p==='/choferes/app/firma-base').length,0,'empty signature must not save');await drawSignature();await page.getByRole('button',{name:'Firmar',exact:true}).click();await page.locator('canvas').waitFor({state:'hidden'});assert(writes.some(w=>w.p==='/choferes/app/firma-base'));
  await tabs.getByRole('button',{name:'Vacaciones',exact:true}).click();await page.getByLabel('Inicio de vacaciones').fill('2026-10-01');await page.getByLabel('Fin de vacaciones').fill('2026-10-05');await page.getByRole('button',{name:'Solicitar y firmar',exact:true}).click();await page.locator('canvas').waitFor();await drawSignature();await page.getByRole('button',{name:'Firmar',exact:true}).click();await page.locator('canvas').waitFor({state:'hidden'});assert(writes.some(w=>w.p==='/choferes/app/vacaciones'&&w.body.fecha_fin==='2026-10-05'));checks.push('Personal/holiday signatures, rejecting empty signatures and saving signed data');
  await tabs.getByRole('button',{name:'Nuevo',exact:true}).click();await page.getByLabel('Cliente / destinatario').fill('Cliente de prueba');await page.getByLabel('Origen / punto de carga').fill('Valencia');await page.getByLabel('Destino / punto de descarga').fill('Madrid');await page.getByLabel('Mercancía',{exact:true}).fill('Palets');await page.getByRole('button',{name:'Crear viaje y DCD',exact:true}).click();await page.getByText('QR generado',{exact:true}).waitFor();assert(writes.some(w=>w.p==='/pedidos/chofer'&&w.body.mercancia==='Palets'));
  await tabs.getByRole('button',{name:'Taller',exact:true}).click();await page.getByRole('button',{name:'Neumático pinchado',exact:true}).click();await page.getByRole('button',{name:'Enviar solicitud de taller',exact:true}).click();await page.getByText('Solicitud enviada',{exact:true}).waitFor();assert(writes.some(w=>w.p==='/taller/solicitudes'&&w.body.motivo==='neumatico_pinchado'));checks.push('Create trip/DCD and workshop request');
  await tabs.getByRole('button',{name:'Activos',exact:true}).click();await page.getByRole('button',{name:'Ver detalles del viaje P-QA-001',exact:true}).press('Enter');await page.waitForTimeout(200);await page.screenshot({path:path.join(out,'trip-expanded.png'),fullPage:true});
  failList=true;await page.getByRole('button',{name:'Actualizar información'}).click();await page.locator('.driver-load-error').waitFor();failList=false;await page.locator('.driver-load-error').getByRole('button',{name:'Reintentar'}).click();await page.locator('.driver-load-error').waitFor({state:'hidden'});
  user.plan='lite';await page.reload({waitUntil:'networkidle'});await page.locator('.driver-page-heading h1').waitFor();await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});assert.equal(await tabs.getByRole('button',{name:'Vacaciones',exact:true}).count(),0);assert.equal(await tabs.getByRole('button',{name:'Taller',exact:true}).count(),0);
  await bottom.getByRole('button',{name:'Más',exact:true}).click();await page.getByRole('button',{name:'Cerrar sesión',exact:true}).click();await page.getByRole('heading',{name:'Iniciar sesión'}).waitFor();checks.push('Keyboard trip details, load failure/retry, plan restrictions and logout');
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

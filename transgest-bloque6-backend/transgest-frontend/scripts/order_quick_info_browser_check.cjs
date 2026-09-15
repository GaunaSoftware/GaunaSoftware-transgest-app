const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const root=path.resolve(__dirname,'../build');
const driver={id:'driver-a',nombre:'Ana',apellidos:'García Pérez',alias:'Ana GP',vehiculo_id:'truck-a',vehiculo_matricula:'1234 ABC',remolque_matricula:'R-1234'};const today='2026-09-15';let points=[],writes=[];const orders=[{id:'order-a',numero:'QA-A',estado:'pendiente',fecha_carga:today,origen:'Madrid',destino:'Valencia'},{id:'order-b',numero:'QA-B',estado:'pendiente',fecha_carga:today,origen:'Madrid',destino:'Valencia'},{id:'old',numero:'QA-VENCIDO',estado:'en_curso',fecha_carga:'2026-08-10',fecha_descarga:'2026-08-11',origen:'Madrid',destino:'Sevilla'},{id:'future',numero:'QA-EN-RUTA',estado:'en_curso',fecha_carga:today,fecha_descarga:'2026-09-16',origen:'Madrid',destino:'Sevilla'}];
async function main(){const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'text/html'));fs.createReadStream(f).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[];
try{browser=await chromium.launch({headless:true,channel:'msedge'});const origin=`http://127.0.0.1:${server.address().port}`;
async function makePage(role){const page=await browser.newPage({viewport:{width:1500,height:1000}}),user={id:'qa',empresa_id:'qa-company',rol:role,nombre:'QA',plan:'enterprise',...(role==='cliente'?{cliente_id:'client'}:{})};page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(today+'T10:00:00Z'));await page.addInitScript(u=>{localStorage.setItem('tms_token','qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1');},user);
await page.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1',''),body=req.method()==='GET'?null:req.postDataJSON();let data=[];if(body||req.method()==='DELETE')writes.push({p,body,method:req.method()});
if(p==='/auth/me')data=user;else if(p.includes('notificaciones'))data={data:[],no_leidas:0};else if(p==='/pedidos'||p==='/pedidos/resumen-lista')data=[{id:'qa-info',numero:'QA-INFO',chofer_id:'driver-a',vehiculo_id:'truck-a',vehiculo_matricula:'1234 ABC',remolque_matricula:'R-1234',estado:'incidencia',fecha_carga:today,origen:'Madrid',destino:'Valencia',puntos_carga:[{direccion:'Madrid'},{direccion:'Carga adicional Toledo'}],puntos_descarga:[{direccion:'Valencia'},{direccion:'Descarga adicional Alicante'}],incidencia_descripcion:'Retraso por avería en carretera'}];else if(p==='/choferes')data=[driver];else if(p==='/portal-cliente/puntos'){if(body){const point={...body,id:'point-'+points.length};points.push(point);data=point;}else data=points;}else if(p==='/portal-cliente/calcular-ruta')data={km:350,warning:'Estimación QA'};else if(p==='/portal-cliente/solicitudes'&&body)data={id:'request-qa'};else if(p.includes('resumen'))data={};else if(p.includes('empresa'))data={plan:'enterprise'};
await route.fulfill({status:200,json:data});});await page.goto(origin,{waitUntil:'networkidle'});return page;}
const page=await makePage('gerente');
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
await page.locator('.orders-workspace').waitFor();
const row=page.getByRole('row').filter({hasText:'QA-INFO'});
await row.getByText('Ana GP',{exact:true}).waitFor();
await row.getByText('1234 ABC · R-1234',{exact:true}).waitFor();
const load=row.locator('summary').filter({hasText:'+1 cargas'});
assert.match(await load.getAttribute('title'),/Carga adicional Toledo/);
const unload=row.locator('summary').filter({hasText:'+1 descargas'});
assert.match(await unload.getAttribute('title'),/Descarga adicional Alicante/);
const incident=row.locator('summary').filter({hasText:'Incidencia operativa'});
assert.match(await incident.getAttribute('title'),/Retraso por avería/);
await incident.click();
await row.getByText('Retraso por avería en carretera',{exact:true}).waitFor();
await load.click();await row.getByText(/2. Carga adicional Toledo/).waitFor();
assert.deepEqual(errors,[]);
console.log('PASS browser: alias and full rig, extra loads/unloads on hover and click, actual incident details');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}}
main().catch(e=>{console.error(e);process.exitCode=1;});

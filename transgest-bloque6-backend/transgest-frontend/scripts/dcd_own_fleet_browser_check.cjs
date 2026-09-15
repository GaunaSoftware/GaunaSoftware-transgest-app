const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const root=path.resolve(__dirname,'../build');
const own={id:'own',numero:'QA-PROPIO',estado:'confirmado',vehiculo_id:'truck',vehiculo_matricula:'1234 ABC',fecha_carga:'2026-09-15',origen:'Madrid',destino:'Valencia'};const external={id:'external',numero:'PED-2026-0397',estado:'confirmado',colaborador_id:'supplier',colaborador_nombre:'Transportes QA',fecha_carga:'2026-09-15',origen:'Madrid',destino:'Valencia'};const today='2026-09-15';let points=[],writes=[];const orders=[{id:'order-a',numero:'QA-A',estado:'pendiente',fecha_carga:today,origen:'Madrid',destino:'Valencia'},{id:'order-b',numero:'QA-B',estado:'pendiente',fecha_carga:today,origen:'Madrid',destino:'Valencia'},{id:'old',numero:'QA-VENCIDO',estado:'en_curso',fecha_carga:'2026-08-10',fecha_descarga:'2026-08-11',origen:'Madrid',destino:'Sevilla'},{id:'future',numero:'QA-EN-RUTA',estado:'en_curso',fecha_carga:today,fecha_descarga:'2026-09-16',origen:'Madrid',destino:'Sevilla'}];
async function main(){const server=http.createServer((req,res)=>{let f=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(f)]||'text/html'));fs.createReadStream(f).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[];
try{browser=await chromium.launch({headless:true,channel:'msedge'});const origin=`http://127.0.0.1:${server.address().port}`;
async function makePage(role){const page=await browser.newPage({viewport:{width:1500,height:1000}}),user={id:'qa',empresa_id:'qa-company',rol:role,nombre:'QA',plan:'enterprise',...(role==='cliente'?{cliente_id:'client'}:{})};page.on('pageerror',e=>errors.push(e.message));await page.clock.setFixedTime(new Date(today+'T10:00:00Z'));await page.addInitScript(u=>{localStorage.setItem('tms_token','qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1');},user);
await page.route('**/api/v1/**',async route=>{const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1',''),body=req.method()==='GET'?null:req.postDataJSON();let data=[];if(body||req.method()==='DELETE')writes.push({p,body,method:req.method()});
if(p==='/auth/me')data=user;else if(p.includes('notificaciones'))data={data:[],no_leidas:0};else if(p==='/pedidos'||p==='/pedidos/resumen-lista')data=[own,external];else if(p==='/pedidos/own')data=own;else if(p.includes('/documento-control-digital'))data={documento:{codigo_control:'QA-DCD'},status:{ready:true,summary:'DCD preparado QA'},pedido:own};else if(p==='/portal-cliente/puntos'){if(body){const point={...body,id:'point-'+points.length};points.push(point);data=point;}else data=points;}else if(p==='/portal-cliente/calcular-ruta')data={km:350,warning:'Estimación QA'};else if(p==='/portal-cliente/solicitudes'&&body)data={id:'request-qa'};else if(p.includes('resumen'))data={};else if(p.includes('empresa'))data={plan:'enterprise'};
await route.fulfill({status:200,json:data});});await page.goto(origin,{waitUntil:'networkidle'});return page;}
const page=await makePage('gerente');
const externalRow=page.locator('.dashboard-live-list button').filter({hasText:'PED-2026-0397'});
await externalRow.getByText('Asignado a Transportes QA',{exact:true}).waitFor();
assert.equal(await externalRow.getByText(/Sin conductor/).count(),0);
await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'pedidos'})));
await page.getByRole('button',{name:'Acciones de QA-PROPIO',exact:true}).click();
await page.getByRole('menuitem',{name:'Documentos',exact:true}).click();
await page.getByRole('button',{name:'Documento de control digital (DCD)',exact:true}).click();
const dialog=page.getByRole('dialog',{name:'Documento de control digital (DCD) · QA-PROPIO'});
await dialog.waitFor();
try { await dialog.getByRole('button',{name:'Generar DeCA',exact:true}).click({timeout:5000}); } catch(e) { console.log('ERRORS',errors,'DIALOG',await dialog.innerText());throw e; }
await page.getByText('DeCA generado y archivado en repositorio.',{exact:true}).waitFor();
assert.ok(writes.some(w=>w.p==='/pedidos/own/documento-control-digital/generar'&&w.method==='POST'));
assert.equal(writes.some(w=>w.p.includes('verificar-orden')),false);
assert.deepEqual(errors,[]);
console.log('PASS browser: collaborator shown as assigned; own-fleet DCD opens and requests generation without supplier-only validation');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}}
main().catch(e=>{console.error(e);process.exitCode=1;});

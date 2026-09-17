const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa','expenses');
const user={id:'qa',empresa_id:'company',rol:'gerente',nombre:'QA',plan:'pro_intelligence',permisos:{}};
const day=new Date().toLocaleDateString('en-CA');
let expenses=[{id:'1',tipo:'gasoil',fecha:day,vehiculo_id:'truck',importe:80,litros:50,estado:'registrado',poblacion:'Madrid',provincia:'Madrid'},{id:'2',tipo:'dieta',fecha:day,vehiculo_id:'truck',importe:20,estado:'registrado',poblacion:'Madrid',provincia:'Madrid'},{id:'3',tipo:'gasoil',fecha:day,vehiculo_id:'truck',en_base:true,estado:'pendiente_base',poblacion:'Madrid',provincia:'Madrid'}];
(async()=>{
 const server=http.createServer((req,res)=>{let f=path.join(root,new URL(req.url,'http://localhost').pathname);if(!fs.existsSync(f)||fs.statSync(f).isDirectory())f=path.join(root,'index.html');res.setHeader('Content-Type',f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html');fs.createReadStream(f).pipe(res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser,page;
 try{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({channel:'msedge',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});let errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(u=>{localStorage.setItem('tms_token','local-qa');localStorage.setItem('tms_user',JSON.stringify(u));localStorage.setItem('tms_onboarding_done:company:gerente:qa','1');},user);
 await page.route('**/api/v1/**',async route=>{const r=route.request(),p=new URL(r.url()).pathname.replace('/api/v1','');let data=[];
 if(p==='/auth/me')data=user;
 else if(p==='/vehiculos')data=[{id:'truck',matricula:'1234-QA',clase:'tractora',chofer_id:'driver'}];
 else if(p==='/choferes')data=[{id:'driver',nombre:'Chofer QA',vehiculo_id:'truck'}];
 else if(p==='/choferes/gastos')data=expenses;
 else if(p==='/choferes/gastos/3/base'){expenses=expenses.map(e=>e.id==='3'?{...e,...r.postDataJSON(),estado:'registrado'}:e);data={id:'3'};}
 else if(p==='/empresa/repostajes/truck')data=[{fecha:day,litros:10,importe:20},{fecha:day,litros:15}];
 else if(p==='/empresa/noches/truck')data=[{fecha:day,importe:10}];
 else if(p.startsWith('/empresa/gasoil-config/'))data={tipo:'fijo',precio_fijo:1.65,periodos:[]};
 else if(p.startsWith('/empresa/chofer-config/'))data={};
 else if(p.startsWith('/taller'))data={stock:[],reparaciones:[]};
 else if(/config|perfil|logo|suscripcion|resumen|puesta-marcha/.test(p))data={};
 await route.fulfill({json:data});});
 await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'hojas_ruta'})));await page.getByRole('button',{name:'Ver hoja',exact:true}).click();
 await page.getByRole('heading',{name:'Tickets y gastos de la app del chófer',exact:true}).waitFor();await page.waitForTimeout(300);
 const row=name=>page.locator('tr').filter({has:page.locator('td').filter({hasText:new RegExp('^'+name+'$')})});
 assert((await row('Gasoil').innerText()).includes('124,75'),'legacy priced/unpriced fuel plus driver receipt');
 assert((await row('Dietas / manutención').innerText()).includes('30,00'),'legacy plus driver diet');
 assert((await row('TOTAL COSTES').innerText()).includes('154,75'));
 await page.getByRole('button',{name:'Completar repostaje en base',exact:true}).click();await page.getByLabel('Litros',{exact:true}).fill('40');await page.getByLabel('Importe (€)',{exact:true}).fill('50');await page.getByRole('button',{name:'Guardar valoración',exact:true}).click();await page.getByRole('button',{name:'Completar repostaje en base',exact:true}).waitFor({state:'hidden'});await page.waitForTimeout(300);assert((await row('TOTAL COSTES').innerText()).includes('204,75'),'base valuation adds once');
 await page.screenshot({path:path.join(out,'route-expenses.png'),fullPage:true});assert.deepEqual(errors,[]);console.log('PASS route-sheet UI: truck/period expense totals, mixed fuel prices, diets and base valuation without duplication');
 }catch(e){if(page){fs.writeFileSync(path.join(out,'failure.txt'),await page.locator('body').innerText());await page.screenshot({path:path.join(out,'failure.png')});}throw e;}finally{await browser?.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

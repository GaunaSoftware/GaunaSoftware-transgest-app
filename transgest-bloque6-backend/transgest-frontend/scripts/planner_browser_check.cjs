const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'../build-planner');
const out = path.join(root,'qa');
const user = {id:'qa',empresa_id:'qa-company',rol:'gerente',plan:'enterprise',nombre:'QA'};
const client={id:'c-qa',nombre:'Destinatario QA'};
const agency={id:'a-qa',nombre:'Agencia QA'};
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser, page;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[], requests=[], writes=[];
    let order=null, blocked=false;
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/v1/**', async route=>{
      const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1',''); requests.push(p);
      let data=[];
      if(p==='/auth/me')data=user;
      else if(p==='/producto')data={producto:'planner'};
      else if(p==='/clientes')data=url.searchParams.get('page')==='1' ? {data:[{id:'first',nombre:'Primera pagina'}],pagination:{hasNext:true}} : {data:[client],pagination:{hasNext:false}};
      else if(p==='/colaboradores')data=[agency];
      else if(p==='/pedidos') {
        if(blocked){await route.fulfill({status:402,contentType:'application/json',body:JSON.stringify({motivo:'suspendido',mensaje:'Cuenta suspendida QA'})});return;}
        if(req.method()==='POST') {const body=req.postDataJSON();writes.push(body);order={...body,id:'p-qa',numero:'PED-QA',colaborador_nombre:agency.nombre};data=order;}
        else {assert.match(url.searchParams.get('desde'),/^\d{4}-\d{2}-01$/);data={data:order?[order]:[],pagination:{hasNext:false}};}
      } else if(p==='/pedidos/p-qa') {
        if(req.method()==='PUT'){const body=req.postDataJSON();writes.push(body);Object.assign(order,body);} data=order;
      } else if(p.includes('empresa'))data={id:user.empresa_id,plan:'enterprise'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.addInitScript(user=>{localStorage.setItem('tms_token','qa-only');localStorage.setItem('tms_user',JSON.stringify(user));},user);
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.getByRole('button',{name:'Nueva carga',exact:true}).click();
    const dialog=page.getByRole('dialog');
    await dialog.getByLabel('Destinatario',{exact:true}).selectOption(client.id);
    await dialog.getByLabel('Agencia de transporte',{exact:true}).selectOption(agency.id);
    await dialog.getByLabel('Referencia',{exact:true}).first().fill('REF-PLANNER');
    for(const [index,town] of ['Burgos','Aspe'].entries()) {
      await dialog.getByLabel('Nombre del punto',{exact:true}).nth(index).fill(index===0?'Skretting':'Fabrica QA');
      await dialog.getByLabel('Población',{exact:true}).nth(index).fill(town);
    }
    await dialog.getByLabel('Tarifa de la agencia',{exact:true}).selectOption('tonelada');
    await dialog.getByLabel('EUR / tonelada',{exact:true}).fill('32,50');
    await page.screenshot({path:path.join(out,'planner-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await dialog.evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    const footer=await dialog.locator('footer').boundingBox();assert.ok(footer.y+footer.height<=844);
    await page.screenshot({path:path.join(out,'planner-mobile.png')});
    await dialog.getByRole('button',{name:'Guardar carga',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    assert.equal(writes.length,1);assert.equal(writes[0].tipo_precio,'viaje');assert.equal(writes[0].tipo_precio_colaborador,'tonelada');
    assert.equal(writes[0].colaborador_id,agency.id);assert.equal(writes[0].puntos_carga[0].ciudad,'Burgos');assert.equal(writes[0].vehiculo_id,undefined);
    await page.getByRole('button',{name:'PED-QA',exact:true}).click();
    await dialog.getByRole('button',{name:'Guardar carga',exact:true}).click();
    await dialog.waitFor({state:'hidden'});assert.equal(writes.length,1,'Sin cambios no debe escribir');
    assert.ok(!requests.some(p=>/^\/(vehiculos|choferes|taller)\b/.test(p)));
    blocked=true;
    await page.locator('input[type="month"]').fill('2027-01');
    await page.getByText('Cuenta suspendida',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Nueva carga',exact:true}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS Planner: create, assign agency, independent tonne rate, unchanged edit, desktop/mobile layout, no fleet calls. Mock API only.');
  } catch(error) {
    if (page) {await page.screenshot({path:path.join(out,'failure.png')});console.error((await page.locator('body').innerText()).slice(-5000));}
    throw error;
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

const fs = require('node:fs'), path = require('node:path'), http = require('node:http'), assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');

async function main() {
  const server = http.createServer((req, res) => {
    let file = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html');
    res.setHeader('Content-Type', ({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)] || 'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({headless:true,channel:'msedge'});
    const origin = `http://127.0.0.1:${server.address().port}`, errors = [];
    async function open(rol, target = '/', extra = {}) {
      const page = await browser.newPage({viewport:{width:1500,height:1000}});
      const user = {id:'qa',empresa_id:'qa-company',rol,nombre:'QA',plan:'enterprise',productos:['transgest','planner'],...extra};
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(u => {
        localStorage.setItem('tms_token','qa'); localStorage.setItem('tms_user',JSON.stringify(u));
        localStorage.setItem(`tms_onboarding_done:${u.empresa_id}:${u.rol}:${u.id}`,'1');
      }, user);
      await page.route('**/api/v1/**', async route => {
        const p = new URL(route.request().url()).pathname.replace('/api/v1','');
        let data = [];
        if (p === '/auth/me') data = user;
        else if (p === '/producto') data = {producto:'tms'};
        else if (p === '/pedidos') data = [{id:'qa-load',numero:'QA-CARGA',estado:'pendiente',fecha_carga:'2026-09-16',origen:'Madrid',destino:'Valencia'}];
        else if (p.includes('notificaciones')) data = {data:[],no_leidas:0};
        else if (p.includes('resumen')) data = {};
        else if (p.includes('empresa')) data = {plan:'enterprise'};
        await route.fulfill({status:200,json:data});
      });
      await page.goto(origin + target, {waitUntil:'networkidle'});
      return page;
    }
    const page = await open('gerente');
    await page.getByRole('link',{name:'Abrir Planner',exact:true}).click();
    await page.waitForURL('**/planner');
    await page.getByRole('heading',{name:'Cargas',exact:true}).waitFor();
    await page.getByText('Trabajas con los datos de tu empresa.',{exact:false}).waitFor();
    await page.getByRole('button',{name:'Nueva carga',exact:true}).click();
    await page.getByRole('dialog',{name:'Nueva carga',exact:true}).waitFor();
    await page.getByRole('button',{name:'Cerrar',exact:true}).last().click();
    const nav = page.getByRole('navigation',{name:'Planner',exact:true});
    await nav.getByRole('button',{name:'Muelles y horarios',exact:true}).click();
    await page.getByRole('heading',{name:'Planificación de cargas y muelles',exact:true}).waitFor();
    await page.getByRole('button',{name:'Nuevo muelle',exact:true}).click();
    await page.getByRole('dialog',{name:'Nuevo muelle',exact:true}).waitFor();
    await page.getByRole('dialog').getByRole('button',{name:'Cerrar',exact:true}).click();
    await nav.getByRole('button',{name:'Almacén y stock',exact:true}).click();
    await page.getByRole('heading',{name:'Gestión de almacén',exact:true}).waitFor();
    await nav.getByRole('button',{name:'Cargas',exact:true}).click();
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('link',{name:'Volver a TransGest',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth > innerWidth),false);
    await page.screenshot({path:path.join(process.env.TEMP || '.', 'planner-access-mobile.png'),fullPage:true});
    await page.getByRole('link',{name:'Volver a TransGest',exact:true}).click();
    await page.waitForURL('**/?workspace=tms');
    assert.equal(await page.getByRole('navigation',{name:'Planner',exact:true}).count(),0);
    // Direct links and refresh use the same authenticated route.
    await page.goto(origin + '/planner/'); await page.reload();
    await page.getByRole('heading',{name:'Cargas',exact:true}).waitFor();
    const viewer = await open('visualizador','/planner');
    await viewer.getByRole('heading',{name:'Cargas',exact:true}).waitFor();
    assert.equal(await viewer.getByRole('button',{name:'Nueva carga',exact:true}).count(),0);
    await viewer.getByRole('button',{name:'Muelles y horarios',exact:true}).click();
    await viewer.getByRole('heading',{name:'Planificación de cargas y muelles',exact:true}).waitFor();
    assert.equal(await viewer.getByRole('button',{name:'Nuevo muelle',exact:true}).count(),0);
    const denied = await open('cliente','/planner');
    await denied.getByRole('heading',{name:'Acceso pendiente',exact:true}).waitFor();
    assert.equal(await denied.getByRole('navigation',{name:'Planner',exact:true}).count(),0);
    const tms=await open('gerente','/',{productos:['transgest']});
    assert.equal(await tms.getByRole('link',{name:'Abrir Planner',exact:true}).count(),0);
    await tms.goto(origin+'/planner');
    await tms.getByRole('heading',{name:'Planner no está habilitado',exact:true}).waitFor();
    const planner=await open('gerente','/',{productos:['planner']});
    await planner.getByRole('heading',{name:'Cargas',exact:true}).waitFor();
    assert.equal(await planner.getByRole('link',{name:'Volver a TransGest',exact:true}).count(),0);
    assert.equal(await planner.getByRole('button',{name:'Gestión de viajes',exact:true}).count(),0);
    assert.equal(await planner.getByRole('button',{name:'Vehículos',exact:true}).count(),0);
    await planner.getByRole('button',{name:'QA-CARGA',exact:true}).waitFor();
    assert.equal(await planner.getByRole('button',{name:'Planificar viaje',exact:true}).count(),0);
    await planner.goto(origin+'/?workspace=tms');
    await planner.getByRole('heading',{name:'Cargas',exact:true}).waitFor();
    // The activation UI persists the selected company, independently of its billing form.
    const sa=await open('gerente');
    await sa.evaluate(()=>sessionStorage.setItem('tms_sa_token','qa-superadmin'));
    let mode='transgest',savedProduct;
    await sa.route('**/api/v1/superadmin/**',async route=>{
      const p=new URL(route.request().url()).pathname;let data=[];
      if(p.endsWith('/empresas')) data=[{id:'qa-company',nombre:'Empresa QA',email_admin:'qa@example.test',plan:'enterprise',estado:'activo'}];
      else if(p.endsWith('/stats'))data={empresas_activas:1};
      else if(p.endsWith('/productos')){
        if(route.request().method()==='PUT'){savedProduct=route.request().postDataJSON();mode=savedProduct.modalidad;}
        data={modalidad:mode};
      }
      await route.fulfill({status:200,json:data});
    });
    await sa.goto(origin+'/superadmin');
    await sa.getByRole('navigation',{name:'Navegacion de superadmin'}).getByRole('button',{name:'Empresas',exact:true}).click();
    await sa.getByRole('button',{name:'Gestionar / Planner',exact:true}).click();
    await sa.getByLabel('Productos habilitados',{exact:true}).selectOption('combinado');
    await sa.getByRole('button',{name:'Guardar productos',exact:true}).click();
    await sa.getByRole('status').filter({hasText:'Configuración guardada'}).waitFor();
    assert.deepEqual(savedProduct,{modalidad:'combinado'});
    await sa.screenshot({path:path.join(process.env.TEMP||'.','planner-company-products.png'),fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('PASS: TMS → Planner → TMS, direct links, refresh, load/dock forms, warehouse, mobile, read-only and external role restrictions. API responses simulated; no production writes.');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode=1; });

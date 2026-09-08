const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../build');
const out = path.join(root, 'qa');

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const server = http.createServer((req,res)=>{
    let file = path.resolve(root, '.'+new URL(req.url,'http://localhost').pathname);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file=path.join(root,'index.html');
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[path.extname(file)] || 'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,page;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[],writes=[];
    page.on('pageerror',e=>errors.push(e.message));
    const empresas=[{id:'empresa-a',nombre:'Empresa QA A',plan:'enterprise',estado:'activa'},{id:'empresa-b',nombre:'Empresa QA B',plan:'enterprise',estado:'activa'}];
    const data={empresas,providers:['here','ors','openai','locatel','movildata'],ai_providers:['openai'],gps_providers:['locatel','movildata'],configs:[],global:{},ai:{provider:'openai'},gps_active:{},gps_webhooks:[],fiscal_configs:[]};
    await page.route('**/api/v1/**',async route=>{
      const req=route.request(),url=new URL(req.url()),p=url.pathname.replace('/api/v1/superadmin','');
      let result={};
      if(req.method()==='PUT') {
        const body=req.postDataJSON(); writes.push({path:p,body});
        const match=p.match(/^\/integraciones\/empresas\/([^/]+)\/([^/]+)$/);
        if(match) {
          const [,empresa_id,provider]=match;
          const old=data.configs.find(c=>c.empresa_id===empresa_id && c.provider===provider);
          data.configs=data.configs.filter(c=>c!==old);
          const config={...old,...body,empresa_id,provider,updated_at:String(writes.length),key_mask:body.api_key?'qa...stored':old?.key_mask};
          delete config.api_key;
          data.configs.push(config);
        }
        if(p.startsWith('/integraciones/global/')) data.global[p.split('/').at(-1)]={global_configured:true,global_source:'global'};
        result={ok:true};
      } else if(p==='/empresas') result=empresas;
      else if(p==='/stats') result={empresas_activas:2,empresas_total:2};
      else if(p==='/integraciones') result=data;
      else if(p==='/integraciones/salud') result={resumen:{score:100},empresas:[],checks:[]};
      else if(p==='/integraciones/contabilidad') result={empresas:[],catalog:[]};
      else if(p.includes('password-reset')) result=[];
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
    });
    await page.addInitScript(()=>{sessionStorage.setItem('tms_sa_token','qa-local-only');localStorage.setItem('transgest_superadmin_theme','dark');});
    await page.goto(`http://127.0.0.1:${server.address().port}/superadmin`,{waitUntil:'networkidle'});
    await page.locator('.sa-nav').getByRole('button',{name:'Integraciones',exact:true}).click();
    const company=page.locator('.sa-scope-notice select');
    // Password inputs have no implicit textbox role.
    const apiKey=page.getByLabel('Clave API de empresa',{exact:true});
    await apiKey.waitFor();
    await apiKey.fill('qa-unsaved-company-a');
    await company.selectOption('empresa-b');
    await page.waitForLoadState('networkidle');
    assert.equal(await apiKey.inputValue(),'');
    await apiKey.fill('qa-private-company-b');
    await page.getByRole('button',{name:'Guardar empresa',exact:true}).click();
    await page.getByPlaceholder('Actual: qa...stored').first().waitFor();
    assert.equal(writes.at(-1).path,'/integraciones/empresas/empresa-b/here');
    assert.equal(writes.at(-1).body.use_global,false);
    assert.equal(data.configs.length,1);
    await page.getByRole('button',{name:'Guardar empresa',exact:true}).click();
    await page.waitForLoadState('networkidle');
    assert.equal(data.configs.length,1);
    assert.equal(data.configs[0].key_mask,'qa...stored');
    await company.selectOption('empresa-a');
    await page.waitForLoadState('networkidle');
    assert.equal(await apiKey.inputValue(),'');
    assert.equal(await apiKey.getAttribute('placeholder'),'Pegar clave de esta empresa');
    await company.selectOption('empresa-b');
    await page.waitForLoadState('networkidle');
    await page.locator('.sa-provider-editors').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'integraciones-dark-desktop.png')});
    await page.getByRole('button',{name:'Activar modo claro'}).click();
    await page.locator('.sa-provider-editors').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'integraciones-light-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.sa-sidebar').getBoundingClientRect().right<=0);
    await apiKey.scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await apiKey.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
    await page.screenshot({path:path.join(out,'integraciones-mobile.png')});
    await page.setViewportSize({width:1440,height:1000});
    await page.getByRole('button',{name:'General',exact:true}).click();
    await page.getByRole('button',{name:'Configurar clave',exact:true}).first().click();
    await page.getByPlaceholder('Pega la API key').fill('qa-general-key');
    await page.getByRole('button',{name:'Guardar',exact:true}).click();
    await page.getByRole('button',{name:'Sustituir clave',exact:true}).first().waitFor();
    assert.ok(data.global.here.global_configured);
    assert.equal(data.configs[0].empresa_id,'empresa-b');
    assert.deepEqual(errors,[]);
    console.log('OK: claves por empresa, cambio de contexto, conservar clave, guardado general, sin duplicados y responsive claro/oscuro.');
  } catch(error) {
    if(page){await page.screenshot({path:path.join(out,'integraciones-failure.png')});console.error((await page.locator('body').innerText()).slice(-5000));}
    throw error;
  } finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

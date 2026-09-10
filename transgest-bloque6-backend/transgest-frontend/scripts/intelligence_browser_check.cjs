const assert = require('assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const {chromium, _electron} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname,'../build');
const out = path.join(root,'qa');
const user = {id:'qa',empresa_id:'qa-company',rol:'gerente',plan:'enterprise',nombre:'QA'};
async function mock(route) {
  const req=route.request(),p=new URL(req.url()).pathname.replace('/api/v1','');
  let data=[];
  if(p==='/auth/me') data=user;
  else if(p==='/ia/intelligence/estado') data={configured:true,source:'company',model:'gpt-5-mini'};
  else if(p==='/ia/intelligence/chat') {
    assert.equal(req.postDataJSON().messages.at(-1).role,'user');
    data={answer:'Un pedido pendiente en septiembre. PED-QA.',sources:[{name:'Pedidos',filters:{desde:'2026-09-01',hasta:'2026-09-30'},limited:false}],checked_at:new Date().toISOString()};
  } else if(p.includes('empresa') || p.includes('config')) data={id:user.empresa_id,nombre:'QA',plan:'enterprise',cfg_alertas:[]};
  else if(p.includes('notificaciones')) data={data:[],no_leidas:0,items:[],resumen:{}};
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
}
async function init(page) {
  await page.addInitScript(user=>{
    localStorage.setItem('tms_token','qa-only');localStorage.setItem('tms_user',JSON.stringify(user));
    localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');
  },user);
}
async function main() {
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,'index.html');
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml'}[path.extname(file)]||'text/html'));
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser,desktop;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true});
    const page=await browser.newPage({viewport:{width:1440,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/v1/**',mock);await init(page);
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'ia'})));
    await page.getByRole('heading',{name:'TransGest Intelligence',exact:true}).waitFor();
    await page.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
    await page.getByLabel('Consulta',{exact:true}).fill('Que pedidos pendientes hay en septiembre?');
    await page.getByRole('button',{name:'Consultar',exact:true}).click();
    await page.getByText('Un pedido pendiente en septiembre. PED-QA.',{exact:true}).waitFor();
    await page.getByText('Fuentes consultadas (1)',{exact:true}).click();
    await page.screenshot({path:path.join(out,'intelligence-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.locator('.intelligence').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
    await page.screenshot({path:path.join(out,'intelligence-mobile.png')});
    assert.deepEqual(errors,[]);
    const exe=process.env.TRANSGEST_TEST_EXE;
    desktop=await _electron.launch({executablePath:exe || require('electron'),args:[...(exe ? [] : [path.resolve(__dirname,'../electron/main.js')]),'--user-data-dir='+path.join(out,'electron-profile')],env:{...process.env,TRANSGEST_DESKTOP_TEST:'1'},timeout:60000});
    const win=await desktop.firstWindow();
    await win.route('**/api/v1/**',mock);await init(win);await win.reload({waitUntil:'networkidle'});
    assert.equal(new URL(win.url()).protocol,'transgest:');
    assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences().webSecurity),true);
    assert.equal(await win.evaluate(()=>typeof window.require),'undefined');
    await win.evaluate(()=>window.dispatchEvent(new CustomEvent('tms:navegar',{detail:'ia'})));
    await win.getByRole('heading',{name:'TransGest Intelligence',exact:true}).waitFor();
    await win.locator('[style*="tgSplashLogo"]').waitFor({state:'hidden'});
    await win.screenshot({path:path.join(out,'intelligence-exe.png')});
    console.log('PASS: chatbot responsive, fuentes y Electron con aislamiento y webSecurity. API simulada, sin gasto OpenAI.');
  } finally {if(desktop)await desktop.close();if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

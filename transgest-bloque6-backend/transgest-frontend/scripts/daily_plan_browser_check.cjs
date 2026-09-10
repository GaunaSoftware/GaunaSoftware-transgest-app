const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'../build'),out=path.join(root,'qa');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    let file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory())file=path.join(root,'index.html');
    res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)] || 'text/html'));fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser,page;
  try{
    browser=await chromium.launch({headless:true,channel:'msedge'});
    page=await browser.newPage({viewport:{width:1920,height:1100}});
    const user={id:'11111111-1111-4111-8111-111111111111',empresa_id:'22222222-2222-4222-8222-222222222222',rol:'gerente',nombre:'QA',plan:'enterprise'};
    const a={id:'a',numero:'PED-PLAN-A',origen:'Burgos',destino:'Valencia',ruta:'Burgos -> Valencia',estado:'confirmado',chofer_id:'driver',puntos_descarga:[{id:'s1',nombre:'Obra primera'},{id:'s2',nombre:'Obra segunda'}]};
    const b={id:'b',numero:'PED-PLAN-B',origen:'Alicante',destino:'Madrid',ruta:'Alicante -> Madrid',estado:'confirmado'};
    const rows=[{id:'33333333-3333-4333-8333-333333333333',clase:'tractora',matricula:'1234-ABC',chofer_id:'driver',chofer_nombre:'Conductor QA',pedidos:[a],avisos:[],descarga_orden:[]},{id:'workshop',clase:'tractora',matricula:'9999-XYZ',estado:'taller',pedidos:[],avisos:[{severity:'danger',title:'Vehículo en taller',label:'No disponible'}]}];
    let unassigned=[b],sent=0,assignment,sequence;
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/api/v1/**',async route=>{
      const p=new URL(route.request().url()).pathname.replace('/api/v1',''),method=route.request().method();let data=[];
      if(p==='/auth/me')data=user;
      else if(p==='/rutas')data=[{id:'rate',cliente_id:'client',cliente_nombre:'Cliente QA',activo:true,origen:'Burgos',destino:'Alicante',km:500,tarifa_tipo:'tonelada',precio_base:30,tipo_vehiculo:'cualquiera'}];
      else if(p==='/clientes')data=[{id:'client',nombre:'Cliente QA',activo:true}];
      else if(p==='/plan-diario')data={rows,unassigned,resumen:{}};
      else if(p==='/pedidos/b' && method==='PUT'){assignment=route.request().postDataJSON();Object.assign(b,assignment);rows[0].pedidos.push(b);unassigned=[];data=b;}
      else if(p==='/plan-diario/orden'){const body=route.request().postDataJSON();if(body.descarga_orden){sequence=body.descarga_orden;rows[0].descarga_orden=sequence;}data=body;}
      else if(p==='/plan-diario/enviar'){sent++;data={ok:true,pedidos:2,descargas:3};}
      else if(p.includes('notificaciones'))data={data:[],no_leidas:0,items:[],resumen:{}};
      else if(p.includes('empresa') || p.includes('config'))data={id:user.empresa_id,nombre:'QA',plan:'enterprise',estado:'activa'};
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    await page.addInitScript(user=>{localStorage.setItem('tms_token','qa-local-only');localStorage.setItem('tms_user',JSON.stringify(user));localStorage.setItem(`tms_onboarding_done:${user.empresa_id}:${user.rol}:${user.id}`,'1');},user);
    await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'networkidle'});
    await page.getByText('Mesa de trafico',{exact:true}).click();
    await page.getByRole('button',{name:'Plan diario',exact:true}).click();
    const target=page.getByRole('button',{name:/PED-PLAN-A/});await target.waitFor({timeout:30000});
    const dt=await page.evaluateHandle(()=>{const dt=new DataTransfer();dt.setData('pedido_id','b');dt.setData('from_vehiculo_id','');return dt;});
    await target.dispatchEvent('drop',{dataTransfer:dt});
    await page.getByRole('button',{name:'Subir descarga 3',exact:true}).waitFor();
    assert.equal(assignment.vehiculo_id,rows[0].id);assert.equal(assignment.fecha_carga,undefined);assert.equal(assignment.precio,undefined);
    await page.getByRole('button',{name:'Subir descarga 3',exact:true}).click();
    await page.waitForResponse(r=>r.url().includes('/plan-diario') && r.request().method()==='GET');
    assert.deepEqual(sequence,['a:s1','b:0','a:s2']);
    await page.getByRole('button',{name:'Enviar al chófer',exact:true}).first().click();
    await page.getByRole('button',{name:'Aviso en la app del chofer',exact:true}).click();
    await page.getByText('Plan completo enviado: 2 pedidos y 3 descargas.',{exact:true}).waitFor();assert.equal(sent,1);
    const workshop=page.locator('tr').filter({hasText:'9999-XYZ'});assert.equal(await workshop.getByText('Sin trabajo planificado').count(),0);
    await page.locator('div[style*="z-index: 9999"]').waitFor({state:'hidden'});
    await page.screenshot({path:path.join(out,'plan-diario-desktop.png')});
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.tg-sidebar').getBoundingClientRect().right<=0);
    await page.getByRole('button',{name:'Subir descarga 3',exact:true}).scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'plan-diario-mobile.png')});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),true,'page overflow');
    await page.setViewportSize({width:1440,height:1000});
    await page.getByText('Rutas y tarifas',{exact:true}).click();
    await page.getByText('Base: 24,00 t',{exact:true}).waitFor();
    await page.getByText('Margen est. 1,02',{exact:true}).waitFor();
    const badge=page.locator('td span').filter({hasText:'Cualquier vehículo'}).first();
    assert.equal(await badge.evaluate(el=>{const r=el.getBoundingClientRect(),p=el.closest('td').getBoundingClientRect();return r.right<=p.right+1 && r.bottom<=p.bottom+1 && getComputedStyle(el).display==='inline-block';}),true);
    await page.screenshot({path:path.join(out,'rutas-margen-desktop.png')});
    assert.deepEqual(errors,[]);console.log('PASS daily plan browser: multiple assignment, delivery order, full send, workshop and mobile.');
  }catch(e){if(page)await page.screenshot({path:path.join(out,'plan-diario-error.png')}).catch(()=>{});throw e;}
  finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

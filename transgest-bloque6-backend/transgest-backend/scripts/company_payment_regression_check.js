const assert = require('node:assert/strict');
function test(name, fn) { fn(); console.log('PASS',name); }
const expect = value => ({toBe: other => assert.equal(value,other),toContain: other => assert.ok(value.includes(other)),toMatch: other => assert.match(value,other),toBeNull:()=>assert.equal(value,null)});
const {formatCompanyPaymentTerms:format,calculateCompanyPaymentDate:due,validateCompanyPaymentSettings:validate} = require('../src/services/companyPayment');
test('editable instruments and custom order conditions are independent of the term',()=>{
 expect(format({medio_pago_clientes:'Pagaré',plazo_pago_clientes:45})).toContain('Pagaré · 45 días');
 expect(format({medio_pago_colaboradores:'Transferencia SEPA',plazo_pago_colaboradores:0},'colaboradores')).toContain('Transferencia SEPA · 0 días');
 expect(format({texto_pago_colaboradores:'Pagaré a 30 días'},'colaboradores')).toBe('Pagaré a 30 días');
 expect(format({})).toContain('30 días');
});
test('payment schedules respect zero days, month length, UTC dates and the 60-day ceiling',()=>{
 expect(due('2026-03-05',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'15'})).toBe('2026-05-04');
 expect(due('2026-01-15',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'31'})).toBe('2026-02-28');
 expect(due('2026-09-17',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'transferencia_inmediata'})).toBe('2026-09-17');
 expect(due('2026-09-17',{plazo_pago_colaboradores:0})).toBe('2026-09-17');
 expect(due('2026-03-05',{plazo_pago_colaboradores:60,forma_pago_colaboradores:'fin_mes'})).toBe('2026-05-04');
 expect(due('2026-03-05',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'dias_fijos',dias_pago_colaboradores:'15,30'})).toBe('2026-04-15');
 expect(due('2026-03-05',{plazo_pago_colaboradores:30,forma_pago_colaboradores:'recepcion_factura',dias_pago_colaboradores:'15'})).toBe('2026-04-04');
 expect(due('2026-02-31',{})).toBeNull();
});
test('server-side settings validation rejects excessive or malformed terms',()=>{
 for(const n of [61,-1,1.5,'abc',Infinity]) expect(validate({plazo_pago_clientes:n})).toMatch(/0 y 60/);
 expect(validate({plazo_pago_clientes:0,plazo_pago_colaboradores:60})).toBe('');
 expect(validate({dias_pago_colaboradores:'32'})).toMatch(/1 al 31/);
 expect(validate({texto_pago_colaboradores:'Pagaré 90 días'})).toMatch(/superior a 60/);
});

const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
assert.equal(fs.readFileSync(path.join(__dirname,'../src/services/companyPayment.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../../transgest-frontend/src/utils/companyPayment.js'),'utf8'),'frontend/backend payment calculation parity');
async function persistence() {
 const {PGlite}=require('@electric-sql/pglite'); const db=new PGlite();
 try {
  await db.exec("CREATE TABLE empresas(id text primary key,plan text,cfg_precios jsonb); INSERT INTO empresas VALUES ('a','profesional','{\"other_setting\":true}'),('b','profesional','{}');");
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/datos_empresa.js'),'utf8');
  const routes={};const router={put:(p,...handlers)=>{routes[p]=handlers;},get:()=>{}};
  const ctx={db,router,SOLO_GERENTE:(req,res,next)=>req.user.rol==='gerente'?next():res.status(403).json({error:'denied'}),EID:req=>req.empresaId,validateCompanyPaymentSettings:validate,normalizeEmpresaPalette:value=>value,EMPRESA_PROFILE_DEFAULTS:{plazo_pago_colaboradores:30,plazo_pago_clientes:30}};
  const norm=source.slice(source.indexOf('function normalizeEmpresaProfile('),source.indexOf('function normalizeEmpresaPalette('));
  const route=source.slice(source.indexOf('router.put("/perfil"'),source.indexOf('router.get("/fiscal-config"'));
  vm.runInNewContext(norm+'\n'+route,ctx);
  const invoke=async(body,rol='gerente')=>{const res={code:200,status(n){this.code=n;return this;},json(v){this.value=v;return this;}};const req={empresaId:'a',user:{rol},body};let allowed=false;routes['/perfil'][0](req,res,()=>{allowed=true;});if(allowed)await routes['/perfil'][1](req,res);return res;};
  assert.equal((await invoke({medio_pago_colaboradores:'Pagaré',plazo_pago_colaboradores:45,plazo_pago_clientes:0})).code,200);
  let rows=(await db.query('SELECT * FROM empresas ORDER BY id')).rows;
  assert.equal(rows[0].cfg_precios.empresa_perfil.medio_pago_colaboradores,'Pagaré');assert.equal(rows[0].cfg_precios.empresa_perfil.plazo_pago_clientes,0);assert.equal(rows[0].cfg_precios.other_setting,true);assert.deepEqual(rows[1].cfg_precios,{});
  assert.equal((await invoke({plazo_pago_colaboradores:90})).code,400);
  assert.equal((await invoke({plazo_pago_colaboradores:15},'trafico')).code,403);
  assert.equal((await db.query("SELECT cfg_precios FROM empresas WHERE id='a'")).rows[0].cfg_precios.empresa_perfil.plazo_pago_colaboradores,45);
  console.log('PASS: company payment persistence, tenant isolation, permissions, invalid updates preserve saved settings');
 } finally {await db.close();}
}
persistence().catch(e=>{console.error(e);process.exitCode=1;});

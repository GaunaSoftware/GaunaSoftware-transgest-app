const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const { PGlite } = require('@electric-sql/pglite');
const { supportUser } = require('../src/services/supportSession');

async function main() {
  const calls = [];
  const company = {id:'company-a',nombre:'Empresa QA',plan:'lite'};
  const sandbox = {module:{exports:{}}, console, Date, Set, require(name) {
    if (name === 'jsonwebtoken') return jwt;
    if (name === 'crypto') return require('crypto');
    if (name.endsWith('/jwtSecrets')) return {userJwtSecret:()=> 'qa-secret-for-tests-only'};
    if (name.endsWith('/db')) return {query:async(sql,args)=>{calls.push({sql,args});return {rows:[company]};}};
    if (name.endsWith('/logger')) return {warn(){},info(){},error(){}};
    if (name.endsWith('/supportSession')) return {supportUser};
    if (name.endsWith('/empresaApiKeys')) return {};
    if (name.endsWith('/companyProducts')) return {get:async()=>({productos:['transgest','planner']}),moduleAvailable:require('../src/services/companyProducts').moduleAvailable};
    throw Error(name);
  }};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/middleware/auth.js'),'utf8'),sandbox);
  const auth = sandbox.module.exports;
  const token = jwt.sign({sub:'admin-id',empresa_id:company.id,superadmin_impersonation:true,impersonado_por:'admin@qa.test'},'qa-secret-for-tests-only',{expiresIn:'2h'});
  const req = {headers:{authorization:'Bearer '+token},originalUrl:'/api/v1/usuarios',method:'PATCH',path:'/user-a'};
  let allowed = false;
  const res = {status(n){this.code=n;return this;},json(data){this.data=data;return this;}};
  await auth.authenticate(req,res,()=>{allowed=true;});
  assert.equal(allowed,true,JSON.stringify(res));
  assert.equal(req.user.id,null);
  assert.equal(req.user.perfil,'superadmin');
  assert.equal(req.empresaId,company.id);
  assert.equal(calls.filter(c=>c.sql.startsWith('SELECT')).length,1);
  assert.equal(calls.some(c=>/^\s*(INSERT|UPDATE|DELETE)/i.test(c.sql)),false);
  assert.ok(calls.at(-1).sql.startsWith('SELECT'));
  allowed=false;auth.SOLO_GERENTE(req,res,()=>{allowed=true;});assert.equal(allowed,true);
  allowed=false;auth.requireModulePermission('usuarios')(req,res,()=>{allowed=true;});assert.equal(allowed,true);
  // An unsigned impersonation claim is never sufficient.
  allowed=false;await auth.authenticate({...req,user:undefined,headers:{authorization:'Bearer '+token+'bad'}},res,()=>{allowed=true;});assert.equal(allowed,false);

  const ui=fs.readFileSync(path.join(__dirname,'../../transgest-frontend/src/pages/Usuarios.js'),'utf8');
  const normalizer=ui.slice(ui.indexOf('function normalizarPermisosUI('),ui.indexOf('function normalizarTraficoConfigUI('));
  const ctx={MODULOS_PERM:[{id:'usuarios'}],IA_ALLOWED_ROLES:new Set(['gerente']),presetRol:()=>({modulos:{usuarios:{ver:true,editar:true}}})};
  vm.runInNewContext(normalizer,ctx);
  assert.equal(ctx.normalizarPermisosUI({},'gerente').modulos.usuarios.editar,true);
  assert.equal(ctx.normalizarPermisosUI({modulos:{usuarios:{ver:false,editar:false}}},'gerente').modulos.usuarios.editar,false);
  assert.ok(ui.includes('delete body.permisos;'));

  const pg=new PGlite();
  try {
    await pg.exec('CREATE TABLE usuarios(email text,rol text,permisos jsonb)');
    const denied={modulos:{usuarios:{ver:false,editar:false}}};
    for (const email of ['gerente@empresa.com','otro@empresa.com']) await pg.query('INSERT INTO usuarios VALUES ($1,$2,$3)',[email,'gerente',denied]);
    await pg.exec(fs.readFileSync(path.join(__dirname,'migrations/017_reparar_permisos_gerente.sql'),'utf8'));
    const {rows}=await pg.query('SELECT * FROM usuarios ORDER BY email');
    assert.deepEqual(rows[0].permisos,{});
    assert.deepEqual(rows[1].permisos,denied);
  } finally {await pg.close();}
  console.log('PASS support session: signed, tenant scoped, full user management, no stored user; rename preserves permissions; targeted manager recovery');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

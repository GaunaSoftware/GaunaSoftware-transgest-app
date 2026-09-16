const assert=require('node:assert/strict');
const {createStore,moduleAvailable}=require('../src/services/companyProducts');

async function main(){
  const companies=new Set(['a','b']), modes=new Map();let schemaCalls=0;
  const store=createStore({query:async(sql,params)=>{
    if(sql.startsWith('CREATE')){schemaCalls++;assert.match(sql,/ON DELETE CASCADE/);return {rows:[]};}
    if(sql.startsWith('SELECT modalidad'))return {rows:modes.has(params[0])?[{modalidad:modes.get(params[0])}]:[]};
    assert.match(sql,/SELECT id,\$2 FROM empresas WHERE id=\$1/);
    if(!companies.has(params[0]))return {rows:[]};
    modes.set(params[0],params[1]);return {rows:[{modalidad:params[1]}]};
  }});
  const prior=process.env.TRANSGEST_PRODUCT;process.env.TRANSGEST_PRODUCT='tms';
  try{
    assert.deepEqual((await store.get('a')).productos,['transgest']);
    await store.set('a','planner');
    assert.deepEqual((await store.get('a')).productos,['planner']);
    assert.deepEqual((await store.get('b')).productos,['transgest']);
    await store.set('a','combinado');
    assert.deepEqual((await store.get('a')).productos,['transgest','planner']);
    await store.set('a','transgest');
    assert.equal(moduleAvailable((await store.get('a')).productos,'planner'),false);
    await assert.rejects(store.set('a','invalid'),{status:400});
    await assert.rejects(store.set('a','__proto__'),{status:400});
    await assert.rejects(store.set('missing','planner'),{status:404});
    assert.equal(schemaCalls,1);
    process.env.TRANSGEST_PRODUCT='planner';
    assert.deepEqual((await store.get('b')).productos,['planner']);
    assert.deepEqual((await store.get('a')).productos,['transgest']);
  }finally{if(prior===undefined)delete process.env.TRANSGEST_PRODUCT;else process.env.TRANSGEST_PRODUCT=prior;}
  for(const module of ['pedidos','clientes','colaboradores','palets','documentos','empresa'])assert.equal(moduleAvailable(['planner'],module),true,module);
  for(const module of ['vehiculos','choferes','gestion_trafico','facturacion','nominas','taller','ia'])assert.equal(moduleAvailable(['planner'],module),false,module);
  assert.equal(moduleAvailable(['transgest','planner'],'planner'),true);
  const {requireModulePermission}=require('../src/middleware/auth');
  function allowed(productos,modulo,rol='gerente',method='GET'){
    let pass=false,code;requireModulePermission(modulo)({user:{productos,rol,plan:'enterprise'},method,path:'/'},{status(c){code=c;return this;},json(){return this;}},()=>{pass=true;});return {pass,code};
  }
  assert.deepEqual(allowed(['planner'],'facturacion'),{pass:false,code:403});
  assert.equal(allowed(['planner'],'pedidos').pass,true);
  assert.equal(allowed(['transgest','planner'],'facturacion').pass,true);
  assert.deepEqual(allowed(['planner'],'pedidos','visualizador','POST'),{pass:false,code:403});
  console.log('PASS: company-scoped product persistence, defaults, activation/revocation, validation and backend product/role permissions. DB simulated.');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

const assert=require('node:assert/strict');
const {requireModulePermission}=require('../src/middleware/auth');
function check(rol,modulo,method,path,permisos) {
  let allowed=false,code;
  requireModulePermission(modulo)({user:{rol,plan:'enterprise',permisos},method,path},{status(value){code=value;return this;},json(){return this;}},()=>{allowed=true;});
  return {allowed,code};
}
for(const rol of ['gerente','trafico','administrativo','contable']) assert.equal(check(rol,'documentos','POST','/pedido/chofer-docs').allowed,true,rol);
for(const rol of ['cliente','cliente_portal','visualizador','chofer']) assert.equal(check(rol,'documentos','POST','/pedido/chofer-docs').allowed,false,rol);
assert.equal(check('chofer','pedidos','POST','/pedido/chofer-docs').allowed,true);
assert.equal(check('chofer','pedidos','DELETE','/pedido/chofer-docs').allowed,false);
assert.equal(check('chofer','pedidos','PUT','/pedido').allowed,false);
assert.equal(check('chofer','pedidos','POST','/pedido/chofer-docs',{modulos:{app_chofer:{ver:true,editar:false}}}).allowed,false);
assert.equal(check('administrativo','pedidos','PUT','/pedido').allowed,true);
assert.equal(check('contable','pedidos','PUT','/pedido').allowed,false);
assert.equal(check('visualizador','plan_diario','PUT','/orden').allowed,false);
assert.equal(check('trafico','plan_diario','PUT','/orden').allowed,true);
assert.equal(check('cliente','empresa','POST','/claves').allowed,false);
console.log('PASS operational permission matrix: office document uploads, driver scoped workflow, explicit revocations, no client/reader writes.');

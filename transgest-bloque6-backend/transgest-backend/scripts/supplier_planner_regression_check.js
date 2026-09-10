const assert = require('node:assert/strict');
const { supplierTonneAgreement, applySupplierPricing } = require('../src/services/supplierPricing');
const { assertSupplierOrder } = require('../src/services/supplierOrder');
const { plannerPolicy } = require('../src/services/plannerPolicy');
async function main() {
  const order = {tipo_precio:'viaje',cantidad:1,tipo_precio_colaborador:'tonelada',precio_colaborador_unitario:'30,5',peso_kg:24000,minimo_colaborador_unidades:25};
  const { renderColaboradorPedidoBox } = require('../src/routes/pedidos')._test;
  const html = renderColaboradorPedidoBox({...order, precio_colaborador:98765}, {mostrarPrecio:true});
  assert.match(html,/30,50 EUR\/tn/); assert.doesNotMatch(html,/98.765|98765|Precio cerrado/);
  const noQuantity = renderColaboradorPedidoBox({...order, peso_kg:0, minimo_colaborador_unidades:0, precio_colaborador:98765}, {mostrarPrecio:true});
  assert.match(noQuantity,/30,50 EUR\/tn/); assert.doesNotMatch(noQuantity,/98765/);
  assert.deepEqual(supplierTonneAgreement(order),{precioTonelada:30.5,minimoToneladas:25,toneladasFacturables:25});
  const patch = {peso_kg:26000};
  assert.equal(applySupplierPricing(patch,patch,order),true);
  assert.equal(patch.precio_colaborador,793);
  const assignment = {colaborador_id:'new'};
  assert.equal(applySupplierPricing(assignment,assignment,order),false);
  assert.equal(assignment.precio_colaborador,undefined);
  const zero = {peso_kg:0,minimo_colaborador_unidades:0};
  applySupplierPricing(zero,{...zero},order); assert.equal(zero.precio_colaborador,0);
  assert.throws(()=>applySupplierPricing({}, {tipo_precio_colaborador:'invalid'}), /no valido/);
  await assert.rejects(assertSupplierOrder({}, {colaborador_id:'a',vehiculo_id:'own'},'company'), /solo esta disponible/);
  const db = {query:async(sql,params)=>{assert.deepEqual(params,['company','1234ABC']);return {rows:[{id:'own'}]};}};
  await assert.rejects(assertSupplierOrder(db,{colaborador_id:'a',matricula_colaborador:'1234 ABC'},'company'),/flota propia/);
  await assertSupplierOrder({query:async()=>({rows:[]})},{colaborador_id:'a',matricula_colaborador:'9999AAA'},'company');
  const prior = process.env.TRANSGEST_PRODUCT;
  try {
    process.env.TRANSGEST_PRODUCT='planner';
    const response={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    let passes=0;
    plannerPolicy({path:'/api/v1/pedidos/id',method:'PUT',body:{vehiculo_id:'own'}},response,()=>passes++);
    assert.equal(response.code,400); assert.equal(passes,0);
    plannerPolicy({path:'/api/v1/taller',method:'GET'},response,()=>passes++); assert.equal(response.code,403);
    plannerPolicy({path:'/api/v1/pedidos/id',method:'PUT',body:{colaborador_id:'agency'}},response,()=>passes++); assert.equal(passes,1);
    process.env.TRANSGEST_PRODUCT='tms';
    plannerPolicy({path:'/api/v1/taller',method:'GET'},response,()=>passes++); assert.equal(passes,2);
  } finally { if(prior===undefined)delete process.env.TRANSGEST_PRODUCT;else process.env.TRANSGEST_PRODUCT=prior; }
  console.log('PASS supplier independent rates, zero quantities, partial updates, own fleet guard and Planner policy');
}
main().catch(err=>{console.error(err);process.exitCode=1;});

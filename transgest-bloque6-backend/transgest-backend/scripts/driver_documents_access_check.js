const assert=require('node:assert/strict');
const db=require('../src/services/db');
const router=require('../src/routes/pedidos');
async function main(){
  const original=db.query;
  let order={id:'order',chofer_id:null,chofer2_id:null,vehiculo_id:'vehicle'};
  db.query=async(sql,params)=>{
    if(sql.includes('FROM pedidos WHERE')){assert.match(sql,/vehiculo_id/);assert.deepEqual(params,['order','tenant']);return {rows:order?[order]:[]};}
    if(sql.includes('FROM choferes')){assert.equal(params[0],'tenant');assert.doesNotMatch(sql,/LOWER\(TRIM\(nombre/);return {rows:[{id:'driver',vehiculo_id:'vehicle'}]};}
    if(sql.includes('FROM pedido_chofer_pasos'))return {rows:[{data:{carga_iniciada:true}}]};
    if(sql.includes('FROM pedido_docs')){assert.deepEqual(params,['order','tenant']);assert.match(sql,/visible_chofer=true/);return {rows:[{id:'doc'}]};}
    if(/^(CREATE|ALTER)/.test(sql.trim()))return {rows:[]};
    throw Error('Unexpected SQL: '+sql);
  };
  async function request(method,path="/:id/chofer-docs"){
    const handler=router.stack.find(s=>s.route?.path===path && s.route.methods[method]).route.stack[0].handle;
    const res={code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({params:{id:'order'},body:{},user:{rol:'chofer',id:'user',chofer_id:'driver',empresa_id:'tenant'}},res);return res;
  }
  try{
    assert.equal((await request('get')).code,200);
    assert.equal((await request('get','/:id/chofer-pasos')).code,200);
    assert.equal((await request('post')).code,400,'vehicle-linked driver reaches upload validation');
    order.chofer_id='someone-else';assert.equal((await request('get','/:id/chofer-pasos')).code,403);assert.equal((await request('get')).code,403);assert.equal((await request('post')).code,403);
    order.chofer_id='driver';assert.equal((await request('get')).code,200);
    order=null;assert.equal((await request('get')).code,404);assert.equal((await request('post')).code,404);
    console.log('PASS driver document ownership: explicit driver or unassigned vehicle, no other driver/tenant access.');
  }finally{db.query=original;}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

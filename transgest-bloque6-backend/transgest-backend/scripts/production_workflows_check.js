const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {estimateFuelCost,fillMissingFuelCost}=require('../src/services/orderFuelCost');
const {missingBillingData}=require('../src/services/billingData');
function loadRoute(file,db,extras={}){
 const routes={},uses=[];const router={use(...h){uses.push(...h);}};
 for(const verb of ['get','post','put','patch','delete'])router[verb]=(p,...h)=>routes[`${verb} ${p}`]=h.at(-1);
 const sandbox={module:{exports:{}},process,console,Date,require(name){if(name==='express')return{Router:()=>router};if(name.includes('/db'))return db;if(name.includes('/supportSchema'))return {ensureSupportSchema:async()=>{}};if(name.includes('/auth'))return{requireRole:()=>()=>{}};if((name==='./planner_inventory'||name==='./planner_vehicles'))return {};if(name.includes('/plannerBooking'))return require('../src/services/plannerBooking');if(name==='crypto')return require('node:crypto');if(extras[name])return extras[name];throw Error(name);}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/routes',file),'utf8'),sandbox);
 return {routes,uses,exported:sandbox.module.exports};
}
const response=()=>({code:200,status(n){this.code=n;return this;},json(value){this.value=value;return this;}});
const id='11111111-1111-4111-8111-111111111111';
async function main(){
 assert.equal(estimateFuelCost({km_ruta:100,peso_kg:24000},{combustible:{precio_litro:2}}),54);
 assert.equal(estimateFuelCost({km_ruta:100,colaborador_id:'external'}),null);
 const manual={coste_gasoil:0,km_ruta:100};await fillMissingFuelCost({query(){throw Error('manual must not query');}},manual,{},'company');assert.equal(manual.coste_gasoil,0);
 const fresh={km_ruta:100,peso_kg:24000};await fillMissingFuelCost({query:async()=>({rows:[{cfg_precios:{combustible:{precio_fijo:2}}}]})},fresh,{},'company');assert.equal(fresh.coste_gasoil,54);
 assert.deepEqual(missingBillingData({nombre:'Cliente'}),['NIF/CIF','dirección fiscal','código postal','población']);
 let calls=[],answer=[];const db={query:async(sql,args)=>{calls.push({sql,args});return{rows:answer};},transaction:async fn=>fn(db)};
 const support=loadRoute('soporte.js',db);support.exported.createSupportRouter();
 const req={user:{id:'user',nombre:'Usuario'},empresaId:'company',params:{id},body:{mensaje:'Consulta'},query:{}};
 let res=response();await support.routes['get /:id'](req,res,e=>{throw e;});assert.equal(res.code,404);assert.equal(calls.length,1);assert.ok(calls[0].sql.includes('s.empresa_id=$2 AND s.usuario_id=$3'));assert.deepEqual(Array.from(calls[0].args),[id,'company','user']);
 calls=[];res=response();await support.routes['post /:id/mensajes'](req,res,e=>{throw e;});assert.equal(res.code,404);assert.equal(calls.length,1);assert.ok(calls[0].sql.includes('FOR UPDATE'));
 const admin=loadRoute('soporte.js',db);admin.exported.createSupportRouter(true);calls=[];answer=[{id}];res=response();await admin.routes['post /:id/mensajes']({...req,superadmin:{id:'admin'}},res,e=>{throw e;});assert.equal(res.code,200);assert.ok(calls.some(c=>c.args?.includes(true)));assert.equal(calls.at(-1).args[0],'respondida');
 let overlap=true;calls=[];const slotDb={transaction:async fn=>fn(slotDb),query:async(sql,args)=>{calls.push({sql,args});return{rows:sql.startsWith('SELECT * FROM planner_muelles')?[{id,activo:true,dias:[1,2,3,4,5],capacidad:33,margen_min:15,zona_horaria:'Europe/Madrid',horario_inicio:'06:00',horario_fin:'18:00'}]:sql.includes('AS abre')?[{abre:true,cierra:true,mismo_dia:true,dia:2}]:sql.startsWith('SELECT id FROM planner_reservas')?(overlap?[{id}]:[]):[{id}]};}};
 const planner=loadRoute('planner.js',slotDb);const slot={...req,body:{muelle_id:id,tipo:'carga',inicio:'2026-09-15T08:00:00Z',fin:'2026-09-15T09:00:00Z'}};
 res=response();await planner.routes['post /reservas'](slot,res,e=>{throw e;});assert.equal(res.code,409);assert.ok(calls[0].sql.includes('FOR UPDATE'));assert.ok(!calls.some(c=>c.sql.startsWith('INSERT')));
 overlap=false;calls=[];res=response();await planner.routes['post /reservas'](slot,res,e=>{throw e;});assert.equal(res.code,201);assert.ok(calls.some(c=>c.sql.startsWith('INSERT')));
 const supplier=loadRoute('supplier_app.js',db);calls=[];answer=[];res=response();await supplier.routes['post /pedidos/:id/acceso']({...req,user:{id:'driver',rol:'chofer',colaborador_id:'supplier'}},res,e=>{throw e;});assert.equal(res.code,404);assert.equal(calls.length,1);assert.deepEqual(Array.from(calls[0].args),[id,'company','supplier','driver']);
 calls=[];res=response();await supplier.routes['get /pedidos']({...req,user:{id:'driver',rol:'chofer',colaborador_id:'supplier'}},res,e=>{throw e;});assert.ok(!calls[0].sql.includes('importe'));assert.ok(calls[0].sql.includes('conductor_proveedor_usuario_id=$3'));
 console.log('PASS fuel estimates/manual preservation, billing reasons, support privacy/replies, dock conflicts and supplier isolation');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

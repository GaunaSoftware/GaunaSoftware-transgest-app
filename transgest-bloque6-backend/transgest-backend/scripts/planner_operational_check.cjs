const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {allocateCosts}=require('../src/services/plannerCosts');
const {assertCargoEditable}=require('../src/services/plannerCargoGuard');
const {plannerInvoiceSql}=require('../src/services/invoiceWorkspace');
const {deliveryData}=require('../src/services/deliveryData');
(async()=>{
 const line=(id,cantidad,peso_kg)=>({id,cantidad,peso_kg,coste_unitario:2,precio_venta:5});
 const weighted=allocateCosts([line('a',10,2),line('b',5,4)],101.01);
 assert.deepEqual(weighted.lineas.map(l=>l.coste_operativo),[50.51,50.5]);
 const units=allocateCosts([line('a',1,0),line('b',2,0)],90);
 assert.equal(units.criterio,'unidades');assert.deepEqual(units.lineas.map(l=>l.coste_operativo),[30,60]);
 assert.equal(allocateCosts([line('a',1,0)],0).total,0);
 assert.throws(()=>allocateCosts([line('a',0,1)],1),/Cantidades/);
 assert.throws(()=>allocateCosts([],1),/mercancía/);
 for(let cents=0;cents<300;cents++)assert.equal(allocateCosts([line('a',1,3),line('b',7,1),line('c',2,11)],cents/100).lineas.reduce((n,l)=>n+Math.round(l.coste_operativo*100),0),cents);
 let calls=0;const tx={query:async(sql,args)=>{calls++;assert.deepEqual(args,['order','company']);return {rows:[{id:'prep'}]};}};
 const order={id:'order',origen_producto:'planner',bultos:64};
 await assertCargoEditable(tx,'company',order,{bultos:'64',estado:'confirmado'});assert.equal(calls,0);
 await assert.rejects(assertCargoEditable(tx,'company',order,{bultos:0}),e=>e.status===409);assert.equal(calls,1);
 await assertCargoEditable(tx,'company',{...order,origen_producto:'transgest'},{bultos:0});assert.equal(calls,1);
 const data=await deliveryData({query:async()=>({rows:[{numero:'TEST',bultos:2,peso_kg:40,delivery_company:{nombre:'Empresa',cif:null,cfg_precios:{empresa_perfil:{cif:'B123',direccion:'Calle 1'}}},delivery_client:{nombre:'Cliente'},mercancia:'Sacos'}]})},'company','order');
 assert.equal(data.empresa.cif,'B123');assert.equal(data.lineas[0].peso_kg,20);
 const pg=new PGlite();try{
  await pg.exec(`CREATE TABLE facturas(id text,empresa_id text,planner_preparacion_id text,factura_original_id text);
    INSERT INTO facturas VALUES ('tms','a',NULL,NULL),('planner','a','prep',NULL),('rect','a',NULL,'planner'),('other','b','otherprep',NULL),('cross','a',NULL,'other');`);
  const list=async planner=>(await pg.query(`SELECT f.id FROM facturas f WHERE f.empresa_id='a' AND ${planner?'':'NOT '}${plannerInvoiceSql('f')} ORDER BY f.id`)).rows.map(r=>r.id);
  assert.deepEqual(await list(true),['planner','rect']);assert.deepEqual(await list(false),['cross','tms']);
 }finally{await pg.close();}
 console.log('PASS operational costs: cent reconciliation, weight/unit fallback, stock edit guard, document profile and invoice workspace isolation');
})().catch(e=>{console.error(e);process.exitCode=1;});

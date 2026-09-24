const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { evaluateCost, createCost } = require('../src/services/importCosts');

async function main() {
  const pg=new PGlite();
  const company='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  const batch='33333333-3333-4333-8333-333333333333';
  try {
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY); CREATE TABLE usuarios(id uuid PRIMARY KEY);
      CREATE TABLE clientes(id uuid PRIMARY KEY,empresa_id uuid,cif text);
      CREATE TABLE choferes(id uuid PRIMARY KEY,empresa_id uuid,dni text);
      CREATE TABLE vehiculos(id uuid PRIMARY KEY,empresa_id uuid,matricula text);
      CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid);
      INSERT INTO empresas VALUES ('${company}'),('${other}');
      INSERT INTO vehiculos VALUES ('44444444-4444-4444-8444-444444444444','${company}','0009-LCZ'),
        ('55555555-5555-4555-8555-555555555555','${other}','0009-LCZ');`);
    for (const name of ['20260924_import_batches.sql','20260924_import_costs.sql']) {
      await pg.exec(fs.readFileSync(path.join(__dirname,'migrations',name),'utf8'));
    }
    await pg.query(`INSERT INTO import_batches(id,empresa_id,tipo,filename,source_system) VALUES($1,$2,'Pack_TransGest','synthetic.xlsx','legacy')`,[batch,company]);
    async function make(type,data,source) {
      const decision=await evaluateCost(pg,company,'legacy',type,data,source,'f'.repeat(64));
      assert.equal(decision.action,'create',JSON.stringify(decision));
      return createCost(pg,company,batch,'legacy',type,data,decision);
    }
    const fuel=await make('Gastos_Operativos',{source_id:'fuel-month',tipo:'combustible_agregado',importe:1800,periodo_desde:'2026-08-01',periodo_hasta:'2026-08-31',matricula:'0009 LCZ'},'fuel-month');
    assert.equal(fuel.table,'gastos_operativos');
    assert.equal((await pg.query('SELECT count(*)::int AS n FROM vehiculo_repostajes')).rows[0].n,0,'Aggregate fuel is not a fabricated fill-up');
    const toll=await make('Gastos_Operativos',{source_id:'toll',tipo:'peaje',importe:25,fecha:'2026-08-12',matricula:'0009LCZ'},'toll');
    assert.ok(toll.id);
    assert.equal((await pg.query('SELECT pedido_id FROM gastos_operativos WHERE id=$1',[toll.id])).rows[0].pedido_id,null,'Unknown order is not invented');
    const fill=await make('Repostajes',{source_id:'fill',matricula:'0009LCZ',fecha:'2026-08-13',litros:100,precio_litro:1.5,importe:150},'fill');
    assert.equal(fill.table,'vehiculo_repostajes');
    const credit=await make('Gastos_Estructura',{source_id:'credit',nombre:'Regularización',importe:-45,fecha:'2026-08-31'},'credit');
    assert.equal(credit.table,'gastos_estructura_movimientos');
    assert.equal(Number((await pg.query('SELECT importe AS amount FROM gastos_estructura_movimientos WHERE id=$1',[credit.id])).rows[0].amount),-45);
    const cross=await evaluateCost(pg,other,'legacy','Repostajes',{matricula:'0009LCZ',fecha:'2026-08-13',litros:1,importe:1},'other','e'.repeat(64));
    assert.equal(cross.action,'create');
    assert.notEqual(cross.vehicleId,(await pg.query('SELECT vehiculo_id FROM vehiculo_repostajes WHERE id=$1',[fill.id])).rows[0].vehiculo_id);
    assert.equal((await evaluateCost(pg,company,'legacy','Gastos_Operativos',{tipo:'peaje',importe:20,fecha:'2026-08-12',matricula:'9999AAA'},'x','d'.repeat(64))).action,'review');
    assert.equal((await evaluateCost(pg,company,'legacy','Repostajes',{matricula:'0009LCZ',fecha:'2026-08-12',litros:0,importe:20},'x','d'.repeat(64))).action,'review');
    console.log('PASS: aggregate fuel, real fill-up, toll without invented order, negative structure movement, tenant vehicle matching, missing reference review. Synthetic PGlite only.');
  } finally { await pg.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

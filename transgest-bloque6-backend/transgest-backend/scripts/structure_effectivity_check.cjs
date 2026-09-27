const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {changeEffectivity,buildStructure}=require('../src/services/structureExpenses');
(async()=>{
 const db=new PGlite();
 try{
 await db.exec('CREATE TABLE empresas(id UUID PRIMARY KEY);');
 for(const name of ['20260927_structure_expenses.sql','20260928_structure_expense_effectivity.sql'])await db.exec(fs.readFileSync(__dirname+'/migrations/'+name,'utf8'));
 await db.exec(fs.readFileSync(__dirname+'/migrations/20260928_structure_expense_effectivity.sql','utf8'));
 const company=crypto.randomUUID(),foreign=crypto.randomUUID();
 await db.query('INSERT INTO empresas VALUES($1),($2)',[company,foreign]);
 const expense=(await db.query("INSERT INTO gastos_estructura(empresa_id,nombre,importe,periodo,fecha) VALUES($1,'Alquiler',100,'mensual','2026-01') RETURNING *",[company])).rows[0];
 const change=body=>db.transaction(tx=>changeEffectivity(tx,{empresaId:company,id:expense.id,actorId:null,body,validate:(input,prev)=>({...prev,...input})}));
 const request={accion:'cambiar',revision:1,desde:'2026-09',motivo:'Nuevo contrato',datos:{importe:150}};
 await db.query("INSERT INTO meses_cerrados VALUES($1,'2026-08',NOW())",[company]);
 let version=await change(request);
 assert.equal(Number(version.importe),100);assert.equal(version.revision,2);
 const total=m=>buildStructure({empresaId:company,month:m,structure:[version]}).total;
 assert.equal(total('2026-08'),100);assert.equal(total('2026-09'),150);
 await assert.rejects(change(request),/ha cambiado/);
 await assert.rejects(change({...request,revision:2,desde:'2026-08'}),/vigencias anteriores/);
 await assert.rejects(db.transaction(tx=>changeEffectivity(tx,{empresaId:foreign,id:expense.id,body:request})),e=>e.status===404);
 await db.query("INSERT INTO meses_cerrados VALUES($1,'2026-11',NOW())",[company]);
 await assert.rejects(change({...request,revision:2,desde:'2026-10'}),/cerrado/);
 version=await change({...request,revision:2,desde:'2026-12',datos:{importe:2400,periodo:'anual'}});
 assert.equal(total('2026-11'),150);assert.equal(total('2026-12'),200);
 version=await change({accion:'finalizar',revision:3,hasta:'2027-01',motivo:'Fin de contrato'});
 assert.equal(total('2027-01'),200);assert.equal(total('2027-02'),null);
 assert.equal((await db.query('SELECT count(*)::int n FROM gastos_estructura_eventos')).rows[0].n,3);
 await assert.rejects(change({...request,revision:4,desde:'2027-03'}),/finalizada/);
 console.log('PASS expense effective versions: historical amounts, close boundaries, final month, annual allocation, optimistic locking, tenant scope, audit and repeated migration');
 }finally{await db.close();await require('../src/services/db').pool.end();}
})().catch(e=>{console.error(e);process.exitCode=1;});

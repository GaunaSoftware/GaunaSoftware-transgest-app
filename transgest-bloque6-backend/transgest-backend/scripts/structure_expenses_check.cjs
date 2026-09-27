const assert = require('node:assert/strict');
const {structureMonth, buildStructure, expenseMonth, readStructure} = require('../src/services/structureExpenses');
const db = require('../src/services/db');
const structure = [
  {empresa_id:'A',nombre:'Mensual',importe:100,fecha:'2026-01',periodo:'mensual'},
  {empresa_id:'A',nombre:'Puntual',importe:200,fecha:'2026-09',periodo:'unico'},
  {empresa_id:'B',nombre:'Ajeno',importe:9000,fecha:'2026-01',periodo:'mensual'},
];
const vehicles = [1,2,3].map(id=>({id,empresa_id:'A',ingresos:100,clase:'tractora'}));
const result = buildStructure({empresaId:'A',month:'2026-09',structure,vehicles});
assert.equal(result.total,300);assert.equal(result.gastos.length,2);
const october = buildStructure({empresaId:'A',month:'2026-10',structure,vehicles});
assert.equal(october.total,100);assert.equal(october.reparto.reduce((s,x)=>s+x.coste_igual,0),100);
assert.equal(october.reparto.reduce((s,x)=>s+x.coste_ingresos,0),100);
assert.equal(october.reparto.reduce((s,x)=>s+x.peso_igual,0),1);
assert.equal(buildStructure({empresaId:'A',month:'2026-09',structure,vehicles:[]}).no_atribuido_igual,300);
assert.equal(buildStructure({empresaId:'A',month:'2026-09',structure:[],vehicles}).total,null);
assert.equal(structureMonth([{importe:120,fecha:'2026-09',periodo:'anual'}],'2026-10')[0].importe_periodo,10);
assert.equal(expenseMonth('2026-09-01'),'2026-09');assert.throws(()=>expenseMonth('2026-13'),/válido/);
const original=db.query;
db.query=async(sql,params)=>{assert.equal(params[0],'A');assert.match(sql,/empresa_id\s*=\s*\$1/);return {rows:sql.includes('SELECT * FROM gastos_estructura')?structure.filter(r=>r.empresa_id==='A'):vehicles};};
readStructure('A','2026-09').then(r=>{assert.equal(r.total,300);console.log('PASS monthly/one-off expenses, exact cent allocation, missing data, company predicates and normalized month');})
  .catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{db.query=original;db.pool?.end();});

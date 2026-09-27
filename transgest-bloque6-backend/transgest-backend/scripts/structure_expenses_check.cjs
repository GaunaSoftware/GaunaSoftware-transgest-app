const assert = require('node:assert/strict');
const {structureMonth, buildStructure, expenseMonth, readStructure, compareStructure} = require('../src/services/structureExpenses');
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
const comparison = compareStructure({empresaId:'A',month:'2026-09',structure});
assert.deepEqual(comparison.periodos.map(p=>p.total),[300,100,null]);
assert.equal(comparison.variacion_anterior.diferencia,200);
assert.equal(comparison.variacion_anterior.porcentaje,200);
assert.equal(comparison.variacion_anual.porcentaje,null);
assert.equal(comparison.periodos[2].estado,'sin_datos');
assert.equal(comparison.categorias[0].actual,300);
assert.ok(!JSON.stringify(comparison).includes('Ajeno'));
const months = compareStructure({empresaId:'A',month:'2026-01',structure});
assert.deepEqual(months.periodos.map(p=>p.periodo),['2026-01','2025-12','2025-01']);
assert.equal(compareStructure({empresaId:'A',month:'2024-02'}).periodos[0].hasta,'2024-02-29');
const complete = compareStructure({empresaId:'A',month:'2026-09',structure:[
  {empresa_id:'A',tipo:'Alquiler',importe:1200,fecha:'2025-01',periodo:'anual',factura_data:'private-attachment'},
  {empresa_id:'A',tipo:'Suministros',importe:90,fecha:'2026-09',periodo:'trimestral'},
  {empresa_id:'A',tipo:'Otros',importe:50,fecha:'2026-09',periodo:'unico'},
  {empresa_id:'A',tipo:'Futuro',importe:2000,fecha:'2026-10',periodo:'mensual'},
  {empresa_id:'A',tipo:'Inactivo',importe:2000,fecha:'2026-01',periodo:'mensual',activo:false},
]});
assert.deepEqual(complete.periodos.map(p=>p.total),[180,100,100]);
assert.equal(complete.periodos[0].prorrateados,2);
for(const [i,key] of ['actual','anterior','ano_anterior'].entries()) assert.equal(complete.categorias.reduce((s,c)=>s+c[key],0),complete.periodos[i].total);
assert.equal(complete.categorias.find(c=>c.tipo==='Otros').variacion_anterior.porcentaje,null);
assert.equal(complete.categorias.find(c=>c.tipo==='Otros').variacion_anterior.diferencia,50);
assert.ok(!JSON.stringify(complete).includes('private-attachment'));
db.query=async(sql,params)=>{assert.equal(params[0],'A');assert.match(sql,/empresa_id\s*=\s*\$1/);return {rows:sql.includes('SELECT * FROM gastos_estructura')?structure.filter(r=>r.empresa_id==='A'):vehicles};};
readStructure('A','2026-09').then(async r=>{
  assert.equal(r.total,300);assert.deepEqual(r.comparativa.periodos.map(p=>p.total),[300,100,null]);
  const empty=await readStructure('A','2025-09');assert.equal(empty.estado,'sin_datos');assert.equal(empty.total,null);
  console.log('PASS monthly/one-off expenses, exact allocation, comparison/month boundaries, categories, missing baseline, company isolation and future-only coverage');})
  .catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{db.query=original;db.pool?.end();});

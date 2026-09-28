const assert = require('node:assert/strict');
const { calculate } = require('../src/services/detentionQuote');
const { list } = require('../src/services/detentionWorkflow');
const start = '2026-01-01T00:00:00Z';
const at = minutes => calculate({ inicio:start,fin:new Date(Date.parse(start)+minutes*60000).toISOString() });
assert.equal(at(60).importe,0);
assert.equal(at(61).importe,40);
assert.equal(at(120).importe,40);
assert.equal(at(121).importe,80);
assert.equal(at(1440).importe,400);
assert.equal(at(1441).importe,450);
assert.equal(at(2880).importe,900);
assert.equal(at(2881).importe,960);
assert.equal(at(4320).importe,1500);
const dst=calculate({inicio:'2026-03-29T01:00:00+01:00',fin:'2026-03-29T04:00:00+02:00'});
assert.equal(dst.minutos,120);assert.equal(dst.importe,40);
assert.equal(calculate({inicio:start,fin:'2026-01-01T02:00:00Z',importe_pactado:75,acuerdo:'Pacto superior'}).importe,75);
assert.throws(()=>calculate({inicio:start,fin:'2026-01-01T02:00:00Z',importe_pactado:39,acuerdo:'Inferior'}),/superior/);
assert.throws(()=>calculate({inicio:start,fin:'2026-01-01T02:00:00Z',importe_pactado:80}),/acuerdo/);
assert.throws(()=>calculate({inicio:'2026-01-01T00:00',fin:'2026-01-01T02:00'}),/zona horaria/);
assert.throws(()=>calculate({inicio:start,fin:'2026-01-01T02:00:00Z'},new Date('2025-12-31')),/finalizados/);
assert.throws(()=>calculate({inicio:'2022-01-01T00:00:00Z',fin:'2022-01-01T02:00:00Z'}),/verificada/);
assert.equal(at(120).iva,null);
const loadStarted='2026-09-17T08:00:00Z',loadEnded='2026-09-17T10:00:00Z';
const mockDb={query:async sql=>{
  if(sql.includes('FROM pedidos WHERE'))return {rows:[{id:'synthetic',numero:'PED-SYNTHETIC'}]};
  if(sql.includes('FROM pedido_chofer_pasos'))return {rows:[{data:{paradas:{'carga-capa':{tipo:'carga',label:'Capa Abanilla',
    aviso_espera_carga:true,carga_ok:true,carga_iniciada_at:loadStarted,carga_ok_at:loadEnded}}}}]};
  return {rows:[]};
}};
list(mockDb,'synthetic-company','synthetic').then(result=>{
  assert.equal(result.demora_chofer.parada_id,'carga-capa');
  assert.equal(result.demora_chofer.inicio,loadStarted);
  assert.equal(result.demora_chofer.fin,loadEnded);
  assert.equal(result.demoras_chofer.length,1);
  console.log('detention_quote_check: 17 cálculos y demora por parada verificados');
}).catch(error=>{console.error(error);process.exitCode=1;});

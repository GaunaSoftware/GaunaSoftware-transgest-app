const assert = require('node:assert/strict');
const express = require('express');
const helmet = require('helmet');
const db = require('../src/services/db');

const enterpriseId = '11111111-1111-4111-8111-111111111111';
const orderId = '22222222-2222-4222-8222-222222222222';
const tokenIds = { carga:'33333333-3333-4333-8333-333333333333', descarga:'44444444-4444-4444-8444-444444444444' };
const state = { loaded:false, delivered:false, used:new Set(), events:[], documents:[] };
const order = { id:orderId, pedido_id:orderId, empresa_id:enterpriseId, numero:'PED-QA-1',
  colaborador_nombre:'Colaborador de prueba', empresa_nombre:'Empresa de prueba',
  colaborador_id:enterpriseId,estado:'confirmado',mercancia:'Goods',peso_kg:8000,bultos:8,origen:'Almacén A', destino:'Almacén B' };

db.query = async (sql,params=[]) => {
  if (/FROM colaborador_pedido_tokens t/i.test(sql)) {
    const action = params[1];
    if (!tokenIds[action] || state.used.has(action)) return {rows:[]};
    return {rows:[{...order,token_id:tokenIds[action],
      colaborador_carga_confirmada_at:state.loaded ? new Date() : null,
      colaborador_descarga_confirmada_at:state.delivered ? new Date() : null}]};
  }
  if(/FROM pedidos p/i.test(sql))return{rows:[{...order,estado:state.loaded?'cargado':'confirmado',colaborador_carga_confirmada_at:state.loaded?new Date():null}]};
  return {rows:[]};
};
db.transaction = async fn => {
  const previous = {loaded:state.loaded,delivered:state.delivered,used:new Set(state.used),events:[...state.events],documents:[...state.documents]};
  const client = {query:async (sql,params=[]) => {
    if(/SELECT \* FROM pedidos/.test(sql))return{rows:[{...order,estado:state.loaded?'cargado':'confirmado',colaborador_carga_confirmada_at:state.loaded?new Date():null}]};
    if (/UPDATE pedidos SET estado='cargado'/i.test(sql)) {
      if (state.loaded) return {rows:[]};
      state.loaded=true;return {rows:[{id:orderId}]};
    }
    if (/UPDATE pedidos SET estado='entregado'/i.test(sql)) {state.delivered=true;return {rows:[{id:orderId}]};}
    if (/UPDATE colaborador_pedido_tokens SET usado_at/i.test(sql)) {
      const action = Object.keys(tokenIds).find(key=>tokenIds[key]===params[0]);
      if (!action || state.used.has(action)) return {rows:[]};
      state.used.add(action);return {rows:[{id:params[0]}]};
    }
    if (/INSERT INTO pedido_docs/i.test(sql)) state.documents.push(params);
    if (/INSERT INTO pedido_eventos/i.test(sql)) state.events.push(params);
    return {rows:[]};
  }};
  try {return await fn(client);} catch(error) {
    state.loaded=previous.loaded;state.delivered=previous.delivered;state.used=previous.used;
    state.events=previous.events;state.documents=previous.documents;throw error;
  }
};

const app = express();
app.use(helmet());
app.use(express.json({limit:'12mb'}));
app.use(express.urlencoded({extended:true}));
app.use('/api/v1/pedidos',require('../src/routes/pedidos'));

async function main() {
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/v1/pedidos/colaborador`;
  try {
    const script = await fetch(`${base}/descarga-form.js`);
    assert.equal(script.status,200);
    assert.match(script.headers.get('content-type'),/javascript/);
    assert.match(script.headers.get('content-security-policy'),/script-src 'self'/);
    assert.match(await script.text(),/addEventListener/);

    const before = await (await fetch(`${base}/carga/test-load`)).text();
    assert.match(before,/Marcar como cargado/);
    assert.doesNotMatch(before,/name="deca_origen"/);
    const loaded = await fetch(`${base}/carga/test-load`,{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'notas=Prueba'});
    assert.equal(loaded.status,200);
    assert.equal(state.loaded,true);
    assert.equal(state.used.has('carga'),false,'la respuesta DeCA debe seguir disponible con el mismo enlace');
    assert.match(await loaded.text(),/name="deca_origen"/);
    const decision = await fetch(`${base}/carga/test-load/deca`,{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'deca_origen=solicitar'});
    assert.equal(decision.status,422,'missing cargo must be completed before issuing');
    assert.equal(state.used.has('carga'),false);
    const received=await fetch(`${base}/carga/test-load/deca`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'deca_origen=recibido'});
    assert.equal(received.status,200,await received.text());
    assert.equal(state.used.has('carga'),true);
    assert.ok(state.events.some(params=>params.includes('documento_control.recibido_cargador')));

    const page = await (await fetch(`${base}/descarga/test-unload`)).text();
    assert.match(page,/descarga-form\.js/);
    assert.doesNotMatch(page,/DeCA originales vigentes|Tráfico debe emitir o adjuntar el DeCA/);
    assert.equal(state.delivered,false);
    const invalid = await fetch(`${base}/descarga/test-unload`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({documentos:[]})});
    assert.equal(invalid.status,400);
    assert.equal(state.delivered,false);
    assert.equal(state.used.has('descarga'),false);
    const png = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0,0,0,0]);
    const uploaded = await fetch(`${base}/descarga/test-unload`,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({documentos:[{nombre:'albaran.png',file_mime:'image/png',file_base64:png.toString('base64')}]})});
    assert.equal(uploaded.status,200,await uploaded.text());
    assert.equal(state.documents.length,1);
    assert.equal(state.delivered,true);
    assert.equal(state.used.has('descarga'),true);
    console.log('PASS HTTP colaborador: CSP/script, DeCA tras carga, rechazo sin archivos y entrega atómica con PNG');
  } finally {await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

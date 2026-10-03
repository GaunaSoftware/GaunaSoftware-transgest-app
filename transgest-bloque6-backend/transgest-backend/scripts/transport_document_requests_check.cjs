const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const {PGlite} = require('@electric-sql/pglite');
const coverage = require('../src/services/transportDocumentCoverage');

async function main() {
  const pg = new PGlite(), company = crypto.randomUUID(), other = crypto.randomUUID();
  const user = crypto.randomUUID(), colleague = crypto.randomUUID(), order = crypto.randomUUID();
  const multi = crypto.randomUUID(), consolidated = crypto.randomUUID(), stale = crypto.randomUUID();
  const shipments = [crypto.randomUUID(),crypto.randomUUID()];
  const db = {query:(...args)=>pg.query(...args)};
  try {
    assert.deepEqual(await coverage.resolveDecaNotifications(db,company),[], 'Old schemas remain readable');
    await pg.exec(`CREATE TABLE transport_document_versions(empresa_id uuid,pedido_id uuid,envio_id uuid,scope_key text,version int,payload jsonb,created_at timestamptz DEFAULT NOW());
      CREATE TABLE pedidos_envios(empresa_id uuid,pedido_id uuid,id uuid);
      CREATE TABLE notificaciones_internas(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,usuario_id uuid,tipo text,titulo text,mensaje text,data jsonb,leida boolean DEFAULT false,created_at timestamptz DEFAULT NOW(),read_at timestamptz);`);
    const notice = async (owner,pedido,reader=user,type='deca_solicitado') => (await pg.query(`INSERT INTO notificaciones_internas(empresa_id,usuario_id,tipo,titulo,mensaje,data)
      VALUES($1,$2,$3,'Solicitud histórica','Revisar original o generar DeCA antes de salir.',$4) RETURNING id`,[owner,reader,type,JSON.stringify({pedido_id:pedido})])).rows[0].id;
    const document = (owner,pedido,scope,version,envioId=null,ids=[]) => pg.query(`INSERT INTO transport_document_versions(empresa_id,pedido_id,scope_key,version,envio_id,payload)
      VALUES($1,$2,$3,$4,$5,$6)`,[owner,pedido,scope,version,envioId,JSON.stringify({envio_ids:ids})]);
    const fulfilled = await notice(company,order), colleagueNotice = await notice(company,order,colleague);
    const partial = await notice(company,multi), complete = await notice(company,consolidated);
    const superseded = await notice(company,stale), otherTenant = await notice(other,order);
    const unrelated = await notice(company,order,user,'agenda_tarea'), noOriginal = await notice(company,crypto.randomUUID());
    for (const pedido of [multi,consolidated,stale]) for (const id of shipments) await pg.query('INSERT INTO pedidos_envios VALUES($1,$2,$3)',[company,pedido,id]);
    await document(company,order,'pedido',1); await document(company,order,'pedido',2);
    await document(company,multi,shipments[0],1,shipments[0]);
    await document(company,consolidated,'consolidado',1,null,shipments);
    await document(company,stale,'consolidado',1,null,shipments);
    await document(company,stale,'consolidado',2,null,[shipments[0]]);
    const before = (await pg.query('SELECT * FROM transport_document_versions ORDER BY pedido_id,scope_key,version')).rows;
    const notificationModule = {exports:{}};
    vm.runInNewContext(fs.readFileSync(require.resolve('../src/services/notificaciones'),'utf8'),{
      module:notificationModule,require:name=>name==='./db'?db:name==='./transportDocumentCoverage'?coverage:require(name),
    });
    const inbox = await notificationModule.exports.listarNotificaciones(company,user);
    assert.equal(inbox.no_leidas,4);
    assert.equal(inbox.data.some(n=>[fulfilled,complete].includes(n.id)),false);
    for (const id of [partial,superseded,unrelated,noOriginal]) assert.equal(inbox.data.some(n=>n.id===id),true);
    const historical = await notificationModule.exports.listarNotificaciones(company,user,{includeRead:true});
    const originalNotice = historical.data.find(n=>n.id===fulfilled);
    assert.equal(originalNotice.leida,true); assert.equal(originalNotice.data.resuelta,true);
    assert.equal(originalNotice.mensaje,'Revisar original o generar DeCA antes de salir.');
    assert.ok(originalNotice.read_at); assert.equal(originalNotice.data.resolucion,'deca_vigente');
    for (const id of [colleagueNotice,otherTenant]) assert.equal((await pg.query('SELECT leida FROM notificaciones_internas WHERE id=$1',[id])).rows[0].leida,false);
    assert.deepEqual(await coverage.resolveDecaNotifications(db,company,{usuarioId:user}),[],'Resolution is idempotent');
    await document(company,multi,shipments[1],1,shipments[1]);
    await coverage.resolveDecaNotifications(db,company,{pedidoId:multi});
    assert.equal((await pg.query('SELECT leida FROM notificaciones_internas WHERE id=$1',[partial])).rows[0].leida,true);
    const after = (await pg.query('SELECT * FROM transport_document_versions WHERE pedido_id<>$1 ORDER BY pedido_id,scope_key,version',[multi])).rows;
    assert.deepEqual(after,before.filter(v=>v.pedido_id!==multi),'No original or version is modified');
    assert.equal(coverage.documentCoverage([{estado:'superada',envio_id:shipments[1]},{estado:'activa',envio_id:shipments[0]}],shipments.map(id=>({id}))).ready,false);
    assert.equal(coverage.documentCoverage([{estado:'activa',payload:{envio_ids:shipments}}],shipments.map(id=>({id}))).ready,true);
    console.log('PASS DeCA requests: existing alerts resolved, all shipments required, superseded originals excluded, consolidated coverage, tenant/user isolation and intact history.');
  } finally {await pg.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});

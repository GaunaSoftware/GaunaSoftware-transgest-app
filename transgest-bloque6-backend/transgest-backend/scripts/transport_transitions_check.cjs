const assert=require('node:assert/strict');
const { PGlite }=require('@electric-sql/pglite');
const { stateFromProgress, stateFromStop, assertTransportTransition }=require('../src/services/transportTransitions');
const { saveSupplierProgress }=require('../src/services/supplierProgress');
async function main() {
  assert.equal(stateFromProgress({carga_iniciada:true}),'espera_carga');
  assert.equal(stateFromProgress({carga_iniciada:true,carga_proceso:true}),'cargando');
  assert.equal(stateFromProgress({carga_ok:true}),'en_curso');
  assert.equal(stateFromProgress({posicionado_descarga:true}),'espera_descarga');
  assert.equal(stateFromProgress({descarga_ok:true}),'descarga');
  assert.equal(stateFromProgress({descarga_ok:true},{deliveryComplete:true}),'entregado');
  assert.equal(stateFromStop({tipo:'descarga'},{firma_entrega:true},false),'en_curso');
  assert.throws(()=>assertTransportTransition('facturado','confirmado',{actor:'gerente',correction:true}),{code:'TRANSPORT_STATE_TERMINAL'});
  assert.throws(()=>assertTransportTransition('entregado','confirmado'),{status:409});
  assert.equal(assertTransportTransition('entregado','confirmado',{actor:'gerente',correction:true}).changed,true);
  assert.equal(assertTransportTransition('entregado','entregado').changed,false);
  const pg=new PGlite();let injectFailure=false;
  const query=(executor)=>(sql,args)=>{if(injectFailure&&sql.includes('INSERT INTO pedido_eventos'))throw Error('event failure');return executor.query(sql,args);};
  const db={transaction:fn=>pg.transaction(tx=>fn({query:query(tx)}))};
  const order='11111111-1111-4111-8111-111111111111',company='22222222-2222-4222-8222-222222222222',supplier='33333333-3333-4333-8333-333333333333';
  const save=patch=>saveSupplierProgress(db,{pedidoId:order,empresaId:company,colaboradorId:supplier,patch});
  try {
    await pg.exec(`CREATE TABLE pedidos(id uuid PRIMARY KEY,empresa_id uuid,colaborador_id uuid,estado text,updated_at timestamptz,carga_real_at timestamptz,descarga_real_at timestamptz);
      CREATE TABLE pedido_chofer_pasos(pedido_id uuid PRIMARY KEY,empresa_id uuid,chofer_id uuid,data jsonb,updated_at timestamptz);
      CREATE TABLE pedido_eventos(pedido_id uuid,empresa_id uuid,tipo text,actor_tipo text,detalle jsonb);
      CREATE TABLE colaborador_liquidacion_tokens(pedido_id uuid,empresa_id uuid,expires_at timestamptz);`);
    await pg.query("INSERT INTO pedidos VALUES($1,$2,$3,'confirmado',NULL,NULL,NULL)",[order,company,supplier]);
    await assert.rejects(save({viaje_iniciado:true}),{code:'SUPPLIER_STEP_SEQUENCE'});
    const arrival=await save({carga_iniciada:true});assert.equal(arrival.estado,'espera_carga');
    assert.equal((await save({carga_iniciada:true,carga_iniciada_at:'2020-01-01'})).data.carga_iniciada_at,arrival.data.carga_iniciada_at);
    assert.equal((await pg.query('SELECT count(*)::int n FROM pedido_eventos')).rows[0].n,1);
    injectFailure=true;await assert.rejects(save({carga_proceso:true}),/event failure/);injectFailure=false;
    assert.equal((await pg.query('SELECT estado FROM pedidos')).rows[0].estado,'espera_carga');
    assert.equal((await pg.query('SELECT data FROM pedido_chofer_pasos')).rows[0].data.carga_proceso,undefined);
    assert.equal((await save({carga_proceso:true})).estado,'cargando');
    assert.equal((await save({carga_ok:true})).estado,'en_curso');
    assert.ok((await pg.query('SELECT carga_real_at FROM pedidos')).rows[0].carga_real_at);
    await save({albaran_carga:true});await save({viaje_iniciado:true});
    assert.equal((await save({posicionado_descarga:true})).estado,'espera_descarga');
    assert.equal((await save({descarga_iniciada:true})).estado,'descarga');
    assert.equal((await save({descarga_ok:true})).estado,'descarga','Unloading is not signed/documented completion');
    const delivered=await save({albaran_descarga:true});assert.equal(delivered.estado,'entregado');
    assert.equal((await save({albaran_descarga:true})).sin_cambios,true);
    await assert.rejects(save({carga_ok:false}),{status:409});
    for(const override of [{empresaId:supplier},{colaboradorId:company}]) {
      await assert.rejects(saveSupplierProgress(db,{pedidoId:order,empresaId:company,colaboradorId:supplier,patch:{carga_iniciada:true},...override}),{status:403});
    }
    await pg.query("UPDATE pedidos SET estado='cancelado'");
    await assert.rejects(save({new_flag:true}),{status:409});
    console.log('PASS shared transitions: arrival/loading, unloading/document completion, terminal states, manager correction, supplier assignment/tenant, timestamp retry and atomic rollback.');
  } finally {await pg.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});

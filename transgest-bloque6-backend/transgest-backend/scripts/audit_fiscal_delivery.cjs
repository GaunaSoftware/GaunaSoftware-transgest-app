const assert = require('node:assert/strict');
const { fiscalProvider } = require('../src/services/fiscalProviders');
const vf = require('../src/services/fiscalProviderVerifacti');
const { ensureFacturaFiscalRecord } = require('../src/services/fiscal');
const { requeueFiscalRecord } = require('../src/services/fiscalRequeue');
const { processPendingFiscalQueue } = require('../src/services/fiscalProcessor');
const { markQueueError, markQueuePending } = require('../src/services/fiscalQueueState');
module.exports = async ({ db, company, user }) => {
  const previous = (await db.query('SELECT configuracion FROM empresas WHERE id=$1', [company])).rows[0].configuracion;
  const cfg = { modo:'verifactu', entorno:'pruebas', nif_declarante:'B00000000', verifactu:{ proveedor:'verifacti', provider_base_url:'https://fiscal.example.invalid', provider_api_key:'synthetic', envio_automatico:true } };
  await db.query("UPDATE empresas SET configuracion=jsonb_set(COALESCE(configuracion,'{}'),'{facturacion_fiscal}',$1::jsonb) WHERE id=$2",[JSON.stringify(cfg),company]);
  const factura = (await db.query("SELECT id FROM facturas WHERE empresa_id=$1 AND estado='emitida' AND total>0 ORDER BY created_at DESC LIMIT 1",[company])).rows[0];
  assert.ok(factura);
  const fiscal = await ensureFacturaFiscalRecord({ facturaId:factura.id, empresaId:company, actorUserId:user });
  const record = fiscal.record;
  const pending = () => db.query('SELECT * FROM factura_envios_fiscales WHERE registro_id=$1 ORDER BY created_at DESC LIMIT 1',[record.id]).then(r=>r.rows[0]);
  const processOne = () => processPendingFiscalQueue({empresaId:company,facturaId:factura.id,limit:1});
  const originalFetch = global.fetch, calls = [];
  let mode='pending';
  global.fetch = async(url, options={}) => {
    assert.ok(String(url).startsWith(cfg.verifactu.provider_base_url), 'no external calls');
    calls.push({url,options});
    if(mode==='timeout') throw new Error('synthetic timeout');
    const response = String(url).includes('/health') ? {estado:'OK',nif:'B00000000',entorno:'test'}
      : mode==='accepted' ? {estado:'Correcto',uuid:'qa-uuid'} : {estado:'Pendiente',uuid:'qa-uuid'};
    return {ok:mode!=='401',status:mode==='401'?401:200,text:async()=>JSON.stringify(response)};
  };
  try {
    assert.equal((await fiscalProvider(cfg).healthCheck()).ok,true);
    mode='401'; assert.equal((await fiscalProvider(cfg).healthCheck()).ok,false);
    assert.equal(vf.normalizeStatus('Incorrecto'),'error');assert.equal(vf.normalizeStatus('No registrado'),'error');assert.equal(vf.normalizeStatus('Duplicado'),'error');assert.equal(vf.normalizeStatus('Aceptado con errores'),'error');assert.equal(vf.normalizeStatus('Enviado'),'error');
    assert.equal(vf.toDdMmYyyy('2026-03-29'),'29-03-2026');
    const payload={expedicion:{numero:'A-1',serie:'A',fecha_factura:'2026-03-29'},importes:{base_imponible:100,tipo_iva:21,cuota_iva:21,total:121},lineas:[{subtotal:50,concepto:'half'}]};
    assert.equal(vf.mapInternalPayloadToVerifacti(payload).lineas[0].base_imponible,'100.00','all emitted supplements retained');
    mode='timeout';await processOne();let item=await pending();assert.ok(item.first_attempt_at);assert.equal(item.retryable,true);
    const key=calls.at(-1).options.headers['Idempotency-Key'];assert.ok(key);
    await db.transaction(tx=>requeueFiscalRecord(tx,record));mode='pending';await processOne();assert.equal(calls.at(-1).options.headers['Idempotency-Key'],key);
    item=await pending();assert.equal(item.response.provider_uuid,'qa-uuid');
    mode='timeout';await db.transaction(tx=>requeueFiscalRecord(tx,record));await processOne();item=await pending();assert.equal(item.response.provider_uuid,'qa-uuid','poll failure preserves uuid');assert.ok(calls.at(-1).url.includes('/status?'));
    await markQueueError(db,item,'permanent validation failure',user,false);assert.equal((await processOne()).total,0);
    await db.transaction(tx=>requeueFiscalRecord(tx,record));mode='accepted';
    const before=calls.length;const results=await Promise.all([processOne(),processOne()]);assert.equal(results.reduce((n,r)=>n+r.total,0),1);assert.equal(calls.length-before,1);
    item=await pending();assert.equal(item.estado,'aceptado');
    await markQueueError(db,item,'late failure',user,true);await markQueuePending(db,item,{provider_uuid:'qa-uuid'},user);assert.equal((await pending()).estado,'aceptado');
    const again=await ensureFacturaFiscalRecord({facturaId:factura.id,empresaId:company,force:true});assert.equal(again.record.huella,record.huella);assert.deepEqual(again.record.payload,record.payload);
    await db.transaction(tx=>requeueFiscalRecord(tx,record));assert.equal((await processOne()).total,0);
    assert.equal((await db.query('SELECT count(*)::int n FROM factura_envios_fiscales WHERE registro_id=$1',[record.id])).rows[0].n,1);
    assert.equal((await processPendingFiscalQueue({empresaId:require('crypto').randomUUID(),facturaId:factura.id})).total,0);
    // Legacy uncertain delivery outside the provider's 24h dedupe window is never retried blindly.
    await db.query("UPDATE factura_envios_fiscales SET estado='error',retryable=true,response=NULL,first_attempt_at=now()-interval '25 hours',next_retry_at=now() WHERE id=$1",[item.id]);
    const previousCount=calls.length;assert.equal((await processOne()).items[0].reason,'reconciliation_required');assert.equal(calls.length,previousCount);
    return { assertions:26, immutableRecord:true, stableIdempotency:true, claimOnce:true, terminalAcceptance:true, tenant:true, network:'stub only; native multi-process and client pilot remain pending' };
  } finally {
    global.fetch=originalFetch;
    await db.query('UPDATE empresas SET configuracion=$1::jsonb WHERE id=$2',[JSON.stringify(previous),company]);
  }
};

const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { driverStops } = require('../src/services/driverStops');
const { transportProgress, withTransportProgress } = require('../src/services/transportProgress');

async function main() {
  const company = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
  const order = { id: '33333333-3333-4333-8333-333333333333', empresa_id: company, estado: 'en_curso', origen: 'A', destino: 'B' };
  assert.equal(transportProgress(order).codigo, 'en_curso');
  assert.equal(transportProgress(order).cobertura, 'sin_desglose');
  assert.equal(transportProgress(order, { carga_ok: true }).codigo, 'cargado');
  assert.equal(transportProgress(order, { carga_ok: true, viaje_iniciado: true }).codigo, 'en_transito');
  assert.equal(transportProgress(order, { carga_ok: false, viaje_iniciado: true }).codigo, 'en_curso');
  assert.equal(transportProgress(order, { carga_ok: 'false' }).codigo, 'en_curso');
  for (const estado of ['pendiente','confirmado','cargando','espera_descarga','descarga','entregado','facturado','cancelado','incidencia']) {
    assert.equal(transportProgress({ ...order, estado }, { carga_ok: true, viaje_iniciado: true }).codigo, estado, 'Never override an explicit order state with stale steps');
  }
  const multi = { ...order, puntos_carga: [{ id: 'a' }, { id: 'b' }], puntos_descarga: [{ id: 'c' }, { id: 'd' }] };
  const [a,b,c,d] = driverStops(multi);
  let data = { carga_ok: true, viaje_iniciado: true, paradas: { [a.id]: { carga_ok: true } } };
  assert.equal(transportProgress(multi, data).codigo, 'en_curso', 'One timestamp/global flag cannot complete multiple loads');
  data.paradas[b.id] = { carga_ok: true };
  assert.equal(transportProgress(multi, data).codigo, 'cargado');
  data.paradas[c.id] = { viaje_iniciado: true };
  assert.equal(transportProgress(multi, data).codigo, 'en_transito');
  data.paradas[c.id].firma_entrega = true;
  assert.equal(transportProgress(multi, data).codigo, 'en_curso', 'Intermediate delivery cannot imply a new departure');
  data.paradas[d.id] = { viaje_iniciado: true };
  assert.equal(transportProgress(multi, data).codigo, 'en_transito');
  assert.equal(transportProgress({ ...multi, puntos_carga: [{ id: 'different' }] }, data).codigo, 'en_curso', 'Edited stops must have their own evidence');
  assert.equal(transportProgress({ ...multi, puntos_descarga: [{ id: 'new-destination' }] }, data).codigo, 'en_curso', 'Editing a destination after departure cannot put the trip back at the loading site');

  const pg = new PGlite();
  try {
    await pg.exec('CREATE TABLE pedido_chofer_pasos (pedido_id uuid,empresa_id uuid,data jsonb)');
    // Deliberately duplicate the identifier in another tenant to prove scope.
    await pg.query('INSERT INTO pedido_chofer_pasos VALUES ($1,$2,$3),($1,$4,$5)', [order.id,company,JSON.stringify({carga_ok:true}),other,JSON.stringify({carga_ok:true,viaje_iniciado:true,firma:'private'})]);
    let reads = 0;
    const db = { query: (sql, args) => { reads++; return pg.query(sql, args); } };
    const output = await withTransportProgress(db, company, [order]);
    assert.equal(reads, 1);
    assert.equal(output[0].estado_operativo.codigo, 'cargado');
    assert.equal(output[0].estado, 'en_curso');
    assert.equal(order.estado_operativo, undefined, 'Do not mutate input/history');
    assert.equal(JSON.stringify(output).includes('firma'), false, 'Do not expose event payloads');
    await assert.rejects(withTransportProgress(db, other, [order]), /empresa/);
    assert.deepEqual(await withTransportProgress(db, company, []), []);
    assert.equal(reads, 1);
    await assert.rejects(withTransportProgress({query:async()=>{throw Error('offline');}}, company, [order]), /offline/, 'Do not mask database outages');
    await pg.exec('DROP TABLE pedido_chofer_pasos');
    assert.equal((await withTransportProgress(db, company, [order]))[0].estado_operativo.cobertura, 'sin_desglose');
  } finally { await pg.close(); }
  console.log('PASS transport progress: explicit events, legacy ambiguity, multi-stop, intermediate delivery, terminal states, one scoped query, privacy and missing-schema compatibility.');
}
main().catch(error => { console.error(error); process.exitCode=1; });

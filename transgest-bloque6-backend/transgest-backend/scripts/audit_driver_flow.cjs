const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { driverStops } = require('../src/services/driverStops');

// Called only by the isolated audit harness, with an already open synthetic workday.
module.exports = async function auditDriverFlow({ base, fetch, db, managerToken, driverToken, company, client, driver, vehicle, password }) {
  assert.match(base, /^http:\/\/127\.0\.0\.1:\d+\/api\/v1$/);
  let checks = 0;
  async function request(method, url, body, status = 200, token = driverToken) {
    const res = await fetch(base + url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const data = await res.json();
    assert.equal(res.status, status, `${method} ${url}: ${JSON.stringify(data)}`);
    checks++;
    return data;
  }
  const plannedDay = daysAgo => { const d=new Date(); d.setUTCDate(d.getUTCDate()-daysAgo); return d.toISOString().slice(0,10); };
  const plannedLoad=plannedDay(3), plannedDelivery=plannedDay(2);
  const agenda = history => request('GET', `/agenda${history?'?mostrar_resueltas=1':''}`, null, 200, managerToken);
  const order = await request('POST', '/pedidos', { cliente_id: client.id, chofer_id: driver.id, vehiculo_id: vehicle.id,
    origen: 'Valencia', destino: 'Madrid', fecha_carga: plannedLoad, fecha_descarga: plannedDelivery, importe: 500,
    puntos_carga: [{ id: 'pickup', direccion: 'Calle sintética 1', ciudad: 'Valencia' }],
    puntos_descarga: [{ id: 'dropoff', direccion: 'Calle sintética 2', ciudad: 'Madrid' }] }, 201, managerToken);
  await request('PATCH', `/pedidos/${order.id}/estado`, { estado: 'confirmado' }, 200, managerToken);
  const loadIncident = (await agenda()).find(e => e.pedido_id===order.id && e.cause_code==='carga_sin_finalizar');
  assert.ok(loadIncident?.explanation && loadIncident?.recommended_action, 'An overdue load explains its cause and action in Agenda');
  const trip = await request('GET', `/pedidos/${order.id}`);
  const [load, unload] = driverStops(trip);
  await request('GET', `/pedidos/${order.id}/documento-control-digital`, null, 409);
  const patch = (stop, data) => request('PATCH', `/pedidos/${order.id}/chofer-pasos`, { parada_id: stop.id, ...data });
  await patch(load, { carga_iniciada: true }); // Positioning does not require a ready DeCA.
  await request('POST', `/pedidos/${order.id}/gps`, { lat: 39.47, lng: -0.37 });
  await patch(load, { carga_proceso: true });
  await patch(load, { mercancia_confirmada: true, mercancia_cargada: 'Mercancía sintética', mercancia_palets: '2', mercancia_peso_kg: '100' });
  const doc = await request('POST', `/pedidos/${order.id}/chofer-docs`, { nombre: 'albaran-sintetico.pdf', tipo: 'albaran',
    file_mime: 'application/pdf', file_base64: Buffer.from('%PDF-1.4\nDocumento sintético de prueba').toString('base64') }, 201);
  assert.ok((await request('GET', `/pedidos/${order.id}/chofer-docs`)).some(d => d.id === doc.id));
  const file = await fetch(`${base}/pedidos/${order.id}/chofer-docs/${doc.id}/archivo`, { headers: { Authorization: `Bearer ${driverToken}` } });
  assert.equal(file.status, 200); assert.match(file.headers.get('content-type'), /application\/pdf/);
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0, 4).toString(), '%PDF'); checks++;
  const signature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  await patch(load, { albaran_carga: true });
  await request('POST', `/pedidos/${order.id}/firma`, { parada_id: load.id, rol: 'cargador', firma_nombre: 'Firmante sintético', firma: signature });
  await patch(load, { firma_cargador: true });
  await patch(load, { carga_ok: true });
  const loadedTrip = await request('GET', `/pedidos/${order.id}`);
  assert.equal(loadedTrip.estado, 'en_curso', 'The legacy state remains compatible');
  assert.equal(loadedTrip.estado_operativo?.codigo, 'cargado', 'Loading completion is not departure');
  for (const endpoint of ['/pedidos', '/pedidos/resumen-lista']) {
    const listing = await request('GET', `${endpoint}?q=${encodeURIComponent(order.numero)}`);
    assert.equal(listing.data.find(p => p.id === order.id)?.estado_operativo?.codigo, 'cargado');
  }
  await db.query(`INSERT INTO usuarios(id,empresa_id,cliente_id,nombre,email,password_hash,rol,activo)
    SELECT $1,$2,$3,'Portal sintético','progress-portal@example.invalid',password_hash,'cliente',true
    FROM usuarios WHERE empresa_id=$2 AND email='audit@example.invalid'`, [crypto.randomUUID(),company,client.id]);
  const portalLogin = await request('POST', '/auth/login', { email:'progress-portal@example.invalid', password });
  const portalOrders = await request('GET', '/portal-cliente/pedidos', null, 200, portalLogin.token);
  assert.equal(portalOrders.find(p => p.id === order.id)?.estado_operativo?.codigo, 'cargado');
  assert.equal(portalOrders.some(p => 'precio_colaborador' in p || 'importe' in p || 'paradas' in p), false, 'Portal progress exposes no internal economics or raw driver evidence');
  assert.equal((await agenda()).some(e => e.id===loadIncident.id), false, 'Completing the load hides its active incident');
  assert.ok((await agenda(true)).find(e => e.id===loadIncident.id)?.resolved_at, 'The resolved incident remains in history');
  await request('GET', `/pedidos/${order.id}/documento-control-digital`);
  await request('POST', `/pedidos/${order.id}/documento-control-digital/evento`, { action: 'consultado' });
  await request('GET', `/pedidos/${order.id}/carta-porte`);
  await patch(unload, { viaje_iniciado: true });
  assert.equal((await request('GET', `/pedidos/${order.id}`)).estado_operativo?.codigo, 'en_transito');
  await patch(unload, { posicionado_descarga: true });
  await patch(unload, { descarga_iniciada: true });
  await patch(unload, { mercancia_confirmada: true, mercancia_cargada: 'Mercancía sintética', mercancia_palets: '2', mercancia_peso_kg: '100' });
  await patch(unload, { descarga_ok: true });
  const finishedUnloading = (await db.query('SELECT descarga_real_at,estado FROM pedidos WHERE id=$1 AND empresa_id=$2', [order.id, company])).rows[0];
  assert.ok(finishedUnloading.descarga_real_at, 'Finalizar la última descarga debe registrar la fecha real antes de firmar');
  assert.notEqual(finishedUnloading.estado, 'entregado', 'La descarga física no sustituye la firma de entrega');
  await patch(unload, { albaran_descarga: true });
  await request('POST', `/pedidos/${order.id}/firma`, { parada_id: unload.id, rol: 'destinatario', firma_nombre: 'Receptor sintético', firma: signature });
  await patch(unload, { firma_entrega: true });
  const beforeRetry = (await db.query('SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2', [order.id, company])).rows[0].n;
  await patch(unload, { firma_entrega: true });
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM pedido_eventos WHERE pedido_id=$1 AND empresa_id=$2', [order.id, company])).rows[0].n, beforeRetry, 'Reintentar el cierre no duplica eventos');
  const done = (await db.query('SELECT estado,carga_real_at,descarga_real_at,fecha_carga_planificada,fecha_descarga_planificada FROM pedidos WHERE id=$1 AND empresa_id=$2', [order.id, company])).rows[0];
  assert.equal(done.estado, 'entregado'); assert.ok(done.carga_real_at && done.descarga_real_at);
  assert.equal(new Date(done.fecha_carga_planificada).toISOString().slice(0, 10), plannedLoad);
  assert.equal(new Date(done.fecha_descarga_planificada).toISOString().slice(0, 10), plannedDelivery);

  const otherDriver = crypto.randomUUID(), otherTrip = crypto.randomUUID(), otherCompany = crypto.randomUUID(), foreignTrip = crypto.randomUUID(), foreignClient = crypto.randomUUID();
  await db.query("INSERT INTO choferes(id,empresa_id,nombre,apellidos) VALUES($1,$2,'Otro','Sintético')", [otherDriver, company]);
  await db.query("INSERT INTO pedidos(id,empresa_id,numero,chofer_id,vehiculo_id,cliente_id,estado) VALUES($1,$2,'AJENO-SINTETICO',$3,$4,$5,'confirmado')", [otherTrip, company, otherDriver, vehicle.id, client.id]);
  for(const endpoint of ['/pedidos','/pedidos/resumen-lista']){
    const own=await request('GET',endpoint+'?q=AJENO-SINTETICO');
    assert.equal(own.data.some(item=>item.id===otherTrip),false,'A shared truck must not expose another assigned driver’s order in the list');
  }
  await db.query("INSERT INTO empresas(id,nombre,cif,email_admin,plan,estado) VALUES($1,'Empresa aislada sintética','B00000009','tenant-b@example.invalid','enterprise','activa')", [otherCompany]);
  await db.query("INSERT INTO clientes(id,empresa_id,nombre) VALUES($1,$2,'Cliente aislado sintético')", [foreignClient, otherCompany]);
  await db.query("INSERT INTO pedidos(id,empresa_id,cliente_id,numero,estado) VALUES($1,$2,$3,'OTRA-EMPRESA','confirmado')", [foreignTrip, otherCompany, foreignClient]);
  for (const [id, status] of [[otherTrip, 403], [foreignTrip, 404]]) {
    for (const [method, suffix, body] of [
      ['GET', '', null], ['GET', '/chofer-pasos', null], ['PATCH', '/chofer-pasos', { parada_id: load.id, carga_iniciada: true }],
      ['GET', '/chofer-docs', null], ['POST', '/chofer-docs', { nombre: 'documento.pdf', tipo: 'albaran', file_base64: 'JVBERg==' }],
      ['POST', '/gps', { lat: 40, lng: -3 }], ['POST', '/firma', { firma: signature, firma_nombre: 'No autorizado' }],
      ['GET', '/documento-control-digital', null], ['GET', '/carta-porte', null], ['GET', '/eventos', null],
      ['PATCH', '/estado', { estado: 'en_curso' }],
    ]) await request(method, `/pedidos/${id}${suffix}`, body, status);
  }
  assert.equal((await db.query('SELECT estado,ultima_posicion,firma_evidencia FROM pedidos WHERE id=$1', [otherTrip])).rows[0].estado, 'confirmado');
  assert.equal((await db.query('SELECT orden_carga_numero FROM pedidos WHERE id=$1',[otherTrip])).rows[0].orden_carga_numero,null,'A denied document read must not generate a document number');
  // Simulate inconsistent legacy references: tenant filtering must also cover joins.
  const foreignDriver=crypto.randomUUID(), foreignVehicle=crypto.randomUUID(), mixedTrip=crypto.randomUUID();
  await db.query("INSERT INTO choferes(id,empresa_id,nombre,apellidos) VALUES($1,$2,'FOREIGN-PRIVATE-DRIVER','Sintético')",[foreignDriver,otherCompany]);
  await db.query("INSERT INTO vehiculos(id,empresa_id,matricula) VALUES($1,$2,'FOREIGN-PRIVATE')",[foreignVehicle,otherCompany]);
  await db.query("INSERT INTO pedidos(id,empresa_id,cliente_id,chofer_id,vehiculo_id,remolque_id,numero,estado) VALUES($1,$2,$3,$4,$5,$5,'REF-LEGACY-SINTETICA','entregado')",[mixedTrip,company,foreignClient,foreignDriver,foreignVehicle]);
  const mixedCarta=await request('GET',`/pedidos/${mixedTrip}/carta-porte`,null,200,managerToken);
  const mixedDetail=await request('GET',`/pedidos/${mixedTrip}`,null,200,managerToken);
  for (const field of ['cliente_nombre','cliente_email','chofer_nombre','matricula']) assert.equal(mixedDetail[field],null,'Order detail must scope legacy joined references');
  for(const field of ['cliente_nombre','cliente_cif','chofer_nombre','chofer_dni','veh_matricula','rem_matricula']) {
    assert.equal(mixedCarta[field],null,`Carta de porte must not resolve cross-tenant ${field}`);
  }
  const mixedDcd=await request('GET',`/pedidos/${mixedTrip}/documento-control-digital`,null,200,managerToken);
  assert.doesNotMatch(JSON.stringify(mixedDcd),/Cliente aislado sintético|FOREIGN-PRIVATE/,'DeCA must not resolve foreign master data');
  const legacyCarta=await request('GET',`/legacy-pedidos/${mixedTrip}/carta-porte`,null,200,managerToken);
  assert.deepEqual(legacyCarta,await request('GET',`/pedidos/${mixedTrip}/carta-porte`,null,200,managerToken),'Compatibility entry point must retain payload and authorization');
  await request('GET',`/legacy-pedidos/${otherTrip}/carta-porte`,null,403);
  await request('GET',`/legacy-pedidos/${foreignTrip}/carta-porte`,null,404);
  return { passed: true, httpChecks: checks, writes: 'synthetic_only', coverage: 'driver lifecycle, workday, documents, signature, GPS, dates, retry and cross-driver/tenant rejection' };
};

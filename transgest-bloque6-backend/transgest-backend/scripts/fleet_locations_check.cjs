const assert = require('node:assert/strict');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const { readFleetLocations, locationForVehicle } = require('../src/services/fleetLocations');
const { createGpsSyncWindow } = require('../src/services/gpsSyncWindow');
const auth = require('../src/middleware/auth');
const db = require('../src/services/db');
const company = '11111111-1111-4111-8111-111111111111';
const otherCompany = '22222222-2222-4222-8222-222222222222';
const vehicle = '33333333-3333-4333-8333-333333333333';
const now = Date.now();
const originalAuth = auth.authenticate, originalQuery = db.query, originalTransaction = db.transaction;

(async () => {
  const pg = new PGlite();
  let server;
  try {
    let clock = 0, reads = 0, release;
    const sync = createGpsSyncWindow({ now: () => clock });
    const first = sync(company, 'geotab', () => { reads++; return new Promise(resolve => { release = resolve; }); });
    await Promise.resolve();
    const second = sync(company, 'geotab', () => { throw Error('Duplicate provider call'); });
    release({ updated: 14 });
    assert.equal((await first).updated, 14);
    assert.equal((await second).cached, true);
    assert.equal(reads, 1);
    assert.equal((await sync(otherCompany, 'geotab', async () => ({ updated: 2 }))).updated, 2);
    assert.equal((await sync(company, 'movildata', async () => ({ updated: 3 }))).updated, 3);
    assert.equal((await sync(company, 'geotab', async () => { throw Error('Too soon'); })).cached, true);
    clock = 60000;
    assert.equal((await sync(company, 'geotab', async () => ({ updated: 4 }))).updated, 4);
    let failedReads = 0;
    const failed = () => { failedReads++; throw Error('Provider unavailable'); };
    await assert.rejects(sync(company, 'locatel', failed), /Provider unavailable/);
    await assert.rejects(sync(company, 'locatel', failed), /Provider unavailable/);
    assert.equal(failedReads, 1);
    clock += 60000;
    assert.equal((await sync(company, 'locatel', async () => ({ updated: 1 }))).updated, 1);
    await assert.rejects(sync(null, 'geotab', failed), { status: 401 });
    await pg.exec(`
      CREATE TABLE empresas(id uuid PRIMARY KEY);
      CREATE TABLE vehiculos(id uuid, empresa_id uuid, matricula text, estado text,
        gps_provider text, activo boolean, clase text, tipo text, chofer_id uuid);
      CREATE TABLE choferes(id uuid, empresa_id uuid, nombre text, apellidos text);
      ALTER TABLE vehiculos ADD COLUMN gps_external_id text;
      CREATE TABLE gps_position_log(id uuid, empresa_id uuid, vehiculo_id uuid, provider text,
        lat numeric, lng numeric, velocidad_kmh numeric, recorded_at timestamptz, raw jsonb);
    `);
    await pg.query(`INSERT INTO vehiculos VALUES
      ($1,$2,'2418-LPH','disponible','geotab',true,'Tractora','tractora',$1),
      ($3,$3,'PRIVATE','disponible',NULL,true,'Tractora','tractora',NULL),
      (gen_random_uuid(),$2,'REMOLQUE','disponible',NULL,true,'Remolque','remolque',NULL),
      (gen_random_uuid(),$2,'INACTIVO','disponible',NULL,false,'Tractora','tractora',NULL)`, [vehicle, company, otherCompany]);
    await pg.query("INSERT INTO choferes VALUES($1,$2,'Ana','Prueba')", [vehicle, company]);
    const gps = (tenant, provider, minutes, raw = { timestamp_source: 'device' }) => pg.query(
      'INSERT INTO gps_position_log VALUES(gen_random_uuid(),$1,$2,$3,38,-1,0,$4,$5)',
      [tenant, vehicle, provider, new Date(now - minutes * 60000).toISOString(), JSON.stringify(raw)]);
    await gps(company, 'geotab', 30);
    await gps(company, 'app_chofer', 2);
    await gps(otherCompany, 'geotab', 0);
    let fleet = await readFleetLocations(pg, company, { now });
    assert.equal(fleet.items.length, 1);
    assert.equal(fleet.items[0].chofer_nombre, 'Ana Prueba');
    assert.equal(fleet.items[0].provider, 'geotab');
    assert.equal(fleet.items[0].status, 'obsoleta');
    assert.equal(fleet.items[0].position, null, 'A newer app signal cannot replace an assigned GPS');
    assert.equal(fleet.items[0].fallback, false);
    assert.ok(!JSON.stringify(fleet).includes('PRIVATE'));
    await gps(company, 'geotab', 4);
    fleet = await readFleetLocations(pg, company, { now });
    assert.equal(fleet.items[0].provider, 'geotab');
    assert.equal(fleet.items[0].fallback, false);
    await gps(company, 'movildata', 0);
    assert.equal((await readFleetLocations(pg, company, {now})).items[0].provider,'geotab');
    await pg.query("UPDATE vehiculos SET gps_provider='movildata' WHERE id=$1",[vehicle]);
    assert.equal((await readFleetLocations(pg, company, {now})).items[0].provider,'movildata');
    await pg.query("UPDATE vehiculos SET gps_provider='manual' WHERE id=$1",[vehicle]);
    assert.equal((await readFleetLocations(pg, company, {now})).items[0].provider,'app_chofer');
    await pg.query("UPDATE vehiculos SET gps_provider='geotab' WHERE id=$1",[vehicle]);
    const mixed=[
      {id:'gps-a',gps_provider:'geotab'}, {id:'gps-b',gps_provider:'movildata'}, {id:'mobile',gps_provider:'manual'}
    ];
    const mixedRows=mixed.flatMap(v=>['geotab','movildata','app_chofer'].map(provider=>({vehiculo_id:v.id,provider,lat:38,lng:-1,recorded_at:new Date(now).toISOString(),raw:{timestamp_source:'device'}})));
    assert.deepEqual(mixed.map(v=>locationForVehicle(v,mixedRows,{now}).provider),['geotab','movildata','app_chofer']);
    assert.equal((await readFleetLocations(pg, company, { now: now + 3600000 })).items[0].position, null);
    const row = { vehiculo_id: vehicle, provider: 'geotab', lat: 38, lng: -1,
      recorded_at: new Date(now).toISOString(), raw: { timestamp_source: 'device' } };
    for (const change of [{ raw: {} }, { lat: 91 }, { recorded_at: new Date(now + 120000).toISOString() }, { provider: 'manual' }]) {
      assert.equal(locationForVehicle({ id: vehicle, gps_provider:'geotab' }, [{ ...row, ...change }], { now }).position, null);
    }
    assert.equal(locationForVehicle({ id: vehicle }, [], { now }).status, 'sin_datos');
    await assert.rejects(readFleetLocations(pg, null), { status: 401 });

    db.query = (...args) => pg.query(...args);
    db.transaction = fn => pg.transaction(tx=>fn({query:(...args)=>tx.query(...args)}));
    await pg.query('INSERT INTO empresas VALUES($1),($2)',[company,otherCompany]);
    const keys=require('../src/services/apiKeys');
    await keys.setCompanyApiConfig(company,'geotab',{api_key:'fake-geotab',use_global:false});
    await keys.setCompanyApiConfig(company,'movildata',{api_key:'fake-movildata',use_global:false});
    // Substitute identity only. Preserve the production role, plan and module gates.
    auth.authenticate = (req, res, next) => {
      const who = req.get('x-test-user');
      if (!who) return res.status(401).json({ error: 'No autenticado' });
      req.user = { empresa_id: who === 'other' ? otherCompany : company,
        rol: who === 'driver' ? 'chofer' : 'gerente', plan: 'enterprise', productos: ['transgest'],
        ...(who === 'revoked' ? { permisos: { modulos: { vehiculos: { ver: false, editar: false } } } } : {}) };
      req.empresaId = req.user.empresa_id;
      next();
    };
    delete require.cache[require.resolve('../src/routes/vehiculos')];
    const router = require('../src/routes/vehiculos');
    const app = express();
    app.use(express.json());
    app.use('/vehiculos', auth.authenticate, auth.requireModulePermission('vehiculos'), router);
    auth.authenticate = originalAuth;
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const call = who => fetch(`http://127.0.0.1:${server.address().port}/vehiculos/localizacion?empresa_id=${otherCompany}`, {
      headers: who ? { 'x-test-user': who } : {}
    });
    for (const [who, status] of [[null, 401], ['driver', 403], ['revoked', 403]]) {
      assert.equal((await call(who)).status, status);
      const deniedSync = await fetch(`http://127.0.0.1:${server.address().port}/vehiculos/gps/sync`, {
        method: 'POST', headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who } : {}) },
        body: JSON.stringify({ provider: 'geotab', source: 'locate', empresa_id: otherCompany }),
      });
      assert.equal(deniedSync.status, status);
    }
    const response = await call('manager');
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.equal((await response.json()).items[0].matricula, '2418-LPH');
    assert.equal((await (await call('other')).json()).items[0].matricula, 'PRIVATE');
    const providers=await fetch(`http://127.0.0.1:${server.address().port}/vehiculos/gps/providers`,{headers:{'x-test-user':'manager'}});
    assert.equal(providers.status,200);
    const configuredProviders=await providers.json();
    assert.deepEqual(configuredProviders.active_providers,['geotab','movildata']);
    assert.equal(configuredProviders.active_provider,'');
    assert.deepEqual(configuredProviders.providers.filter(p=>p.active).map(p=>p.id).sort(),['geotab','movildata']);
    const privateProviders=await (await fetch(`http://127.0.0.1:${server.address().port}/vehiculos/gps/providers`,{headers:{'x-test-user':'other'}})).json();
    assert.deepEqual(privateProviders.active_providers,[]);
    console.log('PASS LOCATE: company-scoped GPS request sharing, cooldown and failed-read recovery; real SQL and HTTP route, company isolation, permissions, GPS priority, driver fallback, stale/invalid/undated signals, active tractors only. Synthetic local fixtures; no provider calls.');
  } finally {
    auth.authenticate = originalAuth;
    db.query = originalQuery;
    db.transaction = originalTransaction;
    if (server) await new Promise(resolve => server.close(resolve));
    await pg.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

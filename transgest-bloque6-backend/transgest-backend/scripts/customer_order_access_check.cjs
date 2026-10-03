const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const express = require('express');
const { PGlite } = require('@electric-sql/pglite');
const auth = require('../src/middleware/auth');
const db = require('../src/services/db');
const notifications = require('../src/services/notificaciones');

async function main() {
  const pg = new PGlite();
  const company = '11111111-1111-4111-8111-111111111111';
  const otherCompany = '22222222-2222-4222-8222-222222222222';
  const original = { query: db.query, authenticate: auth.authenticate,
    ensure: notifications.ensureNotificacionesSchema, create: notifications.crearNotificacion };
  let server;
  try {
    await pg.exec(`CREATE TABLE clientes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
      nombre text NOT NULL, cif text NOT NULL, direccion text, cp text, ciudad text,
      pais text, email text, telefono text, contacto text, forma_pago text,
      vencimiento text, tipo_iva numeric, iva_regimen text, tipo_irpf numeric,
      precio_tn_km numeric, activo boolean DEFAULT true, notas text,
      pendiente_revision boolean DEFAULT false, bloqueado boolean DEFAULT false,
      bloqueo_motivo text, limite_riesgo numeric DEFAULT 0, created_at timestamptz DEFAULT now());
      CREATE TABLE facturas (empresa_id uuid, cliente_id uuid, total numeric, estado text);
      CREATE TABLE pedidos (empresa_id uuid, cliente_id uuid, importe numeric,
        precio_cliente_col numeric, tipo_precio text, precio_unitario numeric,
        cantidad numeric, minimo_unidades numeric, estado text, factura_id uuid);`);
    db.query = (...args) => pg.query(...args);
    // Only identity is synthetic. The real module, role, validation, SQL and
    // tenant guards run through Express, without a production connection.
    auth.authenticate = (req, res, next) => {
      const role = req.get('x-test-role');
      if (!role) return res.status(401).json({ error: 'No autenticado' });
      req.user = { id: company, empresa_id: company, rol: role, plan: 'enterprise', productos: ['transgest'],
        ...(req.get('x-test-read-only') ? { permisos: { modulos: { clientes: { ver: true, editar: false } } } } : {}) };
      req.empresaId = company;
      next();
    };
    notifications.ensureNotificacionesSchema = async () => {};
    notifications.crearNotificacion = async () => {};
    delete require.cache[require.resolve('../src/routes/clientes')];
    const router = require('../src/routes/clientes');
    const app = express();
    app.use(express.json());
    app.use('/clientes', auth.authenticate, auth.requireModulePermission('clientes'), router);
    server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.on('listening', resolve));
    const call = (role, method, route = '', body, readOnly = false) => fetch(`http://127.0.0.1:${server.address().port}/clientes${route}`, {
      method, headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}), ...(readOnly ? { 'x-test-read-only': 'true' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal((await call(null, 'POST', '', { nombre: 'Sin acceso' })).status, 401);
    for (const role of ['chofer', 'cliente', 'visualizador']) {
      assert.equal((await call(role, 'POST', '', { nombre: 'Sin acceso' })).status, 403, role);
    }
    assert.equal((await call('trafico', 'POST', '', { nombre: 'Revocado' }, true)).status, 403);
    const created = [];
    for (const role of ['gerente', 'contable', 'trafico', 'administrativo']) {
      const response = await call(role, 'POST', '', { nombre: `Cliente ${role}`, empresa_id: otherCompany });
      assert.equal(response.status, 201, `${role}: ${await response.clone().text()}`);
      const customer = await response.json();
      assert.equal(customer.empresa_id, company, 'request cannot change tenant');
      assert.equal(customer.pendiente_revision, role==='trafico', 'authorized office profiles create reviewed customers; traffic keeps incomplete review');
      assert.equal(customer.bloqueado, false, 'pending review is not a manual block');
      created.push(customer);
    }
    const customer = created[2];
    let response = await call('trafico', 'PUT', `/${customer.id}`, { nombre: customer.nombre, cif: 'B12345678', direccion: 'Calle Prueba 1', cp: '28013', ciudad: 'Madrid', email: 'prueba@example.invalid', telefono: '600000000' });
    assert.equal(response.status, 200, await response.clone().text());
    assert.equal((await response.json()).direccion, 'Calle Prueba 1');
    assert.equal((await call('trafico', 'PUT', `/${customer.id}`, { nombre: 'Revocado' }, true)).status, 403);
    const foreign = (await pg.query('INSERT INTO clientes(empresa_id,nombre,cif) VALUES($1,$2,$3) RETURNING id', [otherCompany, 'Otra empresa', 'B87654321'])).rows[0];
    assert.equal((await call('trafico', 'PUT', `/${foreign.id}`, { nombre: 'No tocar' })).status, 404);
    assert.equal((await call('trafico', 'DELETE', `/${customer.id}`)).status, 403, 'traffic does not gain deletion or portal credentials');
    assert.equal((await call('trafico', 'POST', `/${customer.id}/portal-user`, {})).status, 403);

    // Execute the actual order admission guard against SQL fixtures. Creating
    // an incomplete client must not bypass risk/manual blocks or tenant scope.
    const source = fs.readFileSync(path.join(__dirname, '../src/routes/pedidos.js'), 'utf8');
    const start = source.indexOf('async function assertClienteAdmiteNuevoPedido(');
    const end = source.indexOf('\nasync function updateVehiculoKmFromOdometer(', start);
    assert(start >= 0 && end > start);
    const scope = { usuarioEsGerencia: req => req.user.rol === 'gerente' };
    vm.runInNewContext(source.slice(start, end) + '\nthis.admit = assertClienteAdmiteNuevoPedido;', scope);
    const req = { empresaId: company, user: { rol: 'trafico' } };
    await scope.admit(pg, req, created[3].id, 200);
    await assert.rejects(scope.admit(pg, req, foreign.id, 200), { status: 404 });
    await pg.query('UPDATE clientes SET bloqueado=true WHERE id=$1', [created[3].id]);
    await assert.rejects(scope.admit(pg, req, created[3].id, 200), { code: 'CLIENTE_BLOQUEADO' });
    await pg.query('UPDATE clientes SET bloqueado=false,limite_riesgo=100 WHERE id=$1', [created[3].id]);
    await assert.rejects(scope.admit(pg, req, created[3].id, 200), { code: 'CLIENTE_RIESGO_BLOQUEADO' });
    console.log('PASS customer HTTP create/edit permissions, incomplete-client order admission, manual/risk blocks, explicit revocations and company isolation. Synthetic SQL only.');
  } finally {
    auth.authenticate = original.authenticate; db.query = original.query;
    notifications.ensureNotificacionesSchema = original.ensure; notifications.crearNotificacion = original.create;
    if (server) await new Promise(resolve => server.close(resolve));
    await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

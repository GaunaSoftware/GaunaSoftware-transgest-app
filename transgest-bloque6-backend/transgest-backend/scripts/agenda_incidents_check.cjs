const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { syncOrderIncidents } = require('../src/services/agendaIncidents');

(async () => {
  const db = new PGlite();
  const companyA = '11111111-1111-4111-8111-111111111111';
  const companyB = '22222222-2222-4222-8222-222222222222';
  const order = '33333333-3333-4333-8333-333333333333';
  try {
    await db.exec(`
      CREATE TABLE empresas (id uuid PRIMARY KEY, cfg_trafico jsonb DEFAULT '{}'::jsonb);
      CREATE TABLE usuarios (id uuid PRIMARY KEY, nombre text, rol text);
      CREATE TABLE pedidos (id uuid PRIMARY KEY, empresa_id uuid NOT NULL, numero text,
        estado text, fecha_carga date, fecha_entrega date, fecha_descarga date,
        pendiente_completar boolean DEFAULT false, incidencia_automatica boolean DEFAULT false);
      CREATE TABLE pedido_chofer_pasos (pedido_id uuid PRIMARY KEY, empresa_id uuid NOT NULL, data jsonb);
      CREATE TABLE agenda_eventos (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), empresa_id uuid NOT NULL,
        titulo text NOT NULL, descripcion text, fecha_inicio timestamptz, todo_dia boolean,
        tipo text, prioridad text, estado text, visibilidad text, pedido_id uuid,
        creado_por uuid, asignado_a uuid,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
    `);
    const migration = fs.readFileSync(path.join(__dirname, 'migrations/20260925_agenda_incident_lifecycle.sql'), 'utf8');
    await db.exec(migration);
    await db.exec(migration);
    await db.query('INSERT INTO empresas(id) VALUES($1),($2)', [companyA, companyB]);
    await db.query(`INSERT INTO pedidos(id,empresa_id,numero,estado,fecha_carga,fecha_entrega)
      VALUES($1,$2,'PED-TEST-1','confirmado','2026-09-22','2026-09-23')`, [order, companyA]);
    const sync = () => syncOrderIncidents({ empresaId:companyA, pedidoId:order, queryable:db, today:'2026-09-25' });
    await sync();
    await sync();
    let rows = (await db.query('SELECT * FROM agenda_eventos ORDER BY cause_code')).rows;
    assert.equal(rows.length, 2, 'Repeated reconciliation must not duplicate active incidents');
    assert.ok(rows.every(row => row.source_type === 'pedido' && row.source_id === order && row.pedido_id === order));
    assert.ok(rows.every(row => row.generated_at && row.explanation && row.recommended_action && row.resolution_condition));

    const appDb = require('../src/services/db');
    const originalQuery = appDb.query;
    appDb.query = (sql, params) => db.query(sql, params);
    try {
      const agenda = require('../src/routes/agenda');
      const get = agenda.stack.find(layer => layer.route?.path === '/' && layer.route.methods.get).route.stack.at(-1).handle;
      const response = () => ({ json(data) { this.data=data; return this; }, status(code) { this.code=code; return this; } });
      const manager = response();
      await get({ user:{ id:companyA, empresa_id:companyA, rol:'gerente' }, query:{ modo:'mias' } }, manager);
      assert.equal(manager.data.length, 2, 'Team automatic incidents must be visible in default manager agenda');
      const driver = response();
      await get({ user:{ id:companyB, empresa_id:companyA, rol:'chofer' }, query:{} }, driver);
      assert.equal(driver.data.length, 0, 'Driver must not see unrelated team incidents');
      const otherTenant = response();
      await get({ user:{ id:companyB, empresa_id:companyB, rol:'gerente' }, query:{} }, otherTenant);
      assert.equal(otherTenant.data.length, 0);
      const patch = agenda.stack.find(layer => layer.route?.path === '/:id' && layer.route.methods.patch).route.stack.at(-1).handle;
      await assert.rejects(
        patch({ user:{ id:companyA, empresa_id:companyA, rol:'gerente' }, params:{ id:rows[0].id }, body:{ estado:'hecha' } }, response()),
        error => error.statusCode === 409,
        'An automatic incident cannot be manually hidden or edited'
      );
    } finally {
      appDb.query = originalQuery;
    }

    await syncOrderIncidents({ empresaId:companyB, pedidoId:order, queryable:db, today:'2026-09-25' });
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NOT NULL')).rows[0].n, 0);

    await db.query('INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,data) VALUES($1,$2,$3::jsonb)',
      [order, companyA, JSON.stringify({ carga_ok:true })]);
    await db.query("UPDATE pedidos SET estado='en_curso' WHERE id=$1", [order]);
    await sync();
    rows = (await db.query('SELECT cause_code,resolved_at,resolution_reason FROM agenda_eventos ORDER BY cause_code')).rows;
    assert.ok(rows.find(row => row.cause_code === 'carga_sin_finalizar').resolved_at);
    assert.equal(rows.find(row => row.cause_code === 'entrega_vencida').resolved_at, null);

    await db.query("UPDATE pedidos SET estado='entregado' WHERE id=$1", [order]);
    await sync();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NULL')).rows[0].n, 0);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos')).rows[0].n, 2, 'History is preserved');

    await db.query('DELETE FROM pedido_chofer_pasos WHERE pedido_id=$1', [order]);
    await db.query("UPDATE pedidos SET estado='confirmado' WHERE id=$1", [order]);
    await sync();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NULL')).rows[0].n, 2);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos')).rows[0].n, 4, 'New occurrence retains prior resolution');
    await db.query("UPDATE empresas SET cfg_trafico='{\"auto_incidencia\":false}'::jsonb WHERE id=$1", [companyA]);
    await sync();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NULL')).rows[0].n, 0, 'Disabling automation resolves active auto incidents');
    await db.query("UPDATE empresas SET cfg_trafico='{}'::jsonb WHERE id=$1", [companyA]);
    await db.query("UPDATE pedidos SET pendiente_completar=true WHERE id=$1", [order]);
    await sync();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NULL')).rows[0].n, 0, 'Unfinished drafts must not create incidents');
    await db.query("UPDATE pedidos SET pendiente_completar=false, estado='facturado' WHERE id=$1", [order]);
    await sync();
    assert.equal((await db.query('SELECT count(*)::int AS n FROM agenda_eventos WHERE resolved_at IS NULL')).rows[0].n, 0, 'Invoiced orders are final');
    const fresh = new PGlite();
    try {
      await fresh.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY);
        CREATE TABLE usuarios(id uuid PRIMARY KEY);
        CREATE TABLE pedidos(id uuid PRIMARY KEY);
        CREATE TABLE vehiculos(id uuid PRIMARY KEY);`);
      await fresh.exec(migration);
      await fresh.exec(migration);
      assert.equal((await fresh.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='agenda_eventos' AND column_name='cause_code'")).rows[0].n, 1);
    } finally { await fresh.close(); }
    console.log('PASS agenda incidents: migration repeat, reasons, active dedupe, resolution, history and tenant isolation');
  } finally {
    await db.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

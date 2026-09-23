const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const weekly = require('../src/services/weeklyBiReports');
const routes = require('../src/routes/biReportCenter');
const { PLANTILLAS } = require('../src/services/email');

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const MANAGER = '10000000-0000-4000-8000-000000000001';
const SECOND = '10000000-0000-4000-8000-000000000002';
const OTHER = '10000000-0000-4000-8000-000000000003';
const TRAFFIC = '10000000-0000-4000-8000-000000000004';

async function call(route, method, company, user, role = 'gerente', body = {}) {
  const layer = routes.stack.find(item => item.route?.path === route && item.route.methods[method.toLowerCase()]);
  let status = 200, result;
  const response = { status(code) { status = code; return this; }, json(value) { result = value; return this; } };
  await layer.route.stack[0].handle({ empresaId: company, user: { id: user, rol: role }, body }, response);
  return { status, result };
}

async function main() {
  const template = PLANTILLAS.bi_rentabilidad_semanal({ empresa: '<Empresa & A>', desde: '2026-09-21', hasta: '2026-09-27' });
  assert.ok(template.html.includes('&lt;Empresa &amp; A&gt;'));
  assert.ok(template.html.includes('El margen directo no es beneficio neto'));
  assert.deepEqual(weekly.weeklyPeriod(new Date('2026-09-28T07:00:00Z')),
    { desde: '2026-09-21', hasta: '2026-09-27' });
  assert.deepEqual(weekly.weeklyPeriod(new Date('2026-10-26T08:00:00Z')),
    { desde: '2026-10-19', hasta: '2026-10-25' }, 'Madrid DST transition');
  assert.equal(weekly.madridClock(new Date('2026-10-26T08:00:00Z')).hour, 9);
  assert.equal(weekly.madridClock(new Date('2026-10-26T07:59:00Z')).hour, 8);

  const pg = new PGlite();
  const oldQuery = db.query, oldTransaction = db.transaction;
  try {
    await pg.exec(`CREATE TABLE empresas(id uuid PRIMARY KEY,nombre text,plan text,estado text);
      CREATE TABLE usuarios(id uuid PRIMARY KEY,empresa_id uuid REFERENCES empresas(id),nombre text,email text,rol text,activo boolean,permisos jsonb);
      CREATE TABLE bi_report_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),empresa_id uuid,owner_id uuid,snapshot jsonb);
      INSERT INTO empresas VALUES ('${A}','Empresa A','profesional','activo'),('${B}','Empresa B','profesional','activo');
      INSERT INTO usuarios VALUES
        ('${MANAGER}','${A}','Gerente A','manager-a@example.test','gerente',true,'{}'),
        ('${SECOND}','${A}','Gerente B','manager-b@example.test','gerente',true,'{}'),
        ('${OTHER}','${B}','Gerente C','manager-c@example.test','gerente',true,'{}'),
        ('${TRAFFIC}','${A}','Tráfico','traffic@example.test','trafico',true,'{}');`);
    await pg.exec(fs.readFileSync(path.join(__dirname, 'migrations', '20260923_bi_weekly_delivery.sql'), 'utf8'));
    db.query = (sql, params) => pg.query(sql, params);
    db.transaction = async fn => { await pg.exec('BEGIN'); try { const result = await fn({ query: db.query }); await pg.exec('COMMIT'); return result; }
      catch (error) { await pg.exec('ROLLBACK'); throw error; } };

    assert.equal((await call('/semanal/configuracion', 'GET', A, TRAFFIC, 'trafico')).status, 403);
    assert.equal((await call('/semanal/configuracion', 'PUT', A, TRAFFIC, 'trafico', { destinatarios: [MANAGER] })).status, 403);
    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [OTHER] })).status, 400,
      'A cannot subscribe manager of B');
    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [TRAFFIC] })).status, 400,
      'Traffic role cannot receive internal report');
    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [MANAGER, SECOND] })).status, 200);
    const settings = await call('/semanal/configuracion', 'GET', A, MANAGER);
    assert.equal(settings.status, 200);
    assert.equal(settings.result.gerentes.length, 2);
    assert.equal(settings.result.destinatarios.length, 2);
    assert.equal((await call('/semanal/configuracion', 'GET', B, OTHER)).result.destinatarios.length, 0);

    const sent = [];
    const deps = {
      query: db.query,
      products: async () => ({ productos: ['transgest'] }),
      generate: async (company, user, config) => {
        assert.equal(company, A); assert.ok([MANAGER, SECOND].includes(user));
        assert.equal(config.template, 'vehiculo'); assert.equal(config.desde, '2026-09-21');
        const saved = await pg.query('INSERT INTO bi_report_runs(empresa_id,owner_id,snapshot) VALUES($1,$2,$3) RETURNING id',
          [company, user, JSON.stringify({ title: 'Informe sintético', metadata: { periodo: { desde: config.desde, hasta: config.hasta } } })]);
        return { id: saved.rows[0].id };
      },
      renderPdf: async () => Buffer.from('%PDF-1.4 synthetic test'),
      send: async mail => { sent.push(mail); return { messageId: `test-${sent.length}` }; },
    };
    assert.equal((await weekly.tick(new Date('2026-09-28T06:59:00Z'), deps)).skipped, 'fuera_de_horario');
    assert.equal(sent.length, 0);
    const first = await weekly.tick(new Date('2026-09-28T07:00:00Z'), deps);
    assert.deepEqual(first.results.map(item => item.status), ['enviado', 'enviado']);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent.map(item => item.destinatario).sort(), ['manager-a@example.test', 'manager-b@example.test']);
    for (const mail of sent) {
      assert.equal(mail.empresa_id, A);
      assert.equal(mail.attachments.length, 1);
      assert.equal(mail.attachments[0].contentType, 'application/pdf');
      assert.equal(mail.datos.desde, '2026-09-21');
    }
    assert.deepEqual((await weekly.tick(new Date('2026-09-28T07:15:00Z'), deps)).results.map(item => item.status),
      ['ya_registrado', 'ya_registrado'], 'restart or next tick cannot duplicate the weekly mail');
    assert.equal(sent.length, 2);
    const rows = await pg.query('SELECT status,week_start,empresa_id FROM bi_weekly_deliveries');
    assert.equal(rows.rows.length, 2);
    assert.ok(rows.rows.every(row => row.status === 'enviado' && row.empresa_id === A));
    assert.equal((await call('/semanal/configuracion', 'GET', B, OTHER)).result.ultimos_envios.length, 0);

    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [MANAGER] })).status, 200);
    await pg.query('UPDATE empresas SET plan=$2 WHERE id=$1', [A, 'basico']);
    assert.equal((await weekly.tick(new Date('2026-10-05T07:00:00Z'), deps)).results.length, 0, 'plan controls delivery');
    await pg.query('UPDATE empresas SET plan=$2 WHERE id=$1', [A, 'profesional']);
    assert.equal((await weekly.tick(new Date('2026-10-05T07:00:00Z'), { ...deps, products: async () => ({ productos: ['planner'] }) })).results.length, 0,
      'Planner-only cannot receive TransGest internal report');
    const simulated = await weekly.tick(new Date('2026-10-05T07:00:00Z'), { ...deps,
      generate: async (company, user, config) => {
        const saved = await pg.query('INSERT INTO bi_report_runs(empresa_id,owner_id,snapshot) VALUES($1,$2,$3) RETURNING id',
          [company, user, JSON.stringify({ title: 'Test', metadata: { periodo: config } })]);
        return { id: saved.rows[0].id };
      },
      send: async () => ({ simulado: true }),
    });
    assert.equal(simulated.results[0].status, 'sin_smtp');
    assert.equal((await weekly.tick(new Date('2026-10-05T07:15:00Z'), deps)).results[0].status, 'ya_registrado',
      'simulated SMTP must not be marked delivered or silently retried');
    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [] })).status, 200);
    assert.equal((await weekly.tick(new Date('2026-10-12T07:00:00Z'), deps)).results.length, 0, 'empty settings disable delivery');
    assert.equal((await call('/semanal/configuracion', 'PUT', A, MANAGER, 'gerente', { destinatarios: [MANAGER] })).status, 200);
    const failed = await weekly.tick(new Date('2026-10-19T07:00:00Z'), {
      ...deps, generate: async () => { throw new Error('Error sintético antes de SMTP'); },
    });
    assert.equal(failed.results[0].status, 'fallido');
    assert.equal((await weekly.tick(new Date('2026-10-19T07:15:00Z'), deps)).results[0].status, 'ya_registrado');
    const ambiguous = await weekly.tick(new Date('2026-10-26T08:00:00Z'), {
      ...deps,
      generate: async (company, user, config) => {
        const saved = await pg.query('INSERT INTO bi_report_runs(empresa_id,owner_id,snapshot) VALUES($1,$2,$3) RETURNING id',
          [company, user, JSON.stringify({ title: 'Test', metadata: { periodo: config } })]);
        return { id: saved.rows[0].id };
      },
      send: async () => { throw new Error('Timeout sintético tras entregar a SMTP'); },
    });
    assert.equal(ambiguous.results[0].status, 'por_verificar');
    assert.equal((await weekly.tick(new Date('2026-10-26T08:15:00Z'), deps)).results[0].status, 'ya_registrado',
      'an ambiguous SMTP timeout must never duplicate mail automatically');
    const visible = (await call('/semanal/configuracion', 'GET', A, MANAGER)).result.ultimos_envios;
    assert.ok(visible.some(item => item.status === 'fallido'));
    assert.ok(visible.some(item => item.status === 'por_verificar'));
    console.log('BI weekly: Madrid calendar/DST, opt-in, roles, tenants, plan, PDF attachment, idempotency and SMTP simulation OK');
  } finally {
    db.query = oldQuery; db.transaction = oldTransaction;
    await pg.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });

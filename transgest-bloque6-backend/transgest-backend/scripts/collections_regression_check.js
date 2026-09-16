const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const email = require('../src/services/email');
const logger = require('../src/services/logger');
const router = require('../src/routes/facturas');

async function main() {
  const pg = new PGlite();
  const original = { query: db.query, send: email.enviarEmail, silent: logger.silent };
  const empresa = randomUUID(), other = randomUUID();
  const cliente = randomUUID(), otherCliente = randomUUID();
  const handler = router.stack.find(layer => layer.route?.path === '/reclamaciones/procesar').route.stack.at(-1).handle;
  const calls = [];
  let mode = 'success';
  db.query = async (sql, params) => params?.length ? pg.query(sql, params) : (await pg.exec(sql)).at(-1);
  email.enviarEmail = async data => {
    calls.push(data);
    if (mode === 'failure') throw Object.assign(new Error('SMTP failure, regression only'),{code:'EAUTH'});
    if (mode === 'simulated') return { simulado: true };
    if (mode === 'partial' && data.destinatario === 'fail@example.test') throw Object.assign(new Error('Rejected recipient'),{code:'EENVELOPE'});
    return { messageId: 'local-test-id' };
  };
  logger.silent = true;
  async function run(owner = empresa, body = {}) {
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    await handler({ empresaId: owner, user: { empresa_id: owner }, body }, res, error=>res.status(error.status || 500).json({error:error.message}));
    return res;
  }
  async function seed({ estado = 'emitida', total = 100, owner = empresa, client = cliente, due = -2, review = -1, count = 0 } = {}) {
    const id = randomUUID();
    await pg.query(`INSERT INTO facturas(id,numero,empresa_id,cliente_id,estado,total,fecha,fecha_vencimiento,revision_cobro_at,reclamacion_envios)
      VALUES($1,$2,$3,$4,$5,$6,CURRENT_DATE-10,CURRENT_DATE+$7::int,CURRENT_DATE+$8::int,$9)`,
    [id, id, owner, client, estado, total, due, review, count]);
    return id;
  }
  const read = async id => (await pg.query('SELECT * FROM facturas WHERE id=$1', [id])).rows[0];
  async function reset() {
    await pg.exec('DELETE FROM facturas');
    await pg.query("UPDATE clientes SET email='billing@example.test', email_facturacion='BILLING@example.test; billing@example.test' WHERE id=$1", [cliente]);
    await pg.query("UPDATE empresas SET configuracion='{}' WHERE id=$1", [empresa]);
    calls.length = 0;
    mode = 'success';
  }

  try {
    await pg.exec(`CREATE TABLE empresas(id UUID PRIMARY KEY,nombre TEXT,configuracion JSONB DEFAULT '{}');
      CREATE TABLE clientes(id UUID PRIMARY KEY,empresa_id UUID,nombre TEXT,email TEXT,email_facturacion TEXT);
      CREATE TABLE facturas(id UUID PRIMARY KEY,numero TEXT,empresa_id UUID,cliente_id UUID,estado TEXT,total NUMERIC,
        fecha DATE,fecha_vencimiento DATE,revision_cobro_at DATE,reclamacion_envios INT DEFAULT 0,
        reclamacion_estado TEXT DEFAULT 'normal',reclamacion_hasta DATE,reclamacion_ultimo_envio_at TIMESTAMPTZ,aviso_cobro_dias INT DEFAULT 7);`);
    await pg.query('INSERT INTO empresas(id,nombre) VALUES($1,$2),($3,$4)', [empresa, 'Transportista QA', other, 'Otra empresa']);
    await pg.query('INSERT INTO clientes(id,empresa_id,nombre,email) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',
      [cliente, empresa, 'Cliente QA', 'billing@example.test', otherCliente, other, 'Otro cliente', 'other@example.test']);
    await reset();

    const excluded = [];
    for (const estado of ['borrador', 'cobrada', 'anulada', 'rectificada', 'sin_cobrar']) excluded.push(await seed({ estado }));
    excluded.push(await seed({ total: 0 }), await seed({ total: -100 }), await seed({ due: 0 }),
      await seed({ due: 1 }), await seed({ due: null }), await seed({ review: 1 }),
      await seed({ owner: other, client: otherCliente }), await seed({ client: otherCliente }));
    const eligible = [];
    for (const estado of ['emitida', 'enviada', 'vencida', 'reclamada']) eligible.push(await seed({ estado }));
    const before = await pg.query('SELECT * FROM facturas WHERE id=ANY($1::uuid[]) ORDER BY id', [excluded]);
    let res = await run();
    assert.equal(res.code, 200);
    assert.equal(res.data.revisadas, 4);
    assert.equal(res.data.emails, 4);
    assert.equal(calls.length, 4, 'duplicate addresses must not receive multiple copies');
    assert.deepEqual((await pg.query('SELECT * FROM facturas WHERE id=ANY($1::uuid[]) ORDER BY id', [excluded])).rows, before.rows);
    for (const id of eligible) assert.equal((await read(id)).reclamacion_envios, 1);
    assert.equal(calls[0].datos.empresa, 'Transportista QA');
    assert.equal(calls[0].meta.factura_id, calls[0].datos.numero);
    assert.equal(calls[0].empresa_id, empresa);
    assert.equal((await run()).data.emails, 0, 'repeat review respects interval');

    for (const outcome of ['failure', 'simulated']) {
      await reset();
      const id = await seed();
      mode = outcome;
      res = await run();
      assert.equal(res.code, 200);
      assert.equal(res.data.emails, 0);
      assert.equal(res.data[outcome === 'failure' ? 'emails_fallidos' : 'emails_simulados'], 1);
      assert.equal((await read(id)).reclamacion_envios, 0);
      assert.equal((await read(id)).reclamacion_ultimo_envio_at, null);
      mode = 'success';
      assert.equal((await run()).data.emails, 1, 'failed/simulated attempt does not consume the interval');
    }

    await reset();
    const partial = await seed();
    await pg.query("UPDATE clientes SET email_facturacion='fail@example.test' WHERE id=$1", [cliente]);
    mode = 'partial';
    res = await run();
    assert.equal(res.data.emails, 1);
    assert.equal(res.data.emails_fallidos, 1);
    assert.equal((await read(partial)).reclamacion_envios, 1, 'count collection rounds, not recipients');

    await reset();
    const exhausted = await seed({ count: 6 });
    assert.equal((await run(empresa, { max_envios: 20 })).data.emails, 0, 'request cannot bypass company limit');
    assert.equal((await read(exhausted)).reclamacion_envios, 6);
    await reset();
    const disabled = await seed();
    await pg.query('UPDATE empresas SET configuracion=$2 WHERE id=$1', [empresa, { facturacion_cobros: { envio_email_auto: false } }]);
    assert.equal((await run()).data.emails, 0);
    assert.equal((await read(disabled)).reclamacion_envios, 0);
    await reset();
    await seed();
    await pg.query("UPDATE clientes SET email='',email_facturacion='invalid' WHERE id=$1", [cliente]);
    assert.equal((await run()).data.sin_destinatario, 1);
    assert.equal(calls.length, 0);

    await reset();
    const expired = await seed();
    const today = await seed();
    await pg.query('UPDATE facturas SET reclamacion_hasta=CURRENT_DATE-1 WHERE id=$1', [expired]);
    await pg.query('UPDATE facturas SET reclamacion_hasta=CURRENT_DATE WHERE id=$1', [today]);
    res = await run();
    assert.equal(res.data.sin_cobrar, 1);
    assert.equal((await read(expired)).estado, 'sin_cobrar');
    assert.equal((await read(today)).estado, 'reclamada', 'deadline is not exhausted at midnight of its last day');

    await reset();
    const paid = await seed();
    db.query = async (sql, params) => {
      const result = await pg.query(sql, params);
      if (sql.includes('SELECT f.*')) await pg.query("UPDATE facturas SET estado='cobrada' WHERE id=$1", [paid]);
      return result;
    };
    assert.equal((await run()).data.emails, 0);
    assert.equal((await read(paid)).estado, 'cobrada');
    db.query = async (sql, params) => params?.length ? pg.query(sql, params) : (await pg.exec(sql)).at(-1);

    await reset();
    await seed();
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { started = resolve; });
    const fakeSend = email.enviarEmail;
    email.enviarEmail = async data => { started(); await gate; return fakeSend(data); };
    const first = run();
    try {
      await entered;
      assert.equal((await run()).code, 409, 'double click is rejected while this process handles the company');
      assert.equal((await run(other)).code, 200, 'another company is not locked');
    } finally { release(); }
    assert.equal((await first).code, 200);
    email.enviarEmail = fakeSend;

    db.query = async () => { throw new Error('regression database failure'); };
    assert.equal((await run()).code, 500);
    db.query = async (sql, params) => params?.length ? pg.query(sql, params) : (await pg.exec(sql)).at(-1);
    assert.equal((await run()).code, 200, 'failed processing releases the company lock');

    const template = email.PLANTILLAS.factura_reclamacion({ numero: '<script>x</script>\r\nInjected', cliente: '<img src=x>', empresa: 'QA & Co', total: 12.5 });
    assert.ok(!template.html.includes('<script>'));
    assert.ok(!template.html.includes('<img src=x>'));
    assert.ok(template.html.includes('QA &amp; Co'));
    assert.ok(!/[\r\n]/.test(template.asunto));
    console.log('OK cobros: elegibilidad, aislamiento, SMTP simulado/fallido/parcial, intervalos, limites, fechas, doble clic y plantilla.');
  } finally {
    db.query = original.query;
    email.enviarEmail = original.send;
    logger.silent = original.silent;
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

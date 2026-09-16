const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const logger = require('../src/services/logger');

async function main() {
  const pg = new PGlite();
  const original = { query: db.query, transaction: db.transaction, silent: logger.silent };
  db.query = (sql, params) => pg.query(sql, params);
  const transaction = fn => pg.transaction(client => fn(client));
  db.transaction = transaction;
  logger.silent = true;
  const empresa = randomUUID(), other = randomUUID(), a = randomUUID(), b = randomUUID(), foreign = randomUUID();
  const draft = randomUUID(), issued = randomUUID(), foreignDraft = randomUUID(), wrongCustomerDraft = randomUUID();
  const router = require('../src/routes/facturas');
  async function read(query = {}, clienteId, owner = empresa, rol = 'gerente') {
    const path = clienteId === undefined ? '/pendientes-por-cliente' : '/pendientes-por-cliente/:clienteId/pedidos';
    const route = router.stack.find(layer => layer.route?.path === path).route;
    const req = { query, params: { clienteId }, empresaId: owner, user: { empresa_id: owner, rol } };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, () => { proceed = true; });
      if (!proceed) break;
    }
    return res;
  }
  async function trip(name, amount = 100, customer = a, invoice = null, state = 'entregado', owner = empresa, date = '2026-09-10') {
    const id = randomUUID();
    await pg.query('INSERT INTO pedidos(id,numero,importe,cliente_id,factura_id,estado,empresa_id,fecha_carga) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [id, name, amount, customer, invoice, state, owner, date]);
    return id;
  }
  try {
    await pg.exec(`CREATE TABLE clientes(id UUID PRIMARY KEY,empresa_id UUID,nombre TEXT,activo BOOLEAN DEFAULT true);
      CREATE TABLE facturas(id UUID PRIMARY KEY,empresa_id UUID,cliente_id UUID,estado TEXT);
      CREATE TABLE factura_pedidos(factura_id UUID,pedido_id UUID);
      CREATE TABLE pedidos(id UUID PRIMARY KEY,empresa_id UUID,cliente_id UUID,factura_id UUID,numero TEXT,estado TEXT,
        importe NUMERIC,origen TEXT,destino TEXT,referencia_cliente TEXT,fecha_carga DATE,fecha_descarga DATE,fecha_entrega DATE);`);
    await pg.query("INSERT INTO clientes(id,empresa_id,nombre,activo) VALUES($1,$2,'Cliente compartido',true),($3,$2,'Cliente compartido',false),($4,$5,'Privado',true)", [a, empresa, b, foreign, other]);
    await pg.query("INSERT INTO facturas VALUES($1,$2,$3,'borrador'),($4,$2,$3,'emitida'),($5,$6,$7,'borrador'),($8,$2,$9,'borrador')",
      [draft, empresa, a, issued, foreignDraft, other, foreign, wrongCustomerDraft, b]);
    const own = await trip('OWN', 100.25);
    const draftTrip = await trip('DRAFT', 50, a, draft);
    await pg.query('INSERT INTO factura_pedidos VALUES($1,$2),($1,$2)', [draft, draftTrip]);
    await trip('ZERO', 0);
    await trip('ABSENT', null);
    await trip('NEGATIVE', -5.25);
    await trip('NAN', 'NaN');
    await trip('SECOND', 10, b);
    await trip('ISSUED', 999, a, issued);
    await trip('FOREIGN-DRAFT', 999, a, foreignDraft);
    await trip('WRONG-CUSTOMER-DRAFT', 999, a, wrongCustomerDraft);
    await trip('FOREIGN-CLIENT', 999, foreign);
    await trip('FOREIGN-COMPANY', 999, foreign, null, 'entregado', other);
    await trip('CANCELLED', 999, a, null, 'cancelado');
    await trip('IN-PROGRESS', 999, a, null, 'en_curso');
    await trip('MISSING-INVOICE', 999, a, randomUUID());
    const reverse = await trip('REVERSE-ISSUED', 999);
    await pg.query('INSERT INTO factura_pedidos VALUES($1,$2)', [issued, reverse]);
    const orphan = await trip('REVERSE-ORPHAN', 999);
    await pg.query('INSERT INTO factura_pedidos VALUES($1,$2)', [randomUUID(), orphan]);
    let response = await read();
    assert.equal(response.code, 200, JSON.stringify(response.data));
    assert.equal(response.data.total, 2);
    assert.equal(response.data.resumen.viajes, 7);
    assert.equal(Number(response.data.resumen.importe_registrado), 155);
    assert.equal(response.data.resumen.importe_ausente, 1);
    assert.equal(response.data.resumen.importe_cero, 1);
    assert.equal(response.data.resumen.importe_negativo, 1);
    assert.equal(response.data.resumen.importe_no_finito, 1);
    assert.equal(response.data.data.find(group => group.cliente_id === b).viajes, 1, 'inactive client historical trips remain visible');
    const page1 = await read({ limit: '1' });
    const page2 = await read({ limit: '1', page: '2' });
    assert.notEqual(page1.data.data[0].cliente_id, page2.data.data[0].cliente_id);
    assert.deepEqual(page1.data.resumen, page2.data.resumen, 'summary is not limited to the visible group page');
    response = await read({ limit: '2' }, a, empresa, 'contable');
    assert.equal(response.data.total, 6);
    assert.equal(response.data.total_pages, 3);
    assert.equal(response.data.data.length, 2);
    assert.equal(Number(response.data.resumen.importe_registrado), 145);
    const details = (await read({}, a)).data.data;
    assert.equal(details.find(row => row.numero === 'ZERO').estado_importe, 'cero');
    assert.equal(details.find(row => row.numero === 'ABSENT').importe_registrado, null);
    assert.equal(details.find(row => row.numero === 'DRAFT').borrador_id, draft);
    assert.ok(!JSON.stringify(details).includes('FOREIGN'));
    assert.deepEqual((await read({ page: '999' })).data.data, []);
    assert.equal((await read({ page: '999' })).data.resumen.viajes, 7);
    assert.equal((await read({}, foreign)).code, 404);
    assert.equal((await read({}, randomUUID())).code, 404);
    assert.equal((await read({}, undefined, empresa, 'cliente')).code, 403);
    assert.equal((await read({}, undefined, null)).code, 401);
    assert.equal((await read({}, 'bad')).code, 400);
    for (const query of [{ desde: '2026-02-30' }, { hasta: '2026-99-99' }, { desde: ['2026-09-01'] },
      { desde: '2026-09-20', hasta: '2026-09-01' }, { page: '0' }, { limit: '201' }, { limit: 'bad' }]) {
      assert.equal((await read(query)).code, 400);
    }
    const fallback = await trip('DATE-FALLBACK', 1, a, null, 'entregado', empresa, null);
    await pg.query("UPDATE pedidos SET fecha_descarga='2026-09-30' WHERE id=$1", [fallback]);
    await trip('OLD', 1000, a, null, 'entregado', empresa, '2026-08-31');
    await trip('UNDATED', 2, a, null, 'entregado', empresa, null);
    const filtered = (await read({ desde: '2026-09-01', hasta: '2026-09-30' }, a)).data;
    assert.equal(filtered.total, 7);
    assert.ok(filtered.data.some(row => row.id === fallback));
    assert.ok(!filtered.data.some(row => row.numero === 'OLD' || row.numero === 'UNDATED'));
    assert.equal((await read({ desde: '2027-01-01' })).data.resumen.viajes, 0);
    assert.equal(Number((await read({ desde: '2027-01-01' })).data.resumen.importe_registrado), 0);
    await pg.query('UPDATE pedidos SET factura_id=$2 WHERE id=$1', [own, issued]);
    assert.ok(!(await read({}, a)).data.data.some(row => row.id === own), 'next read reflects newly billed trips');
    await pg.query(`INSERT INTO pedidos(id,empresa_id,cliente_id,numero,estado,importe,fecha_carga)
      SELECT gen_random_uuid(),$1,$2,'BULK-'||i,'entregado',1,'2026-09-11'::date FROM generate_series(1,1100) i`, [empresa, b]);
    response = await read({}, b);
    assert.equal(response.data.total, 1101);
    assert.equal(Number(response.data.resumen.importe_registrado), 1110);
    assert.equal(response.data.data.length, 50, 'full aggregate even with more than 1000 trips');
    assert.equal((await read({ page: '23' }, b)).data.data.length, 1);
    for (const code of ['57014', '55P03', 'XX000']) {
      db.transaction = async () => { throw Object.assign(new Error('private SQL details'), { code }); };
      response = await read();
      assert.equal(response.code, code === 'XX000' ? 500 : 503);
      assert.ok(!JSON.stringify(response.data).includes('private SQL details'));
    }
    db.transaction = transaction;
    assert.equal((await read()).code, 200);
    console.log('OK pendientes: agrupacion y detalle paginados, totales completos, importes, borradores, doble vinculo, fechas, roles y aislamiento.');
  } finally {
    db.query = original.query;
    db.transaction = original.transaction;
    logger.silent = original.silent;
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

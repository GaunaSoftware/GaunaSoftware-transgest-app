const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const email = require('../src/services/email');
// PDF.js expects a byte array; copy Buffer slices to avoid pooled backing-array offsets.
const parsePdf = buffer => require('pdf-parse')(new Uint8Array(buffer));

async function main() {
  const pg = new PGlite();
  const original = { query: db.query, send: email.enviarEmail };
  const empresa = randomUUID(), otherEmpresa = randomUUID(), cliente = randomUUID(), otherCliente = randomUUID();
  const factura = randomUUID(), otherFactura = randomUUID(), pedido = randomUUID(), otherPedido = randomUUID();
  const crossTenantPedido = randomUUID(), unlinkedPedido = randomUUID();
  const internal = 'INTERNAL_AI_REVIEW_ONLY';
  const sent = [];
  let sendResult = { simulado: true };
  let sendHook = async () => {};
  db.query = (sql, params) => pg.query(sql, params);
  email.enviarEmail = async data => { sent.push(data); await sendHook(); return sendResult; };
  delete require.cache[require.resolve('../src/routes/email')];
  const emailRouter = require('../src/routes/email');
  const portalRouter = require('../src/routes/cliente_portal');
  async function call(router, method, path, owner = empresa, customer = cliente, id = factura) {
    const route = router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route;
    const req = { empresaId: owner, user: { empresa_id: owner, cliente_id: customer, rol: 'cliente' },
      params: { id }, body: { force: true }, query: {} };
    const res = { code: 200, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
    for (const layer of route.stack) {
      let proceed = false;
      await layer.handle(req, res, error => { res.failure = error; proceed = !error; });
      if (!proceed) break;
    }
    return res;
  }
  async function doc(order, owner, name) {
    const id = randomUUID();
    await pg.query("INSERT INTO pedido_docs(id,pedido_id,empresa_id,nombre,tipo,file_base64,file_mime,notas) VALUES($1,$2,$3,$4,'albaran',$5,'text/plain',$6)",
      [id, order, owner, name, Buffer.from(name).toString('base64'), internal]);
    return id;
  }
  async function snapshot(order, source, name, owner = empresa) {
    const id = randomUUID();
    await pg.query("INSERT INTO factura_docs(id,factura_id,empresa_id,pedido_id,pedido_doc_id,nombre,tipo,file_base64,file_mime) VALUES($1,$2,$3,$4,$5,$6,'albaran',$7,'text/plain')",
      [id, factura, owner, order, source, name, Buffer.from(name).toString('base64')]);
  }
  try {
    await pg.exec(`CREATE TABLE empresas(id UUID PRIMARY KEY,nombre TEXT,cfg_precios JSONB);
      CREATE TABLE factura_registros_fiscales(factura_id UUID,empresa_id UUID,modo TEXT,official_qr_url TEXT,official_qr_base64 TEXT,payload JSONB);
      CREATE TABLE clientes(id UUID PRIMARY KEY,empresa_id UUID,nombre TEXT,cif TEXT,direccion TEXT,cp TEXT,ciudad TEXT,pais TEXT,
        email TEXT,email_facturacion TEXT,telefono TEXT,contacto TEXT,forma_pago TEXT,vencimiento INTEGER);
      CREATE TABLE facturas(id UUID PRIMARY KEY,empresa_id UUID,cliente_id UUID,numero TEXT,serie TEXT,fecha DATE,
        fecha_vencimiento DATE,base_imponible NUMERIC,cuota_iva NUMERIC,total NUMERIC,estado TEXT,forma_pago TEXT,
        observaciones TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ DEFAULT NOW(),ia_result JSONB);
      CREATE TABLE pedidos(id UUID PRIMARY KEY,empresa_id UUID,cliente_id UUID,numero TEXT,referencia_cliente TEXT,
        origen TEXT,destino TEXT,fecha_carga DATE,fecha_descarga DATE,ia_result JSONB);
      CREATE TABLE factura_pedidos(factura_id UUID,pedido_id UUID);
      CREATE TABLE factura_lineas(id UUID PRIMARY KEY,factura_id UUID,concepto TEXT,cantidad NUMERIC,precio_unit NUMERIC,orden INT);
      CREATE TABLE factura_extracostes(id UUID PRIMARY KEY,factura_id UUID,tipo TEXT,concepto TEXT,importe NUMERIC);
      CREATE TABLE pedido_docs(id UUID PRIMARY KEY,pedido_id UUID,empresa_id UUID,nombre TEXT,tipo TEXT,file_base64 TEXT,
        file_mime TEXT,file_size_kb INT,notas TEXT,created_at TIMESTAMPTZ DEFAULT NOW());
      CREATE TABLE factura_docs(id UUID PRIMARY KEY,factura_id UUID,empresa_id UUID,pedido_id UUID,pedido_doc_id UUID,
        nombre TEXT,tipo TEXT,file_base64 TEXT,file_mime TEXT,created_at TIMESTAMPTZ DEFAULT NOW());`);
    await pg.query("INSERT INTO empresas VALUES($1,'Transportes QA','{}')", [empresa]);
    await pg.query("INSERT INTO clientes(id,empresa_id,nombre,cif,email) VALUES($1,$2,'Cliente QA','QA123','cliente@example.invalid'),($3,$2,'Otro cliente','QA456','otro@example.invalid')", [cliente, empresa, otherCliente]);
    await pg.query("INSERT INTO facturas(id,empresa_id,cliente_id,numero,serie,fecha,fecha_vencimiento,base_imponible,cuota_iva,total,estado,observaciones,ia_result) VALUES($1,$2,$3,'QA-001','QA','2026-09-01','2026-09-30',100,21,121,'emitida','Referencia publica',$4)",
      [factura, empresa, cliente, JSON.stringify({ resumen: internal })]);
    await pg.query("INSERT INTO facturas(id,empresa_id,cliente_id,numero,estado) VALUES($1,$2,$3,'AJENA','emitida')", [otherFactura, empresa, otherCliente]);
    for (const [id, owner, customer, name] of [[pedido, empresa, cliente, 'PED-PROPIO'], [otherPedido, empresa, otherCliente, 'PED-AJENO'], [crossTenantPedido, otherEmpresa, cliente, 'PED-TENANT'], [unlinkedPedido, empresa, cliente, 'PED-NO-VINCULADO']]) {
      await pg.query("INSERT INTO pedidos(id,empresa_id,cliente_id,numero,referencia_cliente,origen,destino,ia_result) VALUES($1,$2,$3,$4,'REF','Madrid','Valencia',$5)",
        [id, owner, customer, name, JSON.stringify({ resumen: internal })]);
      if (id !== unlinkedPedido) await pg.query('INSERT INTO factura_pedidos VALUES($1,$2)', [factura, id]);
    }
    await pg.query("INSERT INTO factura_lineas VALUES($1,$2,'Transporte QA',1,100,0)", [randomUUID(), factura]);
    const ownDoc = await doc(pedido, empresa, 'albaran-propio.txt');
    const foreignDoc = await doc(otherPedido, empresa, 'albaran-AJENO.txt');
    const tenantDoc = await doc(crossTenantPedido, otherEmpresa, 'albaran-TENANT.txt');
    const unlinkedDoc = await doc(unlinkedPedido, empresa, 'albaran-NO-VINCULADO.txt');
    await snapshot(pedido, ownDoc, 'albaran-propio.txt');
    await snapshot(pedido, null, 'copia-original-eliminado.txt');
    await snapshot(null, null, 'anexo-factura.txt');
    await snapshot(otherPedido, foreignDoc, 'copia-AJENO.txt');
    await snapshot(crossTenantPedido, tenantDoc, 'copia-TENANT.txt');
    await snapshot(unlinkedPedido, unlinkedDoc, 'copia-NO-VINCULADO.txt');
    await snapshot(pedido, foreignDoc, 'copia-ORIGEN-INCOHERENTE.txt');
    await snapshot(null, ownDoc, 'copia-SIN-PEDIDO.txt');
    await snapshot(null, null, 'copia-EMPRESA-INCORRECTA.txt', otherEmpresa);
    const expected = ['albaran-propio.txt', 'anexo-factura.txt', 'copia-original-eliminado.txt'].sort();
    const portal = await call(portalRouter, 'get', '/facturas/:id');
    assert.equal(portal.code, 200);
    assert.equal(portal.failure, undefined);
    assert.deepEqual(portal.data.documentos.map(d => d.nombre).sort(), expected);
    assert.deepEqual(portal.data.pedidos.map(p => p.id), [pedido]);
    assert.deepEqual(portal.data.albaranes.map(d => d.id), [ownDoc]);
    assert.equal(portal.data.observaciones, 'Referencia publica');
    assert.ok(!JSON.stringify(portal.data).includes(internal), 'portal projects customer fields, not AI review or document notes');
    assert.equal((await call(portalRouter, 'get', '/facturas/:id', empresa, otherCliente)).code, 404);
    assert.equal((await call(portalRouter, 'get', '/facturas/:id', otherEmpresa)).code, 404);
    await pg.query("UPDATE facturas SET estado='borrador' WHERE id=$1", [factura]);
    assert.equal((await call(portalRouter, 'get', '/facturas/:id')).code, 404);
    await pg.query("UPDATE facturas SET estado='emitida' WHERE id=$1", [factura]);
    const preflight = await call(emailRouter, 'get', '/factura/:id/preflight');
    assert.equal(preflight.data.ok, true);
    assert.equal(preflight.data.pedidos, 1);
    assert.equal(preflight.data.documentos, 3);
    const sentResult = await call(emailRouter, 'post', '/factura/:id');
    assert.equal(sentResult.code, 200, JSON.stringify(sentResult.data));
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].attachments.slice(1).map(a => a.filename).sort(), expected);
    assert.ok(sent[0].attachments[0].content.toString('utf8').startsWith('%PDF-'));
    const pdf = (await parsePdf(sent[0].attachments[0].content)).text;
    assert.ok(pdf.includes('FACTURA QA-001'));
    assert.ok(pdf.includes('Transporte QA'));
    const template = email.PLANTILLAS.factura_emitida(sent[0].datos);
    for (const output of [pdf, template.html, JSON.stringify(sent[0].datos), JSON.stringify(portal.data)]) {
      for (const forbidden of [internal, 'Sin IA', 'Analizar IA', 'Corregir pedido', 'PED-AJENO', 'PED-TENANT']) assert.ok(!output.includes(forbidden));
    }
    assert.equal((await call(emailRouter, 'post', '/factura/:id', otherEmpresa)).code, 404);
    assert.equal(sent.length, 1);
    db.query = (sql, params) => {
      if (sql.includes('FROM factura_docs fd')) throw new Error('simulated document read failure');
      return pg.query(sql, params);
    };
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 500);
    assert.equal(sent.length, 1, 'document lookup failure must not send a partial invoice');
    assert.ok((await call(portalRouter, 'get', '/facturas/:id')).failure, 'portal forwards async failure instead of pretending the document list is empty');
    db.query = (sql, params) => pg.query(sql, params);
    assert.equal((await call(emailRouter, 'get', '/factura/:id/preflight')).data.ok, true);
    const setState = estado => pg.query('UPDATE facturas SET estado=$2,updated_at=NOW() WHERE id=$1', [factura, estado]);
    const storedState = async () => (await pg.query('SELECT estado FROM facturas WHERE id=$1', [factura])).rows[0].estado;
    assert.equal(await storedState(), 'emitida', 'simulated delivery must not mark invoice sent');
    for (const estado of ['borrador', 'anulada', 'rectificada', 'desconocida']) {
      await setState(estado);
      const count = sent.length;
      assert.equal((await call(emailRouter, 'get', '/factura/:id/preflight')).data.ok, false);
      assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 409, 'force cannot bypass a blocked state');
      assert.equal(sent.length, count);
      assert.equal(await storedState(), estado);
    }
    for (const estado of ['emitida', 'enviada', 'cobrada', 'vencida', 'reclamada', 'sin_cobrar']) {
      await setState(estado);
      sendResult = { simulado: true };
      const simulated = await call(emailRouter, 'post', '/factura/:id');
      assert.equal(simulated.data.estado, estado);
      assert.equal(await storedState(), estado);
      sendResult = { messageId: 'qa-accepted' };
      const delivered = await call(emailRouter, 'post', '/factura/:id');
      assert.equal(delivered.data.estado, estado === 'emitida' ? 'enviada' : estado);
      assert.equal(await storedState(), delivered.data.estado, 'resend does not reset collection status');
    }
    await setState('emitida');
    sendHook = async () => { throw new Error('SMTP rejected'); };
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 500);
    assert.equal(await storedState(), 'emitida');
    sendHook = async () => {};
    sendResult = {};
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 502);
    assert.equal(await storedState(), 'emitida');
    sendResult = { messageId: 'qa-accepted' };
    sendHook = () => setState('cobrada');
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).data.estado, 'cobrada');
    assert.equal(await storedState(), 'cobrada', 'payment while SMTP runs must not be overwritten');
    sendHook = async () => {};
    await setState('emitida');
    const count = sent.length;
    db.query = async (sql, params) => {
      if (sql.includes('SELECT id FROM facturas')) await setState('anulada');
      return pg.query(sql, params);
    };
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 409);
    assert.equal(sent.length, count, 'revalidate before SMTP');
    await setState('emitida');
    db.query = async (sql, params) => {
      if (sql.includes('SELECT id FROM facturas')) {
        await pg.query("UPDATE facturas SET total=999,updated_at=updated_at+INTERVAL '1 microsecond' WHERE id=$1", [factura]);
      }
      return pg.query(sql, params);
    };
    assert.equal((await call(emailRouter, 'post', '/factura/:id')).code, 409);
    assert.equal(sent.length, count, 'a changed invoice version is blocked even if its state is still emitida');
    db.query = (sql, params) => pg.query(sql, params);
    console.log('OK salida factura: PDF/correo sin campos IA internos, portal, documentos propios, origen coherente, aislamiento y fallos sin envio.');
  } finally {
    db.query = original.query;
    email.enviarEmail = original.send;
    delete require.cache[require.resolve('../src/routes/email')];
    await pg.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });

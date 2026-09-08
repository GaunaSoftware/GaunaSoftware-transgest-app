const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const router = require('../src/routes/informes');

async function main() {
  const pg = new PGlite();
  const originalQuery = db.query;
  let params = ['qa','2026-09-01','2026-09-30'];
  try {
    await pg.exec(`CREATE TYPE estado_pedido AS ENUM ('pendiente','confirmado','entregado','cancelado','incidencia');
    CREATE TYPE estado_factura AS ENUM ('borrador','emitida','cobrada','anulada','rectificada');
    CREATE TABLE pedidos (
      id TEXT DEFAULT 'pedido-qa', empresa_id TEXT, cliente_id TEXT DEFAULT 'cliente-qa', estado estado_pedido,
      origen TEXT DEFAULT 'Burgos', destino TEXT DEFAULT 'Aspe', pendiente_completar BOOLEAN, aviso_completar TEXT,
      importe NUMERIC, precio_cliente_col NUMERIC, precio_unitario NUMERIC, km_ruta NUMERIC,
      factura_id TEXT, vehiculo_id TEXT, chofer_id TEXT, colaborador_id TEXT,
      importe_paralizacion NUMERIC, paralizacion_importe NUMERIC, precio_colaborador NUMERIC,
      km_vacio NUMERIC, fecha_descarga DATE, fecha_carga DATE, fecha_pedido DATE,
      created_at TIMESTAMP, facturacion_mes DATE, entregado_at DATE, firma_fecha TIMESTAMPTZ,
      coste_gasoil NUMERIC, coste_peajes NUMERIC, coste_dietas NUMERIC, coste_otros NUMERIC
    );
    CREATE TABLE facturas (id TEXT, empresa_id TEXT, cliente_id TEXT DEFAULT 'cliente-qa', estado estado_factura, total NUMERIC, fecha DATE, base_imponible NUMERIC);
    CREATE TABLE clientes (id TEXT, empresa_id TEXT, nombre TEXT);
    CREATE TABLE portal_solicitudes_cliente (empresa_id TEXT, estado TEXT, created_at TIMESTAMP);
    CREATE TABLE factura_registros_fiscales (empresa_id TEXT, estado_envio TEXT);
    CREATE TABLE pedido_docs (empresa_id TEXT, pedido_id TEXT, tipo TEXT, nombre TEXT, created_at TIMESTAMP);
    INSERT INTO clientes VALUES ('cliente-qa','qa','Cliente QA');
    INSERT INTO pedidos (empresa_id, estado, importe, fecha_descarga, facturacion_mes, km_ruta)
      VALUES ('qa','entregado',300,'2026-08-31','2026-09-01',100),
             ('otra-empresa','entregado',99999,'2026-09-01','2026-09-01',100);`);
    db.query = sql => pg.query(sql, params);
    const handler = router.stack.find(layer=>layer.route?.path === '/bi/resumen').route.stack[0].handle;
    const read = async () => {
      let result;
      await handler({empresaId:'qa',query:{periodo:'mes'}},{json(data){result=data;}});
      return result;
    };
    let result = await read();
    assert.equal(result.kpis.realizados,1);
    assert.equal(result.kpis.pendiente_facturar_realizado,300);
    assert.equal(result.clientes[0].pendiente_facturar_realizado,300);
    assert.equal(result.rutas[0].viajes,1);
    params=['qa','2026-08-01','2026-08-31'];
    assert.equal((await read()).kpis.realizados,0);
    params=['qa','2026-09-01','2026-09-30'];
    await pg.exec(`UPDATE pedidos SET factura_id='borrador-qa' WHERE empresa_id='qa';
      INSERT INTO facturas(id,empresa_id,estado,total,fecha,base_imponible) VALUES ('borrador-qa','qa','borrador',363,'2026-09-01',300);`);
    result=await read();
    assert.equal(result.kpis.pendiente_facturar_realizado,300);
    assert.equal(result.kpis.facturado,0);
    assert.equal(result.kpis.ingreso_gestionado,300);
    await pg.exec(`UPDATE pedidos SET precio_colaborador=100, coste_gasoil=50 WHERE empresa_id='qa'; UPDATE facturas SET estado='emitida';`);
    result=await read();
    assert.equal(result.kpis.facturado,300);
    assert.equal(result.kpis.facturado_total,363);
    assert.equal(result.kpis.pendiente_facturar_realizado,0);
    assert.equal(result.kpis.ingreso_gestionado,300);
    assert.equal(result.kpis.margen,150);
    assert.equal(result.kpis.margen_pct,50);
    assert.equal(result.kpis.eur_km,3);
    assert.equal(result.clientes[0].margen,150);
    assert.equal(result.rutas[0].margen,150);
    await pg.exec("UPDATE facturas SET estado='cobrada'");
    assert.equal((await read()).kpis.cobro_pct,100);
    await pg.exec("UPDATE facturas SET estado='anulada'");
    assert.equal((await read()).kpis.pendiente_facturar_realizado,300);
    await pg.exec("UPDATE pedidos SET facturacion_mes='2025-12-01' WHERE empresa_id='qa'");
    params=['qa','2025-12-01','2025-12-31'];
    assert.equal((await read()).kpis.realizados,1);
    assert.equal((await pg.query("SELECT fecha_descarga::text FROM pedidos WHERE empresa_id='qa'")).rows[0].fecha_descarga,'2026-08-31');
    console.log('OK BI: mes elegido, cambio de ano, borrador, emision, anulacion, margen neto, costes, cobros, rankings y aislamiento.');
  } finally { db.query=originalQuery; await pg.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

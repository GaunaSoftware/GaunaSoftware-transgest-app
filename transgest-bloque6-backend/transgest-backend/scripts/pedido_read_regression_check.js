const assert = require('node:assert/strict');
const {pedidoConImporteVisible,calcPedidoImporteUpdate} = require('../src/routes/pedidos')._test;
const base={importe:'0',tipo_precio:'viaje',precio_unitario:'480',cantidad:1};
assert.equal(pedidoConImporteVisible(base).importe,480);
assert.equal(base.importe,'0');
assert.equal(pedidoConImporteVisible({...base,importe:400}).importe,400);
assert.equal(pedidoConImporteVisible({...base,factura_id:'factura'}).importe,'0');
assert.equal(pedidoConImporteVisible({...base,tipo_precio:'hora',precio_unitario:'60',cantidad:8}).importe,480);
assert.equal(pedidoConImporteVisible({...base,precio_unitario:0}).importe,'0');
assert.equal(pedidoConImporteVisible({...base,precio_unitario:null,precio_cliente_col:480}).importe,480);
const current={importe:480,tipo_precio:'hora',precio_unitario:60,cantidad:8,extracostes_importe:0};
const defaults={tipo_precio:'viaje',precio_unitario:null,cantidad:undefined,extracostes_importe:0};
assert.equal(calcPedidoImporteUpdate(current,{vehiculo_id:'vehiculo'},defaults),null);
assert.equal(calcPedidoImporteUpdate(current,{km_vacio:25},defaults),null);
assert.equal(calcPedidoImporteUpdate(current,{puntos_descarga:[]},{...defaults,puntos_descarga:'[]'}),480);
assert.equal(calcPedidoImporteUpdate(current,{cantidad:9},{...defaults,cantidad:9}),540);
assert.equal(calcPedidoImporteUpdate(current,{precio_unitario:0},{...defaults,precio_unitario:0}),0);
assert.equal(current.importe,480);
console.log('OK importes: lectura legado, asignacion sin recalculo, cambios parciales, tarifa por horas y cero explicito.');

// Production users may have a single full-name column, without apellidos.
(async()=>{
  const {PGlite}=require('@electric-sql/pglite');
  const fs=require('node:fs'),path=require('node:path');
  const source=fs.readFileSync(path.join(__dirname,'../src/routes/pedidos.js'),'utf8');
  const sql=source.match(/`(SELECT pe.id,pe.tipo,[\s\S]*?LIMIT 100)`/)[1];
  const pg=new PGlite();
  try {
    await pg.exec(`CREATE TABLE usuarios(id text,empresa_id text,nombre text,email text,rol text);
      CREATE TABLE pedido_eventos(id text,pedido_id text,empresa_id text,tipo text,actor_tipo text,actor_id text,detalle jsonb,created_at timestamp);
      INSERT INTO usuarios VALUES ('u','a','Ana García','qa@example.test','trafico'),('u','b','Otro tenant','private@example.test','gerente');
      INSERT INTO pedido_eventos VALUES ('e','p','a','asignacion','usuario','u','{}',now()),('other','p','b','privado','usuario','u','{}',now());`);
    const result=await pg.query(sql,['p','a']);
    assert.equal(result.rows.length,1);assert.equal(result.rows[0].actor_nombre,'Ana García');
    console.log('PASS order history with legacy user schema and tenant isolation');
  } finally {await pg.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});

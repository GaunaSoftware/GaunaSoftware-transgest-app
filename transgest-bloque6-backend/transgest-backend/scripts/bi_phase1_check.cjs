const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/services/db');
const { collectionAmounts, periodRange, ratio, day } = require('../src/services/financialKpis');
const { buildAnalytics, structureMonth } = require('../src/services/financialAnalytics');
const { buildRouteSheet } = require('../src/services/financialRouteSheet');
const { cacheMiddleware, clear } = require('../src/services/cache');
const router = require(process.env.BI_BASELINE ? '../src/routes/__baseline_bi' : '../src/routes/informes');
async function main() {
  assert.deepEqual(collectionAmounts(1210,1210),{total:1210,cobrado:1210,saldo:0,porcentaje:100});
  assert.deepEqual(collectionAmounts(1210,605),{total:1210,cobrado:605,saldo:605,porcentaje:50});
  assert.equal(ratio(100,0),null);
  assert.deepEqual(periodRange('mes',new Date('2026-03-31T22:30:00Z')),{desde:'2026-04-01',hasta:'2026-04-01'});
  assert.deepEqual(periodRange('anual',new Date('2026-09-23T12:00:00Z')),{desde:'2026-01-01',hasta:'2026-09-23'});
  assert.deepEqual(periodRange('30d',new Date('2026-03-01T12:00:00Z')),{desde:'2026-01-31',hasta:'2026-03-01'});
  assert.equal(day(new Date('2026-03-28T23:30:00Z')),'2026-03-29','Madrid ya está en el día siguiente antes del cambio a horario de verano');
  assert.equal(day('2026-10-24T22:30:00Z'),'2026-10-25','Inicio civil del día del cambio a horario de invierno');
  assert.deepEqual(periodRange('mes',new Date('2026-10-31T23:30:00Z')),{desde:'2026-11-01',hasta:'2026-11-01'});
  assert.deepEqual(periodRange('semana_anterior',new Date('2026-09-28T07:00:00Z')),{desde:'2026-09-21',hasta:'2026-09-27'});
  assert.deepEqual(periodRange('semana_anterior',new Date('2026-09-30T07:00:00Z')),{desde:'2026-09-21',hasta:'2026-09-27'});
  const pg=new PGlite(), original=db.query;
  try {
    await pg.exec(`CREATE TYPE estado_pedido AS ENUM ('pendiente','confirmado','entregado','cancelado','incidencia');
    CREATE TYPE estado_factura AS ENUM ('borrador','emitida','cobrada','anulada','rectificada');
    CREATE TABLE pedidos (
      numero TEXT, id TEXT DEFAULT 'pedido-qa', empresa_id TEXT, cliente_id TEXT DEFAULT 'cliente-qa', estado estado_pedido,
      origen TEXT DEFAULT 'Burgos', destino TEXT DEFAULT 'Aspe', pendiente_completar BOOLEAN, aviso_completar TEXT,
      importe NUMERIC, precio_cliente_col NUMERIC, precio_unitario NUMERIC, km_ruta NUMERIC,
      factura_id TEXT, vehiculo_id TEXT, chofer_id TEXT, colaborador_id TEXT,
      importe_paralizacion NUMERIC, paralizacion_importe NUMERIC, precio_colaborador NUMERIC,
      km_vacio NUMERIC, fecha_descarga DATE, fecha_carga DATE, fecha_pedido DATE,
      created_at TIMESTAMP, facturacion_mes DATE, entregado_at DATE, firma_fecha TIMESTAMPTZ,
      coste_gasoil NUMERIC, coste_peajes NUMERIC, coste_dietas NUMERIC, coste_otros NUMERIC
    );
    CREATE TABLE facturas (id TEXT, empresa_id TEXT, cliente_id TEXT DEFAULT 'cliente-qa', estado estado_factura, total NUMERIC, fecha DATE, fecha_vencimiento DATE, base_imponible NUMERIC);
    CREATE TABLE clientes (id TEXT, empresa_id TEXT, nombre TEXT);
    CREATE TABLE portal_solicitudes_cliente (empresa_id TEXT, estado TEXT, created_at TIMESTAMP);
    CREATE TABLE factura_registros_fiscales (empresa_id TEXT, estado_envio TEXT);
    CREATE TABLE pedido_docs (empresa_id TEXT, pedido_id TEXT, tipo TEXT, nombre TEXT, created_at TIMESTAMP);
    CREATE TABLE vehiculos (id TEXT, empresa_id TEXT, matricula TEXT, clase TEXT, tipo TEXT, remolque_id TEXT, chofer_id TEXT, activo BOOLEAN, estado TEXT);
    CREATE TABLE choferes (id TEXT, empresa_id TEXT, nombre TEXT, apellidos TEXT, vehiculo_id TEXT);
    CREATE TABLE taller_estado (empresa_id TEXT, data JSONB);
    CREATE TABLE vehiculo_km_vacio (empresa_id TEXT, vehiculo_id TEXT, fecha DATE, km_vacio NUMERIC, notas TEXT);
    CREATE TABLE gastos_estructura (empresa_id TEXT, activo BOOLEAN, periodo TEXT, fecha TEXT, importe NUMERIC);
    CREATE TABLE objetivos_kpi (empresa_id TEXT, periodo TEXT);
    CREATE TABLE vehiculo_repostajes (empresa_id TEXT, vehiculo_id TEXT, fecha DATE, litros NUMERIC, precio_litro NUMERIC, importe NUMERIC);
    CREATE TABLE vehiculo_noches (empresa_id TEXT, vehiculo_id TEXT, fecha DATE, importe NUMERIC);
    CREATE TABLE chofer_gastos (empresa_id TEXT, vehiculo_id TEXT, fecha DATE, tipo TEXT, estado TEXT, importe NUMERIC, litros NUMERIC);
    CREATE TABLE chofer_config (empresa_id TEXT, chofer_id TEXT);
    CREATE TABLE vehiculo_gasoil_config (empresa_id TEXT, vehiculo_id TEXT, tipo TEXT, precio_fijo NUMERIC, periodos JSONB);
    CREATE TABLE nominas_emitidas (empresa_id TEXT, chofer_id TEXT, periodo TEXT, salario_base NUMERIC, ss_empresa NUMERIC);

      CREATE TABLE pedido_extracostes(pedido_id TEXT, importe NUMERIC);
      CREATE TABLE factura_pedidos(factura_id TEXT,pedido_id TEXT);
      INSERT INTO clientes VALUES ('cliente-qa','qa','QA'),('b','b','Otra empresa');
      INSERT INTO pedidos(id,empresa_id,estado,importe,fecha_carga,fecha_descarga,km_ruta,coste_gasoil)
        SELECT n::text,'qa','entregado',100,'2026-09-01','2026-09-01',10,20 FROM generate_series(1,1501) n;
      INSERT INTO pedidos(id,empresa_id,estado,importe,fecha_descarga) VALUES ('b','b','entregado',999999,'2026-09-01');
      INSERT INTO facturas(id,empresa_id,estado,total,base_imponible,fecha) VALUES ('f','qa','cobrada',1210,1000,'2026-09-01'),('old','qa','emitida',605,500,'2026-08-01'),('b','b','emitida',99999,99999,'2026-09-01');
    `);
    db.query=(sql,params)=>pg.query(sql,params);
    const call=async(path,company='qa',page=1,extra={})=>{
      let result,status=200;
      const handler=router.stack.find(l=>l.route?.path===path).route.stack.at(-1).handle;
      await handler({empresaId:company,user:{empresa_id:company},query:{desde:'2026-09-01',hasta:'2026-09-30',empresa_id:'b',page,...extra}}, {status(n){status=n;return this;},json(data){result=data;}});
      return {result,status};
    };
    let op=await call('/rentabilidad-operativa');
    assert.equal(op.status,200);
    assert.equal(op.result.resumen.pedidos,1501,'Incluye los 1501 pedidos');
    assert.equal(op.result.resumen.ingreso,150100);
    assert.deepEqual((await call('/rentabilidad-operativa','qa',2)).result.resumen,op.result.resumen,'Cambiar página no cambia agregados');
    let bi=(await call('/bi/resumen')).result;
    assert.equal(bi.clientes_top_facturacion[0].cobro_pct,100);
    assert.equal(bi.kpis.saldo_al_corte,605,'Incluye deuda anterior al mes');
    assert.equal(bi.metadata.metricas.cobrado.estado,'estimado');
    assert.equal(bi.kpis.cobros_efectivos,null);
    assert.equal((await call('/bi/resumen','b')).result.kpis.facturado,99999);
    assert.equal(bi.kpis.facturado,1000);
    const analytics=(await call('/bi/analitica')).result;
    assert.equal(analytics.totals.viajes,1501,'La analítica nueva agrega todos los pedidos');
    assert.equal(analytics.totals.facturado_total,1210);
    assert.equal(analytics.totals.cobro_pct,100,'Factura neta 1000 y bruta 1210 cobrada al 100 %, no 121 %');
    assert.equal(analytics.totals.saldo_al_corte,605);
    assert.equal((await call('/bi/analitica','b')).result.totals.facturado_total,99999,'Analítica aislada por empresa');
    const workspace=(await call('/bi/workspace')).result;
    assert.equal(workspace.economia.ingreso_servicios_realizados,150100,'Panel agrega toda la población autorizada');
    assert.equal(workspace.servicios.total,1501);
    assert.equal(workspace.servicios.rows.length,20,'Solo el detalle está paginado');
    if (!process.env.BI_BASELINE) {
      let queryCount=0;const started=performance.now();
      const complete=await require('../src/services/financialWorkspace').readWorkspace('qa',
        {desde:'2026-09-01',hasta:'2026-09-30',page:1,limit:Number.MAX_SAFE_INTEGER},
        {exportAll:true,queryDb:(sql,params)=>{queryCount++;return pg.query(sql,params);}});
      const elapsedMs=Math.round(performance.now()-started);
      assert.equal(complete.servicios.rows.length,1501,'Exportación BI incluye detalle autorizado completo');
      assert.equal(complete.economia.ingreso_servicios_realizados,workspace.economia.ingreso_servicios_realizados,
        'La página visible y la exportación concilian');
      console.log(`MEDICIÓN BI sintética: 1501 servicios, ${queryCount} consultas, ${elapsedMs} ms; respuesta paginada ${Buffer.byteLength(JSON.stringify(workspace))} bytes`);
    }
    assert.equal(workspace.comparacion.ingreso.variacion_pct,null,'Sin base previa no se presenta variación infinita');
    assert.equal((await call('/bi/workspace','b')).result.economia.ingreso_servicios_realizados,999999,'Panel aísla empresas');
    const routePanel=(await call('/bi/workspace','qa',1,{ruta:'Burgos → Aspe'})).result;
    assert.equal(routePanel.economia.metricas.vencido_al_corte.estado,'no_aplicable','No atribuye deuda a ruta');
    assert.equal(routePanel.economia.pendiente_facturar.importe,150100,'Pendiente del servicio sí admite filtro de ruta');
    const management=(await call('/gestion')).result;
    assert.equal(management.pedidos.total,1501,'El adaptador conserva los recuentos operativos');
    assert.equal(management.pedidos.entregados,1501);
    assert.equal(management.facturacion.pendiente,605);
    await pg.exec("INSERT INTO vehiculos (id,empresa_id,matricula,chofer_id) VALUES ('v','qa','1234ABC','current'); UPDATE pedidos SET vehiculo_id='v',chofer_id='historical' WHERE id='1' AND empresa_id='qa'; INSERT INTO nominas_emitidas VALUES ('qa','historical','2026-09',100,10),('qa','current','2026-09',900,90);");
    const sheet=await call('/bi/hoja','qa',1,{vehiculo_id:'v'});
    assert.equal(sheet.status,200,'Hoja de ruta consulta las fuentes existentes');
    assert.equal(sheet.result.viajes,1);
    assert.equal(sheet.result.salarioBase,100,'Usa conductor histórico del pedido, no la relación actual del vehículo');
    assert.equal(sheet.result.margen,null,'Sin combustible registrado no estima margen');
    assert.equal((await call('/bi/hoja','b',1,{vehiculo_id:'v'})).status,404,'Vehículo de otra empresa no accesible');
    await pg.exec("INSERT INTO facturas(id,empresa_id,estado,total,base_imponible,fecha,fecha_vencimiento) VALUES ('credit','qa','emitida',-100,-82.64,'2026-08-01','2026-09-10')");
    const overduePanel=(await call('/bi/workspace')).result;
    assert.equal(overduePanel.facturas_vencidas.total,1,'El detalle incluye todos los documentos vencidos con signo');
    assert.equal(overduePanel.facturas_vencidas.rows[0].total,-100,'Un abono vencido conserva el signo que reconcilia el agregado');
    await pg.exec(`INSERT INTO pedidos(id,empresa_id,estado,importe,fecha_descarga,firma_fecha)
      VALUES ('tz','tz','entregado',100,'2026-10-24','2026-10-24T22:30:00Z');`);
    const tz=await call('/rentabilidad-operativa','tz',1,{desde:'2026-10-25',hasta:'2026-10-25'});
    assert.equal(tz.result.resumen.pedidos,1,'Una firma en el día civil de Madrid entra en el periodo correcto');
    await pg.exec(`INSERT INTO facturas(id,empresa_id,estado,total,base_imponible,fecha) VALUES ('draft','qa','borrador',121,100,'2026-09-01'); UPDATE pedidos SET factura_id='draft' WHERE empresa_id='qa';`);
    assert.equal((await call('/rentabilidad-operativa')).result.resumen.pendiente_facturar_realizado,150100);
    await pg.exec(`UPDATE pedidos SET km_ruta=NULL,coste_gasoil=NULL WHERE empresa_id='qa'`);
    bi=(await call('/bi/resumen')).result;
    assert.equal(bi.kpis.eur_km,null);
    assert.equal(bi.kpis.margen,null);
    await pg.exec(`UPDATE pedidos SET estado='confirmado' WHERE empresa_id='qa'`);
    assert.equal((await call('/rentabilidad-operativa')).result.resumen.pod_ok_pct,null);
    await pg.exec('DROP TABLE chofer_gastos');
    const missingExpenseSource=await call('/bi/analitica');
    assert.equal(missingExpenseSource.status,200,'Fuente opcional ausente no impide métricas respaldadas');
    assert.ok(missingExpenseSource.result.economia.fuentes_no_disponibles.includes('chofer_gastos'));
    db.query=async()=>{throw new Error('synthetic outage');};
    assert.equal((await call('/bi/resumen')).status,500,'Error no es ausencia de actividad');
    console.log('OK BI SQL: 1501, paginación, borrador, corte, IVA, null, error, aislamiento');
  } finally { db.query=original; await pg.close(); }
  const range={desde:'2026-09-01',hasta:'2026-09-30'};
  const data=buildAnalytics({empresaId:'a',range, orders:[{empresa_id:'a',estado:'entregado',importe:100,fecha_descarga:'2026-09-02',km_ruta:null,coste_operativo:0}], invoices:[{empresa_id:'a',estado:'emitida',total:1210,base_imponible:1000,fecha:'2026-08-01'},{empresa_id:'b',estado:'emitida',total:99999,fecha:'2026-09-01'}],vehicles:[{id:'v',empresa_id:'a',matricula:'1234ABC'}],repairs:[{vehiculo_id:'v',fecha:'2026-08-01',coste_total:999},{vehiculo_id:'v',fecha:'2026-09-01',coste_total:10}]});
  assert.equal(data.totals.facturado_total,0);assert.equal(data.totals.saldo_al_corte,1210);
  assert.equal(data.totals.eurosKm,null);assert.equal(data.totals.margen,null);
  assert.equal(data.flotaStats[0].pctVacio,null,'Sin km válidos no publica porcentaje de vacío');
  assert.equal(data.tallerVisitas[0].visitas,1);assert.equal(data.totals.coste_taller,10);
  assert.equal(data.costeMensualTaller.length,1);
  assert.equal(structureMonth([{periodo:'mensual',fecha:'2026-01-01',importe:120,activo:true}], '2026-09')[0].importe_periodo,120);
  assert.equal(structureMonth([{periodo:'anual',fecha:'2026-01-01',importe:120,activo:true}], '2026-09')[0].importe_periodo,10);
  const multiMonth = buildAnalytics({empresaId:'a',range:{desde:'2026-08-01',hasta:'2026-09-30'},structure:[{empresa_id:'a',periodo:'mensual',fecha:'2026-01',importe:120,activo:true}]});
  assert.equal(multiMonth.estructura.total,null,'No extrapola el primer mes a un rango de varios meses');
  assert.equal(multiMonth.estructura.coste_medio_camion,null);
  assert.equal(multiMonth.metadata.metricas.estructura.estado,'no_aplicable');
  assert.equal(data.estructura.total,null,'Sin gastos de estructura registrados no confirma coste cero');
  assert.equal(data.metadata.metricas.estructura.estado,'sin_datos');
  const route = buildRouteSheet({range,orders:[{estado:'entregado',importe:100,km_ruta:100,km_vacio:10,fecha_bi:'2026-09-02'}],emptyKm:[{km_vacio:5}],repostajes:[],noches:[],expenses:[],repairs:[],config:{salario_base:1000}});
  assert.equal(route.kmTotal,115,'Incluye kilómetros vacíos registrados fuera del pedido');
  assert.equal(route.costeGasoil,null,'Ausencia de repostaje no significa combustible gratis');
  assert.equal(route.margen,null,'No publica resultado sin coste de combustible');
  clear(); let calls=0;
  const cached=(company,status)=>{const req={method:'GET',originalUrl:'/bi',empresaId:company,user:{empresa_id:'a'}};const res={statusCode:status,setHeader(){},json(d){return d;}};cacheMiddleware()(req,res,()=>{calls++;res.json({value:company});});};
  cached('a',500);cached('a',200);cached('a',200);cached('b',200);assert.equal(calls,3);
  const {GERENTE_O_CONTABLE}=require('../src/middleware/auth');let denied=0;
  GERENTE_O_CONTABLE({user:{rol:'chofer'}},{status(n){denied=n;return this;},json(){}},()=>{throw new Error('Driver may not read finance');});assert.equal(denied,403);
  const {requireModulePermission}=require('../src/middleware/auth');
  const canReadSheet=(rol,productos=['transgest'])=>{let status=200,allowed=false;requireModulePermission('hojas_ruta')({user:{rol,plan:'profesional',productos},method:'GET',path:'/bi'},{status(n){status=n;return this;},json(){}},()=>{allowed=true;});return {status,allowed};};
  assert.equal(canReadSheet('trafico').allowed,true,'Tráfico conserva su permiso de hoja de ruta');
  assert.equal(canReadSheet('colaborador').status,403,'Colaborador no recibe datos salariales');
  assert.equal(canReadSheet('trafico',['planner']).status,403,'Producto Planner no expone hoja de ruta TMS');
  console.log('OK BI definitions, periodos, cobro parcial, taller, cache y rol');
}
main().catch(e=>{console.error(e);process.exitCode=1;});

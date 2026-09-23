const assert=require('node:assert/strict');
const {buildOperationalMetrics,loadOperationalEvidence,loadPlannerMetrics,distribution,explicitWindow}=require('../src/services/operationalMetrics');
const {driverStops}=require('../src/services/driverStops');
const range={desde:'2026-09-01',hasta:'2026-09-30'};
const order=(id,more={})=>({id,empresa_id:'a',numero:id,estado:'entregado',fecha_bi:'2026-09-11',
  fecha_carga:'2026-09-10',fecha_descarga:'2026-09-11',ventana_carga:'08:00-09:00',ventana_descarga:'10:00-12:00',
  origen:'Madrid',destino:'Valencia',bultos:10,peso_kg:1000,importe:500,km_ruta:100,km_vacio:20,vehiculo_id:'v',...more});
const events={carga_iniciada_at:'2026-09-10T06:30:00Z',carga_proceso_at:'2026-09-10T07:00:00Z',
  carga_ok_at:'2026-09-10T08:00:00Z',carga_ok:true,
  posicionado_descarga_at:'2026-09-11T08:30:00Z',descarga_iniciada_at:'2026-09-11T09:00:00Z',
  descarga_ok_at:'2026-09-11T10:00:00Z',firma_entrega_at:'2026-09-11T10:10:00Z',firma_entrega:true,
  mercancia_confirmada:true,mercancia_palets:'10',mercancia_peso_kg:'1000'};
const stopIds=driverStops(order('one'));
const perStop={paradas:{[stopIds[0].id]:events,[stopIds[1].id]:events}};
const input={empresaId:'a',range,orders:[order('one')],steps:[{empresa_id:'a',pedido_id:'one',data:perStop}],
  docs:[{empresa_id:'a',pedido_id:'one',tipo:'pod',created_at:'2026-09-11T11:10:00Z'}],
  fuel:[{empresa_id:'a',vehiculo_id:'v',fecha:'2026-09-11',litros:100,importe:150}],
  repairs:[{empresa_id:'a',vehiculo_id:'v',fecha:'2026-09-11',coste_total:120}],
  config:{sostenibilidad:{consumo_l_100km:30,factor_kg_co2_litro:2.6}}};
const result=buildOperationalMetrics(input);
assert.equal(result.metricas.puntualidad_recogida.valor,100);
assert.equal(result.metricas.puntualidad_entrega.valor,100);
assert.equal(result.metricas.otif.valor,100);
assert.equal(result.tiempos.espera_carga.media,30);
assert.equal(result.tiempos.carga_efectiva.mediana,60);
assert.equal(result.tiempos.descarga_efectiva.p90,60);
assert.equal(result.tiempos.recepcion_pod.mediana,60);
assert.equal(result.metricas.consumo_l_100km.valor,null,'Repostajes no se convierten en consumo');
assert.equal(result.metricas.coste_combustible_km.valor,1.25);
assert.equal(result.metricas.mantenimiento_km.valor,1);
assert.equal(result.flota.repostajes.total,1);
assert.equal(result.flota.taller.total,1);
assert.equal(result.metricas.co2_estimado.valor,93.6);
assert.equal(explicitWindow({tipo:'carga',ventana:'08:00-09:00'},order('x')).date,'2026-09-10');
assert.equal(explicitWindow({tipo:'carga',ventana:'a las 08:00'},order('x', {ventana_carga:null})),null);
assert.equal(distribution([1,2,3,4,100],5).p90,100);
const noEvents=buildOperationalMetrics({...input,steps:[],docs:[]});
assert.equal(noEvents.metricas.puntualidad_recogida.valor,null,'Entregado no demuestra puntualidad');
assert.equal(noEvents.metricas.otif.valor,null,'Sin paradas completas y marcas reales no hay OTIF');
assert.equal(noEvents.metricas.pod_pendiente.valor,null,'Sin entrega firmada, POD no tiene denominador evaluable');
const late=buildOperationalMetrics({...input,steps:[{empresa_id:'a',pedido_id:'one',data:{paradas:{...perStop.paradas,[stopIds[1].id]:{...events,posicionado_descarga_at:'2026-09-11T11:30:00Z'}}}}]});
assert.equal(late.metricas.puntualidad_entrega.valor,0);
assert.equal(late.metricas.otif.valor,0);
const grouped=buildOperationalMetrics({...input,orders:[order('g1',{grupaje_id:'g'}),order('g2',{grupaje_id:'g'})],steps:[],docs:[],fuel:[]});
assert.equal(grouped.metricas.co2_estimado.valor,93.6,'El mismo tramo físico no duplica emisiones');
assert.equal(grouped.emisiones.por_viaje.rows[0].kg_co2_estimado,46.8);
assert.equal(buildOperationalMetrics({...input,orders:[order('g1',{grupaje_id:'g'}),order('g2',{grupaje_id:'g',km_ruta:120})],steps:[],docs:[]}).metricas.co2_estimado.valor,null,
  'Grupaje con distancias incompatibles no genera una emisión ficticia');
assert.equal(buildOperationalMetrics({...input,attributionScope:false}).metricas.coste_combustible_km.valor,null,
  'Un filtro por cliente/ruta no recibe todos los repostajes del vehículo');
assert.equal(buildOperationalMetrics({...input,attributionScope:false}).flota.repostajes.total,0,
  'Tampoco atribuye sus tickets al detalle filtrado');
const isolated=buildOperationalMetrics({...input,orders:[order('one'),order('foreign',{empresa_id:'b',importe:999999,km_ruta:999999})],
  steps:[...input.steps,{empresa_id:'b',pedido_id:'foreign',data:events}],fuel:[...input.fuel,{empresa_id:'b',vehiculo_id:'v',importe:999999}]});
assert.equal(isolated.metricas.km_totales.valor,120);
assert.equal(isolated.metricas.coste_combustible_km.valor,1.25);
assert.equal(buildOperationalMetrics({...input,orders:[order('one'),order('planner',{origen_producto:'planner',km_ruta:999})]}).poblacion.pedidos,1,
  'La cohorte transportista no incorpora cargas de Planner');
async function evidenceCheck(){
  const {PGlite}=require('@electric-sql/pglite');
  const db=require('../src/services/db'),pg=new PGlite(),original=db.query;
  const a='00000000-0000-4000-8000-000000000001',b='00000000-0000-4000-8000-000000000002';
  const p='10000000-0000-4000-8000-000000000001',q='10000000-0000-4000-8000-000000000002';
  try{
    await pg.exec(`CREATE TABLE empresas(id uuid,cfg_precios jsonb);CREATE TABLE pedido_chofer_pasos(empresa_id uuid,pedido_id uuid,data jsonb);
      CREATE TABLE pedido_docs(empresa_id uuid,pedido_id uuid,tipo text,nombre text,created_at timestamptz);
      CREATE TABLE pedidos(id uuid,empresa_id uuid,origen_producto text);
      CREATE TABLE planner_muelles(id uuid,empresa_id uuid,nombre text,almacen text);
      CREATE TABLE planner_reservas(id uuid,empresa_id uuid,pedido_id uuid,muelle_id uuid,inicio timestamptz,fin timestamptz);
      CREATE TABLE planner_preparaciones(empresa_id uuid,pedido_id uuid,estado text,carga_inicio_at timestamptz,carga_fin_at timestamptz);
      INSERT INTO empresas VALUES ('${a}','{}'),('${b}','{}');
      INSERT INTO pedido_chofer_pasos VALUES ('${a}','${p}','{}'),('${b}','${q}','{}');
      INSERT INTO pedido_docs VALUES ('${a}','${p}','pod','POD',now()),('${b}','${q}','pod','POD',now());
      INSERT INTO pedidos VALUES ('${p}','${a}','planner'),('${q}','${b}','planner');
      INSERT INTO planner_muelles VALUES ('20000000-0000-4000-8000-000000000001','${a}','M1','Almacén'),
       ('20000000-0000-4000-8000-000000000002','${b}','M2','Almacén');
      INSERT INTO planner_reservas VALUES ('30000000-0000-4000-8000-000000000001','${a}','${p}','20000000-0000-4000-8000-000000000001','2026-09-10 08:00Z','2026-09-10 09:00Z'),
       ('30000000-0000-4000-8000-000000000002','${b}','${q}','20000000-0000-4000-8000-000000000002','2026-09-10 08:00Z','2026-09-10 09:00Z');
      INSERT INTO planner_preparaciones VALUES ('${a}','${p}','lista','2026-09-10 08:10Z','2026-09-10 08:50Z');`);
    db.query=(sql,params)=>pg.query(sql,params);
    const evidence=await loadOperationalEvidence(a,[p,q]);
    assert.equal(evidence.steps.length,1);assert.equal(evidence.docs.length,1);
    assert.equal(String(evidence.steps[0].pedido_id),p);
    const planner=await loadPlannerMetrics(a,range);
    assert.equal(planner.reservas,1,'Planner mantiene aislamiento y producto propio');
    assert.equal(planner.por_muelle[0].minutos_reservados,60);
    assert.equal(planner.duracion_carga.mediana,40);
  }finally{db.query=original;await pg.close();}
}
evidenceCheck().then(()=>console.log('OK BI fase 4: ventanas, OTIF, tiempos, ausencia de datos, repostajes, grupaje y aislamiento SQL'))
  .catch(error=>{console.error(error);process.exitCode=1;});

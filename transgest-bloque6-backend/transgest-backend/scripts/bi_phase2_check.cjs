const assert = require('node:assert/strict');
const { buildEconomics, physicalKm, structureInPeriod } = require('../src/services/financialEconomics');
const { buildAnalytics } = require('../src/services/financialAnalytics');
const { buildRouteSheet } = require('../src/services/financialRouteSheet');
const { equivalentPrevious, waterfall, evolution, matches } = require('../src/services/financialWorkspace');
const range = { desde: '2026-09-01', hasta: '2026-09-30' };
const order = (id, more = {}) => ({ id, empresa_id: 'a', estado: 'entregado', fecha_bi: '2026-09-10',
  cliente_id: 'c', origen: 'Madrid', destino: 'Valencia', vehiculo_id: 'v1', chofer_id: 'd1',
  importe: 1500, coste_operativo: 1250, coste_gasoil: 1250, km_ruta: 800, km_vacio: 200,
  pendiente_factura: true, ...more });
const reference = buildEconomics({ empresaId: 'a', range, orders: [order('one')] });
assert.equal(reference.ingreso_km_total, 1.5);
assert.equal(reference.coste_km_total, 1.25);
assert.equal(reference.margen_km_total, 0.25);
assert.equal(reference.margen_directo, 250);
assert.deepEqual(equivalentPrevious({desde:'2026-09-01',hasta:'2026-09-30'}),{desde:'2026-08-02',hasta:'2026-08-31'});
const bridge=waterfall(reference);
assert.equal(bridge[0].acumulado,1500);
assert.equal(bridge[1].acumulado,250);
assert.equal(bridge[1].base,250);
assert.equal(bridge[1].tramo,1250);
assert.equal(evolution([order('missing',{importe:null})],'dia')[0].ingreso,null,'Serie temporal sin ingreso conocido no inventa cero');
assert.equal(matches(order('filtered'),{cliente_id:'c',ruta:'Madrid → Valencia',vehiculo_id:'v1',ejecucion:'flota_propia'}),true);
assert.equal(matches(order('filtered'),{cliente_id:'c',ruta:'Madrid → Murcia',vehiculo_id:'v1',ejecucion:'flota_propia'}),false,'Los filtros analíticos se combinan');
assert.equal(reference.porcentaje_vacio, 20);
assert.ok(Math.abs(reference.margen_directo_pct_sin_redondeo - 16.6666666667) < 0.0001);
assert.equal(reference.metricas.margen_directo.estado, 'parcial', 'Coste registrado no acredita cobertura plena');
const weighted = buildEconomics({empresaId:'a',range,orders:[
  order('w1',{importe:100,coste_operativo:50,coste_gasoil:50,km_ruta:100,km_vacio:0}),
  order('w2',{importe:900,coste_operativo:450,coste_gasoil:450,km_ruta:300,km_vacio:0})]});
assert.equal(weighted.ingreso_km_total,2.5,'Ratio agregado = 1000 / 400, no media de ratios');
assert.equal(weighted.margen_directo_pct,50,'Margen porcentual = suma de márgenes / suma de ingresos');
const grouped = [order('g1', {grupaje_id:'g',importe:100,coste_operativo:40,coste_gasoil:40,km_ruta:100,km_vacio:0}),
  order('g2', {grupaje_id:'g',importe:200,coste_operativo:80,coste_gasoil:80,km_ruta:100,km_vacio:0})];
assert.equal(physicalKm(grouped).total, 100, 'Dos pedidos sobre el mismo tramo no suman 200 km');
assert.equal(buildEconomics({empresaId:'a',range,orders:grouped}).ingreso_km_total,3);
assert.equal(physicalKm([grouped[0], {...grouped[1],vehiculo_id:'v2'}]).total,200,'Dos vehículos recorren 200 km físicos');
assert.equal(buildEconomics({empresaId:'a',range,orders:[grouped[0],{...grouped[1],km_ruta:120}]}).ingreso_km_total,null,
  'Distancias divergentes en un grupaje requieren un tramo físico verificable');
assert.equal(physicalKm([order('x',{km_ruta:100,km_vacio:20})],
  [{km_vacio:20,notas:'app_chofer:pedido:x'},{km_vacio:5,notas:'manual'}]).total,125,'No duplica vacío de la app');
const input = {empresaId:'a',range,orders:[order('one')],
  fuel:[{id:'ticket',empresa_id:'a',fecha:'2026-09-12',importe:250,vehiculo_id:'v1'}],
  driverExpenses:[{id:'ticket',empresa_id:'a',fecha:'2026-09-12',tipo:'gasoil',estado:'registrado',importe:250,vehiculo_id:'v1'},
    {id:'base',empresa_id:'a',fecha:'2026-09-12',tipo:'gasoil',estado:'pendiente_base',importe:null}],
  structure:[{empresa_id:'a',activo:true,fecha:'2026-01',periodo:'mensual',importe:300}],
  repairs:[{id:'repair',empresa_id:'a',fecha:'2026-09-15',vehiculo_id:'v1',coste_total:50}],
  payroll:[{id:'pay',empresa_id:'a',periodo:'2026-09',salario_base:100,ss_empresa:30,importe_noches:20}],
  invoices:[{id:'issued',empresa_id:'a',cliente_id:'c',estado:'emitida',fecha:'2026-08-01',fecha_vencimiento:'2026-08-20',total:1210,base_imponible:1000},
    {id:'draft',empresa_id:'a',cliente_id:'c',estado:'borrador',fecha:'2026-09-01',total:9999},
    {id:'credit',empresa_id:'a',cliente_id:'c',estado:'emitida',fecha:'2026-09-15',total:-121,base_imponible:-100}],
  clients:[{id:'c',empresa_id:'a',nombre:'Cliente A'}]};
const result = buildEconomics(input);
assert.equal(result.margen_directo,250,'Tickets no se añaden otra vez al coste de pedido');
assert.equal(result.resultado_categorias.importe,-230,'Resta 50 taller, 130 salario base y SS, 300 estructura');
assert.equal(result.resultado_categorias.estructura_no_atribuida,0);
assert.deepEqual(result.resultado_categorias.reparto_estructura,[{vehiculo_id:'v1',ingreso_base:1500,importe:300}]);
assert.equal(result.cobertura.gastos_pendientes_valorar,1);
assert.equal(result.pendiente_facturar.importe,1500);
assert.equal(result.pendiente_facturar.antiguedad['0_30'],1500);
assert.equal(result.saldo_estimado_al_corte,1089,'Incluye deuda anterior y abono firmado; excluye borrador');
assert.equal(result.vencido_estimado,1210);
assert.equal(result.cobros_efectivos,null);
assert.equal(result.antiguedad_vencido_por_cliente[0].cliente,'Cliente A');
assert.equal(buildEconomics({...input,orders:[order('one',{vehiculo_id:null})]}).resultado_categorias.estructura_no_atribuida,300);
assert.equal(structureInPeriod(input.structure,{desde:'2026-09-01',hasta:'2026-10-31'}).importe,600);
const changed = buildEconomics({...input,orders:[order('one',{vehiculo_id:'v2'})],
  vehicles:[{id:'v1',empresa_id:'a',chofer_id:'d1'}]});
assert.equal(changed.por_vehiculo[0].id,'v2','Usa asignación guardada en el pedido, no vínculo actual del vehículo');
assert.equal(buildEconomics({...input,orders:[...input.orders,order('foreign',{empresa_id:'b',importe:999999})],
  invoices:[...input.invoices,{empresa_id:'b',estado:'emitida',fecha:'2026-09-01',total:999999}]}).ingreso_servicios_realizados,1500);
const pages = [1,2].map(page => buildEconomics({empresaId:'a',range,page,limit:1,
  orders:[order('first',{cliente_id:'c1',importe:100}),order('second',{cliente_id:'c2',importe:200})]}));
assert.equal(pages[0].ingreso_servicios_realizados,300);
assert.equal(pages[1].ingreso_servicios_realizados,300,'Cambiar página no cambia el agregado');
assert.notEqual(pages[0].por_cliente[0].id,pages[1].por_cliente[0].id,'El detalle sí pagina');
const legacy = buildAnalytics({empresaId:'a',range,orders:grouped});
assert.equal(legacy.totals.kmTotal,100,'Adaptador de fase 1 también deja de duplicar grupaje');
const route = buildRouteSheet({range,orders:[order('one',{km_ruta:100,km_vacio:20})],repostajes:[],noches:[],expenses:[],repairs:[],
  emptyKm:[{km_vacio:20,notas:'app_chofer:pedido:one'},{km_vacio:5,notas:'manual'}]});
assert.equal(route.kmTotal,125,'Hoja de ruta evita el doble vacío');
console.log('OK BI fase 2: reconciliación, duplicados, grupaje, vehículo histórico, estructura, abono y aislamiento');

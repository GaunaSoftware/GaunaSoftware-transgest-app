// One tenant-scoped BI request for Dirección and Rentabilidad. Financial
// formulas come from financialEconomics; this module only builds visual series,
// filter choices, paginated explanations and navigation targets.
const db = require('./db');
const { reportRange, day, money, ratio, isValidInvoice } = require('./financialKpis');
const { loadAnalyticsSources } = require('./financialAnalytics');
const { buildEconomics, costBreakdown } = require('./financialEconomics');
const { buildOperationalMetrics, loadOperationalEvidence, loadPlannerMetrics } = require('./operationalMetrics');
const execution = p => p.colaborador_id || p.colaborador_nombre ? 'subcontratado' : 'flota_propia';
const done = p => ['entregado', 'facturado'].includes(String(p.estado));
const dateOf = p => day(p.fecha_bi || p.facturacion_mes || p.entregado_at || p.fecha_descarga || p.fecha_carga || p.fecha_pedido);
const euro = n => money(n == null ? null : n);
function moveDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function equivalentPrevious(range) {
  const length = (Date.parse(range.hasta) - Date.parse(range.desde)) / 86400000 + 1;
  return { desde: moveDate(range.desde, -length), hasta: moveDate(range.desde, -1) };
}
function validateFilters(query = {}) {
  const text = (key, max = 240) => {
    const v = String(query[key] || '').trim();
    if (v.length > max) throw Object.assign(new Error(`Filtro ${key} demasiado largo`), { status: 400 });
    return v;
  };
  const filters = { cliente_id: text('cliente_id', 80), ruta: text('ruta'), vehiculo_id: text('vehiculo_id', 80), ejecucion: text('ejecucion', 32) };
  if (filters.ejecucion && !['flota_propia', 'subcontratado'].includes(filters.ejecucion)) throw Object.assign(new Error('Tipo de ejecución no válido'), { status: 400 });
  return filters;
}
function matches(p, filters) {
  return (!filters.cliente_id || String(p.cliente_id) === filters.cliente_id)
    && (!filters.ruta || `${p.origen || '?'} → ${p.destino || '?'}` === filters.ruta)
    && (!filters.vehiculo_id || String(p.vehiculo_id || '') === filters.vehiculo_id)
    && (!filters.ejecucion || execution(p) === filters.ejecucion);
}
function filterChoices(sources, orders) {
  const unique = rows => [...new Map(rows.map(r => [r.id, r])).values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const clientIds = new Set(orders.map(p => String(p.cliente_id)));
  const vehicleIds = new Set(orders.map(p => String(p.vehiculo_id)));
  return {
    clientes: unique(sources.clients.filter(c => clientIds.has(String(c.id))).map(c => ({id:String(c.id), nombre:c.nombre || String(c.id)}))),
    rutas: unique(orders.map(p => ({id:`${p.origen || '?'} → ${p.destino || '?'}`, nombre:`${p.origen || '?'} → ${p.destino || '?'}`}))),
    vehiculos: unique(sources.vehicles.filter(v => vehicleIds.has(String(v.id))).map(v => ({id:String(v.id), nombre:v.matricula || String(v.id)}))),
    ejecuciones: [{id:'flota_propia',nombre:'Flota propia'},{id:'subcontratado',nombre:'Subcontratación'}]
  };
}
function timeBucket(date, granularity) {
  if (granularity === 'mes') return date.slice(0, 7);
  if (granularity === 'semana') {
    const d = new Date(`${date}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    return d.toISOString().slice(0, 10);
  }
  return date;
}
function evolution(services, granularity) {
  const buckets = new Map();
  for (const p of services) {
    const key = timeBucket(dateOf(p), granularity);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(p);
  }
  return [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, rows]) => {
    const known = rows.filter(p => p.importe != null && Number.isFinite(Number(p.importe)));
    const income = known.length ? euro(known.reduce((n, p) => n + Number(p.importe), 0)) : null;
    const costs = costBreakdown(rows);
    return { fecha, ingreso: income, margen: income == null || costs.directo_registrado == null ? null : euro(income - costs.directo_registrado),
      cobertura_costes: costs.cobertura };
  });
}
function detail(services, clients, vehicles, invoices, sort, direction, page, limit) {
  const clientNames = new Map(clients.map(c => [String(c.id), c.nombre]));
  const plates = new Map(vehicles.map(v => [String(v.id), v.matricula]));
  const validInvoices = new Set(invoices.filter(isValidInvoice).map(f => String(f.id)));
  const rows = services.map(p => {
    const cost = costBreakdown([p]).directo_registrado;
    return { id:p.id, numero:p.numero || String(p.id), fecha:dateOf(p), cliente_id:p.cliente_id,
      cliente:clientNames.get(String(p.cliente_id)) || 'Sin cliente', ruta:`${p.origen || '?'} → ${p.destino || '?'}`,
      vehiculo_id:p.vehiculo_id || null, vehiculo:plates.get(String(p.vehiculo_id)) || p.matricula || 'Sin vehículo',
      ejecucion:execution(p), ingreso:euro(p.importe), coste:cost, margen:cost == null || euro(p.importe) == null ? null : euro(Number(p.importe) - cost),
      km_pedido:p.km_ruta == null ? null : Number(p.km_ruta), km_vacio_pedido:p.km_vacio == null ? null : Number(p.km_vacio),
      pendiente_factura:p.pendiente_factura === true,
      factura_id:p.factura_id && validInvoices.has(String(p.factura_id)) ? p.factura_id : null };
  });
  const numeric = ['ingreso', 'coste', 'margen', 'km_pedido', 'km_vacio_pedido'].includes(sort);
  rows.sort((a, b) => {
    const av = a[sort], bv = b[sort];
    if (av == null && bv != null) return 1;
    if (bv == null && av != null) return -1;
    const comparison = numeric ? Number(av || 0) - Number(bv || 0) : String(av || '').localeCompare(String(bv || ''), 'es');
    return (direction === 'asc' ? comparison : -comparison) || String(a.id).localeCompare(String(b.id));
  });
  return { total: rows.length, page, limit, rows:rows.slice((page - 1) * limit, page * limit),
    nota_km:'Los km de un servicio compartido en grupaje no son aditivos; los totales usan kilómetros físicos deduplicados.' };
}
function waterfall(economy) {
  const direct = economy.costes_directos.directo_registrado;
  if (economy.ingreso_servicios_realizados == null || direct == null) return [];
  const steps = [{ clave:'ingreso', etiqueta:'Ingreso realizado', impacto:economy.ingreso_servicios_realizados }];
  steps.push({ clave:'directo', etiqueta:'Coste directo registrado', impacto:-direct });
  const amounts = economy.resultado_categorias.importes;
  if (economy.resultado_categorias.incluidas.includes('taller_registrado')) steps.push({clave:'taller',etiqueta:'Taller',impacto:-amounts.taller});
  if (economy.resultado_categorias.incluidas.includes('salario_base_y_ss_empresa_registrados')) steps.push({clave:'nomina',etiqueta:'Salario base + SS empresa',impacto:-amounts.nomina_base_ss});
  if (economy.resultado_categorias.incluidas.includes('estructura_estimada')) steps.push({clave:'estructura',etiqueta:'Estructura estimada',impacto:-amounts.estructura});
  let running = 0;
  return steps.map(step => { const before=running; running = euro(running + step.impacto); return {...step, base:Math.max(0,Math.min(before,running)), tramo:Math.abs(step.impacto), tipo:step.impacto < 0 ? 'coste' : 'ingreso', acumulado:running}; });
}
function reviewItems(services, invoices, range, invoiceScope) {
  const items = [];
  for (const p of services) {
    const cost = costBreakdown([p]).directo_registrado;
    if (cost == null) items.push({tipo:'pedido',id:p.id,numero:p.numero,motivo:'Coste directo sin valorar',prioridad:1});
    else if (Number(p.importe || 0) < cost) items.push({tipo:'pedido',id:p.id,numero:p.numero,motivo:'Margen directo negativo',prioridad:0});
    if (!(Number(p.km_ruta) > 0)) items.push({tipo:'pedido',id:p.id,numero:p.numero,motivo:'Kilómetros sin informar',prioridad:2});
  }
  if (invoiceScope) for (const f of invoices) {
    if (isValidInvoice(f) && f.estado !== 'cobrada' && day(f.fecha_vencimiento) && day(f.fecha_vencimiento) < range.hasta && Number(f.total) > 0)
      items.push({tipo:'factura',id:f.id,numero:f.numero || '',motivo:'Saldo vencido estimado',prioridad:1});
  }
  return items.sort((a,b) => a.prioridad-b.prioridad || String(a.numero).localeCompare(String(b.numero),'es')).slice(0,12);
}
function comparison(current, previous) {
  const toComparison = (a, b) => ({actual:a,anterior:b,diferencia:a == null || b == null ? null : euro(a-b),
    variacion_pct:a == null || !(b > 0) ? null : ratio(a-b,b,100)});
  return {ingreso:toComparison(current.ingreso_servicios_realizados,previous.ingreso_servicios_realizados),
    margen:toComparison(current.margen_directo,previous.margen_directo)};
}
async function readWorkspace(empresaId, query = {}, access = {}) {
  if (!empresaId) throw Object.assign(new Error('Sin empresa_id'), {status:401});
  const range = reportRange(query), previousRange = equivalentPrevious(range), filters = validateFilters(query);
  const page = Number(query.page || 1), limit = Number(query.limit || 20);
  const invoicePage = Number(query.invoice_page || 1), invoiceLimit = 20;
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || (limit > 100 && !access.exportAll))
    throw Object.assign(new Error('Paginación BI no válida'), {status:400});
  if (!Number.isSafeInteger(invoicePage) || invoicePage < 1 || invoicePage > 1000000)
    throw Object.assign(new Error('Paginación de facturas no válida'), {status:400});
  const sort = ['fecha','numero','cliente','ruta','vehiculo','ejecucion','ingreso','coste','margen','km_pedido','km_vacio_pedido'].includes(query.sort) ? query.sort : 'fecha';
  const direction = query.direction === 'asc' ? 'asc' : 'desc';
  const granularity = ['dia','semana','mes'].includes(query.granularity) ? query.granularity :
    (Date.parse(range.hasta)-Date.parse(range.desde))/86400000 <= 45 ? 'dia' : 'mes';
  const queryDb = access.queryDb || db.query;
  const source = await loadAnalyticsSources(empresaId,range,previousRange.desde,queryDb);
  const currentAll = source.orders.filter(p => done(p) && dateOf(p) >= range.desde && dateOf(p) <= range.hasta);
  const filtered = currentAll.filter(p => matches(p,filters));
  const operationalView = ['operaciones','flota','calidad'].includes(String(query.vista||''));
  const operationalOrders = operationalView ? source.orders.filter(p => String(p.origen_producto||'transgest')!=='planner' && dateOf(p) >= range.desde && dateOf(p) <= range.hasta && matches(p,filters)) : [];
  const evidence = operationalView ? await loadOperationalEvidence(empresaId,operationalOrders.map(p=>p.id),queryDb) : null;
  const operations = operationalView ? buildOperationalMetrics({empresaId,range,orders:operationalOrders,
    steps:evidence.steps,docs:evidence.docs,clients:source.clients,vehicles:source.vehicles,fuel:source.fuel,repairs:source.repairs,
    emptyKm:source.emptyKm.filter(r=>!filters.vehiculo_id||String(r.vehiculo_id)===filters.vehiculo_id),
    config:evidence.config,missingSources:[...source.missingSources,...evidence.missingSources],page,limit,
    attributionScope:!filters.cliente_id&&!filters.ruta&&!filters.ejecucion}) : null;
  if (operations && query.vista==='operaciones' && access.plannerAuthorized && !Object.values(filters).some(Boolean))
    operations.planner=await loadPlannerMetrics(empresaId,range,queryDb);
  const prior = source.orders.filter(p => done(p) && dateOf(p) >= previousRange.desde && dateOf(p) <= previousRange.hasta && matches(p,filters));
  const invoiceScope = !filters.ruta && !filters.vehiculo_id && !filters.ejecucion;
  const invoices = invoiceScope ? source.invoices.filter(f => !filters.cliente_id || String(f.cliente_id) === filters.cliente_id) : [];
  const dimensionFiltered = Object.values(filters).some(Boolean);
  const attributableEmpty = filters.cliente_id || filters.ruta || filters.ejecucion ? [] :
    filters.vehiculo_id ? source.emptyKm.filter(r => String(r.vehiculo_id) === filters.vehiculo_id) : source.emptyKm;
  const shared = { empresaId, orders:filtered, invoices, clients:source.clients, vehicles:source.vehicles,
    repairs:dimensionFiltered ? [] : source.repairs, emptyKm:attributableEmpty,
    structure:dimensionFiltered ? [] : source.structure, fuel:dimensionFiltered ? [] : source.fuel,
    driverExpenses:dimensionFiltered ? [] : source.driverExpenses,
    payroll:dimensionFiltered ? [] : source.payroll, nights:dimensionFiltered ? [] : source.nights,
    missingSources:source.missingSources, page:1, limit:Number.MAX_SAFE_INTEGER };
  const economy = buildEconomics({...shared,range});
  const previous = buildEconomics({empresaId,range:previousRange,orders:prior,invoices:[]});
  const metricInputs = {
    ingreso_realizado:[economy.ingreso_servicios_realizados,'Ninguno'],
    coste_directo:[economy.costes_directos.directo_registrado,'Costes directos registrados en el pedido'],
    margen_directo:[economy.margen_directo,'Costes directos registrados en el pedido'],
    ingreso_km_total:[economy.ingreso_servicios_realizados,'Ninguno'],
    margen_km_total:[economy.margen_directo,'Costes directos registrados en el pedido'],
    km_vacios_pct:[economy.kilometros.vacios,'Ninguno'],
    pendiente_facturar:[economy.pendiente_facturar.importe,'Ninguno'],
    vencido_al_corte:[economy.vencido_estimado,'Ninguno']
  };
  for (const [name,[numerator,costs]] of Object.entries(metricInputs)) {
    economy.metricas[name] = {...economy.metricas[name],numerador:numerator,costes_incluidos:costs,fecha_corte:range.hasta};
  }
  if (dimensionFiltered) {
    economy.resultado_categorias.importe = null;
    economy.metricas.resultado_con_categorias = {...economy.metricas.resultado_con_categorias,valor:null,estado:'no_aplicable',
      definicion:'Los costes de flota y estructura no pueden atribuirse con seguridad a esta selección.'};
  }
  if (!invoiceScope) {
    for (const name of ['facturacion_emitida','pendiente_facturar','vencido_al_corte','saldo_al_corte']) {
      if (name !== 'pendiente_facturar') economy.metricas[name] = {...economy.metricas[name],valor:null,estado:'no_aplicable',definicion:'No atribuible a ruta, vehículo o tipo de ejecución sin enlace fiscal por importe.'};
    }
    economy.facturacion_emitida_neta = null; economy.facturacion_emitida_total = null;
    economy.saldo_estimado_al_corte = null; economy.vencido_estimado = null;
  }
  let objective = null;
  if (!Object.values(filters).some(Boolean) && ['mes','mensual','anual','anio','año'].includes(query.periodo)) {
    const goalPeriod = ['mes','mensual'].includes(query.periodo) ? 'mensual' : 'anual';
    try {
      if(queryDb!==db.query&&!(await queryDb("SELECT to_regclass('objetivos_kpi') AS relation")).rows[0]?.relation)throw Object.assign(new Error('Objetivos no disponibles'),{code:'42P01'});
      const result = await queryDb('SELECT facturacion,km_totales,pct_km_vacio,pedidos,coste_taller,margen FROM objetivos_kpi WHERE empresa_id=$1 AND periodo=$2 LIMIT 1',[empresaId,goalPeriod]);
      if (result.rows[0]) objective = {periodo:goalPeriod, ...result.rows[0], nota:'Objetivo configurado para el periodo calendario completo; facturación significa base emitida, no ingreso realizado.'};
    } catch (error) { if (error.code !== '42P01') throw error; }
  }
  const breakdowns = {
    cliente:economy.por_cliente, ruta:economy.por_ruta, vehiculo:economy.por_vehiculo, ejecucion:economy.por_ejecucion
  };
  const sortMargin = rows => [...rows].filter(r => r.margen_directo_registrado != null)
    .sort((a,b) => b.margen_directo_registrado-a.margen_directo_registrado).slice(0,10);
  const invoiceSort = ['fecha_vencimiento','numero','cliente','total'].includes(query.invoice_sort) ? query.invoice_sort : 'fecha_vencimiento';
  const invoiceDirection = query.invoice_direction === 'desc' ? 'desc' : 'asc';
  const invoicesDue = invoiceScope ? invoices.filter(f => isValidInvoice(f) && f.estado !== 'cobrada' && day(f.fecha_vencimiento) && day(f.fecha_vencimiento) < range.hasta)
    .map(f => ({id:f.id,numero:f.numero,cliente:f.cliente_nombre,fecha_vencimiento:day(f.fecha_vencimiento),total:f.total == null ? null : Number(f.total)}))
    .sort((a,b) => {const av=a[invoiceSort],bv=b[invoiceSort];const delta=invoiceSort==='total'?Number(av||0)-Number(bv||0):String(av||'').localeCompare(String(bv||''),'es');return (invoiceDirection==='asc'?delta:-delta)||String(a.id).localeCompare(String(b.id));}) : [];
  return { metadata:{ version:'bi.workspace.v1',periodo:range,comparacion:previousRange,
      actualizado_en:new Date().toISOString(),zona_horaria:'Europe/Madrid',alcance:'empresa autenticada; agregados antes de paginación',
      facturas_atribuibles:invoiceScope },
    filtros:{aplicados:filters,opciones:filterChoices(source,currentAll)},
    economia:economy, comparacion:comparison(economy,previous), evolucion:evolution(filtered,granularity),granularidad:granularity,
    objetivo:objective, cascada:waterfall(economy),
    rankings:{cliente:sortMargin(breakdowns.cliente),ruta:sortMargin(breakdowns.ruta),vehiculo:sortMargin(breakdowns.vehiculo),ejecucion:sortMargin(breakdowns.ejecucion)},
    matriz:breakdowns, servicios:detail(filtered,source.clients,source.vehicles,invoices,sort,direction,page,limit),
    revision:reviewItems(filtered,invoices,range,invoiceScope), operations,
    facturas_vencidas:{total:invoicesDue.length,page:invoicePage,limit:invoiceLimit,rows:access.exportAll?invoicesDue:invoicesDue.slice((invoicePage-1)*invoiceLimit,invoicePage*invoiceLimit)}};
}
module.exports = { readWorkspace, equivalentPrevious, validateFilters, matches, evolution, waterfall };

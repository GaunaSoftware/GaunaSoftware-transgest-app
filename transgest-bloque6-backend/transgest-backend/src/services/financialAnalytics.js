// Read-only analytical adapter. Never writes invoices or connects to accounting/production services.
const db = require('./db');
const { financialPedidosCte, reportRange, money, ratio, day, isValidInvoice, collectionAmounts, metric, reportMetadata } = require('./financialKpis');
const { buildEconomics, physicalKm } = require('./financialEconomics');
const num = v => Number(v || 0);
const sum = (rows, key) => money(rows.reduce((n, r) => n + num(typeof key === 'function' ? key(r) : r[key]), 0));
const inRange = (date, range) => day(date) >= range.desde && day(date) <= range.hasta;
const completed = p => ['entregado','facturado'].includes(p.estado);
const dateOrder = p => p.fecha_bi || (completed(p) ? p.facturacion_mes || p.entregado_at || p.firma_fecha : null) || p.fecha_descarga || p.fecha_carga || p.fecha_pedido || p.created_at;
function tractor(v, vehicles) {
  return !/remolque|dolly|lowboy/i.test(v.clase || v.tipo || '') && !/^R-|-R$/i.test(v.matricula || '') && !vehicles.some(t => t.remolque_id === v.id);
}
function orderTotals(orders) {
  const income = sum(orders, 'importe'), cost = sum(orders, 'coste_operativo');
  const physical = physicalKm(orders);
  const loaded = physical.cargados, empty = physical.vacios;
  const knownKm = orders.filter(p => num(p.km_ruta) > 0).length;
  const knownCost = orders.filter(p => num(p.coste_operativo) > 0).length;
  return { ingresos: income, costes: cost, margen: knownCost ? money(income - cost) : null,
    viajes: orders.length, entregas: orders.filter(completed).length,
    kmTotal: loaded, kmVacio: empty, kmTotales: loaded + empty,
    eurosKm: knownKm === orders.length ? ratio(income, loaded + empty) : null,
    eurosKmCargado: knownKm === orders.length ? ratio(income, loaded) : null,
    pctVacio: knownKm === orders.length ? ratio(empty, loaded + empty, 100) : null,
    cobertura_km: knownKm, cobertura_coste: knownCost };
}
function group(rows, key) { const result = new Map(); for (const r of rows) { const k = key(r); if (!result.has(k)) result.set(k, []); result.get(k).push(r); } return [...result.entries()]; }
function structureMonth(gastos, month) {
  const [y, m] = month.split('-').map(Number);
  const target = y * 12 + m;
  return gastos.filter(g => g.activo !== false).map(g => {
    const [gy, gm] = day(g.fecha).split('-').map(Number);
    const elapsed = target - (gy * 12 + gm);
    const frequency = { mensual: 1, trimestral: 3, anual: 12 }[g.periodo];
    const matches = elapsed >= 0 && (frequency ? true : elapsed === 0);
    return matches ? { ...g, importe_periodo: money(num(g.importe) / (frequency || 1)) } : null;
  }).filter(Boolean);
}

function buildAnalytics({ empresaId, range, orders = [], invoices = [], vehicles = [], drivers = [], repairs = [], emptyKm = [], structure = [], clients: clientRecords = [], fuel = [], driverExpenses = [], payroll = [], nights = [], page = 1, limit = 50, missingSources = [] }) {
  // Defense in depth for reuse outside HTTP. SQL readers also apply company predicates.
  const own = rows => rows.filter(r => String(r.empresa_id) === String(empresaId));
  orders = own(orders).filter(p => inRange(dateOrder(p), range) && p.estado !== 'cancelado');
  const services = orders.filter(completed);
  invoices = own(invoices).filter(isValidInvoice);
  const issued = invoices.filter(f => inRange(f.fecha, range));
  const atCutoff = invoices.filter(f => day(f.fecha) && day(f.fecha) <= range.hasta);
  vehicles = own(vehicles); drivers = own(drivers); emptyKm = own(emptyKm).filter(r => inRange(r.fecha, range));
  repairs = repairs.filter(r => (!r.empresa_id || String(r.empresa_id) === String(empresaId)) && inRange(r.fecha, range)); // nested rows from tenant-scoped taller_estado
  const totals = orderTotals(services);
  const invoiceTotal = sum(issued, 'total');
  const collected = sum(issued.filter(f => f.estado === 'cobrada'), 'total');
  const balance = sum(atCutoff.filter(f => f.estado !== 'cobrada'), 'total');
  const monthly = group(issued, f => day(f.fecha).slice(0,7)).map(([name, rows]) => ({ name, fact: sum(rows,'total'), facturado: sum(rows,'base_imponible'), cobr: sum(rows.filter(f=>f.estado==='cobrada'),'total') })).sort((a,b)=>a.name.localeCompare(b.name));
  const clients = group(issued, f => f.cliente_id).map(([id, rows]) => {
    const amounts = collectionAmounts(sum(rows,'total'), sum(rows.filter(f=>f.estado==='cobrada'),'total'));
    return { id, name: rows[0].cliente_nombre || 'Sin cliente', total: amounts.total, nfact: rows.length, cobrado: amounts.cobrado, pendiente: amounts.saldo, cobro_pct: amounts.porcentaje };
  }).sort((a,b)=>b.total-a.total);
  const routes = group(services, p => `${p.origen || 'Sin origen'} → ${p.destino || 'Sin destino'}`).map(([name, rows]) => ({ name, viajes: rows.length, importe: sum(rows,'importe'), ingreso_medio: ratio(sum(rows,'importe'), rows.length) })).sort((a,b)=>b.importe-a.importe);
  const fleet = vehicles.filter(v=>tractor(v,vehicles)).map(v => {
    const rows = services.filter(p=>p.vehiculo_id===v.id);
    const costs = sum(repairs.filter(r=>r.vehiculo_id===v.id),'coste_total');
    const t = orderTotals(rows);
    const manual = sum(emptyKm.filter(r=>r.vehiculo_id===v.id && !String(r.notas || '').startsWith('app_chofer:pedido:')),'km_vacio');
    const km = t.kmTotales + manual;
    // Manual repositioning is separate from order kilometres; coverage explicitly estimated.
    const evaluatedKm = rows.length > 0 && t.cobertura_km === rows.length;
    return { ...v, ...t, kmTot:t.kmTotal, kmVac:t.kmVacio + manual, eKm: evaluatedKm ? ratio(t.ingresos, km) : null,
      pVac: evaluatedKm ? ratio(t.kmVacio + manual, km, 100) : null,
      coste_taller: costs, resultado_con_taller: t.margen == null ? null : money(t.margen - costs),
      vehiculo:v, pedidosVh:rows, kmCargados:t.kmTotal, kmVacioReg:t.kmVacio + manual, kmTotales:km, costosTaller:costs,
      pctVacio:evaluatedKm ? ratio(t.kmVacio + manual,km,100) : null, costoKm:repairs.some(r=>r.vehiculo_id===v.id) && evaluatedKm ? ratio(costs,km) : null, ingresoKm:t.eurosKmCargado,
      kmVacioRecords:emptyKm.filter(r=>r.vehiculo_id===v.id && !String(r.notas || '').startsWith('app_chofer:pedido:')), reparaciones:repairs.filter(r=>r.vehiculo_id===v.id) };
  });
  const byDriver = drivers.map(c => {
    const rows = services.filter(p=>p.chofer_id===c.id || p.chofer2_id===c.id);
    const weighted = rows.map(p=>({ ...p, importe:num(p.importe) * (p.chofer2_id ? (p.chofer_id === c.id ? num(p.reparto_chofer1 ?? 50) : 100-num(p.reparto_chofer1 ?? 50))/100 : 1) }));
    return { id:c.id, nombre:`${c.nombre || ''} ${c.apellidos || ''}`.trim(), ...orderTotals(weighted) };
  });
  const visits = vehicles.map(v => {
    const reps = repairs.filter(r=>r.vehiculo_id===v.id);
    const types = group(reps,r=>r.tipo || 'Otros').sort((a,b)=>b[1].length-a[1].length);
    return { matricula:v.matricula, marca:v.marca || 'Sin marca', modelo:v.modelo, visitas:reps.length, coste:sum(reps,'coste_total'), topTipo:types[0]?.[0] || '—' };
  });
  // The existing structure view is monthly. A multi-month report must not present
  // the first month's allocation as the total for the entire selected interval.
  const singleMonth = range.desde.slice(0,7) === range.hasta.slice(0,7);
  const structureRows = singleMonth ? structureMonth(own(structure), range.desde.slice(0,7)) : [];
  const structureTotal = singleMonth && structureRows.length ? sum(structureRows,'importe_periodo') : null;
  const activeFleet = fleet.filter(v=>v.activo !== false && !['baja','inactivo'].includes(v.estado));
  const activeIncome = sum(activeFleet,'ingresos');
  const allocation = activeFleet.map(v=>({ v, peso_igual:ratio(1,activeFleet.length), peso_ingresos:ratio(v.ingresos,activeIncome), coste_igual:singleMonth ? ratio(structureTotal,activeFleet.length) : null, coste_ingresos:singleMonth && activeIncome > 0 ? money(structureTotal*v.ingresos/activeIncome) : null }));
  const economia = buildEconomics({empresaId,range,orders,invoices,vehicles,drivers,repairs,emptyKm,structure,clients:clientRecords,fuel,driverExpenses,payroll,nights,page,limit,missingSources});
  return {
    metadata:reportMetadata(range, {
      margen_directo:metric(totals.margen,'Servicios realizados menos costes directos registrados', { status:totals.margen == null?'sin_datos':'parcial', total:services.length, known:totals.cobertura_coste }),
      eur_km:metric(totals.eurosKm,'Ingresos realizados / km cargados y vacíos de esos servicios', { unit:'EUR/km total',total:services.length,known:totals.cobertura_km,denominator:totals.kmTotales }),
      cobrado:metric(collected,'Facturas emitidas en el periodo con estado cobrada; estimación sin fecha de pago',{status:'estimado',taxes:'con impuestos'}),
      saldo_al_corte:metric(balance,'Emitidas hasta el corte y actualmente no cobradas; incluye deuda anterior',{status:'estimado',taxes:'con impuestos'}),
      cobros_efectivos:metric(null,'No hay movimientos de cobro fechados en la base TMS'),
      resultado_completo:metric(null,'Sin conciliación entre costes por pedido, flota, nóminas y estructura'),
      estructura:metric(structureTotal,'Imputación mensual: anual /12, trimestral /3, mensual o único completo',{status:!singleMonth?'no_aplicable':structureTotal==null?'sin_datos':'estimado'})
    }),
    totals:{ ...totals, facturado:sum(issued,'base_imponible'), facturado_total:invoiceTotal, cobrado:collected, cobro_pct:ratio(collected,invoiceTotal,100), saldo_al_corte:balance, cobros_efectivos:null, facturas:issued.length,
      facturas_vencidas:atCutoff.filter(f=>f.estado!=='cobrada' && day(f.fecha_vencimiento) && day(f.fecha_vencimiento)<range.hasta).length,
      ticket_medio:ratio(totals.ingresos, services.length), coste_taller:sum(repairs,'coste_total'), facturacion_por_camion:ratio(invoiceTotal,fleet.length), coste_taller_por_camion:ratio(sum(repairs,'coste_total'),fleet.length) },
    facMensual:monthly, topClientes:clients, topRutas:routes, flotaStats:fleet, choferesStats:byDriver,
    tallerVisitas:visits, tallerPorMarca:group(visits,v=>v.marca).map(([marca,rows])=>({marca,visitas:sum(rows,'visitas'),coste:sum(rows,'coste'),vehiculos:rows.length})),
    costesCat:group(repairs,r=>r.tipo || 'Otros').map(([name,rows])=>({name,value:sum(rows,'coste_total')})),
    costeMensualTaller:group(repairs,r=>day(r.fecha).slice(0,7)).map(([name,rows])=>({name,coste:sum(rows,'coste_total')})).sort((a,b)=>a.name.localeCompare(b.name)),
    explotacionTotales:{ ingresos:sum(fleet,'ingresos'),kmCargados:sum(fleet,'kmCargados'),kmVacioReg:sum(fleet,'kmVacioReg'),costosTaller:sum(fleet,'costosTaller'),margen:fleet.some(v=>v.margen!=null)?sum(fleet,'resultado_con_taller'):null },
    estructura:{ gastos:structureRows, total:structureTotal, coste_medio_camion:ratio(structureTotal,activeFleet.length), reparto:allocation, base_reparto:'Ingresos netos de servicios realizados por tractora (no facturas sin asignación de vehículo)' },
    economia
  };
}
async function loadAnalyticsSources(empresaId, range, ordersFrom = range.desde, queryDb = db.query) {
  if (!empresaId) throw Object.assign(new Error('Sin empresa_id'),{status:401});
  const optional = async (name, sql, params) => {
    // A missing relation must be detected before querying inside a read-only
    // report snapshot: catching 42P01 would otherwise abort its transaction.
    if (queryDb !== db.query && !(await queryDb('SELECT to_regclass($1) AS relation',[name])).rows[0]?.relation)
      return {rows:[],missingSource:name};
    try { return await queryDb(sql, params); }
    catch (error) {
      if (error.code === '42P01') return { rows: [], missingSource: name };
      throw error;
    }
  };
  const [orders,invoices,vehicles,drivers,workshop,emptyKm,structure,clients,fuel,driverExpenses,payroll,nights] = await Promise.all([
    queryDb(`WITH ${financialPedidosCte} SELECT * FROM pedidos_bi WHERE fecha_bi BETWEEN $2 AND $3`,[empresaId,ordersFrom,range.hasta]),
    queryDb(`SELECT f.*, c.nombre AS cliente_nombre FROM facturas f LEFT JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id WHERE f.empresa_id=$1 AND f.fecha <= $2`,[empresaId,range.hasta]),
    queryDb('SELECT * FROM vehiculos WHERE empresa_id=$1',[empresaId]),
    queryDb("SELECT id,empresa_id,nombre,to_jsonb(choferes)->>'apellidos' AS apellidos FROM choferes WHERE empresa_id=$1",[empresaId]),
    queryDb('SELECT data FROM taller_estado WHERE empresa_id=$1',[empresaId]),
    queryDb('SELECT * FROM vehiculo_km_vacio WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3',[empresaId,range.desde,range.hasta]),
    queryDb('SELECT * FROM gastos_estructura WHERE empresa_id=$1 AND activo=true',[empresaId]),
    queryDb('SELECT id,empresa_id,nombre FROM clientes WHERE empresa_id=$1',[empresaId]),
    optional('vehiculo_repostajes','SELECT * FROM vehiculo_repostajes WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3',[empresaId,range.desde,range.hasta]),
    optional('chofer_gastos','SELECT * FROM chofer_gastos WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3',[empresaId,range.desde,range.hasta]),
    optional('nominas_emitidas','SELECT * FROM nominas_emitidas WHERE empresa_id=$1 AND LEFT(periodo::text,7) BETWEEN $2 AND $3',[empresaId,range.desde.slice(0,7),range.hasta.slice(0,7)]),
    optional('vehiculo_noches','SELECT * FROM vehiculo_noches WHERE empresa_id=$1 AND fecha BETWEEN $2 AND $3',[empresaId,range.desde,range.hasta])
  ]);
  const missingSources=[fuel,driverExpenses,payroll,nights].map(r=>r.missingSource).filter(Boolean);
  return {empresaId,range,orders:orders.rows,invoices:invoices.rows,vehicles:vehicles.rows,drivers:drivers.rows,
    repairs:workshop.rows[0]?.data?.reparaciones || [],emptyKm:emptyKm.rows,structure:structure.rows,clients:clients.rows,
    fuel:fuel.rows,driverExpenses:driverExpenses.rows,payroll:payroll.rows,nights:nights.rows,missingSources};
}
async function readAnalytics(empresaId, query) {
  if (!empresaId) throw Object.assign(new Error('Sin empresa_id'),{status:401});
  const range = reportRange(query);
  const page = Number(query.page || 1), limit = Number(query.limit || 50);
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) {
    throw Object.assign(new Error('Paginación BI no válida'), { status: 400 });
  }
  return buildAnalytics({...(await loadAnalyticsSources(empresaId,range)),page,limit});
}
module.exports = { readAnalytics, loadAnalyticsSources, buildAnalytics, orderTotals, structureMonth };

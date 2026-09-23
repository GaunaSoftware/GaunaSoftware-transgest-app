// Economic BI v2. Each source is read independently; never join one-to-many
// invoices, stops, expenses and orders before summing money.
const { day, money, ratio, isValidInvoice, metric } = require('./financialKpis');
const value = v => v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
const sum = (rows, get) => money(rows.reduce((n, row) => n + (value(get(row)) || 0), 0));
const between = (date, range) => !!day(date) && day(date) >= range.desde && day(date) <= range.hasta;
const isDone = p => ['entregado', 'facturado'].includes(String(p.estado));
const serviceDate = p => p.fecha_bi || p.facturacion_mes || p.entregado_at || p.firma_fecha || p.fecha_descarga || p.fecha_carga || p.fecha_pedido || p.created_at;
const execution = p => p.colaborador_id || p.colaborador_nombre ? 'subcontratado' : 'flota_propia';
const aged = days => days <= 30 ? '0_30' : days <= 60 ? '31_60' : days <= 90 ? '61_90' : 'mas_90';
const daysSince = (from, to) => Math.max(0, Math.floor((Date.parse(day(to)) - Date.parse(day(from))) / 86400000));
const unique = rows => [...new Map(rows.map((r, i) => [r.id || `row:${i}`, r])).values()];
const hasRecordedCost = p => [p.precio_colaborador, p.coste_gasoil, p.coste_peajes, p.coste_dietas, p.coste_otros, p.extracostes_importe].some(v => value(v) != null && Number(v) !== 0) || value(p.coste_operativo) > 0;
const group = (rows, key) => {
  const map = new Map();
  for (const row of rows) { const id = key(row); if (!map.has(id)) map.set(id, []); map.get(id).push(row); }
  return [...map.entries()];
};
function physicalKm(orders, manualEmpty = []) {
  const legs = new Map(); let missing = 0, ambiguous = 0;
  for (const p of orders) {
    if (!(value(p.km_ruta) > 0)) { missing++; continue; }
    const shared = !!p.grupaje_id;
    const key = shared ? `g:${p.grupaje_id}:${p.vehiculo_id || 'sin_vehiculo'}` : `p:${p.id}`;
    const existing = legs.get(key);
    const loaded = Number(p.km_ruta), empty = Math.max(0, value(p.km_vacio) || 0);
    if (existing) {
      if (existing.loaded !== loaded || existing.empty !== empty) ambiguous++;
      existing.loaded = Math.max(existing.loaded, loaded);
      existing.empty = Math.max(existing.empty, empty);
    } else legs.set(key, { loaded, empty });
  }
  const loaded = sum([...legs.values()], r => r.loaded);
  const orderEmpty = sum([...legs.values()], r => r.empty);
  // App driver writes the same empty leg to both pedido.km_vacio and
  // vehiculo_km_vacio; its source marker makes the duplicate identifiable.
  const separate = manualEmpty.filter(r => !String(r.notas || '').startsWith('app_chofer:pedido:'));
  const manual = sum(separate, r => Math.max(0, value(r.km_vacio) || 0));
  return { cargados: loaded, vacios_pedido: orderEmpty, vacios_manuales: manual,
    vacios: money(orderEmpty + manual), total: money(loaded + orderEmpty + manual),
    cobertura: { evaluables: orders.length - missing, total: orders.length, grupajes_discrepantes: ambiguous,
      vacios_manuales_excluidos_por_duplicado: manualEmpty.length - separate.length } };
}
function costBreakdown(orders) {
  const direct = sum(orders, p => p.coste_operativo);
  const evaluated = orders.filter(hasRecordedCost).length;
  return { directo_registrado: evaluated ? direct : null, cobertura: { evaluables: evaluated, total: orders.length },
    pendientes_valorar: orders.length - evaluated,
    colaborador: sum(orders, p => p.precio_colaborador),
    gasoil_pedido: sum(orders, p => p.coste_gasoil), peajes: sum(orders, p => p.coste_peajes),
    dietas_pedido: sum(orders, p => p.coste_dietas), otros_y_extras: money(direct - sum(orders, p => p.precio_colaborador) - sum(orders, p => p.coste_gasoil) - sum(orders, p => p.coste_peajes) - sum(orders, p => p.coste_dietas)) };
}
function monthParts(range) {
  const parts = []; let cursor = new Date(`${range.desde}T12:00:00Z`);
  const end = new Date(`${range.hasta}T12:00:00Z`);
  while (cursor <= end) {
    const y = cursor.getUTCFullYear(), m = cursor.getUTCMonth();
    const monthEnd = new Date(Date.UTC(y, m + 1, 0, 12));
    const last = monthEnd < end ? monthEnd : end;
    const days = (last - cursor) / 86400000 + 1;
    parts.push({ month: `${y}-${String(m + 1).padStart(2, '0')}`, fraction: days / monthEnd.getUTCDate() });
    cursor = new Date(Date.UTC(y, m + 1, 1, 12));
  }
  return parts;
}
function structureInPeriod(rows, range) {
  const parts = monthParts(range);
  const total = sum(parts, part => rows.reduce((n, r) => {
    if (r.activo === false || !day(r.fecha) || day(r.fecha).slice(0, 7) > part.month) return n;
    const source = day(r.fecha).slice(0, 7);
    const elapsed = (Number(part.month.slice(0, 4)) - Number(source.slice(0, 4))) * 12 + Number(part.month.slice(5, 7)) - Number(source.slice(5, 7));
    const cycle = { mensual: 1, trimestral: 3, anual: 12 }[r.periodo];
    if (!cycle && elapsed !== 0) return n;
    if (value(r.importe) == null) return n;
    return n + Number(r.importe) / (cycle || 1) * part.fraction;
  }, 0));
  return { importe: rows.length ? total : null, criterio: 'Devengo lineal por mes y días del rango; mensual, trimestral / 3, anual / 12, único en el mes de origen',
    registros: rows.length, periodos: parts };
}
function dimension(rows, key, label, manualEmpty = []) {
  return group(rows, key).map(([id, orders]) => {
    const income = sum(orders, p => p.importe), cost = costBreakdown(orders);
    const km = physicalKm(orders, manualEmpty.filter(r => String(r.vehiculo_id) === String(id)));
    return { id, nombre: label(orders[0], id), servicios: orders.length, ingreso: income,
      coste_directo_registrado: cost.directo_registrado,
      margen_directo_registrado: cost.directo_registrado == null ? null : money(income - cost.directo_registrado),
      margen_pct: cost.directo_registrado == null ? null : ratio(income - cost.directo_registrado, income, 100),
      km_total: km.cobertura.evaluables === orders.length ? km.total : null,
      km_cargados: km.cobertura.evaluables === orders.length ? km.cargados : null,
      km_vacios: km.cobertura.evaluables === orders.length ? km.vacios : null,
      cobertura_costes: cost.cobertura };
  });
}
function buildEconomics({ empresaId, range, orders = [], invoices = [], clients = [], vehicles = [], repairs = [], emptyKm = [], structure = [], fuel = [], driverExpenses = [], payroll = [], nights = [], page = 1, limit = 50, missingSources = [] }) {
  const own = rows => rows.filter(r => String(r.empresa_id) === String(empresaId));
  clients = own(clients);
  vehicles = own(vehicles);
  const services = own(orders).filter(p => isDone(p) && between(serviceDate(p), range));
  const allInvoices = own(invoices).filter(f => isValidInvoice(f) && day(f.fecha) <= range.hasta);
  const issued = allInvoices.filter(f => between(f.fecha, range));
  const incomeKnown = services.filter(p => value(p.importe) != null);
  const income = incomeKnown.length ? sum(incomeKnown, p => p.importe) : null;
  const direct = costBreakdown(services);
  const directMargin = income == null || direct.directo_registrado == null ? null : money(income - direct.directo_registrado);
  const km = physicalKm(services, own(emptyKm).filter(r => between(r.fecha, range)));
  const kmComplete = services.length > 0 && km.cobertura.evaluables === services.length && !km.cobertura.grupajes_discrepantes && km.total > 0;
  const repairsPeriod = unique(repairs.filter(r => (!r.empresa_id || String(r.empresa_id) === String(empresaId)) && between(r.fecha, range)));
  const workshop = sum(repairsPeriod, r => r.coste_total);
  const salaryRows = unique(own(payroll).filter(r => r.periodo && monthParts(range).some(p => p.month === String(r.periodo).slice(0, 7))));
  const salary = sum(salaryRows, r => value(r.salario_base) != null && value(r.ss_empresa) != null ? Number(r.salario_base) + Number(r.ss_empresa) : 0);
  const salaryIncomplete = salaryRows.some(r => value(r.salario_base) == null || value(r.ss_empresa) == null);
  const structureValue = structureInPeriod(own(structure), range);
  // Unknown linkage with order-level 'otros' prevents silently adding workshop twice.
  const workshopOverlap = services.some(p => value(p.coste_otros) > 0) && repairsPeriod.length > 0;
  const includedWorkshop = workshopOverlap ? 0 : workshop;
  const result = directMargin == null ? null : money(directMargin - includedWorkshop - salary - (structureValue.importe || 0));
  const fuelRows = unique(own(fuel).filter(r => between(r.fecha, range)));
  const driverRows = unique(own(driverExpenses).filter(r => between(r.fecha, range)));
  const nightRows = unique(own(nights).filter(r => between(r.fecha, range)));
  const unpriced = [...fuelRows.filter(r => value(r.importe) == null && !(value(r.litros) > 0 && value(r.precio_litro) > 0)),
    ...driverRows.filter(r => r.estado !== 'registrado' || value(r.importe) == null), ...nightRows.filter(r => value(r.importe) == null)];
  const pending = services.filter(p => p.pendiente_factura === true);
  const pendingAmount = sum(pending, p => p.importe);
  const pendingAges = { '0_30': 0, '31_60': 0, '61_90': 0, mas_90: 0 };
  for (const p of pending) pendingAges[aged(daysSince(serviceDate(p), range.hasta))] += value(p.importe) || 0;
  Object.keys(pendingAges).forEach(k => { pendingAges[k] = money(pendingAges[k]); });
  const outstanding = allInvoices.filter(f => f.estado !== 'cobrada');
  const balance = sum(outstanding, f => f.total);
  const overdue = outstanding.filter(f => day(f.fecha_vencimiento) && day(f.fecha_vencimiento) < range.hasta);
  const overdueAges = group(overdue, f => String(f.cliente_id || 'sin_cliente')).map(([id, rows]) => {
    const bands = { '0_30': 0, '31_60': 0, '61_90': 0, mas_90: 0 };
    for (const f of rows) bands[aged(daysSince(f.fecha_vencimiento, range.hasta))] += value(f.total) || 0;
    Object.keys(bands).forEach(k => { bands[k] = money(bands[k]); });
    return { cliente_id: id, cliente: clients.find(c => String(c.id) === id)?.nombre || rows[0].cliente_nombre || id,
      total: sum(rows, f => f.total), tramos: bands };
  }).sort((a, b) => b.total - a.total);
  const byClient = dimension(services, p => String(p.cliente_id || 'sin_cliente'), (p, id) => clients.find(c => String(c.id) === id)?.nombre || id);
  const byRoute = dimension(services, p => `${p.origen || '?'} → ${p.destino || '?'}`, (p, id) => id);
  const byVehicle = dimension(services, p => p.vehiculo_id || 'sin_vehiculo', (p, id) => p.matricula || vehicles.find(v => String(v.id) === String(id))?.matricula || (id === 'sin_vehiculo' ? 'Sin vehículo' : String(id)), own(emptyKm).filter(r => between(r.fecha, range)));
  const byExecution = dimension(services, execution, (p, id) => id);
  const sorted = [...byClient].sort((a, b) => b.ingreso - a.ingreso);
  const subcontracted = services.filter(p => execution(p) === 'subcontratado');
  const subcontractCost = costBreakdown(subcontracted);
  const structureShares = structureValue.importe == null || !(income > 0) ? [] : byVehicle
    .filter(v => v.id !== 'sin_vehiculo' && v.ingreso > 0)
    .map(v => ({ vehiculo_id: v.id, ingreso_base: v.ingreso, importe: money(structureValue.importe * v.ingreso / income) }));
  const unallocatedStructure = structureValue.importe == null ? null : money(structureValue.importe - sum(structureShares, v => v.importe));
  const metrics = {
    ingreso_realizado: metric(income, 'Suma del precio neto de pedidos entregados/facturados por fecha económica', { total: services.length, known: incomeKnown.length }),
    coste_directo: metric(direct.directo_registrado, 'Costes directos registrados en pedido, sin tickets externos para evitar doble cómputo', { status: direct.directo_registrado == null ? 'sin_datos' : 'parcial', total: services.length, known: direct.cobertura.evaluables }),
    margen_directo: metric(directMargin, 'Ingreso realizado menos costes directos registrados; margen parcial', { status: directMargin == null ? 'sin_datos' : 'parcial', total: services.length, known: direct.cobertura.evaluables }),
    resultado_con_categorias: metric(result, 'Margen directo menos taller sin solape aparente, salario base y SS empresa registrados, y estructura estimada; faltan fuentes y conciliación', { status: result == null ? 'sin_datos' : 'parcial' }),
    ingreso_km_total: metric(kmComplete ? ratio(income, km.total) : null, 'Ingreso neto / km físicos cargados y vacíos', { unit: 'EUR/km total', total: services.length, known: km.cobertura.evaluables, denominator: km.total, status: kmComplete ? 'estimado' : 'sin_datos' }),
    coste_km_total: metric(kmComplete && direct.directo_registrado != null ? ratio(direct.directo_registrado, km.total) : null, 'Coste directo registrado / km físicos totales', { unit: 'EUR/km total', total: services.length, known: direct.cobertura.evaluables, denominator: km.total, status: kmComplete && direct.directo_registrado != null ? 'parcial' : 'sin_datos' }),
    margen_km_total: metric(kmComplete && directMargin != null ? ratio(directMargin, km.total) : null, 'Margen directo registrado / km físicos totales', { unit: 'EUR/km total', denominator: km.total, status: kmComplete && directMargin != null ? 'parcial' : 'sin_datos' }),
    km_vacios_pct: metric(kmComplete ? ratio(km.vacios, km.total, 100) : null, 'Km vacíos / km físicos totales', { unit: '%', denominator: km.total, total: services.length, known: km.cobertura.evaluables, status: kmComplete ? 'estimado' : 'sin_datos' }),
    facturacion_emitida: metric(sum(issued, f => f.base_imponible), 'Base neta de facturas válidas emitidas en el periodo, con abonos firmados', { status: 'completo', total: issued.length, known: issued.length }),
    pendiente_facturar: metric(pendingAmount, 'Servicios realizados sin factura válida vinculada al corte; no se conoce importe parcial ya facturado', { status: 'parcial', total: services.length, known: pending.length }),
    vencido_al_corte: metric(sum(overdue, f => f.total), 'Total bruto hoy no cobrado y con vencimiento anterior al corte', { status: 'estimado', taxes: 'con impuestos', total: outstanding.length, known: overdue.length }),
    margen_subcontratado: metric(subcontracted.length && subcontractCost.colaborador > 0 ? money(sum(subcontracted, p => p.importe) - subcontractCost.colaborador) : null,
      'Ingreso subcontratado menos precio registrado del colaborador; faltan otros costes', { status: 'parcial', total: subcontracted.length, known: subcontracted.filter(p => value(p.precio_colaborador) > 0).length }),
    concentracion_principal: metric(income > 0 ? ratio(sorted[0]?.ingreso || 0, income, 100) : null,
      'Ingreso del cliente principal / ingreso total de servicios realizados', { unit: '%', status: income > 0 ? 'completo' : 'sin_datos', denominator: income, total: services.length, known: incomeKnown.length }),
    gastos_pendientes_valorar: metric(direct.pendientes_valorar + unpriced.length,
      'Servicios sin coste directo registrado más gastos externos sin importe; conteo no monetario', { unit: 'registros', status: 'parcial', total: services.length + fuelRows.length + driverRows.length + nightRows.length,
        known: direct.cobertura.evaluables + fuelRows.length + driverRows.length + nightRows.length - unpriced.length }),
    cobros_efectivos: metric(null, 'Sin libro de pagos parciales, fechados y reversibles en TMS', { status: 'no_aplicable', taxes: 'con impuestos' }),
    saldo_al_corte: metric(balance, 'Facturas válidas emitidas hasta el corte y hoy no marcadas cobradas; no reconstruye saldo histórico', { status: 'estimado', taxes: 'con impuestos' }),
    presupuesto_desviacion: metric(null, 'Sin presupuesto original versionado y comparable', { status: 'no_aplicable' })
  };
  const paginate = rows => rows.slice((page - 1) * limit, page * limit);
  return { version: 'bi.economia.v2', periodo: range, fecha_corte: range.hasta, metricas: metrics,
    fuentes_no_disponibles: missingSources,
    paginacion: { page, limit, totales_antes_de_paginacion: true,
      registros: { clientes: byClient.length, rutas: byRoute.length, vehiculos: byVehicle.length, ejecucion: byExecution.length, vencido_clientes: overdueAges.length } },
    ingreso_servicios_realizados: income, costes_directos: direct, margen_directo: directMargin,
    margen_directo_pct: directMargin == null ? null : ratio(directMargin, income, 100),
    margen_directo_pct_sin_redondeo: directMargin == null || !(income > 0) ? null : directMargin / income * 100,
    resultado_categorias: { importe: result, incluidas: ['costes_directos_pedido', ...(!workshopOverlap && repairsPeriod.length ? ['taller_registrado'] : []),
      ...(salaryRows.length && !salaryIncomplete ? ['salario_base_y_ss_empresa_registrados'] : []), ...(structureValue.importe != null ? ['estructura_estimada'] : [])],
      importes: { taller: includedWorkshop, nomina_base_ss: salaryRows.length && !salaryIncomplete ? salary : null, estructura: structureValue.importe },
      pendientes_conciliar: ['repostajes', 'gastos_chofer', 'noches', ...(workshopOverlap ? ['taller_posible_solape_con_otros'] : []), ...(salaryIncomplete ? ['nominas_incompletas'] : [])],
      estructura_no_atribuida: unallocatedStructure, reparto_estructura: structureShares,
      criterio_estructura: `${structureValue.criterio}; por ingreso neto positivo de servicios con tractora histórica asignada` },
    kilometros: km, ingreso_km_total: metrics.ingreso_km_total.valor, coste_km_total: metrics.coste_km_total.valor,
    margen_km_total: metrics.margen_km_total.valor, porcentaje_vacio: metrics.km_vacios_pct.valor,
    por_cliente: paginate(byClient), por_ruta: paginate(byRoute), por_vehiculo: paginate(byVehicle), por_ejecucion: paginate(byExecution),
    subcontratacion: { servicios: subcontracted.length, ingreso: sum(subcontracted, p => p.importe),
      coste_colaborador: subcontractCost.colaborador, margen_registrado: subcontracted.length && subcontractCost.colaborador > 0 ? money(sum(subcontracted, p => p.importe) - subcontractCost.colaborador) : null },
    pendiente_facturar: { servicios: pending.length, importe: pendingAmount, antiguedad: pendingAges,
      limite: 'Enlace factura-pedido sin importe por pedido: facturación parcial no cuantificable' },
    facturacion_emitida_neta: sum(issued, f => f.base_imponible), facturacion_emitida_total: sum(issued, f => f.total),
    cobros_efectivos: null, saldo_estimado_al_corte: balance, vencido_estimado: sum(overdue, f => f.total),
    antiguedad_vencido_por_cliente: paginate(overdueAges),
    concentracion: { principal_cliente_pct: income > 0 ? ratio(sorted[0]?.ingreso || 0, income, 100) : null,
      top_5_pct: income > 0 ? ratio(sum(sorted.slice(0, 5), c => c.ingreso), income, 100) : null },
    cobertura: { servicios: services.length, ingresos: incomeKnown.length, costes: direct.cobertura.evaluables,
      km: km.cobertura.evaluables, gastos_pendientes_valorar: direct.pendientes_valorar + unpriced.length,
      fuentes_sin_conciliar: { repostajes: fuelRows.length, gastos_chofer: driverRows.length, noches: nightRows.length,
        nominas: salaryRows.length, taller: repairsPeriod.length } } };
}
module.exports = { buildEconomics, physicalKm, costBreakdown, structureInPeriod };

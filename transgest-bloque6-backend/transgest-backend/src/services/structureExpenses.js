const db = require('./db');
const { money, day, financialPedidosCte } = require('./financialKpis');

function expenseMonth(value) {
  const month = String(value || '').slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw Object.assign(new Error('Indica un mes válido (AAAA-MM).'), {status: 400});
  return month;
}
function structureMonth(gastos, month) {
  const [y, m] = expenseMonth(month).split('-').map(Number);
  const target = y * 12 + m;
  return gastos.filter(g => g.activo !== false).map(g => {
    const [gy, gm] = day(g.fecha).split('-').map(Number);
    const elapsed = target - (gy * 12 + gm);
    const frequency = {mensual: 1, trimestral: 3, anual: 12}[g.periodo];
    return elapsed >= 0 && (frequency || elapsed === 0)
      ? {...g, importe_periodo: money(Number(g.importe) / (frequency || 1))} : null;
  }).filter(Boolean);
}
function isTractor(v, vehicles) {
  return !/remolque|dolly|lowboy/i.test(v.clase || v.tipo || '') && !/^R-|-R$/i.test(v.matricula || '') && !vehicles.some(t => t.remolque_id === v.id);
}
// Allocate cents cumulatively; the last truck gets the rounding remainder.
function shares(total, weights) {
  const denominator = weights.reduce((sum, n) => sum + n, 0);
  let cumulative = 0, previous = 0;
  return weights.map(weight => {
    if (total == null || denominator <= 0) return null;
    cumulative += weight;
    const next = Math.round(total * 100 * cumulative / denominator);
    const result = (next - previous) / 100; previous = next; return result;
  });
}
function buildStructure({empresaId, month, structure = [], vehicles = []}) {
  const own = rows => rows.filter(row => String(row.empresa_id) === String(empresaId));
  const rows = structureMonth(own(structure), month);
  const total = rows.length ? money(rows.reduce((sum, row) => sum + row.importe_periodo, 0)) : null;
  const ownVehicles = own(vehicles);
  const fleet = ownVehicles.filter(v => isTractor(v, ownVehicles) && v.activo !== false && !['baja','inactivo'].includes(v.estado));
  const incomes = fleet.map(v => Math.max(0, Number(v.ingresos || 0)));
  const income = incomes.reduce((sum, n) => sum + n, 0);
  const equal = shares(total, fleet.map(() => 1)), weighted = shares(total, incomes);
  return {gastos: rows, total, coste_medio_camion: total == null || !fleet.length ? null : money(total / fleet.length),
    reparto: fleet.map((v, i) => ({v, peso_igual: 1 / fleet.length, peso_ingresos: income > 0 ? incomes[i] / income : null,
      coste_igual: equal[i], coste_ingresos: weighted[i]})),
    no_atribuido_igual: fleet.length ? 0 : total, no_atribuido_ingresos: income > 0 ? 0 : total,
    base_reparto: 'Ingresos netos positivos de servicios realizados por tractora; reparto orientativo, no genera gastos duplicados',
  };
}
function shiftedMonth(month, offset) {
  const [year, m] = expenseMonth(month).split('-').map(Number);
  const date = new Date(Date.UTC(year, m - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}
function variation(current, previous) {
  const difference = current == null || previous == null ? null : money(current - previous);
  return {diferencia: difference, porcentaje: difference == null || previous === 0 ? null : difference / Math.abs(previous) * 100,
    estado: difference == null ? 'sin_datos' : previous === 0 ? 'sin_base' : 'calculable'};
}
// Compare the same monthly allocation on one authorized source, without attachments
// or current fleet counts masquerading as historical fleet data.
function compareStructure({empresaId, month, structure = []}) {
  const own = structure.filter(row => String(row.empresa_id) === String(empresaId));
  const periods = [month, shiftedMonth(month, -1), shiftedMonth(month, -12)].map(periodo => {
    const rows = structureMonth(own, periodo);
    const categorias = new Map();
    for (const row of rows) {
      const category = row.tipo || 'Sin categoría';
      categorias.set(category, money((categorias.get(category) || 0) + row.importe_periodo));
    }
    const [year, m] = periodo.split('-').map(Number);
    return {periodo, desde: periodo + '-01', hasta: new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10),
      total: rows.length ? money(rows.reduce((sum, row) => sum + row.importe_periodo, 0)) : null,
      registros: rows.length, prorrateados: rows.filter(row => ['anual','trimestral'].includes(row.periodo)).length,
      estado: rows.length ? 'parcial' : 'sin_datos', categorias};
  });
  const categorias = [...new Set(periods.flatMap(p => [...p.categorias.keys()]))].sort((a,b) => a.localeCompare(b, 'es')).map(tipo => {
    const values = periods.map(p => p.registros ? p.categorias.get(tipo) || 0 : null);
    return {tipo, actual: values[0], anterior: values[1], ano_anterior: values[2],
      variacion_anterior: variation(values[0], values[1]), variacion_anual: variation(values[0], values[2])};
  });
  return {version: 'estructura.mensual.v1', periodos: periods.map(({categorias, ...p}) => p), categorias,
    variacion_anterior: variation(periods[0].total, periods[1].total), variacion_anual: variation(periods[0].total, periods[2].total),
    definicion: 'Suma de gastos activos imputados al mes: mensual íntegro, puntual solo en su mes, trimestral / 3 y anual / 12 desde el mes de inicio.',
    unidad: 'EUR', impuestos: 'Importes tal como se registraron; esta fuente no desglosa IVA ni permite normalizar una base neta.',
    cobertura: 'Gastos de estructura registrados, no todos los costes de explotación. La ausencia de registros no confirma coste cero.',
    alcance: 'Meses naturales completos. El mes en curso puede estar incompleto. El histórico se reconstruye con las fichas vigentes; no es una instantánea contable de cada cierre.',
    generado_at: new Date().toISOString()};
}
async function readStructure(empresaId, value) {
  const month = expenseMonth(value);
  const [year, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(year, m, 0)).toISOString().slice(0, 10);
  const [structure, vehicles] = await Promise.all([
    db.query('SELECT * FROM gastos_estructura WHERE empresa_id=$1 AND activo=true ORDER BY fecha DESC,nombre', [empresaId]),
    db.query(`WITH ${financialPedidosCte}, ingresos AS (
      SELECT vehiculo_id, SUM(importe) AS ingresos FROM pedidos_bi
      WHERE fecha_bi BETWEEN $2 AND $3 AND estado::text IN ('entregado','facturado') GROUP BY vehiculo_id
    ) SELECT v.*, COALESCE(i.ingresos,0) AS ingresos FROM vehiculos v
      LEFT JOIN ingresos i ON i.vehiculo_id=v.id WHERE v.empresa_id=$1 ORDER BY v.matricula,v.id`, [empresaId, month+'-01',last]),
  ]);
  const result = buildStructure({empresaId, month, structure: structure.rows, vehicles: vehicles.rows});
  return {...result, comparativa: compareStructure({empresaId, month, structure: structure.rows}),
    periodo: month, fecha_corte: last, estado: result.gastos.length ? 'estimado' : 'sin_datos'};
}
module.exports = {expenseMonth, structureMonth, buildStructure, readStructure, compareStructure};

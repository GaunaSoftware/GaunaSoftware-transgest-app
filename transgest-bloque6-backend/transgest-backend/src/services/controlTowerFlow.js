const { withTransportProgress } = require('./transportProgress');

const FLOW_STATES = Object.freeze([
  ['pendiente', 'Pendiente'], ['confirmado', 'Confirmado'], ['espera_carga', 'En espera de carga'],
  ['cargando', 'Cargando'], ['cargado', 'Cargado'], ['en_transito', 'En tránsito'],
  ['en_curso', 'En curso · sin desglose'], ['espera_descarga', 'En espera de descarga'],
  ['descarga', 'Descargando'], ['entregado', 'Entregado'], ['incidencia', 'Incidencia'],
]);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };

// Same operational horizon as the legacy tower, explicit and anchored in Madrid.
// This is a current work queue, not the financial reporting period.
async function readFlowPopulation(db, empresaId) {
  if (!empresaId) fail('Sin empresa', 401);
  const { rows } = await db.query(`SELECT p.id, p.empresa_id, p.estado::text AS estado,
      p.origen, p.destino, p.puntos_carga, p.puntos_descarga
    FROM pedidos p WHERE p.empresa_id=$1 AND p.factura_id IS NULL
      AND p.estado::text NOT IN ('cancelado','facturado')
      AND COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date)
        BETWEEN (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date - 2
            AND (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Madrid')::date + 10
    ORDER BY COALESCE(p.fecha_carga::date,p.fecha_pedido,p.created_at::date), p.numero, p.id`, [empresaId]);
  return withTransportProgress(db, empresaId, rows);
}

function summarizeFlow(rows) {
  const count = new Map();
  const legacy = new Map();
  for (const row of rows) {
    const key = row.estado_operativo.codigo;
    count.set(key, (count.get(key) || 0) + 1);
    legacy.set(row.estado, (legacy.get(row.estado) || 0) + 1);
  }
  const definitions = new Map(FLOW_STATES);
  // Preserve any future/legacy state rather than silently omitting its orders.
  for (const key of count.keys()) if (!definitions.has(key)) definitions.set(key, key);
  return {
    estados: [...definitions].map(([key, label]) => ({ key, label, total: count.get(key) || 0 })),
    legacy: [...legacy].map(([estado, total]) => ({ estado, total })),
    alcance: { total: rows.length, zona_horaria: 'Europe/Madrid', desde_dias: -2, hasta_dias: 10,
      definicion: 'Cola operativa: desde hace 2 días hasta dentro de 10 días, sin facturar ni cancelados.',
      sin_desglose: rows.filter(row => row.estado_operativo.cobertura === 'sin_desglose').length },
  };
}

async function readFlowPage(db, empresaId, { estado, page = 1, pageSize = 40 } = {}) {
  if (!FLOW_STATES.some(([key]) => key === estado)) fail('Estado operativo no válido');
  const number = Number(page), size = Number(pageSize);
  if (!Number.isSafeInteger(number) || number < 1 || !Number.isInteger(size) || size < 1 || size > 100) fail('Paginación no válida');
  const population = await readFlowPopulation(db, empresaId);
  const selected = population.filter(row => row.estado_operativo.codigo === estado);
  const slice = selected.slice((number - 1) * size, number * size);
  let rows = [];
  if (slice.length) ({ rows } = await db.query(`SELECT p.id, p.numero, p.estado::text AS estado,
      p.origen, p.destino, p.puntos_carga, p.puntos_descarga, p.fecha_carga, p.fecha_descarga,
      c.nombre AS cliente_nombre, v.matricula AS vehiculo_matricula, col.nombre AS colaborador_nombre
    FROM pedidos p
    LEFT JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
    LEFT JOIN vehiculos v ON v.id=p.vehiculo_id AND v.empresa_id=p.empresa_id
    LEFT JOIN colaboradores col ON col.id=p.colaborador_id AND col.empresa_id=p.empresa_id
    WHERE p.empresa_id=$1 AND p.id=ANY($2::uuid[])`, [empresaId, slice.map(row => row.id)]));
  const details = new Map(rows.map(row => [row.id, row]));
  return { estado, page: number, page_size: size, total: selected.length,
    items: slice.filter(row => details.has(row.id)).map(row => ({ ...details.get(row.id), estado_operativo: row.estado_operativo })),
    alcance: summarizeFlow(population).alcance };
}

module.exports = { FLOW_STATES, readFlowPopulation, summarizeFlow, readFlowPage };

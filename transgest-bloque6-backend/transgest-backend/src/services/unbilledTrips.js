const { pedidoDateFilter } = require('./pedidoDateFilter');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function unbilledOptions(query = {}, clienteId) {
  const options = {};
  for (const key of ['desde', 'hasta']) {
    const value = query[key];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) !== value) {
      throw new Error(`${key} debe ser una fecha valida YYYY-MM-DD`);
    }
    options[key] = value;
  }
  if (options.desde && options.hasta && options.desde > options.hasta) throw new Error('El rango de fechas esta invertido');
  for (const [key, fallback, max] of [['page', 1, 1000000], ['limit', 50, 200]]) {
    const value = query[key] === undefined ? String(fallback) : query[key];
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || Number(value) > max) throw new Error(`${key} fuera de rango`);
    options[key] = Number(value);
  }
  if (clienteId !== undefined) {
    if (typeof clienteId !== 'string' || !UUID.test(clienteId)) throw new Error('Cliente invalido');
    options.cliente_id = clienteId;
  }
  return options;
}

function pendingQuery(empresaId, options) {
  const params = [empresaId];
  const where = ["p.empresa_id=$1", "p.estado='entregado'", "COALESCE(to_jsonb(p)->>'origen_producto','transgest')<>'planner'",
    `(p.factura_id IS NULL OR (f.estado='borrador' AND f.cliente_id=p.cliente_id))`,
    // A stale reverse link must not allow billing a trip a second time.
    `NOT EXISTS (
      SELECT 1 FROM factura_pedidos fp LEFT JOIN facturas linked ON linked.id=fp.factura_id
      WHERE fp.pedido_id=p.id AND (linked.id IS NULL
        OR linked.empresa_id IS DISTINCT FROM p.empresa_id
        OR linked.cliente_id IS DISTINCT FROM p.cliente_id
        OR linked.estado IS DISTINCT FROM 'borrador')
    )`];
  const dateFilter = pedidoDateFilter(options, params);
  if (dateFilter) where.push(dateFilter);
  if (options.cliente_id) {
    params.push(options.cliente_id);
    where.push(`p.cliente_id=$${params.length}`);
  }
  return { params, sql: `WITH pending AS (
    SELECT p.id,p.numero,p.cliente_id,c.nombre AS cliente_nombre,p.origen,p.destino,
      p.fecha_carga,p.fecha_descarga,p.fecha_entrega,p.referencia_cliente,
      p.importe AS importe_registrado,p.factura_id AS borrador_id,
      COALESCE(p.fecha_carga,p.fecha_descarga,p.fecha_entrega) AS fecha_periodo,
      CASE WHEN p.importe IS NULL THEN 'ausente'
        WHEN p.importe::text IN ('NaN','Infinity','-Infinity') THEN 'no_finito'
        WHEN p.importe=0 THEN 'cero' WHEN p.importe<0 THEN 'negativo' ELSE 'positivo' END AS estado_importe
    FROM pedidos p JOIN clientes c ON c.id=p.cliente_id AND c.empresa_id=p.empresa_id
    LEFT JOIN facturas f ON f.id=p.factura_id AND f.empresa_id=p.empresa_id
    WHERE ${where.join(' AND ')}
  )` };
}

const COUNTS = `COUNT(*)::int AS viajes,
  COALESCE(SUM(importe_registrado) FILTER (WHERE estado_importe NOT IN ('ausente','no_finito')),0) AS importe_registrado,
  COUNT(*) FILTER (WHERE estado_importe='ausente')::int AS importe_ausente,
  COUNT(*) FILTER (WHERE estado_importe='cero')::int AS importe_cero,
  COUNT(*) FILTER (WHERE estado_importe='negativo')::int AS importe_negativo,
  COUNT(*) FILTER (WHERE estado_importe='no_finito')::int AS importe_no_finito`;

async function readUnbilledTrips(client, empresaId, options) {
  let customer;
  if (options.cliente_id) {
    const { rows } = await client.query('SELECT id,nombre FROM clientes WHERE id=$1 AND empresa_id=$2', [options.cliente_id, empresaId]);
    if (!rows[0]) return null;
    customer = rows[0];
  }
  const { sql, params } = pendingQuery(empresaId, options);
  const { rows: totals } = await client.query(`${sql} SELECT ${COUNTS},COUNT(DISTINCT cliente_id)::int AS clientes FROM pending`, params);
  const total = customer ? totals[0].viajes : totals[0].clientes;
  const pageParams = [...params, options.limit, (options.page - 1) * options.limit];
  const pagination = `LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const { rows } = await client.query(customer
    ? `${sql} SELECT id,numero,cliente_id,origen,destino,fecha_carga,fecha_descarga,fecha_entrega,
        referencia_cliente,importe_registrado,estado_importe,borrador_id,fecha_periodo
       FROM pending ORDER BY fecha_periodo ASC NULLS LAST,id ${pagination}`
    : `${sql} SELECT cliente_id,cliente_nombre,${COUNTS},MIN(fecha_periodo) AS fecha_mas_antigua,
        MAX(fecha_periodo) AS fecha_mas_reciente FROM pending GROUP BY cliente_id,cliente_nombre
       ORDER BY cliente_nombre,cliente_id ${pagination}`, pageParams);
  return { data: rows, resumen: totals[0], ...(customer ? { cliente: customer } : {}),
    page: options.page, limit: options.limit, total, total_pages: Math.ceil(total / options.limit),
    criterio_fecha: 'carga_descarga_entrega', importe_fuente: 'registrado_sin_recalculo' };
}

module.exports = { unbilledOptions, readUnbilledTrips };

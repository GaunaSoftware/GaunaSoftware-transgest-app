function pedidoDateFilter(query, params) {
  const clauses = [];
  for (const [field, operator] of [['desde', '>='], ['hasta', '<=']]) {
    if (!query[field]) continue;
    params.push(query[field]);
    clauses.push(`COALESCE(p.fecha_carga, p.fecha_descarga, p.fecha_entrega) ${operator} $${params.length}::date`);
  }
  if (!clauses.length) return '';
  const range = `(${clauses.join(' AND ')})`;
  // Esta excepcion afecta solo al periodo, nunca a empresa, cliente o permisos.
  return query.incluir_incidencias === 'true'
    ? `(${range} OR p.estado::text = 'incidencia')`
    : range;
}

module.exports = { pedidoDateFilter };

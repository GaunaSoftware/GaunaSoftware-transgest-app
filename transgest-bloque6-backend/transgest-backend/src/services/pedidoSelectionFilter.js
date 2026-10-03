const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

// A dashboard snapshot limits the selection; it never replaces tenant/role filters.
function pedidoSelectionFilter(query, params) {
  if (query.pedido_ids === undefined) return '';
  let ids;
  try { ids = JSON.parse(query.pedido_ids); } catch { ids = null; }
  if (!Array.isArray(ids) || ids.length > 1000 || ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw Object.assign(new Error('Selección de pedidos no válida.'), { status: 400 });
  }
  params.push([...new Set(ids)]);
  return `p.id = ANY($${params.length}::uuid[])`;
}

module.exports = { pedidoSelectionFilter };

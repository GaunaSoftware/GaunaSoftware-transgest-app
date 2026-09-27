// Additive list metadata, with no financial aggregation and no extra order details.
async function withJourneyProjection(db, empresaId, orders) {
  if (!orders.length) return orders;
  let links;
  try {
    links = (await db.query(`SELECT vp.pedido_id,v.id,v.legacy_grupaje_id,v.version,v.estado,
      (SELECT COUNT(*)::int FROM viaje_pedidos x WHERE x.empresa_id=v.empresa_id AND x.viaje_id=v.id AND x.activo) AS pedidos_count,
      (SELECT planificacion->>'fecha' FROM viaje_paradas s WHERE s.empresa_id=v.empresa_id AND s.viaje_id=v.id ORDER BY orden LIMIT 1) AS fecha_inicio
      FROM viaje_pedidos vp JOIN viajes_operativos v ON v.empresa_id=vp.empresa_id AND v.id=vp.viaje_id
      WHERE vp.empresa_id=$1 AND vp.pedido_id=ANY($2::uuid[]) AND vp.activo AND v.estado<>'cancelado' AND v.legacy_grupaje_id IS NOT NULL`, [empresaId, orders.map(p => p.id)])).rows;
  } catch (error) {
    if (!['42P01', '42703'].includes(error.code)) throw error;
    return orders; // compatible reading before the additive migration
  }
  const byOrder = new Map(links.map(row => [row.pedido_id, row]));
  return orders.map(order => {
    const trip = byOrder.get(order.id);
    return trip ? { ...order, viaje_operativo: { id: trip.id, grupaje_id: trip.legacy_grupaje_id, version: trip.version, estado: trip.estado, pedidos_count: trip.pedidos_count, fecha_inicio: trip.fecha_inicio }, es_hijo_viaje: true } : order;
  });
}
module.exports = { withJourneyProjection };

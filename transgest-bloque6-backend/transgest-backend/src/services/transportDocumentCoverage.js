function documentCoverage(versions = [], shipments = []) {
  const active = versions.filter(version => version.estado === 'activa');
  const covers = id => active.some(version => String(version.envio_id || '') === String(id) ||
    version.payload?.envio_ids?.some(value => String(value) === String(id)));
  const missingIds = shipments.filter(shipment => !covers(shipment.id)).map(shipment => String(shipment.id));
  return {active, current:active[0] || null, missingIds, ready:active.length > 0 && missingIds.length === 0};
}

// Close only fulfilled requests. The notification and immutable originals stay
// in their respective histories. Also repairs old unread notices at inbox read.
async function resolveDecaNotifications(db, empresaId, {pedidoId = null, usuarioId = null} = {}) {
  const schema = (await db.query(`SELECT to_regclass('public.notificaciones_internas') AS notices,
    to_regclass('public.transport_document_versions') AS versions,
    to_regclass('public.pedidos_envios') AS shipments`)).rows[0];
  if (!schema?.notices || !schema?.versions || !schema?.shipments) return [];
  const {rows} = await db.query(`
    WITH current_versions AS (
      SELECT DISTINCT ON (d.pedido_id,d.scope_key) d.pedido_id,d.envio_id,d.payload
        FROM transport_document_versions d
       WHERE d.empresa_id=$1 AND ($2::uuid IS NULL OR d.pedido_id=$2)
         AND EXISTS (
           SELECT 1 FROM notificaciones_internas n
            WHERE n.empresa_id=$1 AND n.tipo='deca_solicitado' AND n.leida=false
              AND n.data->>'pedido_id'=d.pedido_id::text
              AND ($3::uuid IS NULL OR n.usuario_id=$3)
         )
       ORDER BY d.pedido_id,d.scope_key,d.version DESC,d.created_at DESC
    ), ready_orders AS (
      SELECT DISTINCT v.pedido_id FROM current_versions v
       WHERE NOT EXISTS (
         SELECT 1 FROM pedidos_envios s
          WHERE s.empresa_id=$1 AND s.pedido_id=v.pedido_id
            AND NOT EXISTS (
              SELECT 1 FROM current_versions c WHERE c.pedido_id=s.pedido_id
                AND (c.envio_id=s.id OR COALESCE(c.payload->'envio_ids','[]'::jsonb) ? s.id::text)
            )
       )
    )
    UPDATE notificaciones_internas n
       SET leida=true, read_at=COALESCE(n.read_at,NOW()),
           data=n.data || jsonb_build_object('resuelta',true,'resolucion','deca_vigente','resuelta_at',NOW())
      FROM ready_orders r
     WHERE n.empresa_id=$1 AND n.tipo='deca_solicitado' AND n.leida=false
       AND n.data->>'pedido_id'=r.pedido_id::text
       AND ($3::uuid IS NULL OR n.usuario_id=$3)
    RETURNING n.id`, [empresaId,pedidoId,usuarioId]);
  return rows;
}

module.exports = {documentCoverage, resolveDecaNotifications};

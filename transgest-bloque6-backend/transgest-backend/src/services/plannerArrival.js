// Callers verify ownership before requesting arrival information. No other cargo is disclosed.
async function arrivals(db, company, order) {
  return (await db.query(`SELECT r.id,r.inicio,m.nombre AS muelle,m.almacen,m.zona_horaria,s.media_min,s.muestras
    FROM planner_reservas r JOIN planner_muelles m ON m.id=r.muelle_id AND m.empresa_id=r.empresa_id
    LEFT JOIN LATERAL (SELECT ROUND(AVG(EXTRACT(EPOCH FROM(pp.carga_fin_at-pp.carga_inicio_at))/60))::int AS media_min,COUNT(*)::int AS muestras
      FROM planner_preparaciones pp WHERE pp.empresa_id=m.empresa_id AND pp.muelle_carga_id=m.id
      AND pp.estado<>'cancelada' AND pp.carga_fin_at>pp.carga_inicio_at) s ON true
    WHERE r.empresa_id=$1 AND r.pedido_id=$2 AND r.tipo='carga' ORDER BY r.inicio`, [company,order])).rows;
}
module.exports={arrivals};

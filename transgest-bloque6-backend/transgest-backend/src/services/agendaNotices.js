const { can } = require('./noticeCenter');
const { day } = require('./financialKpis');
async function readOperationalNotices(db, user) {
  if (!user?.empresa_id || !can(user,'avisos') || !can(user,'pedidos') || !['gerente','trafico','administrativo','contable','responsable_taller','mecanico'].includes(user.rol)) return [];
  const {rows} = await db.query(`SELECT e.id,e.titulo,e.descripcion,e.fecha_inicio,e.explanation,e.recommended_action,p.id AS pedido_id,p.numero
    FROM agenda_eventos e JOIN pedidos p ON p.id=e.pedido_id AND p.empresa_id=e.empresa_id
    WHERE e.empresa_id=$1 AND (e.source_type='pedido' OR e.metadata->>'source'='avisos_operativos_colaborador')
    AND e.resolved_at IS NULL AND e.estado IN ('pendiente','en_progreso')
    AND (e.visibilidad='equipo' OR e.creado_por=$2 OR e.asignado_a=$2)
    ORDER BY e.fecha_inicio,e.id`, [user.empresa_id,user.id]);
  return rows.map(r => ({id:`operativa:${r.id}`,category:'operativa',title:r.titulo,description:[r.explanation || r.descripcion,r.recommended_action].filter(Boolean).join(' '),entity:r.numero,date:day(r.fecha_inicio),severity:'pendiente',days:null,view:'pedidos',focusKey:'tms_pedidos_focus',focus:{pedido_id:r.pedido_id,numero:r.numero,open:true}}));
}
module.exports = { readOperationalNotices };

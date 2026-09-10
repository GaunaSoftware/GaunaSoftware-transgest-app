async function confirmWorkshopAssignment(tx, empresaId, body, previous = {}) {
  const ids = [...new Set(['vehiculo_id','remolque_id'].filter(k => body[k] && body[k] !== previous[k]).map(k => body[k]))].sort();
  if (!ids.length || body.colaborador_id) return [];
  const { rows } = await tx.query(`SELECT id,matricula,estado FROM vehiculos WHERE empresa_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE`, [empresaId,ids]);
  const workshop = rows.filter(v => ['taller','en_taller','averia'].includes(v.estado));
  const accepted = Array.isArray(body.salida_taller_confirmada) ? body.salida_taller_confirmada : [];
  if (workshop.some(v => !accepted.includes(v.id))) {
    throw Object.assign(new Error('El vehiculo esta en taller. Confirma su salida antes de asignar el viaje.'), {
      status:409, code:'VEHICULO_EN_TALLER', requiere_confirmacion:true,
      vehiculos:workshop.map(({id,matricula}) => ({id,matricula})),
    });
  }
  if (workshop.length) await tx.query(`UPDATE vehiculos SET estado='disponible' WHERE empresa_id=$1 AND id=ANY($2::uuid[])`, [empresaId,workshop.map(v=>v.id)]);
  return workshop;
}
module.exports = { confirmWorkshopAssignment };

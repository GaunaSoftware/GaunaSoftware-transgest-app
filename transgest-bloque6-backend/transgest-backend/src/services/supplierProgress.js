const { stateFromProgress, assertTransportTransition } = require('./transportTransitions');

// Called only after portal authentication. Recheck assignment under lock so a
// token read before traffic reassigns the trip cannot alter its new assignment.
async function saveSupplierProgress(db, { pedidoId, empresaId, colaboradorId, patch }) {
  return db.transaction(async client => {
    const pedido = (await client.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [pedidoId,empresaId])).rows[0];
    if (!pedido || !colaboradorId || pedido.colaborador_id !== colaboradorId) throw Object.assign(new Error('Viaje no disponible para este colaborador'), {status:403});
    const current = (await client.query('SELECT data FROM pedido_chofer_pasos WHERE pedido_id=$1 AND empresa_id=$2', [pedidoId,empresaId])).rows[0]?.data || {};
    const data = { ...current };
    const required = { carga_proceso:['carga_iniciada'], carga_ok:['carga_proceso'],
      viaje_iniciado:['carga_ok','albaran_carga'], posicionado_descarga:['viaje_iniciado'],
      descarga_iniciada:['posicionado_descarga'], descarga_ok:['descarga_iniciada'] };
    for (const [key, prerequisites] of Object.entries(required)) {
      if (patch[key] === true && current[key] !== true && prerequisites.some(field => current[field] !== true)) {
        throw Object.assign(new Error('Completa primero el paso operativo anterior.'), {status:409,code:'SUPPLIER_STEP_SEQUENCE'});
      }
    }
    if(patch.viaje_iniciado===true&&current.viaje_iniciado!==true) await require('./transportDocumentVersions').assertDeparture(client,empresaId,pedido,{...current,...patch});
    const now = new Date().toISOString();
    let changed = false;
    for (const [key,value] of Object.entries(patch)) {
      if (key.endsWith('_at')) continue;
      if (current[key] === true && value === false) throw Object.assign(new Error('No se puede deshacer una confirmación registrada'), {status:409});
      if (JSON.stringify(value) === JSON.stringify(current[key])) continue;
      data[key] = value;
      if (value === true) data[`${key}_at`] = now;
      changed = true;
    }
    if (!changed) return { data:current, estado:pedido.estado, sin_cambios:true };
    const estado = stateFromProgress(data, { deliveryComplete: data.descarga_ok === true && data.albaran_descarga === true }) || pedido.estado;
    assertTransportTransition(pedido.estado, estado, {actor:'colaborador'});
    if (['facturado','entregado','cancelado'].includes(pedido.estado)) throw Object.assign(new Error('El viaje ya está cerrado'), {status:409});
    data.updated_at = now;
    await client.query(`INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,chofer_id,data,updated_at)
      VALUES($1,$2,NULL,$3,NOW()) ON CONFLICT(pedido_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[pedidoId,empresaId,JSON.stringify(data)]);
    await client.query(`UPDATE pedidos SET estado=$3,updated_at=NOW(),
      carga_real_at=CASE WHEN $4::boolean THEN COALESCE(carga_real_at,NOW()) ELSE carga_real_at END,
      descarga_real_at=CASE WHEN $5::boolean THEN COALESCE(descarga_real_at,NOW()) ELSE descarga_real_at END
      WHERE id=$1 AND empresa_id=$2`,[pedidoId,empresaId,estado,patch.carga_ok===true,patch.descarga_ok===true]);
    await client.query(`INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,detalle)
      VALUES($1,$2,'colaborador_portal.operativa_actualizada','colaborador_portal',$3)`,
      [pedidoId,empresaId,JSON.stringify({colaborador_id:colaboradorId,estado_anterior:pedido.estado,estado,pasos:data})]);
    if (estado === 'entregado') await client.query('UPDATE colaborador_liquidacion_tokens SET expires_at=NOW() WHERE pedido_id=$1 AND empresa_id=$2 AND expires_at>NOW()', [pedidoId,empresaId]);
    return { data, estado, sin_cambios:false };
  });
}
module.exports = { saveSupplierProgress };

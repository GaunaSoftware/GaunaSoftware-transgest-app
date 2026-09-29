const crypto = require('node:crypto');
const { validateTrafficAssignment } = require('./trafficAssignment');
const { saveGroupagePlan } = require('./groupagePlan');
const { legacyOperationalModel } = require('./operationalModel');
const day = value => value instanceof Date ? value.toISOString().slice(0,10) : String(value||'').slice(0,10);
const fail = (message, code, status = 409) => { throw Object.assign(new Error(message), { status, code }); };

// Caller owns the transaction. Commercial amounts and customer documents are not writable here.
async function assignGroupage(tx, { empresaId, groupId, actorId, operationId, patch, authorize, confirm = false, saveOperationId, requireConjunto = false }) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(operationId || ''))) fail('Falta identificador de operación.', 'OPERATION_ID', 400);
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${empresaId}:groupage-write`]);
  const orders = (await tx.query('SELECT * FROM pedidos WHERE empresa_id=$1 AND grupaje_id=$2::uuid ORDER BY id FOR UPDATE', [empresaId, groupId])).rows;
  if (!orders.length) fail('Grupaje no encontrado.', 'GROUPAGE_NOT_FOUND', 404);
  for (const order of orders) authorize?.(order);
  const hash = crypto.createHash('sha256').update(JSON.stringify({ groupId, patch })).digest('hex');
  const receipt = (await tx.query('SELECT request_hash,resultado FROM viaje_operaciones WHERE empresa_id=$1 AND client_operation_uuid=$2', [empresaId, operationId])).rows[0];
  if (receipt) {
    if (receipt.request_hash !== hash) fail('La operación ya se usó con otros datos.', 'OPERATION_CONFLICT');
    return { ...receipt.resultado, replayed: true };
  }
  const trip = (await tx.query('SELECT * FROM viajes_operativos WHERE empresa_id=$1 AND legacy_grupaje_id=$2 FOR UPDATE', [empresaId, groupId])).rows[0];
  if (trip && !['borrador', 'pendiente', 'confirmado'].includes(trip.estado)) fail('El viaje ya ha comenzado.', 'ASSIGNMENT_STARTED');
  const steps = (await tx.query('SELECT pedido_id,data FROM pedido_chofer_pasos WHERE empresa_id=$1 AND pedido_id=ANY($2::uuid[])', [empresaId, orders.map(p => p.id)])).rows;
  if (orders.some(p => !['pendiente', 'confirmado'].includes(p.estado) || p.factura_id || p.carga_real_at || p.descarga_real_at || legacyOperationalModel(p, steps.find(s => s.pedido_id === p.id)?.data).viajes[0].paradas.some(s => s.estado !== 'pendiente'))) fail('Hay pedidos iniciados o facturados.', 'ASSIGNMENT_STARTED');
  const assignment = {};
  for (const field of ['vehiculo_id', 'chofer_id', 'chofer2_id', 'remolque_id', 'remolque_id_manual', 'colaborador_id']) {
    const raw = patch[field];
    if (raw != null && raw !== '' && !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(raw))) fail('Recurso no válido.', 'ASSIGNMENT_ID', 400);
    assignment[field] = raw || null;
  }
  for (const field of ['matricula_manual', 'matricula_colaborador', 'remolque_matricula_colaborador']) assignment[field] = String(patch[field] || '').trim().toUpperCase().slice(0, 24) || null;
  if (assignment.colaborador_id) {
    if (!(await tx.query('SELECT id FROM colaboradores WHERE empresa_id=$1 AND id=$2', [empresaId, assignment.colaborador_id])).rows.length) fail('Colaborador no disponible.', 'ASSIGNMENT_SCOPE');
    for (const key of ['vehiculo_id', 'chofer_id', 'chofer2_id', 'remolque_id', 'remolque_id_manual', 'matricula_manual']) assignment[key] = null;
  } else {
    assignment.matricula_colaborador = assignment.remolque_matricula_colaborador = null;
    if (!assignment.vehiculo_id) fail('Selecciona un vehículo de la empresa o un colaborador.', 'ASSIGNMENT_VEHICLE', 400);
    const truck = (await tx.query('SELECT * FROM vehiculos WHERE empresa_id=$1 AND id=$2', [empresaId, assignment.vehiculo_id])).rows[0];
    if (!truck) fail('Vehículo no disponible.', 'ASSIGNMENT_SCOPE');
    if (/remolque|dolly/i.test(String(truck.clase||truck.tipo||''))) fail('Selecciona una tractora o camión rígido, no un remolque como vehículo principal.', 'ASSIGNMENT_VEHICLE', 400);
    assignment.chofer_id ||= truck.chofer_id || null;
    // Un rígido utiliza su propia carrocería salvo que se seleccione un remolque expresamente.
    if (String(truck.clase || truck.tipo || "").toLowerCase().includes("tractora")) assignment.remolque_id ||= truck.remolque_id || null;
    assignment.remolque_id_manual ||= assignment.remolque_id;
    if (requireConjunto && /tractora/i.test(String(truck.clase||truck.tipo||'')) && !assignment.remolque_id) fail('Selecciona el remolque del conjunto.', 'ASSIGNMENT_TRAILER', 400);
    if (assignment.remolque_id) {
      const trailer = (await tx.query('SELECT clase,tipo FROM vehiculos WHERE empresa_id=$1 AND id=$2', [empresaId, assignment.remolque_id])).rows[0];
      if (!trailer || !/remolque/i.test(String(trailer.clase||trailer.tipo||''))) fail('Selecciona un remolque válido de la empresa.', 'ASSIGNMENT_TRAILER', 400);
    }
    const aggregate = { ...orders[0], ...assignment };
    // Conservative envelope, not a claim of occupancy on every physical segment.
    for (const key of ['peso_kg', 'palets_cantidad', 'metros_lineales', 'carga_largo_m']) aggregate[key] = orders.reduce((sum, p) => sum + (Number(p[key]) || 0), 0);
    aggregate.fecha_carga = orders.map(p => day(p.fecha_carga || p.fecha_pedido)).sort()[0];
    aggregate.fecha_descarga = orders.map(p => day(p.fecha_descarga || p.fecha_entrega || p.fecha_carga)).sort().at(-1);
    await validateTrafficAssignment(tx, empresaId, aggregate, { ...assignment, asignar_solo_si_libre: true, asignacion_revisada: patch.asignacion_revisada === true }, actorId);
  }
  for (const order of orders) authorize?.({ ...order, ...assignment });
  assignment.remolque_id=assignment.remolque_id_manual||assignment.remolque_id;
  delete assignment.remolque_id_manual;
  const keys = Object.keys(assignment);
  await tx.query(`UPDATE pedidos SET ${keys.map((key, i) => `${key}=$${i + 3}`).join(',')} WHERE empresa_id=$1 AND grupaje_id=$2::uuid`, [empresaId, groupId, ...Object.values(assignment)]);
  // Save one version for the parent after every child update succeeds. Failure rolls all back.
  const result = await saveGroupagePlan(tx, { empresaId, grupajeId: groupId, operationId: saveOperationId || crypto.randomUUID(), actorId, version: trip?.version, confirm });
  await tx.query('INSERT INTO viaje_operaciones(empresa_id,client_operation_uuid,viaje_id,request_hash,resultado) VALUES($1,$2,$3,$4,$5)', [empresaId, operationId, result.viaje_id, hash, JSON.stringify(result)]);
  for (const order of orders) await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,actor_id,detalle) VALUES($1,$2,'grupaje.asignacion','usuario',$3,$4)", [order.id, empresaId, actorId, JSON.stringify({ viaje_id: result.viaje_id, asignacion: assignment, client_operation_uuid: operationId })]);
  return result;
}
async function protectJourneyAssignment(tx, empresaId, previous, patch) {
  patch={...patch};
  if(patch.remolque_id_manual!==undefined)patch.remolque_id=patch.remolque_id_manual;
  const keys = ['vehiculo_id','chofer_id','chofer2_id','remolque_id','colaborador_id','grupaje_id','matricula_manual','matricula_colaborador','remolque_matricula_colaborador'];
  if (!keys.some(key => Object.prototype.hasOwnProperty.call(patch,key) && String(patch[key]||'') !== String(previous[key]||''))) return;
  let linked;
  try { linked = (await tx.query(`SELECT v.id FROM viajes_operativos v JOIN viaje_pedidos vp ON vp.empresa_id=v.empresa_id AND vp.viaje_id=v.id
    WHERE vp.empresa_id=$1 AND vp.pedido_id=$2 AND vp.activo AND (v.legacy_grupaje_id IS NOT NULL OR v.version>1) AND v.estado<>'cancelado'`, [empresaId,previous.id])).rows[0]; }
  catch(error) { if (['42P01','42703'].includes(error.code)) return; throw error; }
  if (linked) fail('Este pedido forma parte de un viaje operativo. Usa Replanificación y relevos o la asignación del grupaje completo.', 'JOURNEY_ASSIGNMENT_REQUIRED');
}
module.exports = { assignGroupage, protectJourneyAssignment };

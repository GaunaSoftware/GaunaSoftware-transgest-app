const documents = require('./transportDocumentVersions');
const fail = (message, code) => { throw Object.assign(Error(message), {status:409, code}); };

// Public supplier access has already been checked by the caller. Only expose
// administrative original URLs; never regenerate a document from today's order.
async function summary(db, empresaId, pedidoId) {
  const rows = (await documents.list(db, empresaId, pedidoId)).filter(v => v.estado === 'activa');
  const versiones = rows.map(v => ({id:v.id, version:v.version, envio_id:v.envio_id,
    filename:v.filename, pdf_hash:v.pdf_hash, source:v.source, url:v.public_url}));
  return {source:'versioned_originals', versiones, status:{ready:versiones.length>0},
    soporte_url:versiones[0]?.url || '', remision:{download_url:versiones[0]?.url || ''}};
}

function review(body) {
  const ids = body?.document_versions;
  if (body?.deca_revisado !== true || !Array.isArray(ids) || !ids.length || ids.length > 200 ||
      !ids.every(id => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(String(id)))) {
    fail('Abre los DeCA vigentes y confirma que los has revisado y los llevas disponibles antes de salir.', 'DECA_REVIEW_REQUIRED');
  }
  return {dcd_revisado:true,dcd_disponible:true,dcd_versiones_revisadas:[...new Set(ids)].sort()};
}

// The old email action remains usable, but its departure is now atomic and
// subject to the same original/version/weight review as the current driver app.
async function emailDeparture(db, {tokenHash, body, notes}) {
  return db.transaction(async tx => {
    const candidate = (await tx.query("SELECT pedido_id,empresa_id FROM colaborador_pedido_tokens WHERE token_hash=$1 AND accion='camino' AND expires_at>NOW()", [tokenHash])).rows[0];
    if (!candidate) fail('El enlace ha caducado o no existe.', 'SUPPLIER_TOKEN_EXPIRED');
    // Same lock order as traffic assignment: order first, then its tokens.
    const order = (await tx.query('SELECT * FROM pedidos WHERE id=$1 AND empresa_id=$2 FOR UPDATE', [candidate.pedido_id,candidate.empresa_id])).rows[0];
    const token = (await tx.query("SELECT * FROM colaborador_pedido_tokens WHERE token_hash=$1 AND pedido_id=$2 AND empresa_id=$3 AND accion='camino' AND expires_at>NOW() FOR UPDATE", [tokenHash,candidate.pedido_id,candidate.empresa_id])).rows[0];
    if (!token) fail('El enlace ha caducado o no existe.', 'SUPPLIER_TOKEN_EXPIRED');
    if (!order || !order.colaborador_id || ['cancelado','facturado','entregado'].includes(order.estado)) fail('El transporte ya no permite registrar la salida.', 'TRANSPORT_STATE_TERMINAL');
    if (token.usado_at) return {id:order.id,empresa_id:order.empresa_id,replayed:true};
    const current = (await tx.query('SELECT data FROM pedido_chofer_pasos WHERE pedido_id=$1 AND empresa_id=$2', [order.id,order.empresa_id])).rows[0]?.data || {};
    if (!current.carga_ok && !order.colaborador_carga_confirmada_at) fail('Finaliza la carga antes de salir.', 'SUPPLIER_STEP_SEQUENCE');
    const reviewed=review(body);
    await documents.assertDeparture(tx,order.empresa_id,order,reviewed);
    const now=new Date().toISOString(),data={...current,...reviewed,viaje_iniciado:true,viaje_iniciado_at:now};
    await tx.query(`INSERT INTO pedido_chofer_pasos(pedido_id,empresa_id,data,updated_at) VALUES($1,$2,$3,NOW())
      ON CONFLICT(pedido_id) DO UPDATE SET data=EXCLUDED.data,updated_at=NOW()`,[order.id,order.empresa_id,JSON.stringify(data)]);
    await tx.query("UPDATE pedidos SET estado='en_curso',colaborador_en_camino_confirmada_at=NOW(),updated_at=NOW(),notas=TRIM(BOTH ' ' FROM CONCAT_WS(' | ',NULLIF(notas,''),$3::text)) WHERE id=$1 AND empresa_id=$2",[order.id,order.empresa_id,notes ? 'EN CAMINO COLABORADOR: '+notes : null]);
    await tx.query("INSERT INTO pedido_eventos(pedido_id,empresa_id,tipo,actor_tipo,detalle) VALUES($1,$2,'colaborador.en_camino_confirmado','colaborador',$3)",
      [order.id,order.empresa_id,JSON.stringify({notas:notes||null,document_versions:reviewed.dcd_versiones_revisadas,source:'legacy_email',token_id:token.id})]);
    await tx.query('UPDATE colaborador_pedido_tokens SET usado_at=NOW() WHERE id=$1',[token.id]);
    return {id:order.id,empresa_id:order.empresa_id,replayed:false};
  });
}
module.exports={summary,review,emailDeparture};

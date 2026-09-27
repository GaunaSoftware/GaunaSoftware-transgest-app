const crypto = require('crypto');
// Stable condition, not the continuously increasing wait-minute counter.
function fingerprint(item) {
  return crypto.createHash('sha256').update(JSON.stringify([item.key, item.estado, item.colaborador_id, item.chofer_id, item.fecha_carga, item.fecha_descarga, item.severity])).digest('hex');
}
async function unreadItems(db, user, items) {
  const { rows } = await db.query('SELECT alert_key,fingerprint FROM avisos_operativos_leidos WHERE empresa_id=$1 AND usuario_id=$2', [user.empresa_id, user.id]);
  const read = new Map(rows.map(r => [r.alert_key, r.fingerprint]));
  return items.filter(i => read.get(i.key) !== fingerprint(i));
}
async function markRead(db, user, items) {
  if (!items.length) return 0;
  const { rows } = await db.query(`INSERT INTO avisos_operativos_leidos(empresa_id,usuario_id,alert_key,fingerprint)
    SELECT $1::uuid,$2::uuid,x.key,x.fingerprint FROM jsonb_to_recordset($3::jsonb) AS x(key text,fingerprint text)
    ON CONFLICT(empresa_id,usuario_id,alert_key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,read_at=NOW() RETURNING alert_key`,
  [user.empresa_id, user.id, JSON.stringify(items.map(i => ({ key: i.key, fingerprint: fingerprint(i) })))]);
  return rows.length;
}
module.exports = { fingerprint, unreadItems, markRead };

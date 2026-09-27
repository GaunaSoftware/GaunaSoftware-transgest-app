const releases = require('../data/productReleases.json');
const { can, settings } = require('./noticeCenter');
const forbidden = () => Object.assign(new Error('Acceso no autorizado.'), { status: 403 });
function requireUser(user) { if (!user?.id || !user?.empresa_id) throw forbidden(); }
function releaseFor(user, id) {
  requireUser(user);
  const release = releases.find(r => r.id === id);
  if (!release) throw Object.assign(new Error('Actualización no encontrada.'), { status: 404 });
  return { ...release, items: release.items.filter(i => (!i.module || can(user, i.module)) && (!i.roles || i.roles.includes(user.rol))) };
}
async function getRelease(db, user, id) {
  const release = releaseFor(user, id);
  const { rows } = await db.query('SELECT dismissed_at FROM user_release_acknowledgements WHERE usuario_id=$1 AND release_id=$2', [user.id, id]);
  return { ...release, dismissed: !!rows.length };
}
async function dismissRelease(db, user, id) {
  releaseFor(user, id);
  await db.query('INSERT INTO user_release_acknowledgements(usuario_id,release_id) VALUES($1,$2) ON CONFLICT(usuario_id,release_id) DO NOTHING', [user.id, id]);
  return { dismissed: true, release_id: id };
}
async function agendaPreferences(db, user) {
  requireUser(user);
  if (!can(user, 'agenda')) throw forbidden();
  let allowed = [];
  if (can(user, 'avisos') && ['gerente','contable','administrativo','trafico','responsable_taller','mecanico'].includes(user.rol)) {
    allowed = (await settings(db, user)).map(({key,label}) => ({key,label}));
    if (can(user, 'pedidos')) allowed.unshift({key:'operativa',label:'Tráfico e incidencias de pedidos'});
  }
  const { rows } = await db.query('SELECT notice_types FROM agenda_preferences WHERE usuario_id=$1 AND empresa_id=$2', [user.id, user.empresa_id]);
  const selected = Array.isArray(rows[0]?.notice_types) ? rows[0].notice_types : [];
  const recommended = user.rol === 'contable' ? ['facturas'] : user.rol === 'trafico' ? ['operativa'] : ['vehiculos','choferes'];
  return { notice_types: selected.filter(key => allowed.some(a => a.key === key)), allowed, recommended: recommended.filter(key => allowed.some(a => a.key === key)) };
}
async function saveAgendaPreferences(db, user, types) {
  const config = await agendaPreferences(db, user);
  if (!Array.isArray(types) || types.length > 5 || new Set(types).size !== types.length || types.some(t => !config.allowed.some(a => a.key === t)))
    throw Object.assign(new Error('Selecciona solo tipos de aviso autorizados para tu perfil.'), { status: 400 });
  await db.query(`INSERT INTO agenda_preferences(usuario_id,empresa_id,notice_types) VALUES($1,$2,$3::jsonb)
    ON CONFLICT(usuario_id,empresa_id) DO UPDATE SET notice_types=EXCLUDED.notice_types,updated_at=NOW()`, [user.id,user.empresa_id,JSON.stringify(types)]);
  return { ...config, notice_types: types };
}
module.exports = { getRelease, dismissRelease, agendaPreferences, saveAgendaPreferences };

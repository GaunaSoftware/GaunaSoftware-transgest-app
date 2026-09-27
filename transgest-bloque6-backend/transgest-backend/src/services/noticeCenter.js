const { normalizePermissionsForRole } = require('../middleware/auth');
const { day, validInvoiceSql } = require('./financialKpis');

const TYPES = {
  facturas: { label: 'Facturas y cobros', module: 'facturacion', days: 30 },
  vehiculos: { label: 'Vehículos y remolques', module: 'vehiculos', days: 30 },
  choferes: { label: 'Conductores', module: 'choferes', days: 30 },
  plataformas: { label: 'Plataformas', module: null, days: 30 },
};
const OFFICE_ROLES = new Set(['gerente','contable','administrativo','trafico','responsable_taller','mecanico']);
const can = (user, module, action = 'ver') => normalizePermissionsForRole(user?.permisos, user?.rol)?.modulos?.[module]?.[action] === true;
const allowedType = (user, type) => TYPES[type] && (TYPES[type].module ? can(user, TYPES[type].module) : can(user, 'vehiculos') || can(user, 'choferes'));
function rulesFrom(raw) {
  const rows = Array.isArray(raw) ? raw : [];
  return Object.fromEntries(Object.entries(TYPES).map(([key, type]) => {
    const r = rows.find(r => r.tipo_aviso === key) || {};
    return [key, { enabled: r.activo !== false, days: Number.isInteger(r.dias_aviso) && r.dias_aviso >= 0 && r.dias_aviso <= 365 ? r.dias_aviso : type.days }];
  }));
}
async function settings(db, user) {
  if (!user?.empresa_id || !OFFICE_ROLES.has(user.rol) || !can(user, 'avisos')) throw Object.assign(new Error('Avisos de empresa no autorizado.'), { status:403 });
  const { rows } = await db.query('SELECT cfg_alertas FROM empresas WHERE id=$1', [user.empresa_id]);
  const rules = rulesFrom(rows[0]?.cfg_alertas);
  return Object.entries(TYPES).filter(([key]) => allowedType(user, key)).map(([key, t]) => ({ key, label: t.label, ...rules[key] }));
}
async function saveSettings(db, user, input) {
  if (user.rol !== 'gerente' || !can(user, 'avisos', 'editar')) throw Object.assign(new Error('Solo gerencia con permiso de edición puede configurar avisos.'), { status: 403 });
  if (!Array.isArray(input) || input.length !== Object.keys(TYPES).length || new Set(input.map(r => r.key)).size !== input.length || input.some(r => !TYPES[r.key] || typeof r.enabled !== 'boolean' || !Number.isInteger(r.days) || r.days < 0 || r.days > 365))
    throw Object.assign(new Error('Configura cada tipo con una antelación de 0 a 365 días.'), { status: 400 });
  const records = input.map(r => ({ tipo_aviso: r.key, activo: r.enabled, dias_aviso: r.days }));
  // Preserve maintenance rules and concurrent changes to unrelated configuration.
  await db.query(`UPDATE empresas SET cfg_alertas=COALESCE((SELECT jsonb_agg(r) FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cfg_alertas)='array' THEN cfg_alertas ELSE '[]'::jsonb END) r WHERE NOT (r ? 'tipo_aviso')),'[]'::jsonb) || $2::jsonb WHERE id=$1`, [user.empresa_id, JSON.stringify(records)]);
  return settings(db, user);
}
function difference(date, today) { return Math.round((Date.parse(`${day(date)}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86400000); }
function target(type, id, extra = {}) {
  const entity = type === 'facturas' ? 'factura' : type === 'choferes' ? 'chofer' : 'vehiculo';
  const view = type === 'facturas' ? 'facturacion' : type === 'choferes' ? 'choferes' : 'vehiculos';
  return { view, focusKey: `tms_${view}_focus`, focus: { [`${entity}_id`]: id, source: 'avisos', section: 'documentacion', open: true, ...extra } };
}
function platformDocs(raw) {
  let rows = raw;
  if (typeof rows === 'string') { try { rows = JSON.parse(rows); } catch { return []; } }
  return Array.isArray(rows) ? rows : [];
}
async function readNotices(db, user, { now = new Date(), category = '', text = '' } = {}) {
  if (!user?.empresa_id || !can(user, 'avisos')) throw Object.assign(new Error('Avisos no autorizado.'), { status: 403 });
  const cfg = await settings(db, user), rules = Object.fromEntries(cfg.map(r => [r.key, r]));
  const today = day(now), items = [], errors = [];
  const add = (category, id, title, date, destination, extra = {}) => {
    const rule = rules[category], days = difference(date, today);
    if (!rule?.enabled || !Number.isFinite(days) || days > rule.days) return;
    items.push({ id: `${category}:${id}`, category, title, date: day(date), days, severity: days < 0 ? 'vencido' : days === 0 ? 'hoy' : 'proximo', ...destination, ...extra });
  };
  const read = async (name, work) => { try { await work(); } catch (e) { errors.push({ source: name, status: 'error' }); } };
  if (can(user, 'facturacion')) await read('facturas', async () => {
    const { rows } = await db.query(`SELECT f.id,f.numero,f.fecha_vencimiento,f.total,f.estado,c.nombre AS cliente
      FROM facturas f LEFT JOIN clientes c ON c.id=f.cliente_id AND c.empresa_id=f.empresa_id
      WHERE f.empresa_id=$1 AND ${validInvoiceSql('f')} AND f.estado::text NOT IN ('cobrada','rectificada') AND f.total>0
      AND f.fecha <= $2::date AND f.fecha_vencimiento <= $2::date + 365
      AND COALESCE(to_jsonb(f)->>'origen_producto','transgest')<>'planner' AND NULLIF(to_jsonb(f)->>'planner_preparacion_id','') IS NULL`, [user.empresa_id, today]);
    for (const f of rows) add('facturas', f.id, `Factura ${f.numero}`, f.fecha_vencimiento, target('facturas', f.id, { numero: f.numero }), { entity: f.cliente, amount: Number(f.total), coverage: 'estimado', description: 'Total con impuestos de factura no marcada cobrada. No acredita un saldo conciliado con pagos parciales.' });
  });
  for (const type of ['vehiculos', 'choferes']) {
    if (!can(user, type)) continue;
    await read(type, async () => {
      const { rows } = await db.query(`SELECT id,to_jsonb(t) AS data FROM ${type} t WHERE empresa_id=$1 AND COALESCE((to_jsonb(t)->>'activo')::boolean,true)=true`, [user.empresa_id]);
      const docs = await db.query(`SELECT d.id,d.tipo,d.fecha_vencimiento,d.fecha_emision,d.created_at,d.${type === 'vehiculos' ? 'vehiculo' : 'chofer'}_id AS entity_id FROM docs_${type} d JOIN ${type} t ON t.id=d.${type === 'vehiculos' ? 'vehiculo' : 'chofer'}_id WHERE t.empresa_id=$1`, [user.empresa_id]);
      const latest = new Map();
      for (const d of docs.rows) {
        const key = `${d.entity_id}:${String(d.tipo || '').toLocaleLowerCase('es')}`;
        const prior = latest.get(key);
        if (!prior || day(d.fecha_vencimiento || d.fecha_emision || d.created_at) > day(prior.fecha_vencimiento || prior.fecha_emision || prior.created_at)) latest.set(key, d);
      }
      for (const { id, data: v } of rows) {
        const entity = type === 'vehiculos' ? v.matricula : [v.nombre, v.apellidos].filter(Boolean).join(' ');
        const defaults = type === 'vehiculos' ? [['ITV', v.fecha_itv], ['Seguro', v.fecha_seguro]] : [['CAP', v.cap_vencimiento], ['Carnet', v.carnet_vencimiento], ['Médico', v.medico_vencimiento]];
        for (const [name, date] of defaults) if (!latest.has(`${id}:${name.toLocaleLowerCase('es')}`)) add(type, `${id}:${name}`, `${name} · ${entity}`, date, target(type, id), { entity });
        for (const d of latest.values()) if (String(d.entity_id) === String(id)) add(type, d.id, `${d.tipo} · ${entity}`, d.fecha_vencimiento, target(type, id), { entity });
        for (const p of platformDocs(v.plataformas)) for (const [index, d] of (Array.isArray(p.documentos) ? p.documentos : []).entries())
          add('plataformas', `${type}:${id}:${p.id || p.nombre}:${d.id || index}`, `${p.nombre || 'Plataforma'} · ${d.nombre || 'Documento'}`, d.fecha_tope || d.caducidad, target(type, id, { section:'plataformas' }), { entity });
      }
    });
  }
  const filtered = items.filter(i => (!category || i.category === category) && (!text || `${i.title} ${i.entity || ''}`.toLocaleLowerCase('es').includes(text.toLocaleLowerCase('es')))).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return { items: filtered, total: filtered.length, categories: cfg, errors, coverage: errors.length ? 'parcial' : 'completo', date: today, updated_at: new Date().toISOString() };
}
module.exports = { TYPES, can, rulesFrom, settings, saveSettings, readNotices, target, difference };

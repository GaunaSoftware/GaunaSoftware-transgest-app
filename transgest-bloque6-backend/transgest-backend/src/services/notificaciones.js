const db = require("./db");

let schemaReady = null;

function ensureNotificacionesSchema() {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS notificaciones_internas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        empresa_id UUID NOT NULL,
        usuario_id UUID NOT NULL,
        tipo VARCHAR(80) NOT NULL,
        titulo VARCHAR(160) NOT NULL,
        mensaje TEXT,
        data JSONB NOT NULL DEFAULT '{}'::jsonb,
        leida BOOLEAN NOT NULL DEFAULT false,
        created_by UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        read_at TIMESTAMPTZ
      )
    `).then(() => Promise.all([
      db.query("CREATE INDEX IF NOT EXISTS idx_notificaciones_usuario ON notificaciones_internas(empresa_id, usuario_id, leida, created_at DESC)"),
      db.query("CREATE INDEX IF NOT EXISTS idx_notificaciones_tipo ON notificaciones_internas(empresa_id, tipo, created_at DESC)"),
    ])).catch(err => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

async function crearNotificacion({ empresa_id, usuario_id, tipo, titulo, mensaje, data = {}, created_by = null }) {
  if (!empresa_id || !usuario_id || !tipo || !titulo) return null;
  await ensureNotificacionesSchema();
  const dedupeKey = data && typeof data === "object" ? String(data.dedupe_key || "").trim() : "";
  if (dedupeKey) {
    const exists = await db.query(
      `SELECT id, empresa_id, usuario_id, tipo, titulo, mensaje, data, leida, created_at, read_at
         FROM notificaciones_internas
        WHERE empresa_id=$1
          AND usuario_id=$2
          AND tipo=$3
          AND leida=false
          AND data->>'dedupe_key'=$4
        ORDER BY created_at DESC
        LIMIT 1`,
      [empresa_id, usuario_id, tipo, dedupeKey]
    ).catch(() => ({ rows: [] }));
    if (exists.rows[0]) return exists.rows[0];
  }
  const { rows } = await db.query(
    `INSERT INTO notificaciones_internas
      (empresa_id, usuario_id, tipo, titulo, mensaje, data, created_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     RETURNING id, empresa_id, usuario_id, tipo, titulo, mensaje, data, leida, created_at, read_at`,
    [empresa_id, usuario_id, tipo, titulo, mensaje || "", JSON.stringify(data || {}), created_by]
  );
  return rows[0] || null;
}

async function listarNotificaciones(empresaId, usuarioId, { limit = 50, includeRead = false } = {}) {
  await ensureNotificacionesSchema();
  const max = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const showRead = includeRead === true || String(includeRead || "").toLowerCase() === "true";
  const [items, count] = await Promise.all([
    db.query(
      `SELECT id, tipo, titulo, mensaje, data, leida, created_at, read_at
         FROM notificaciones_internas
        WHERE empresa_id=$1 AND usuario_id=$2
          AND ($4::boolean = true OR leida=false)
        ORDER BY created_at DESC
        LIMIT $3`,
      [empresaId, usuarioId, max, showRead]
    ),
    db.query(
      `SELECT COUNT(*)::int AS no_leidas
         FROM notificaciones_internas
        WHERE empresa_id=$1 AND usuario_id=$2 AND leida=false`,
      [empresaId, usuarioId]
    ),
  ]);
  return { data: items.rows, no_leidas: Number(count.rows[0]?.no_leidas || 0) };
}

async function marcarLeida(empresaId, usuarioId, id) {
  await ensureNotificacionesSchema();
  const { rows } = await db.query(
    `UPDATE notificaciones_internas
        SET leida=true, read_at=COALESCE(read_at, NOW())
      WHERE empresa_id=$1 AND usuario_id=$2 AND id=$3
      RETURNING id, tipo, titulo, mensaje, data, leida, created_at, read_at`,
    [empresaId, usuarioId, id]
  );
  return rows[0] || null;
}

async function marcarTodasLeidas(empresaId, usuarioId) {
  await ensureNotificacionesSchema();
  const { rowCount } = await db.query(
    `UPDATE notificaciones_internas
        SET leida=true, read_at=COALESCE(read_at, NOW())
      WHERE empresa_id=$1 AND usuario_id=$2 AND leida=false`,
    [empresaId, usuarioId]
  );
  return rowCount || 0;
}

module.exports = {
  ensureNotificacionesSchema,
  crearNotificacion,
  listarNotificaciones,
  marcarLeida,
  marcarTodasLeidas,
};

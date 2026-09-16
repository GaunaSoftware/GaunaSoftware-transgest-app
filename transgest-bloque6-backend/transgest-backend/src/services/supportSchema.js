const db = require('./db');
let pending;
function ensureSupportSchema() {
  if (!pending) pending = db.transaction(async client => {
    // Serialize both legacy and current entry points, including concurrent instances.
    await client.query("SELECT pg_advisory_xact_lock(194016, 1)");
    await client.query(`
      CREATE TABLE IF NOT EXISTS soporte_solicitudes (
        id UUID PRIMARY KEY, empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
        usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL,
        asunto VARCHAR(160) NOT NULL, estado VARCHAR(24) NOT NULL DEFAULT 'abierta',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE soporte_solicitudes ADD COLUMN IF NOT EXISTS usuario_leido_at TIMESTAMPTZ;
      ALTER TABLE soporte_solicitudes ADD COLUMN IF NOT EXISTS soporte_leido_at TIMESTAMPTZ;
      CREATE TABLE IF NOT EXISTS soporte_mensajes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), mensaje TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now());
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS empresa_id UUID REFERENCES empresas(id) ON DELETE CASCADE;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS usuario_id UUID REFERENCES usuarios(id) ON DELETE SET NULL;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS nombre VARCHAR(180);
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS email VARCHAR(255);
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS estado VARCHAR(30) NOT NULL DEFAULT 'pendiente';
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS resuelto_at TIMESTAMPTZ;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS solicitud_id UUID REFERENCES soporte_solicitudes(id) ON DELETE CASCADE;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS autor_id TEXT;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS autor_nombre TEXT;
      ALTER TABLE soporte_mensajes ADD COLUMN IF NOT EXISTS desde_soporte BOOLEAN NOT NULL DEFAULT false;
      ALTER TABLE soporte_solicitudes ALTER COLUMN usuario_id DROP NOT NULL;
      INSERT INTO soporte_solicitudes (id, empresa_id, usuario_id, asunto, estado, created_at, updated_at)
        SELECT id,empresa_id,usuario_id,'Consulta de soporte (histórico)',
          CASE WHEN resuelto_at IS NOT NULL OR estado='resuelto' THEN 'resuelta' ELSE 'abierta' END,
          created_at,COALESCE(resuelto_at,created_at)
        FROM soporte_mensajes WHERE solicitud_id IS NULL AND empresa_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;
      UPDATE soporte_mensajes m SET solicitud_id=m.id, autor_id=COALESCE(m.usuario_id::text,'historico'),
        autor_nombre=COALESCE(NULLIF(m.nombre,''),'Usuario'), desde_soporte=false
        WHERE m.solicitud_id IS NULL AND EXISTS(SELECT 1 FROM soporte_solicitudes s WHERE s.id=m.id);
      CREATE INDEX IF NOT EXISTS soporte_usuario_idx ON soporte_solicitudes(empresa_id,usuario_id,updated_at);
      CREATE INDEX IF NOT EXISTS soporte_mensajes_idx ON soporte_mensajes(solicitud_id,created_at);
    `);
  }).catch(error => { pending = null; throw error; });
  return pending;
}
module.exports = { ensureSupportSchema };
